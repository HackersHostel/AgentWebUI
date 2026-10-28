"""Chats, messages, attached files, projects and cached agent options in one SQLite file. Calls are short and local,
so they run on the event loop.

Messages form a tree: each one records the message it follows (`parent`), and a chat points at the last message of
the thread on screen (`leaf`). Editing a message or regenerating a reply adds a sibling instead of replacing it."""
from __future__ import annotations

import json
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK (kind IN ('model', 'agent')),
    target TEXT NOT NULL,
    cwd TEXT NOT NULL DEFAULT '',
    session_id TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL DEFAULT '',
    parts TEXT NOT NULL DEFAULT '[]',
    meta TEXT NOT NULL DEFAULT '{}',
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    mime TEXT NOT NULL DEFAULT 'application/octet-stream',
    size INTEGER NOT NULL DEFAULT 0,
    origin TEXT NOT NULL DEFAULT 'upload',
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    folder TEXT NOT NULL DEFAULT '',
    target TEXT NOT NULL DEFAULT '',
    config TEXT NOT NULL DEFAULT '{}',
    instructions TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_options (
    agent_id TEXT PRIMARY KEY,
    options TEXT NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_chat ON messages (chat_id, id);
CREATE INDEX IF NOT EXISTS chats_updated ON chats (updated_at DESC);
CREATE INDEX IF NOT EXISTS files_chat ON files (chat_id);
"""

# Columns added after the first release, so an existing chats.db gains them on start.
COLUMNS = {
    "chats": [("config", "TEXT NOT NULL DEFAULT '{}'"), ("pinned", "INTEGER NOT NULL DEFAULT 0"),
              ("archived", "INTEGER NOT NULL DEFAULT 0"), ("project_id", "TEXT NOT NULL DEFAULT ''"),
              ("leaf", "INTEGER NOT NULL DEFAULT 0")],
    "messages": [("parent", "INTEGER NOT NULL DEFAULT 0")],
}
CHAT_FIELDS = ("title", "session_id", "target", "config", "pinned", "archived", "project_id", "leaf")


class Store:
    def __init__(self, path: Path | str) -> None:
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), isolation_level=None, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript(SCHEMA)
        self._migrate()

    def _migrate(self) -> None:
        for table, columns in COLUMNS.items():
            have = {row["name"] for row in self.db.execute(f"PRAGMA table_info({table})")}
            for name, spec in columns:
                if name in have:
                    continue
                self.db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {spec}")
                if (table, name) == ("messages", "parent"):  # older chats are one straight thread
                    self.db.execute("UPDATE messages SET parent = COALESCE((SELECT MAX(m.id) FROM messages m WHERE "
                                    "m.chat_id = messages.chat_id AND m.id < messages.id), 0)")
                if (table, name) == ("chats", "leaf"):
                    self.db.execute("UPDATE chats SET leaf = COALESCE((SELECT MAX(id) FROM messages m WHERE "
                                    "m.chat_id = chats.id), 0)")

    def close(self) -> None:
        self.db.close()

    # --- chats ---
    def list_chats(self) -> list[dict[str, Any]]:
        rows = self.db.execute("SELECT * FROM chats ORDER BY pinned DESC, updated_at DESC").fetchall()
        return [_chat(row) for row in rows]

    def get_chat(self, chat_id: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM chats WHERE id = ?", (chat_id,)).fetchone()
        return _chat(row) if row else None

    def create_chat(self, kind: str, target: str, cwd: str = "", title: str = "", config: dict | None = None,
                    project_id: str = "", prefix: str = "") -> dict[str, Any]:
        now = time.time()
        chat_id = prefix + secrets.token_hex(8)
        self.db.execute("INSERT INTO chats (id, title, kind, target, cwd, config, project_id, created_at, updated_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (chat_id, title, kind, target, cwd, json.dumps(config or {}), project_id, now, now))
        return self.get_chat(chat_id)  # type: ignore[return-value]

    def update_chat(self, chat_id: str, touch: bool = True, **fields: Any) -> None:
        allowed = {key: (json.dumps(value) if key == "config" else value)
                   for key, value in fields.items() if key in CHAT_FIELDS}
        if touch:
            allowed["updated_at"] = time.time()
        if not allowed:
            return
        assignments = ", ".join(f"{key} = ?" for key in allowed)
        self.db.execute(f"UPDATE chats SET {assignments} WHERE id = ?", (*allowed.values(), chat_id))

    def delete_chat(self, chat_id: str) -> list[str]:
        """Remove the chat; the ids of its files are returned so their bytes can go too."""
        files = [row["id"] for row in self.db.execute("SELECT id FROM files WHERE chat_id = ?", (chat_id,))]
        self.db.execute("DELETE FROM files WHERE chat_id = ?", (chat_id,))
        self.db.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
        return files

    def search(self, query: str, limit: int = 30) -> list[dict[str, Any]]:
        """Chats whose title or messages contain `query`, newest first, with a snippet around the first hit."""
        needle = query.strip()
        if not needle:
            return []
        like = "%" + needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        rows = self.db.execute(
            "SELECT c.*, (SELECT content FROM messages m WHERE m.chat_id = c.id AND m.content LIKE ? ESCAPE '\\' "
            "ORDER BY m.id LIMIT 1) AS hit FROM chats c WHERE c.title LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM "
            "messages m WHERE m.chat_id = c.id AND m.content LIKE ? ESCAPE '\\') ORDER BY c.updated_at DESC LIMIT ?",
            (like, like, like, limit)).fetchall()
        out = []
        for row in rows:
            chat = _chat(row)
            hit = chat.pop("hit") or ""
            snippet = ""
            if hit and needle.lower() not in chat["title"].lower():
                at = hit.lower().find(needle.lower())
                start = max(at - 40, 0)
                snippet = ("…" if start else "") + " ".join(hit[start:at + len(needle) + 60].split()) + "…"
            out.append({**chat, "snippet": snippet, "in_title": needle.lower() in chat["title"].lower()})
        return out

    def clone_chat(self, chat_id: str, title: str, upto: int | None = None) -> dict[str, Any] | None:
        """A copy of the thread on screen (up to and including `upto`), as a new chat with no agent session."""
        chat = self.get_chat(chat_id)
        if chat is None:
            return None
        copy = self.create_chat(chat["kind"], chat["target"], chat["cwd"], title, chat["config"], chat["project_id"])
        for message in self.messages(chat_id):
            self.add_message(copy["id"], message["role"], message["content"], message["parts"], message["meta"])
            if message["id"] == upto:
                break
        return self.get_chat(copy["id"])

    # --- messages ---
    def _all(self, chat_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute("SELECT * FROM messages WHERE chat_id = ? ORDER BY id", (chat_id,)).fetchall()
        return [_message(row) for row in rows]

    def messages(self, chat_id: str) -> list[dict[str, Any]]:
        """The thread on screen, oldest first. Each message lists its siblings (other versions) by id."""
        everything = self._all(chat_id)
        if not everything:
            return []
        by_id = {m["id"]: m for m in everything}
        chat = self.get_chat(chat_id)
        leaf = chat["leaf"] if chat and chat["leaf"] in by_id else everything[-1]["id"]
        thread = []
        node = by_id.get(leaf)
        while node is not None:
            thread.append(node)
            node = by_id.get(node["parent"])
        thread.reverse()
        for message in thread:
            message["siblings"] = [m["id"] for m in everything
                                   if m["parent"] == message["parent"] and m["role"] == message["role"]]
        return thread

    def get_message(self, chat_id: str, message_id: int) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM messages WHERE chat_id = ? AND id = ?", (chat_id, message_id)).fetchone()
        return _message(row) if row else None

    def add_message(self, chat_id: str, role: str, content: str, parts: list | None = None,
                    meta: dict | None = None, parent: int | None = None) -> dict[str, Any]:
        """Add a message after `parent` (the end of the thread on screen when None) and show its thread."""
        now = time.time()
        if parent is None:
            chat = self.get_chat(chat_id)
            thread = self.messages(chat_id) if chat else []
            parent = thread[-1]["id"] if thread else 0
        cursor = self.db.execute(
            "INSERT INTO messages (chat_id, role, content, parts, meta, parent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (chat_id, role, content, json.dumps(parts or []), json.dumps(meta or {}), parent, now))
        self.db.execute("UPDATE chats SET updated_at = ?, leaf = ? WHERE id = ?", (now, cursor.lastrowid, chat_id))
        row = self.db.execute("SELECT * FROM messages WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return _message(row)

    def show_version(self, chat_id: str, message_id: int) -> bool:
        """Show the thread through `message_id`: the newest path below it becomes the chat's leaf."""
        everything = self._all(chat_id)
        if not any(m["id"] == message_id for m in everything):
            return False
        leaf = message_id
        while True:
            children = [m["id"] for m in everything if m["parent"] == leaf]
            if not children:
                break
            leaf = max(children)
        self.db.execute("UPDATE chats SET leaf = ? WHERE id = ?", (leaf, chat_id))
        return True

    # --- files people attach and agents produce ---
    def add_file(self, chat_id: str, name: str, mime: str, size: int, origin: str = "upload") -> dict[str, Any]:
        file_id = secrets.token_hex(12)
        self.db.execute("INSERT INTO files (id, chat_id, name, mime, size, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (file_id, chat_id, name, mime, size, origin, time.time()))
        return self.get_file(file_id)  # type: ignore[return-value]

    def get_file(self, file_id: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
        return dict(row) if row else None

    def claim_files(self, file_ids: list[str], chat_id: str) -> None:
        for file_id in file_ids:
            self.db.execute("UPDATE files SET chat_id = ? WHERE id = ? AND chat_id = ''", (chat_id, file_id))

    # --- projects ---
    def list_projects(self) -> list[dict[str, Any]]:
        return [_project(row) for row in self.db.execute("SELECT * FROM projects ORDER BY name COLLATE NOCASE")]

    def get_project(self, project_id: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        return _project(row) if row else None

    def save_project(self, project_id: str | None, **fields: Any) -> dict[str, Any]:
        now = time.time()
        values = {key: (json.dumps(value) if key == "config" else value) for key, value in fields.items()
                  if key in ("name", "folder", "target", "config", "instructions")}
        if project_id is None:
            project_id = secrets.token_hex(6)
            self.db.execute("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
                            (project_id, values.get("name", ""), now, now))
        if values:
            assignments = ", ".join(f"{key} = ?" for key in values)
            self.db.execute(f"UPDATE projects SET {assignments}, updated_at = ? WHERE id = ?",
                            (*values.values(), now, project_id))
        return self.get_project(project_id)  # type: ignore[return-value]

    def delete_project(self, project_id: str) -> bool:
        self.db.execute("UPDATE chats SET project_id = '' WHERE project_id = ?", (project_id,))
        return self.db.execute("DELETE FROM projects WHERE id = ?", (project_id,)).rowcount > 0

    # --- what each agent offers (model, effort, …), so the home screen can show it before a session exists ---
    def agent_options(self, agent_id: str) -> list[dict[str, Any]] | None:
        row = self.db.execute("SELECT options FROM agent_options WHERE agent_id = ?", (agent_id,)).fetchone()
        return json.loads(row["options"]) if row else None

    def set_agent_options(self, agent_id: str, options: list[dict[str, Any]]) -> None:
        self.db.execute("INSERT INTO agent_options (agent_id, options, updated_at) VALUES (?, ?, ?) ON CONFLICT"
                        "(agent_id) DO UPDATE SET options = excluded.options, updated_at = excluded.updated_at",
                        (agent_id, json.dumps(options), time.time()))

    def backup(self, target: Path) -> None:
        """A consistent copy of the database, safe while the server runs."""
        destination = sqlite3.connect(str(target))
        with destination:
            self.db.backup(destination)
        destination.close()


def _chat(row: sqlite3.Row) -> dict[str, Any]:
    chat = dict(row)
    if "config" in chat:
        chat["config"] = json.loads(chat["config"] or "{}")
    for key in ("pinned", "archived"):
        if key in chat:
            chat[key] = bool(chat[key])
    return chat


def _message(row: sqlite3.Row) -> dict[str, Any]:
    message = dict(row)
    message["parts"] = json.loads(message["parts"])
    message["meta"] = json.loads(message["meta"])
    return message


def _project(row: sqlite3.Row) -> dict[str, Any]:
    project = dict(row)
    project["config"] = json.loads(project["config"] or "{}")
    return project
