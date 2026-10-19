"""The HTTP API and the web page. A reply streams as server-sent events from the request that sent the message;
the reply runs on its own, so closing the tab does not stop it, and `GET /api/chats/{id}/events` picks it back up."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import secrets
from pathlib import Path
from typing import Any

import aiohttp
from aiohttp import web

from .acp import AgentError, Agents
from .config import Settings, is_loopback
from .providers import ProviderError, Providers
from .store import Store
from .turns import Turn

log = logging.getLogger("agentwebui_lite")
STATIC = Path(__file__).parent / "static"
COOKIE = "awl_session"
CANCEL_GRACE = 15
OPEN_PATHS = {"/", "/api/health", "/api/session", "/api/login"}

SETTINGS = web.AppKey("settings", Settings)
STORE = web.AppKey("store", Store)
PROVIDERS = web.AppKey("providers", Providers)
AGENTS = web.AppKey("agents", Agents)
TURNS = web.AppKey("turns", dict)
TOKEN = web.AppKey("token", str)


def create_app(settings: Settings) -> web.Application:
    app = web.Application(middlewares=[guard], client_max_size=4 * 1024 * 1024)
    app[SETTINGS] = settings
    app[STORE] = Store(settings.data_dir / "chats.db")
    app[AGENTS] = Agents(settings.agents, settings.agent_idle_minutes)
    app[TURNS] = {}
    app[TOKEN] = session_token(settings) if settings.password else ""
    app.cleanup_ctx.append(_lifetime)
    app.add_routes([
        web.get("/", index),
        web.get("/api/health", health),
        web.get("/api/session", session_state),
        web.post("/api/login", login),
        web.post("/api/logout", logout),
        web.get("/api/config", config),
        web.get("/api/chats", list_chats),
        web.post("/api/chats", create_chat),
        web.get("/api/chats/{id}", get_chat),
        web.patch("/api/chats/{id}", rename_chat),
        web.delete("/api/chats/{id}", delete_chat),
        web.post("/api/chats/{id}/messages", send_message),
        web.get("/api/chats/{id}/events", follow_chat),
        web.post("/api/chats/{id}/cancel", cancel_chat),
        web.post("/api/chats/{id}/permissions/{question}", answer_permission),
        web.static("/assets", STATIC),
    ])
    return app


async def _lifetime(app: web.Application):
    http = aiohttp.ClientSession()
    app[PROVIDERS] = Providers(app[SETTINGS].providers, http)
    app[AGENTS].start_reaper()
    yield
    for turn in list(app[TURNS].values()):
        if turn.task:
            turn.task.cancel()
    await asyncio.gather(*(t.task for t in app[TURNS].values() if t.task), return_exceptions=True)
    await app[AGENTS].close()
    await http.close()
    app[STORE].close()


def session_token(settings: Settings) -> str:
    """The cookie value: an HMAC of the password with a key kept in the data folder. Changing the password signs
    every browser out."""
    key_file = settings.data_dir / "secret.key"
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    if not key_file.exists():
        key_file.write_bytes(secrets.token_bytes(32))
        os.chmod(key_file, 0o600)
    return hmac.new(key_file.read_bytes(), settings.password.encode(), hashlib.sha256).hexdigest()


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
    return await handler(request)


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


def _chat_or_404(request: web.Request) -> dict[str, Any]:
    chat = request.app[STORE].get_chat(request.match_info["id"])
    if chat is None:
        raise web.HTTPNotFound(text=json.dumps({"error": "no such chat"}), content_type="application/json")
    return chat


async def index(request: web.Request) -> web.FileResponse:
    return web.FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})


async def health(request: web.Request) -> web.Response:
    return web.json_response({"status": "ok"})


async def session_state(request: web.Request) -> web.Response:
    token = request.app[TOKEN]
    signed_in = not token or hmac.compare_digest(request.cookies.get(COOKIE, ""), token)
    return web.json_response({"password_required": bool(token), "signed_in": signed_in})


async def login(request: web.Request) -> web.Response:
    settings = request.app[SETTINGS]
    body = await _body(request)
    if not settings.password or not hmac.compare_digest(str(body.get("password", "")).encode(),
                                                        settings.password.encode()):
        await asyncio.sleep(1)
        return _error(401, "wrong password")
    response = web.json_response({"signed_in": True})
    response.set_cookie(COOKIE, request.app[TOKEN], httponly=True, samesite="Strict", secure=request.secure,
                        max_age=60 * 60 * 24 * 30)
    return response


async def logout(request: web.Request) -> web.Response:
    response = web.json_response({"signed_in": False})
    response.del_cookie(COOKIE)
    return response


async def config(request: web.Request) -> web.Response:
    settings = request.app[SETTINGS]
    return web.json_response({
        "models": await request.app[PROVIDERS].models(),
        "agents": [{"id": a.id, "name": a.name, "cwd": a.cwd} for a in settings.agents],
        "workspace": settings.workspace,
    })


async def list_chats(request: web.Request) -> web.Response:
    turns = request.app[TURNS]
    return web.json_response([{**chat, "running": chat["id"] in turns} for chat in request.app[STORE].list_chats()])


async def create_chat(request: web.Request) -> web.Response:
    settings = request.app[SETTINGS]
    body = await _body(request)
    kind, _, target = str(body.get("target", "")).partition(":")
    cwd = ""
    if kind == "model":
        provider_id, _, model = target.partition("/")
        if settings.provider(provider_id) is None or not model:
            return _error(422, f"unknown model {target!r}")
    elif kind == "agent":
        agent = settings.agent(target)
        if agent is None:
            return _error(422, f"unknown agent {target!r}")
        cwd = os.path.expanduser(str(body.get("cwd") or agent.cwd))
        if not os.path.isdir(cwd):
            return _error(422, f"{cwd} is not a folder")
        cwd = str(Path(cwd).resolve())
    else:
        return _error(422, "target must be model:<provider>/<model> or agent:<id>")
    chat = request.app[STORE].create_chat(kind, target, cwd, str(body.get("title") or "")[:200])
    return web.json_response(chat, status=201)


async def get_chat(request: web.Request) -> web.Response:
    chat = _chat_or_404(request)
    turn = request.app[TURNS].get(chat["id"])
    return web.json_response({**chat, "running": turn is not None, "messages": request.app[STORE].messages(chat["id"])})


async def rename_chat(request: web.Request) -> web.Response:
    chat = _chat_or_404(request)
    title = str((await _body(request)).get("title") or "").strip()[:200]
    request.app[STORE].update_chat(chat["id"], title=title)
    return web.json_response(request.app[STORE].get_chat(chat["id"]))


async def delete_chat(request: web.Request) -> web.Response:
    chat = _chat_or_404(request)
    if chat["id"] in request.app[TURNS]:
        return _error(409, "stop the reply first")
    request.app[STORE].delete_chat(chat["id"])
    return web.Response(status=204)


async def send_message(request: web.Request) -> web.StreamResponse:
    chat = _chat_or_404(request)
    text = str((await _body(request)).get("text") or "").strip()
    if not text:
        return _error(422, "the message is empty")
    turns = request.app[TURNS]
    if chat["id"] in turns:
        return _error(409, "a reply is still running in this chat")
    store = request.app[STORE]
    user = store.add_message(chat["id"], "user", text)
    if not chat["title"]:
        store.update_chat(chat["id"], title=text.splitlines()[0][:60])
    turn = Turn(chat["id"])
    turn.emit("user", message=user)
    turns[chat["id"]] = turn
    turn.task = asyncio.create_task(_run(request.app, chat, text, turn))
    return await _stream(request, turn)


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
        process.cancel(request.app[STORE].get_chat(chat["id"])["session_id"])
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


async def _run(app: web.Application, chat: dict[str, Any], text: str, turn: Turn) -> None:
    store, meta = app[STORE], {}
    try:
        if chat["kind"] == "model":
            history = [{"role": m["role"], "content": m["content"]} for m in store.messages(chat["id"])
                       if m["content"]]
            if app[SETTINGS].system_prompt:
                history.insert(0, {"role": "system", "content": app[SETTINGS].system_prompt})
            async for kind, value in app[PROVIDERS].stream(chat["target"], history):
                if kind == "usage":
                    meta["usage"] = value
                else:
                    turn.add_text("text" if kind == "delta" else "thought", value)
        else:
            process = app[AGENTS].get(chat["target"])
            if process is None:
                raise AgentError(f"the agent {chat['target']!r} is no longer in .env")
            session_id, session, lost = await process.open(chat["cwd"], chat["session_id"])
            if session_id != chat["session_id"]:
                store.update_chat(chat["id"], session_id=session_id)
            if lost:
                turn.emit("notice", text=f"{process.spec.name} restarted and does not remember the earlier messages.")
            result = await process.prompt(session_id, session, turn, text)
            meta["stop_reason"] = result.get("stopReason")
            if isinstance(result.get("usage"), dict):
                meta["usage"] = result["usage"]
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
        message = store.add_message(chat["id"], "assistant", turn.text, turn.parts, meta)
        app[TURNS].pop(chat["id"], None)
        turn.emit("message", message=message)
        turn.finish()
