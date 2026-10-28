"""The HTTP API and the web page. A reply streams as server-sent events from the request that sent the message;
the reply runs on its own, so closing the tab does not stop it, and `GET /api/chats/{id}/events` picks it back up."""
from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import logging
import mimetypes
import os
import secrets
import time
from pathlib import Path
from typing import Any

import aiohttp
from aiohttp import web

from . import __version__, workspace
from .acp import AgentError, AgentProcess, Agents, Session, choices_of, restrict_models
from .config import Settings, is_loopback
from .providers import ProviderError, Providers
from .store import Store
from .turns import Turn

log = logging.getLogger("agentwebui")
STATIC = Path(__file__).parent / "static"
COOKIE = "awl_session"
CANCEL_GRACE = 15
OPEN_PATHS = {"/", "/embed", "/api/health", "/api/session", "/api/login", "/manifest.webmanifest", "/brand/logo"}
EMBED_MAX_AGE = 300  # seconds an /embed link may live
TEXT_INLINE = 200 * 1024  # a text attachment up to this size goes into a model chat as text
LOGIN_TRIES, LOGIN_WINDOW = 8, 600
# Shown to a model (with the system prompt) and to an agent (before its first prompt), so a reply can use the
# page's picker, images and file cards. RICH_REPLIES=false in .env leaves it out.
RICH_NOTE = """You are talking to a person through AgentWebUI, a chat page that renders Markdown. It also shows:
- A picker. When a short choice from the person really helps, end your reply with a fenced block whose language is \
`choices`, holding JSON: {"question": "…", "type": "single", "options": ["A", "B"]}. Types: single, multi (with \
optional "min"/"max"), confirm, text, scale ("min", "max", "labels"), number ("min", "max", "unit"), date, select \
(a long list), rank. Several at once: {"questions": [ … ]}. Their answer comes back as their next message.
- Images: Markdown ![alt](url). {files}
- Files to download: a fenced block whose language is `file` with a name, like ```file name="report.csv", holding \
the file's text."""
AGENT_FILES = "A path to a file in your working folder works as well, so after you create an image, chart or \
document, show it with ![name](path) or offer it with [name](path)."

SETTINGS = web.AppKey("settings", Settings)
STORE = web.AppKey("store", Store)
TEMP = web.AppKey("temp", Store)
PROVIDERS = web.AppKey("providers", Providers)
AGENTS = web.AppKey("agents", Agents)
TURNS = web.AppKey("turns", dict)
TOKEN = web.AppKey("token", str)
HTTP = web.AppKey("http", aiohttp.ClientSession)
LOGINS = web.AppKey("logins", dict)
ASSETS = web.AppKey("assets", str)
EMBEDS = web.AppKey("embeds", dict)  # nonce → expiry of every /embed link already used


