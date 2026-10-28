"""Files and Git under FILES_ROOTS: browse, read, edit, upload, search, and the server's own `git` command.

Every path is resolved (symlinks included) and must stay inside one of the roots, so `..` or a link cannot reach the
rest of the server. Git runs without a terminal and never prompts; it uses the server's own Git sign-in."""
from __future__ import annotations

import asyncio
import fnmatch
import mimetypes
import os
import re
import shutil
from pathlib import Path
from typing import Any

from .config import Settings

TEXT_LIMIT = 2 * 1024 * 1024
SKIP = {".git", "node_modules", ".venv", "venv", "__pycache__", ".mypy_cache", ".pytest_cache", "dist", "build",
        ".next", ".cache", "target"}
GIT_TIMEOUT = 120


class WorkspaceError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def resolve(settings: Settings, path: str) -> Path:
    """The real path for `path`, refused when it leaves every root."""
    if not path:
        raise WorkspaceError(422, "a path is required")
    resolved = Path(os.path.expanduser(path)).resolve()
    if not settings.allowed(str(resolved)):
        raise WorkspaceError(403, f"{path} is outside the folders this server shares (FILES_ROOTS)")
    return resolved


def roots(settings: Settings) -> list[dict[str, Any]]:
    return [{"path": root, "name": Path(root).name or root, "exists": Path(root).is_dir()} for root in settings.roots]


def _entry(path: Path) -> dict[str, Any]:
    try:
        stat = path.stat()
        size, mtime = stat.st_size, stat.st_mtime
    except OSError:
        size, mtime = 0, 0.0
    return {"name": path.name, "path": str(path), "dir": path.is_dir(), "size": size, "mtime": mtime}


def list_dir(settings: Settings, path: str, hidden: bool = False) -> dict[str, Any]:
    folder = resolve(settings, path)
    if not folder.is_dir():
        raise WorkspaceError(404, f"{path} is not a folder")
    try:
        children = [child for child in folder.iterdir() if hidden or not child.name.startswith(".")]
    except PermissionError:
        raise WorkspaceError(403, f"this server may not read {path}") from None
    entries = sorted((_entry(child) for child in children), key=lambda e: (not e["dir"], e["name"].lower()))
    parent = str(folder.parent) if settings.allowed(str(folder.parent)) and folder.parent != folder else None
    return {"path": str(folder), "name": folder.name, "parent": parent, "entries": entries}


def read_file(settings: Settings, path: str) -> dict[str, Any]:
    file = resolve(settings, path)
    if not file.is_file():
        raise WorkspaceError(404, f"{path} is not a file")
    info = _entry(file)
    mime = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
    info["mime"] = mime
    if info["size"] > TEXT_LIMIT:
        return {**info, "text": None, "reason": "too_big"}
    data = file.read_bytes()
    if b"\0" in data[:8192]:
        return {**info, "text": None, "reason": "binary"}
    try:
        return {**info, "text": data.decode("utf-8")}
    except UnicodeDecodeError:
        return {**info, "text": None, "reason": "binary"}


def write_file(settings: Settings, path: str, content: str, create: bool = False) -> dict[str, Any]:
    file = resolve(settings, path)
    if file.is_dir():
        raise WorkspaceError(409, f"{path} is a folder")
    if create and file.exists():
        raise WorkspaceError(409, f"{file.name} already exists")
    if not file.parent.is_dir():
        raise WorkspaceError(404, f"the folder {file.parent} doesn't exist")
    file.write_text(content, encoding="utf-8")
    return _entry(file)


def write_bytes(settings: Settings, folder: str, name: str, data: bytes) -> dict[str, Any]:
    target_dir = resolve(settings, folder)
    clean = Path(name).name
    if not target_dir.is_dir() or not clean or clean in (".", ".."):
        raise WorkspaceError(422, "choose a folder and a file name")
    target = resolve(settings, str(target_dir / clean))
    stem, suffix, n = target.stem, target.suffix, 1
    while target.exists():  # never overwrite on upload
        n += 1
        target = target_dir / f"{stem} ({n}){suffix}"
    target.write_bytes(data)
    return _entry(target)