def create_app(settings: Settings) -> web.Application:
    app = web.Application(middlewares=[guard], client_max_size=(settings.upload_mb * 4 // 3 + 2) * 1024 * 1024)
    app[SETTINGS] = settings
    app[STORE] = Store(settings.data_dir / "chats.db")
    app[TEMP] = Store(":memory:")  # temporary chats: never written to disk, gone on restart
    app[AGENTS] = Agents(settings.agents, settings.agent_idle_minutes)
    for process in app[AGENTS].processes.values():
        process.on_options = app[STORE].set_agent_options
    for agent in settings.agents:
        # Options cached before AGENT_<ID>_MODELS changed still list the old models; everything cached after this
        # comes from a session, which applies the list itself.
        cached = app[STORE].agent_options(agent.id)
        if agent.models and cached is not None:
            app[STORE].set_agent_options(agent.id, restrict_models(cached, agent.models))
    app[TURNS] = {}
    app[LOGINS] = {}
    app[EMBEDS] = {}
    app[TOKEN] = session_token(settings) if settings.password else ""
    app[ASSETS] = _assets_version()
    app.cleanup_ctx.append(_lifetime)
    app.on_response_prepare.append(_revalidate_assets)
    app.on_response_prepare.append(_frame_policy)
    app.add_routes([
        web.get("/", index),
        web.get("/embed", embed),
        web.get("/manifest.webmanifest", manifest),
        web.get("/brand/logo", brand_logo),
        web.get("/api/health", health),
        web.get("/api/session", session_state),
        web.post("/api/login", login),
        web.post("/api/logout", logout),
        web.get("/api/config", config),
        web.get("/api/agents/{id}/options", agent_options),
        web.get("/api/chats", list_chats),
        web.post("/api/chats", create_chat),
        web.get("/api/chats/{id}", get_chat),
        web.patch("/api/chats/{id}", update_chat),
        web.delete("/api/chats/{id}", delete_chat),
        web.post("/api/chats/{id}/clone", clone_chat),
        web.get("/api/search", search),
        web.post("/api/chats/{id}/messages", send_message),
        web.post("/api/chats/{id}/retry", retry_reply),
        web.post("/api/chats/{id}/version", show_version),
        web.post("/api/chats/{id}/mode", set_mode),
        web.post("/api/chats/{id}/config", set_config),
        web.get("/api/chats/{id}/events", follow_chat),
        web.post("/api/chats/{id}/cancel", cancel_chat),
        web.post("/api/chats/{id}/permissions/{question}", answer_permission),
        web.get("/api/chats/{id}/local", chat_local_file),
        web.post("/api/files", upload_file),
        web.get("/api/files/{id}", get_file),
        web.get("/api/projects", list_projects),
        web.post("/api/projects", save_project),
        web.patch("/api/projects/{id}", save_project),
        web.delete("/api/projects/{id}", delete_project),
        web.get("/api/fs/roots", fs_roots),
        web.get("/api/fs/list", fs_list),
        web.get("/api/fs/read", fs_read),
        web.get("/api/fs/raw", fs_raw),
        web.post("/api/fs/write", fs_write),
        web.post("/api/fs/upload", fs_upload),
        web.post("/api/fs/mkdir", fs_mkdir),
        web.post("/api/fs/rename", fs_rename),
        web.post("/api/fs/delete", fs_delete),
        web.get("/api/fs/find", fs_find),
        web.get("/api/fs/grep", fs_grep),
        web.get("/api/git/status", git_status),
        web.get("/api/git/diff", git_diff),
        web.get("/api/git/log", git_log),
        web.get("/api/git/branches", git_branches),
        web.post("/api/git/commit", git_commit),
        web.post("/api/git/switch", git_switch),
        web.post("/api/git/sync", git_sync),
        web.post("/api/git/init", git_init),
        web.post("/api/git/clone", git_clone),
        web.static(f"/assets/{app[ASSETS]}", STATIC),
        web.static("/assets", STATIC),
    ])
    return app


async def _lifetime(app: web.Application):
    http = aiohttp.ClientSession()
    app[HTTP] = http
    app[PROVIDERS] = Providers(app[SETTINGS].providers, http)
    app[PROVIDERS].locality.start()  # in the background: no page waits for these checks
    app[AGENTS].start_reaper()
    yield
    for turn in list(app[TURNS].values()):
        if turn.task:
            turn.task.cancel()
    await asyncio.gather(*(t.task for t in app[TURNS].values() if t.task), return_exceptions=True)
    await app[AGENTS].close()
    await app[PROVIDERS].locality.close()
    await http.close()
    app[STORE].close()
    app[TEMP].close()


def _assets_version() -> str:
    """Changes whenever a client file does. The page loads the client from /assets/<version>/, so after an update
    no browser can reuse a module it cached from the old one."""
    digest = hashlib.sha256()
    for path in sorted(STATIC.rglob("*")):
        if path.is_file():
            stat = path.stat()
            digest.update(f"{path.relative_to(STATIC)}:{stat.st_size}:{stat.st_mtime_ns}\n".encode())
    return digest.hexdigest()[:12]


async def _revalidate_assets(request: web.Request, response: web.StreamResponse) -> None:
    """The browser checks every client file on each load (a cheap 304), so an update never mixes old and new
    modules into a blank page."""
    if request.path.startswith("/assets/"):
        response.headers.setdefault("Cache-Control", "no-cache")


async def _frame_policy(request: web.Request, response: web.StreamResponse) -> None:
    """Only this server, and the pages in FRAME_ANCESTORS, may show these pages in a frame."""
    rule = " ".join(("frame-ancestors", "'self'", *request.app[SETTINGS].frame_ancestors))
    policy = response.headers.get("Content-Security-Policy")
    response.headers["Content-Security-Policy"] = f"{policy}; {rule}" if policy else rule


def _cookie_options(request: web.Request) -> dict[str, Any]:
    """Strict by default. A page that may be framed by another site needs SameSite=None, which needs Secure."""
    if request.app[SETTINGS].frame_ancestors:
        return {"httponly": True, "samesite": "None", "secure": True}
    return {"httponly": True, "samesite": "Strict", "secure": _secure(request)}


def embed_link_token(secret: str, now: float | None = None, nonce: str | None = None) -> str:
    """A one-time sign-in link's token, as a framing page makes it: base64url JSON {exp, nonce}, a dot, then the
    hex HMAC-SHA256 of that text with EMBED_SECRET. Here for the tests and for anyone writing the other side."""
    payload = json.dumps({"exp": int((now or time.time()) + 60), "nonce": nonce or secrets.token_hex(16)})
    text = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    return f"{text}.{hmac.new(secret.encode(), text.encode(), hashlib.sha256).hexdigest()}"


async def embed(request: web.Request) -> web.Response:
    """Sign the browser in from a one-time link (`/embed?token=…`) that a page framing this one made with
    EMBED_SECRET, then open the app. Each link works once and for at most five minutes."""
    settings = request.app[SETTINGS]
    if not settings.embed_secret:
        return _error(404, "this server has no EMBED_SECRET")
    text, _, signature = request.query.get("token", "").partition(".")
    expected = hmac.new(settings.embed_secret.encode(), text.encode(), hashlib.sha256).hexdigest()
    if not text or not hmac.compare_digest(signature, expected):
        return _error(401, "this link is not valid")
    try:
        claims = json.loads(base64.urlsafe_b64decode(text + "=" * (-len(text) % 4)))
        expires, nonce = int(claims["exp"]), str(claims["nonce"])
    except (ValueError, KeyError, TypeError, binascii.Error):
        return _error(401, "this link is not valid")
    now = time.time()
    used = request.app[EMBEDS]
    for old in [n for n, e in used.items() if e < now]:
        del used[old]
    if expires < now or expires > now + EMBED_MAX_AGE or nonce in used:
        return _error(401, "this link has expired; open the chat again")
    used[nonce] = expires
    response = web.Response(status=302, headers={"Location": "/", "Cache-Control": "no-store"})
    response.set_cookie(COOKIE, request.app[TOKEN], max_age=60 * 60 * 24 * 30, **_cookie_options(request))
    return response


def session_token(settings: Settings) -> str:
    """The cookie value: an HMAC of the password with a key kept in the data folder. Changing the password signs
    every browser out."""
    key_file = settings.data_dir / "secret.key"
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    if not key_file.exists():
        key_file.write_bytes(secrets.token_bytes(32))
        os.chmod(key_file, 0o600)
    return hmac.new(key_file.read_bytes(), settings.password.encode(), hashlib.sha256).hexdigest()


def _secure(request: web.Request) -> bool:
    """HTTPS, as the browser sees it. Behind a proxy (TRUST_PROXY=true), the proxy says so."""
    if request.app[SETTINGS].trust_proxy:
        return request.headers.get("X-Forwarded-Proto", "").split(",")[0].strip() == "https" or request.secure
    return request.secure


def _client_ip(request: web.Request) -> str:
    if request.app[SETTINGS].trust_proxy and request.headers.get("X-Forwarded-For"):
        return request.headers["X-Forwarded-For"].split(",")[0].strip()
    return request.remote or ""


@web.middleware
async def guard(request: web.Request, handler):
    settings = request.app[SETTINGS]
    if not settings.password and not is_loopback(request.host.rsplit(":", 1)[0].strip("[]")):
        # Without a password only this machine may talk to us; this also refuses DNS-rebinding pages.
        return _error(403, "this server only answers on localhost")
    if request.method not in ("GET", "HEAD"):
        origin = request.headers.get("Origin")
        if origin and origin.split("://", 1)[-1] != request.host:
            return _error(403, "cross-site request refused")
        if request.can_read_body and request.content_type != "application/json":
            return _error(415, "send JSON")
    if settings.password and request.path not in OPEN_PATHS and not request.path.startswith("/assets/"):
        if not hmac.compare_digest(request.cookies.get(COOKIE, ""), request.app[TOKEN]):
            return _error(401, "sign in first")
    try:
        return await handler(request)
    except workspace.WorkspaceError as exc:
        return _error(exc.status, str(exc))


def _error(status: int, message: str) -> web.Response:
    return web.json_response({"error": message}, status=status)


async def _body(request: web.Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except ValueError:
        raise web.HTTPBadRequest(text=json.dumps({"error": "invalid JSON"}), content_type="application/json")
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text=json.dumps({"error": "expected an object"}), content_type="application/json")
    return body


def _store(app: web.Application, chat_id: str) -> Store:
    return app[TEMP] if chat_id.startswith("t") else app[STORE]


def _chat_or_404(request: web.Request) -> dict[str, Any]:
    chat_id = request.match_info["id"]
    chat = _store(request.app, chat_id).get_chat(chat_id)
    if chat is None:
        raise web.HTTPNotFound(text=json.dumps({"error": "no such chat"}), content_type="application/json")
    return chat


async def index(request: web.Request) -> web.Response:
    """The page, with the brand name in its title and the theme color set before the first paint. With BRAND_LOGO set,
    the page is marked so the client shows that logo instead of the one in each theme's ink."""
    settings = request.app[SETTINGS]
    page = (STATIC / "index.html").read_text(encoding="utf-8")
    page = page.replace("<title>AgentWebUI</title>", f"<title>{_html(settings.brand_name)}</title>")
    if settings.brand_logo:
        page = page.replace('<html lang="en" class="app">', '<html lang="en" class="app" data-own-logo>')
    page = page.replace('"/assets/', f'"/assets/{request.app[ASSETS]}/')
    return web.Response(text=page, content_type="text/html", headers={"Cache-Control": "no-cache"})


def _html(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


async def manifest(request: web.Request) -> web.Response:
    """Lets a phone or desktop install the VPS address as an app, under the brand's name and logo."""
    settings = request.app[SETTINGS]
    icons = [{"src": "/brand/logo", "sizes": "any", "type": _logo_type(settings)}] if settings.brand_logo else [
        {"src": "/assets/brand/icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "/assets/brand/icon-512.png", "sizes": "512x512", "type": "image/png"},
        {"src": "/assets/brand/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        {"src": "/brand/logo", "sizes": "any", "type": "image/svg+xml"}]
    return web.json_response({
        "name": settings.brand_name, "short_name": settings.brand_name[:12], "start_url": "/", "display": "standalone",
        "background_color": "#111114", "theme_color": "#111114", "icons": icons},
        content_type="application/manifest+json")


def _logo_type(settings: Settings) -> str:
    return mimetypes.guess_type(settings.brand_logo)[0] or "image/svg+xml" if settings.brand_logo else "image/svg+xml"


async def brand_logo(request: web.Request) -> web.StreamResponse:
    settings = request.app[SETTINGS]
    if settings.brand_logo.startswith(("http://", "https://")):
        raise web.HTTPFound(settings.brand_logo)
    path = Path(os.path.expanduser(settings.brand_logo)) if settings.brand_logo else STATIC / "logo.svg"
    if not path.is_file():
        path = STATIC / "logo.svg"
    return web.FileResponse(path, headers={"Cache-Control": "max-age=3600"})


async def health(request: web.Request) -> web.Response:
    return web.json_response({"status": "ok", "version": __version__})


async def session_state(request: web.Request) -> web.Response:
    token = request.app[TOKEN]
    signed_in = not token or hmac.compare_digest(request.cookies.get(COOKIE, ""), token)
    return web.json_response({"password_required": bool(token), "email_required": bool(request.app[SETTINGS].login_email),
                              "signed_in": signed_in})


async def login(request: web.Request) -> web.Response:
    """Sign in with PASSWORD (and LOGIN_EMAIL when set). Each address gets a few tries per ten minutes, so a guesser
    can't keep going."""
    settings = request.app[SETTINGS]
    tries = request.app[LOGINS]
    ip, now = _client_ip(request), time.monotonic()
    recent = [t for t in tries.get(ip, []) if now - t < LOGIN_WINDOW]
    if len(recent) >= LOGIN_TRIES:
        return _error(429, "too many wrong passwords; wait ten minutes")
    body = await _body(request)
    # Both are compared every time, so a wrong email takes as long as a wrong password.
    email_ok = hmac.compare_digest(str(body.get("email", "")).strip().lower().encode(), settings.login_email.encode())
    password_ok = bool(settings.password) and hmac.compare_digest(str(body.get("password", "")).encode(),
                                                                  settings.password.encode())
    if not (email_ok and password_ok):
        tries[ip] = [*recent, now]
        await asyncio.sleep(1)
        return _error(401, "wrong email or password" if settings.login_email else "wrong password")
    tries.pop(ip, None)
    response = web.json_response({"signed_in": True})
    response.set_cookie(COOKIE, request.app[TOKEN], max_age=60 * 60 * 24 * 30, **_cookie_options(request))
    return response


async def logout(request: web.Request) -> web.Response:
    response = web.json_response({"signed_in": False})
    response.del_cookie(COOKIE, **_cookie_options(request))
    return response


async def config(request: web.Request) -> web.Response:
    settings = request.app[SETTINGS]
    agents = request.app[AGENTS]
    store = request.app[STORE]
    if request.query.get("refresh"):
        request.app[PROVIDERS].forget()
    return web.json_response({
        "models": await request.app[PROVIDERS].models(),
        "providers": await request.app[PROVIDERS].summary(),
        "agents": [{"id": a.id, "name": a.name, "cwd": a.cwd, "command": " ".join(a.command), "model": a.model,
                    "running": agents.get(a.id).running, "options": store.agent_options(a.id)}
                   for a in settings.agents],
        "workspace": settings.workspace,
        "roots": workspace.roots(settings),
        "user_name": settings.user_name,
        "password": bool(settings.password),
        "system_prompt": bool(settings.system_prompt),
        "rich_replies": settings.rich_replies,
        "upload_mb": settings.upload_mb,
        "webhook": bool(settings.notify_webhook),
        "brand": {"name": settings.brand_name, "logo": "/brand/logo", "greeting": settings.brand_greeting,
                  "accent": settings.brand_accent, "theme": settings.brand_theme},
        "lock_model": settings.lock_model,
        "lock_folder": settings.lock_folder,
        "version": __version__,
    })


async def agent_options(request: web.Request) -> web.Response:
    """What an agent offers (models, effort, toggles). From the cache, or by starting it once and asking."""
    settings = request.app[SETTINGS]
    agent = settings.agent(request.match_info["id"])
    if agent is None:
        return _error(404, "no such agent")
    store = request.app[STORE]
    cached = store.agent_options(agent.id)
    if cached is not None and not request.query.get("refresh"):
        return web.json_response({"options": cached})
    process = request.app[AGENTS].get(agent.id)
    assert process is not None
    try:
        _, session, _ = await process.open(agent.cwd if os.path.isdir(agent.cwd) else settings.workspace)
    except AgentError as exc:
        return _error(502, str(exc))
    options = session.config or []
    store.set_agent_options(agent.id, options)
    return web.json_response({"options": options})


def _live(app: web.Application, chat: dict[str, Any]) -> dict[str, Any]:
    turn = app[TURNS].get(chat["id"])
    return {**chat, "running": turn is not None, "waiting": bool(turn and turn.waiting),
            "temporary": chat["id"].startswith("t")}


async def list_chats(request: web.Request) -> web.Response:
    return web.json_response([_live(request.app, chat) for chat in request.app[STORE].list_chats()])


async def search(request: web.Request) -> web.Response:
    query = request.query.get("q", "")[:200]
    return web.json_response([_live(request.app, chat) for chat in request.app[STORE].search(query)])


def _model_params(raw: Any) -> dict[str, Any]:
    """The per-chat settings of a model chat: temperature, maximum reply length and instructions."""
    out: dict[str, Any] = {}
    if not isinstance(raw, dict):
        return out
    if isinstance(raw.get("temperature"), (int, float)) and 0 <= raw["temperature"] <= 2:
        out["temperature"] = round(float(raw["temperature"]), 2)
    if isinstance(raw.get("max_tokens"), int) and 1 <= raw["max_tokens"] <= 1_000_000:
        out["max_tokens"] = raw["max_tokens"]
    if isinstance(raw.get("instructions"), str) and raw["instructions"].strip():
        out["instructions"] = raw["instructions"].strip()[:8000]
    return out


async def create_chat(request: web.Request) -> web.Response:
    settings = request.app[SETTINGS]
    store = request.app[STORE]
    body = await _body(request)
    kind, _, target = str(body.get("target", "")).partition(":")
    project_id = str(body.get("project_id") or "")
    project = store.get_project(project_id) if project_id else None
    if project_id and project is None:
        return _error(422, "no such project")
    cwd, chat_config = "", {}
    if kind == "model":
        provider_id, _, model = target.partition("/")
        if settings.provider(provider_id) is None or not model:
            return _error(422, f"unknown model {target!r}")
        chat_config = _model_params(body.get("config"))
    elif kind == "agent":
        agent = settings.agent(target)
        if agent is None:
            return _error(422, f"unknown agent {target!r}")
        chosen = None if settings.lock_folder else body.get("cwd") or (project and project["folder"])
        cwd = os.path.expanduser(str(chosen or agent.cwd))
        if not os.path.isdir(cwd):
            return _error(422, f"{cwd} is not a folder")
        cwd = str(Path(cwd).resolve())
        if not settings.allowed(cwd):
            return _error(403, f"{cwd} is outside the folders this server shares (FILES_ROOTS)")
        raw = body.get("config")
        chat_config = {str(k): v for k, v in raw.items() if isinstance(v, (str, bool))} if isinstance(raw, dict) else {}
        if settings.lock_model:
            chat_config = {k: v for k, v in chat_config.items() if not _is_model_option(store.agent_options(agent.id), k)}
        if agent.model and "model" not in chat_config:
            chat_config["model"] = agent.model
    else:
        return _error(422, "target must be model:<provider>/<model> or agent:<id>")
    temporary = bool(body.get("temporary"))
    chat = (request.app[TEMP] if temporary else store).create_chat(
        kind, target, cwd, str(body.get("title") or "")[:200], chat_config, project_id, "t" if temporary else "")
    return web.json_response(_live(request.app, chat), status=201)


def _is_model_option(options: list[dict[str, Any]] | None, option_id: str) -> bool:
    """Whether an agent option picks the model: the legacy `model` id, or an option in the model category."""
    return option_id == "model" or any(o.get("id") == option_id and o.get("category") == "model" for o in options or [])


def _overlay(options: list[dict[str, Any]] | None, values: dict[str, Any]) -> list[dict[str, Any]] | None:
    """Cached agent options with this chat's stored choices shown as current."""
    if options is None:
        return None
    out = []
    for option in options:
        value = values.get(option["id"], values.get(option.get("category") or "\0"))
        if value is not None and (option["type"] == "boolean") == isinstance(value, bool):
            if option["type"] == "boolean" or str(value) in {c["value"] for c in choices_of(option)}:
                option = {**option, "currentValue": value}
        out.append(option)
    return out


async def get_chat(request: web.Request) -> web.Response:
    chat = _chat_or_404(request)
    store = _store(request.app, chat["id"])
    body = {**_live(request.app, chat), "messages": store.messages(chat["id"])}
    if chat["kind"] == "agent":
        process = request.app[AGENTS].get(chat["target"])
        state = process.state(chat["session_id"]) if process else None
        if state is not None and state["config"] is None:
            state["config"] = _overlay(request.app[STORE].agent_options(chat["target"]), chat["config"])
        body["agent"] = state
    return web.json_response(body)


async def update_chat(request: web.Request) -> web.Response:
    """Rename, pin, archive or move a chat to a project; move a model chat to another model or change its
    settings (its history is plain messages, so any model reads it)."""
    chat = _chat_or_404(request)
    store = _store(request.app, chat["id"])
    body = await _body(request)
    fields: dict[str, Any] = {}
    if "title" in body:
        fields["title"] = str(body.get("title") or "").strip()[:200]
    for flag in ("pinned", "archived"):
        if flag in body:
            fields[flag] = 1 if body[flag] else 0
    if "project_id" in body:
        project_id = str(body["project_id"] or "")
        if project_id and request.app[STORE].get_project(project_id) is None:
            return _error(422, "no such project")
        fields["project_id"] = project_id
    if "config" in body:
        if chat["kind"] != "model":
            return _error(422, "change an agent's options through /config")
        fields["config"] = _model_params(body["config"])
    if "target" in body:
        kind, _, target = str(body["target"]).partition(":")
        provider_id, _, model = target.partition("/")
        if chat["kind"] != "model" or kind != "model":
            return _error(422, "only a model chat can switch to another model")
        if request.app[SETTINGS].provider(provider_id) is None or not model:
            return _error(422, f"unknown model {target!r}")
        if chat["id"] in request.app[TURNS]:
            return _error(409, "a reply is still running in this chat")
        fields["target"] = target
    store.update_chat(chat["id"], touch="title" in fields or "target" in fields, **fields)
    return web.json_response(_live(request.app, store.get_chat(chat["id"])))  # type: ignore[arg-type]


async def delete_chat(request: web.Request) -> web.Response:
    chat = _chat_or_404(request)
    if chat["id"] in request.app[TURNS]:
        return _error(409, "stop the reply first")
    files = _store(request.app, chat["id"]).delete_chat(chat["id"])
    if chat["id"].startswith("t"):  # a temporary chat's files are listed in the main database
        files += request.app[STORE].delete_chat(chat["id"])
    for file_id in files:
        _blob(request.app, file_id).unlink(missing_ok=True)
    return web.Response(status=204)


async def clone_chat(request: web.Request) -> web.Response:
    chat = _chat_or_404(request)
    if chat["id"].startswith("t"):
        return _error(422, "a temporary chat can't be cloned")
    upto = (await _body(request)).get("upto") if request.can_read_body else None
    title = f"{chat['title'] or 'New chat'} ({'branch' if upto else 'copy'})"[:200]
    copy = request.app[STORE].clone_chat(chat["id"], title, upto if isinstance(upto, int) else None)
    return web.json_response(_live(request.app, copy), status=201)  # type: ignore[arg-type]


def _attachments(app: web.Application, raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    files = []
    for file_id in raw[:20]:
        file = app[STORE].get_file(str(file_id))
        if file:
            files.append({k: file[k] for k in ("id", "name", "mime", "size")})
    return files


async def send_message(request: web.Request) -> web.StreamResponse:
    """Send a message. With `edit`, it is a new version of that earlier message: the thread forks there."""
    chat = _chat_or_404(request)
    body = await _body(request)
    text = str(body.get("text") or "").strip()
    files = _attachments(request.app, body.get("files"))
    if not text and not files:
        return _error(422, "the message is empty")
    turns = request.app[TURNS]
    if chat["id"] in turns:
        return _error(409, "a reply is still running in this chat")
    store = _store(request.app, chat["id"])
    parent = None
    if body.get("edit") is not None:
        edited = store.get_message(chat["id"], int(body["edit"])) if str(body["edit"]).isdigit() else None
        if edited is None or edited["role"] != "user":
            return _error(422, "that message can't be edited")
        if chat["kind"] == "agent":
            return _error(422, "an agent remembers the conversation, so its messages can't be edited")
        parent = edited["parent"]
    request.app[STORE].claim_files([f["id"] for f in files], chat["id"])
    user = store.add_message(chat["id"], "user", text, meta={"files": files} if files else None, parent=parent)
    user = next((m for m in store.messages(chat["id"]) if m["id"] == user["id"]), user)  # with its versions
    if not chat["title"]:
        store.update_chat(chat["id"], title=(text.splitlines()[0] if text else files[0]["name"])[:60])
    return await _stream(request, _start(request.app, chat, user, user))


async def retry_reply(request: web.Request) -> web.StreamResponse:
    """Answer a message again. The new reply is another version beside the old one."""
    chat = _chat_or_404(request)
    if chat["id"] in request.app[TURNS]:
        return _error(409, "a reply is still running in this chat")
    store = _store(request.app, chat["id"])
    thread = store.messages(chat["id"])
    last = next((m for m in reversed(thread) if m["role"] == "user"), None)
    if last is None:
        return _error(422, "there is no message to answer")
    store.update_chat(chat["id"], touch=False, leaf=last["id"])
    return await _stream(request, _start(request.app, chat, last, None))


async def show_version(request: web.Request) -> web.Response:
    chat = _chat_or_404(request)
    if chat["id"] in request.app[TURNS]:
        return _error(409, "a reply is still running in this chat")
    store = _store(request.app, chat["id"])
    message = (await _body(request)).get("message")
    if not isinstance(message, int) or not store.show_version(chat["id"], message):
        return _error(422, "no such message")
    return web.json_response({"messages": store.messages(chat["id"])})


def _start(app: web.Application, chat: dict[str, Any], message: dict[str, Any], user: dict[str, Any] | None) -> Turn:
    turn = Turn(chat["id"], save=lambda name, mime, data: _save_blob(app, chat["id"], name, mime, data, "agent"))
    if user:
        turn.emit("user", message=user)
    if not chat["id"].startswith("t"):
        turn.on_ask = lambda: _notify(app, chat, "waiting")
    app[TURNS][chat["id"]] = turn
    turn.task = asyncio.create_task(_run(app, chat, message, turn))
    return turn


async def set_mode(request: web.Request) -> web.Response:
    chat = _chat_or_404(request)
    process = request.app[AGENTS].get(chat["target"]) if chat["kind"] == "agent" else None
    if process is None:
        return _error(422, "only an agent chat has modes")
    try:
        modes = await process.set_mode(chat["session_id"], str((await _body(request)).get("mode") or ""))
    except (AgentError, ValueError) as exc:
        return _error(409, str(exc))
    return web.json_response({"modes": modes})


async def set_config(request: web.Request) -> web.Response:
    """Change an agent chat's model, effort or a toggle. Kept on the chat, so it survives a restart; applied at
    once when the agent runs this chat, else when the session opens."""
    chat = _chat_or_404(request)
    if chat["kind"] != "agent":
        return _error(422, "only an agent chat has agent options")
    if chat["id"] in request.app[TURNS]:
        return _error(409, "change it after this reply")
    body = await _body(request)
    config_id, value = str(body.get("id") or ""), body.get("value")
    if not isinstance(value, (str, bool)):
        return _error(422, "the value must be text or true/false")
    store = _store(request.app, chat["id"])
    process = request.app[AGENTS].get(chat["target"])
    session = process.sessions.get(chat["session_id"]) if process and process.running else None
    if request.app[SETTINGS].lock_model and _is_model_option(
            (session.config if session is not None else None) or request.app[STORE].agent_options(chat["target"]),
            config_id):
        return _error(403, "this agent's model is set by the server")
    values = dict(chat["config"])
    if session is not None and session.config is not None:
        try:
            options = await process.set_config(chat["session_id"], config_id, value)  # type: ignore[union-attr]
        except ValueError as exc:
            return _error(422, str(exc))
        except AgentError as exc:
            return _error(409, str(exc))
        values = {o["id"]: o["currentValue"] for o in options if o.get("category") != "mode"}
    else:
        cached = request.app[STORE].agent_options(chat["target"]) or []
        option = next((o for o in cached if o["id"] == config_id), None)
        if option is None:
            return _error(422, f"no option {config_id!r}")
        if option["type"] == "boolean" and not isinstance(value, bool):
            return _error(422, f"{option['name']} is on or off")
        if option["type"] == "select" and str(value) not in {c["value"] for c in choices_of(option)}:
            return _error(422, f"{option['name']} has no choice {value!r}")
        values.pop(option.get("category") or "\0", None)
        values[config_id] = value
        options = _overlay(cached, values) or []
    store.update_chat(chat["id"], touch=False, config=values)
    return web.json_response({"config": options})


async def follow_chat(request: web.Request) -> web.StreamResponse:
    chat = _chat_or_404(request)
    turn = request.app[TURNS].get(chat["id"])
    if turn is None:
        return web.Response(status=204)
    return await _stream(request, turn)


async def _stream(request: web.Request, turn: Turn) -> web.StreamResponse:
    response = web.StreamResponse(headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache",
                                           "X-Accel-Buffering": "no"})
    await response.prepare(request)
    try:
        async for event in turn.follow():
            await response.write(f"data: {json.dumps(event)}\n\n".encode())
    except ConnectionResetError:
        pass  # the viewer left; the reply carries on
    return response


async def cancel_chat(request: web.Request) -> web.Response:
    chat = _chat_or_404(request)
    turn = request.app[TURNS].get(chat["id"])
    if turn is None or turn.task is None:
        return web.Response(status=204)
    turn.cancelled = True
    turn.cancel_questions()
    process = request.app[AGENTS].get(chat["target"]) if chat["kind"] == "agent" else None
    if process is None:
        turn.task.cancel()
    else:
        # ACP: ask the agent to stop and let it end the turn itself; stop waiting if it does not.
        process.cancel(_store(request.app, chat["id"]).get_chat(chat["id"])["session_id"])  # type: ignore[index]
        task = turn.task
        asyncio.get_running_loop().call_later(CANCEL_GRACE, lambda: task.done() or task.cancel())
    return web.Response(status=202)


async def answer_permission(request: web.Request) -> web.Response:
    chat = _chat_or_404(request)
    turn = request.app[TURNS].get(chat["id"])
    option = (await _body(request)).get("option")
    if turn is None or not turn.answer(request.match_info["question"], str(option) if option else None):
        return _error(404, "that question is no longer open")
    return web.Response(status=204)


# --- files people attach and agents send back ---
def _blob(app: web.Application, file_id: str) -> Path:
    return app[SETTINGS].data_dir / "files" / file_id


def _save_blob(app: web.Application, chat_id: str, name: str, mime: str, data: bytes, origin: str) -> dict[str, Any]:
    file = app[STORE].add_file(chat_id, Path(name).name[:200] or "file", mime[:100], len(data), origin)
    path = _blob(app, file["id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return file


def _decode(body: dict[str, Any], limit_mb: int) -> bytes:
    try:
        data = base64.b64decode(str(body.get("data") or ""), validate=True)
    except (binascii.Error, ValueError):
        raise web.HTTPUnprocessableEntity(text=json.dumps({"error": "data must be base64"}),
                                          content_type="application/json") from None
    if len(data) > limit_mb * 1024 * 1024:
        raise web.HTTPRequestEntityTooLarge(max_size=limit_mb * 1024 * 1024, actual_size=len(data),
                                            text=json.dumps({"error": f"files can be up to {limit_mb} MB"}),
                                            content_type="application/json")
    return data


async def upload_file(request: web.Request) -> web.Response:
    """Attach a file: `{name, type, data}` with the bytes as base64, or `{path}` of a file in a shared folder.
    It belongs to the chat it is sent in."""
    body = await _body(request)
    settings = request.app[SETTINGS]
    if body.get("path"):
        source = workspace.resolve(settings, str(body["path"]))
        if not source.is_file():
            return _error(404, "no such file")
        if source.stat().st_size > settings.upload_mb * 1024 * 1024:
            return _error(413, f"files can be up to {settings.upload_mb} MB")
        body = {"name": source.name, "type": body.get("type"), "data": ""}
        data = source.read_bytes()
    else:
        data = _decode(body, settings.upload_mb)
    name = str(body.get("name") or "file")
    mime = str(body.get("type") or mimetypes.guess_type(name)[0] or "application/octet-stream")
    file = _save_blob(request.app, "", name, mime, data, "upload")
    return web.json_response({k: file[k] for k in ("id", "name", "mime", "size")}, status=201)


def _send_file(path: Path, name: str, mime: str, download: bool) -> web.FileResponse:
    # Same origin as the app, so HTML or SVG must never run as a page here: sandbox it and never sniff.
    disposition = "attachment" if download else "inline"
    safe = name.replace('"', "").replace("\n", " ")
    return web.FileResponse(path, headers={
        "Content-Type": mime or "application/octet-stream", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
        "Content-Disposition": f'{disposition}; filename="{safe}"', "Cache-Control": "private, max-age=3600"})


async def get_file(request: web.Request) -> web.StreamResponse:
    file = request.app[STORE].get_file(request.match_info["id"])
    path = _blob(request.app, request.match_info["id"]) if file else None
    if file is None or path is None or not path.is_file():
        return _error(404, "no such file")
    return _send_file(path, file["name"], file["mime"], bool(request.query.get("download")))


async def chat_local_file(request: web.Request) -> web.StreamResponse:
    """A file an agent wrote or names, served from the chat's folder (or another shared folder)."""
    chat = _chat_or_404(request)
    raw = request.query.get("path", "")
    if not raw:
        return _error(422, "a path is required")
    base = Path(chat["cwd"] or request.app[SETTINGS].workspace)
    path = (base / os.path.expanduser(raw)).resolve()
    inside = chat["cwd"] and (path == Path(chat["cwd"]) or Path(chat["cwd"]) in path.parents)
    if not inside and not request.app[SETTINGS].allowed(str(path)):
        return _error(403, "that file is outside this chat's folder")
    if not path.is_file():
        return _error(404, "no such file")
    return _send_file(path, path.name, mimetypes.guess_type(path.name)[0] or "application/octet-stream",
                      bool(request.query.get("download")))


# --- projects: a folder, a default agent or model with its options, and standing instructions ---
async def list_projects(request: web.Request) -> web.Response:
    return web.json_response(request.app[STORE].list_projects())


async def save_project(request: web.Request) -> web.Response:
    settings = request.app[SETTINGS]
    store = request.app[STORE]
    project_id = request.match_info.get("id")
    if project_id and store.get_project(project_id) is None:
        return _error(404, "no such project")
    body = await _body(request)
    fields: dict[str, Any] = {}
    if "name" in body or not project_id:
        name = str(body.get("name") or "").strip()[:80]
        if not name:
            return _error(422, "give the project a name")
        fields["name"] = name
    if "folder" in body:
        folder = str(body.get("folder") or "").strip()
        if folder:
            folder = str(Path(os.path.expanduser(folder)).resolve())
            if not os.path.isdir(folder):
                return _error(422, f"{folder} is not a folder")
            if not settings.allowed(folder):
                return _error(403, f"{folder} is outside the folders this server shares (FILES_ROOTS)")
        fields["folder"] = folder
    if "target" in body:
        fields["target"] = str(body.get("target") or "")[:200]
    if "instructions" in body:
        fields["instructions"] = str(body.get("instructions") or "")[:8000]
    if "config" in body:
        fields["config"] = body["config"] if isinstance(body["config"], dict) else {}
    project = store.save_project(project_id, **fields)
    return web.json_response(project, status=200 if project_id else 201)


async def delete_project(request: web.Request) -> web.Response:
    if not request.app[STORE].delete_project(request.match_info["id"]):
        return _error(404, "no such project")
    return web.Response(status=204)


# --- the file manager and Git, inside FILES_ROOTS ---
def _q(request: web.Request, key: str = "path") -> str:
    return request.query.get(key, "")


async def fs_roots(request: web.Request) -> web.Response:
    return web.json_response(workspace.roots(request.app[SETTINGS]))


async def fs_list(request: web.Request) -> web.Response:
    return web.json_response(workspace.list_dir(request.app[SETTINGS], _q(request), bool(request.query.get("hidden"))))


async def fs_read(request: web.Request) -> web.Response:
    return web.json_response(workspace.read_file(request.app[SETTINGS], _q(request)))


async def fs_raw(request: web.Request) -> web.StreamResponse:
    path = workspace.resolve(request.app[SETTINGS], _q(request))
    if not path.is_file():
        return _error(404, "no such file")
    return _send_file(path, path.name, mimetypes.guess_type(path.name)[0] or "application/octet-stream",
                      bool(request.query.get("download")))


async def fs_write(request: web.Request) -> web.Response:
    body = await _body(request)
    return web.json_response(workspace.write_file(request.app[SETTINGS], str(body.get("path") or ""),
                                                  str(body.get("content") or ""), bool(body.get("create"))))


async def fs_upload(request: web.Request) -> web.Response:
    body = await _body(request)
    data = _decode(body, request.app[SETTINGS].upload_mb)
    return web.json_response(workspace.write_bytes(request.app[SETTINGS], str(body.get("folder") or ""),
                                                   str(body.get("name") or ""), data), status=201)


async def fs_mkdir(request: web.Request) -> web.Response:
    body = await _body(request)
    return web.json_response(workspace.make_dir(request.app[SETTINGS], str(body.get("path") or "")), status=201)


async def fs_rename(request: web.Request) -> web.Response:
    body = await _body(request)
    return web.json_response(workspace.rename(request.app[SETTINGS], str(body.get("path") or ""),
                                              str(body.get("to") or "")))


async def fs_delete(request: web.Request) -> web.Response:
    workspace.delete(request.app[SETTINGS], str((await _body(request)).get("path") or ""))
    return web.Response(status=204)


async def fs_find(request: web.Request) -> web.Response:
    return web.json_response(workspace.find_files(request.app[SETTINGS], _q(request), _q(request, "q")[:200]))


async def fs_grep(request: web.Request) -> web.Response:
    query = _q(request, "q")[:200]
    if not query:
        return _error(422, "type something to search for")
    return web.json_response(await asyncio.to_thread(
        workspace.grep, request.app[SETTINGS], _q(request), query, bool(request.query.get("regex")),
        bool(request.query.get("case")), _q(request, "include")[:200]))


async def git_status(request: web.Request) -> web.Response:
    return web.json_response(await workspace.status(request.app[SETTINGS], _q(request)))


async def git_diff(request: web.Request) -> web.Response:
    return web.json_response(await workspace.diff(request.app[SETTINGS], _q(request), _q(request, "file")))


async def git_log(request: web.Request) -> web.Response:
    return web.json_response(await workspace.log(request.app[SETTINGS], _q(request)))


async def git_branches(request: web.Request) -> web.Response:
    return web.json_response(await workspace.branches(request.app[SETTINGS], _q(request)))


async def git_commit(request: web.Request) -> web.Response:
    body = await _body(request)
    files = body.get("files") if isinstance(body.get("files"), list) else None
    return web.json_response(await workspace.commit(request.app[SETTINGS], str(body.get("path") or ""),
                                                    str(body.get("message") or ""), [str(f) for f in files or []]))


async def git_switch(request: web.Request) -> web.Response:
    body = await _body(request)
    return web.json_response(await workspace.switch(request.app[SETTINGS], str(body.get("path") or ""),
                                                    str(body.get("branch") or ""), bool(body.get("create"))))


async def git_sync(request: web.Request) -> web.Response:
    body = await _body(request)
    return web.json_response(await workspace.sync(request.app[SETTINGS], str(body.get("path") or ""),
                                                  str(body.get("action") or "")))


async def git_init(request: web.Request) -> web.Response:
    return web.json_response(await workspace.init(request.app[SETTINGS], str((await _body(request)).get("path") or "")))


async def git_clone(request: web.Request) -> web.Response:
    body = await _body(request)
    return web.json_response(await workspace.clone(request.app[SETTINGS], str(body.get("url") or "").strip(),
                                                   str(body.get("into") or "")), status=201)


# --- one reply ---
def _instructions(app: web.Application, chat: dict[str, Any], agent: bool) -> str:
    settings = app[SETTINGS]
    parts = []
    if not agent and settings.system_prompt:
        parts.append(settings.system_prompt)
    project = app[STORE].get_project(chat["project_id"]) if chat.get("project_id") else None
    if project and project["instructions"].strip():
        parts.append(project["instructions"].strip())
    if not agent and chat["config"].get("instructions"):
        parts.append(chat["config"]["instructions"])
    if settings.rich_replies:
        parts.append(RICH_NOTE.replace("{files}", AGENT_FILES if agent else ""))
    return "\n\n".join(parts)


def _model_content(app: web.Application, message: dict[str, Any]) -> Any:
    """A user message for an OpenAI-compatible API: plain text, or parts when it carries images or files."""
    files = (message.get("meta") or {}).get("files") or []
    if not files:
        return message["content"]
    parts: list[dict[str, Any]] = []
    for file in files:
        path = _blob(app, file["id"])
        if not path.is_file():
            continue
        if file["mime"].startswith("image/"):
            data = base64.b64encode(path.read_bytes()).decode()
            parts.append({"type": "image_url", "image_url": {"url": f"data:{file['mime']};base64,{data}"}})
        elif file["size"] <= TEXT_INLINE and _is_text(path):
            parts.append({"type": "text", "text": f"<file name=\"{file['name']}\">\n"
                                                  f"{path.read_text(encoding='utf-8', errors='replace')}\n</file>"})
        else:
            parts.append({"type": "text", "text": f"[Attached {file['name']} ({file['mime']}, {file['size']} bytes); "
                                                  "this model can't read it.]"})
    if message["content"]:
        parts.append({"type": "text", "text": message["content"]})
    return parts


def _is_text(path: Path) -> bool:
    try:
        head = path.read_bytes()[:8192]
        head.decode("utf-8")
        return b"\0" not in head
    except (OSError, UnicodeDecodeError):
        return False


def _agent_blocks(app: web.Application, process: AgentProcess, session: Session, chat: dict[str, Any],
                  message: dict[str, Any]) -> list[dict[str, Any]]:
    """The ACP prompt: a note on what the page can show (first prompt only), the files, then the text."""
    caps = process.prompt_capabilities
    blocks: list[dict[str, Any]] = []
    if session.fresh and (note := _instructions(app, chat, agent=True)):
        blocks.append({"type": "text", "text": f"<context from=\"AgentWebUI\">\n{note}\n</context>"})
    for file in (message.get("meta") or {}).get("files") or []:
        path = _blob(app, file["id"])
        if not path.is_file():
            continue
        uri = path.resolve().as_uri()
        if file["mime"].startswith("image/") and caps.get("image"):
            blocks.append({"type": "image", "mimeType": file["mime"],
                           "data": base64.b64encode(path.read_bytes()).decode(), "uri": uri})
        elif caps.get("embeddedContext") and file["size"] <= TEXT_INLINE and _is_text(path):
            blocks.append({"type": "resource", "resource": {"uri": uri, "mimeType": file["mime"],
                                                            "text": path.read_text(encoding="utf-8", errors="replace")}})
        else:
            blocks.append({"type": "resource_link", "uri": uri, "name": file["name"], "mimeType": file["mime"],
                           "size": file["size"]})
    blocks.append({"type": "text", "text": message["content"] or "(see the attached files)"})
    return blocks


async def _apply_config(process: AgentProcess, session_id: str, session: Session, chat: dict[str, Any],
                        store: Store, turn: Turn) -> None:
    """Make the session match the choices stored on the chat (model first: other options depend on it)."""
    wanted = chat["config"]
    if not wanted or not session.config:
        return
    keys = sorted(wanted, key=lambda k: 0 if k == "model" else 1)
    changed = dict(wanted)
    for key in keys:
        option = session.option(key) or next((o for o in session.config or [] if o.get("category") == key), None)
        if option is None or option["currentValue"] == wanted[key]:
            continue
        try:
            await process.set_config(session_id, option["id"], wanted[key])
        except (ValueError, AgentError):
            current = session.option(option["id"]) or option
            name = next((c["name"] for c in choices_of(current) if c["value"] == current["currentValue"]),
                        str(current["currentValue"]))
            turn.emit("notice", text=f"{wanted[key]} isn’t available any more; using {name}.")
            changed.pop(key, None)
            changed[option["id"]] = current["currentValue"]
    if changed != wanted:
        store.update_chat(chat["id"], touch=False, config=changed)


def _model_label(session: Session) -> str:
    """"Opus · High": the current model's name and its effort, for the reply's meta line."""
    names = []
    for category in ("model", "thought_level"):
        option = next((o for o in session.config or [] if o.get("category") == category and o["type"] == "select"),
                      None)
        if option:
            names.append(next((c["name"] for c in choices_of(option) if c["value"] == option["currentValue"]),
                              option["currentValue"]))
    return " · ".join(n for n in names if n)


async def _run(app: web.Application, chat: dict[str, Any], message: dict[str, Any], turn: Turn) -> None:
    store, meta = _store(app, chat["id"]), {}
    chat = store.get_chat(chat["id"]) or chat  # the model may have changed since the request was read
    try:
        if chat["kind"] == "model":
            meta["model"] = chat["target"]
            history = [{"role": m["role"], "content": _model_content(app, m) if m["role"] == "user" else m["content"]}
                       for m in store.messages(chat["id"]) if m["content"] or (m.get("meta") or {}).get("files")]
            if note := _instructions(app, chat, agent=False):
                history.insert(0, {"role": "system", "content": note})
            params = {k: chat["config"][k] for k in ("temperature", "max_tokens") if k in chat["config"]}
            async for kind, value in app[PROVIDERS].stream(chat["target"], history, params):
                if kind == "usage":
                    meta["usage"] = value
                elif kind == "finish":
                    meta["finish"] = value
                else:
                    turn.add_text("text" if kind == "delta" else "thought", value)
        else:
            process = app[AGENTS].get(chat["target"])
            if process is None:
                raise AgentError(f"the agent {chat['target']!r} is no longer in .env")
            session_id, session, lost = await process.open(chat["cwd"], chat["session_id"])
            if session_id != chat["session_id"]:
                store.update_chat(chat["id"], touch=False, session_id=session_id)
                chat["session_id"] = session_id
            if lost:
                turn.emit("notice", text=f"{process.spec.name} restarted and does not remember the earlier messages.")
            await _apply_config(process, session_id, session, chat, store, turn)
            if session.modes:
                turn.emit("modes", modes=session.modes)
            if session.config is not None:
                turn.emit("config", config=session.config, modes=session.modes)
            if session.commands:
                turn.emit("commands", commands=session.commands)
            meta["agent"] = process.spec.name
            if label := _model_label(session):
                meta["agent_model"] = label
            result = await process.prompt(session_id, session, turn, _agent_blocks(app, process, session, chat, message))
            meta["stop_reason"] = result.get("stopReason")
            if isinstance(result.get("usage"), dict):
                meta["usage"] = result["usage"]
            turn.add_outputs()
    except asyncio.CancelledError:
        meta["stop_reason"] = "cancelled"
    except (ProviderError, AgentError) as exc:
        meta["error"] = str(exc)
        turn.emit("error", message=str(exc))
    except Exception as exc:
        log.exception("reply in chat %s failed", chat["id"])
        meta["error"] = f"unexpected error: {type(exc).__name__}"
        turn.emit("error", message=meta["error"])
    finally:
        if turn.cancelled:
            meta["stop_reason"] = "cancelled"
        meta["seconds"] = turn.seconds
        reply = store.add_message(chat["id"], "assistant", turn.text, turn.parts, meta, parent=message["id"])
        app[TURNS].pop(chat["id"], None)
        saved = next((m for m in store.messages(chat["id"]) if m["id"] == reply["id"]), reply)
        turn.emit("message", message=saved)
        turn.finish()
        if not chat["id"].startswith("t"):
            _notify(app, chat, "failed" if meta.get("error") else "finished")


def _notify(app: web.Application, chat: dict[str, Any], what: str) -> None:
    """Tell NOTIFY_WEBHOOK (Slack, Teams, ntfy or any URL) that a reply finished or failed. Never waits."""
    url = app[SETTINGS].notify_webhook
    if not url:
        return
    title = (_store(app, chat["id"]).get_chat(chat["id"]) or chat)["title"] or "A chat"
    said = {"failed": "failed", "waiting": "is waiting for your answer"}.get(what, "has a reply")
    text = f"{app[SETTINGS].brand_name}: “{title}” {said}."

    async def post() -> None:
        try:
            async with app[HTTP].post(url, json={"text": text, "event": what, "chat": chat["id"], "title": title},
                                      timeout=aiohttp.ClientTimeout(total=10)):
                pass
        except (aiohttp.ClientError, TimeoutError) as exc:
            log.warning("NOTIFY_WEBHOOK failed: %s", type(exc).__name__)

    asyncio.create_task(post())