def make_dir(settings: Settings, path: str) -> dict[str, Any]:
    folder = resolve(settings, path)
    if folder.exists():
        raise WorkspaceError(409, f"{folder.name} already exists")
    folder.mkdir(parents=True)
    return _entry(folder)


def rename(settings: Settings, path: str, new_path: str) -> dict[str, Any]:
    source, target = resolve(settings, path), resolve(settings, new_path)
    if not source.exists():
        raise WorkspaceError(404, f"{path} doesn't exist")
    if target.exists():
        raise WorkspaceError(409, f"{target.name} already exists")
    if any(source == Path(root).resolve() for root in settings.roots):
        raise WorkspaceError(403, "a shared folder itself can't be moved")
    source.rename(target)
    return _entry(target)


def delete(settings: Settings, path: str) -> None:
    target = resolve(settings, path)
    if any(target == Path(root).resolve() for root in settings.roots):
        raise WorkspaceError(403, "a shared folder itself can't be deleted")
    if target.is_dir() and not target.is_symlink():
        shutil.rmtree(target)
    elif target.exists() or target.is_symlink():
        target.unlink()
    else:
        raise WorkspaceError(404, f"{path} doesn't exist")


def _walk(folder: Path):
    for current, dirs, files in os.walk(folder):
        dirs[:] = sorted(d for d in dirs if d not in SKIP and not d.startswith("."))
        for name in sorted(files):
            yield Path(current) / name


def find_files(settings: Settings, path: str, query: str, limit: int = 50) -> list[dict[str, Any]]:
    """Files whose path contains the query's letters in order (like ⌘P in an editor), best first."""
    folder = resolve(settings, path)
    needle = query.lower().replace(" ", "")
    scored = []
    for count, file in enumerate(_walk(folder)):
        if count > 20000:
            break
        rel = str(file.relative_to(folder))
        score = _fuzzy(needle, rel.lower())
        if score is not None:
            scored.append((score, rel, file))
    scored.sort(key=lambda s: (s[0], len(s[1])))
    return [{"path": str(file), "rel": rel, "name": file.name} for _, rel, file in scored[:limit]]


def _fuzzy(needle: str, text: str) -> int | None:
    if not needle:
        return 0
    name = text.rsplit("/", 1)[-1]
    if needle in name:
        return name.index(needle)
    if needle in text:
        return 100 + text.index(needle)
    at, gaps = 0, 0
    for ch in needle:
        found = text.find(ch, at)
        if found < 0:
            return None
        gaps += found - at
        at = found + 1
    return 1000 + gaps


def grep(settings: Settings, path: str, query: str, regex: bool = False, case: bool = False,
         include: str = "", limit: int = 300) -> dict[str, Any]:
    """Lines matching `query` in the text files under `path`, grouped by file."""
    folder = resolve(settings, path)
    try:
        pattern = re.compile(query if regex else re.escape(query), 0 if case else re.IGNORECASE)
    except re.error as exc:
        raise WorkspaceError(422, f"not a valid pattern: {exc}") from None
    files: list[dict[str, Any]] = []
    total = 0
    for file in _walk(folder):
        rel = str(file.relative_to(folder))
        if include and not fnmatch.fnmatch(rel, include):
            continue
        try:
            if file.stat().st_size > TEXT_LIMIT:
                continue
            data = file.read_bytes()
        except OSError:
            continue
        if b"\0" in data[:4096]:
            continue
        hits = []
        for number, line in enumerate(data.decode("utf-8", "replace").splitlines(), 1):
            if pattern.search(line):
                hits.append({"line": number, "text": line[:300]})
                total += 1
                if total >= limit:
                    break
        if hits:
            files.append({"path": str(file), "rel": rel, "hits": hits})
        if total >= limit:
            break
    return {"files": files, "total": total, "truncated": total >= limit}


# --- Git ---
async def git(cwd: Path, *args: str, timeout: float = GIT_TIMEOUT) -> tuple[int, str, str]:
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "", "LC_ALL": "C"}
    try:
        proc = await asyncio.create_subprocess_exec("git", *args, cwd=str(cwd), env=env, stdin=asyncio.subprocess.DEVNULL,
                                                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    except FileNotFoundError:
        raise WorkspaceError(501, "git is not installed on this server") from None
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except TimeoutError:
        proc.kill()
        raise WorkspaceError(504, f"git {args[0]} took longer than {int(timeout)} s") from None
    return proc.returncode or 0, out.decode("utf-8", "replace"), err.decode("utf-8", "replace")


async def _must(cwd: Path, *args: str, timeout: float = GIT_TIMEOUT) -> str:
    code, out, err = await git(cwd, *args, timeout=timeout)
    if code != 0:
        message = (err or out).strip().splitlines()
        raise WorkspaceError(409, f"git {args[0]}: {message[-1] if message else 'failed'}")
    return out


async def repo_root(settings: Settings, path: str) -> Path | None:
    folder = resolve(settings, path)
    if folder.is_file():
        folder = folder.parent
    code, out, _ = await git(folder, "rev-parse", "--show-toplevel")
    if code != 0:
        return None
    root = Path(out.strip()).resolve()
    return root if settings.allowed(str(root)) else folder


async def status(settings: Settings, path: str) -> dict[str, Any]:
    root = await repo_root(settings, path)
    if root is None:
        return {"repo": False, "path": str(resolve(settings, path))}
    out = await _must(root, "status", "--porcelain=v1", "-b", "-z", "--untracked-files=all")
    entries = out.split("\0")
    head = entries[0][3:] if entries and entries[0].startswith("## ") else ""
    branch, _, tracking = head.partition("...")
    ahead = behind = 0
    if m := re.search(r"ahead (\d+)", tracking):
        ahead = int(m[1])
    if m := re.search(r"behind (\d+)", tracking):
        behind = int(m[1])
    changes = []
    items = entries[1:]
    i = 0
    while i < len(items):
        item = items[i]
        i += 1
        if len(item) < 4:
            continue
        code, file = item[:2], item[3:]
        if code[0] in "RC":
            i += 1  # the original name follows a rename
        changes.append({"path": str(root / file), "rel": file, "index": code[0], "work": code[1],
                        "status": _status_word(code)})
    if branch.startswith("No commits yet on "):
        branch = branch[len("No commits yet on "):]
    return {"repo": True, "root": str(root), "branch": branch.split(" ")[0], "upstream": tracking.split(" ")[0],
            "ahead": ahead, "behind": behind, "changes": changes}


def _status_word(code: str) -> str:
    if code == "??":
        return "untracked"
    if "U" in code or code in ("AA", "DD"):
        return "conflict"
    for letter, word in (("D", "deleted"), ("A", "added"), ("R", "renamed"), ("M", "modified")):
        if letter in code:
            return word
    return "modified"


async def diff(settings: Settings, path: str, file: str = "") -> dict[str, Any]:
    """The old (HEAD) and new (on disk) text of each changed file, or of one; the page draws the line diff."""
    info = await status(settings, path)
    if not info["repo"]:
        raise WorkspaceError(422, "this folder is not a Git repository")
    root = Path(info["root"])
    wanted = str(resolve(settings, file)) if file else None
    files = []
    for change in info["changes"]:
        if wanted and change["path"] != wanted:
            continue
        full = Path(change["path"])
        code, old, _ = await git(root, "show", f"HEAD:{change['rel']}")
        new = ""
        if full.is_file() and full.stat().st_size < TEXT_LIMIT:
            new = full.read_text(encoding="utf-8", errors="replace")
        files.append({"path": change["path"], "rel": change["rel"], "status": change["status"],
                      "old": old if code == 0 else "", "new": new})
        if len(files) >= 40:
            break
    return {"files": files}


async def _has_head(root: Path) -> bool:
    return (await git(root, "rev-parse", "--verify", "HEAD"))[0] == 0


async def commit(settings: Settings, path: str, message: str, files: list[str] | None = None) -> dict[str, Any]:
    root = await repo_root(settings, path)
    if root is None:
        raise WorkspaceError(422, "this folder is not a Git repository")
    if not message.strip():
        raise WorkspaceError(422, "write a commit message")
    if files:
        targets = [str(resolve(settings, f)) for f in files]
        await _must(root, "add", "-A", "--", *targets)
        await _must(root, "commit", "-m", message.strip(), "--", *targets)
    else:
        await _must(root, "add", "-A")
        await _must(root, "commit", "-m", message.strip())
    return await status(settings, str(root))


async def branches(settings: Settings, path: str) -> dict[str, Any]:
    root = await repo_root(settings, path)
    if root is None:
        raise WorkspaceError(422, "this folder is not a Git repository")
    out = await _must(root, "branch", "--all", "--format=%(refname:short)%09%(HEAD)")
    names = []
    current = ""
    for line in out.splitlines():
        name, _, mark = line.partition("\t")
        if name.endswith("/HEAD") or not name:
            continue
        names.append(name)
        if mark.strip() == "*":
            current = name
    return {"current": current, "branches": names}


async def switch(settings: Settings, path: str, branch: str, create: bool = False) -> dict[str, Any]:
    root = await repo_root(settings, path)
    if root is None:
        raise WorkspaceError(422, "this folder is not a Git repository")
    if not re.fullmatch(r"[\w./-]+", branch) or branch.startswith("-"):
        raise WorkspaceError(422, "not a valid branch name")
    await _must(root, "switch", *(["-c"] if create else []), branch)
    return await status(settings, str(root))


async def sync(settings: Settings, path: str, action: str) -> dict[str, Any]:
    """Push or pull with the server's own Git sign-in; pull only fast-forwards, so it never makes a merge."""
    root = await repo_root(settings, path)
    if root is None:
        raise WorkspaceError(422, "this folder is not a Git repository")
    if action == "push":
        info = await status(settings, str(root))
        args = ["push"] if info["upstream"] else ["push", "-u", "origin", info["branch"]]
        await _must(root, *args)
    elif action == "pull":
        await _must(root, "pull", "--ff-only")
    elif action == "fetch":
        await _must(root, "fetch", "--prune")
    else:
        raise WorkspaceError(422, "push, pull or fetch")
    return await status(settings, str(root))


async def log(settings: Settings, path: str, limit: int = 30) -> list[dict[str, Any]]:
    root = await repo_root(settings, path)
    if root is None or not await _has_head(root):
        return []
    out = await _must(root, "log", f"-n{limit}", "--format=%h%x1f%an%x1f%at%x1f%s")
    rows = []
    for line in out.splitlines():
        sha, author, at, subject = (line.split("\x1f") + ["", "", "", ""])[:4]
        rows.append({"sha": sha, "author": author, "at": float(at or 0), "subject": subject})
    return rows


async def init(settings: Settings, path: str) -> dict[str, Any]:
    folder = resolve(settings, path)
    await _must(folder, "init")
    return await status(settings, str(folder))


async def clone(settings: Settings, url: str, into: str) -> dict[str, Any]:
    """Clone a repository into a new folder inside a root."""
    parent = resolve(settings, into)
    if not re.match(r"^(https://|git@|ssh://)[\w.@:/~+-]+$", url):
        raise WorkspaceError(422, "use an https:// or git@ address")
    name = re.sub(r"\.git$", "", url.rstrip("/").rsplit("/", 1)[-1].rsplit(":", 1)[-1]) or "repository"
    target = parent / name
    if target.exists():
        raise WorkspaceError(409, f"{name} already exists in {parent.name}")
    await _must(parent, "clone", "--", url, str(target), timeout=600)
    return _entry(target)
