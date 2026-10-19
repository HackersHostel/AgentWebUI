"""Client side of the Agent Client Protocol: JSON-RPC 2.0, one JSON object per line, over an agent's stdio.

One process per configured agent serves every chat with it, each chat as its own ACP session. A process with no
reply in progress stops after AGENT_IDLE_MINUTES; the next message starts it again and reloads the session when the
agent supports `session/load`.
"""
from __future__ import annotations

import asyncio
import itertools
import json
import logging
import os
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from . import __version__
from .config import Agent
from .turns import Turn

log = logging.getLogger("agentwebui_lite")
MAX_LINE = 10 * 1024 * 1024
PROTOCOL_VERSION = 1


class AgentError(Exception):
    pass


class RpcError(Exception):
    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code


class Rpc:
    """JSON-RPC over a reader and a writer. Requests from the agent run as their own tasks, so one that waits for a
    person (a permission question) does not stop the messages behind it."""

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.reader, self.writer = reader, writer
        self.ids = itertools.count(1)
        self.pending: dict[int, asyncio.Future[Any]] = {}
        self.handlers: dict[str, Callable[[dict[str, Any]], Awaitable[Any]]] = {}
        self.on_notification: Callable[[str, dict[str, Any]], None] | None = None
        self.on_close: Callable[[], None] | None = None
        self.tasks: set[asyncio.Task[None]] = set()
        self.closed = False
        self.pump = asyncio.create_task(self._read())

    async def request(self, method: str, params: dict[str, Any], timeout: float | None = 120) -> Any:
        if self.closed:
            raise RpcError(-32000, "the agent is not running")
        number = next(self.ids)
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self.pending[number] = future
        self._send({"jsonrpc": "2.0", "id": number, "method": method, "params": params})
        try:
            return await asyncio.wait_for(future, timeout)
        finally:
            self.pending.pop(number, None)

    def notify(self, method: str, params: dict[str, Any]) -> None:
        if not self.closed:
            self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def _send(self, message: dict[str, Any]) -> None:
        self.writer.write(json.dumps(message, separators=(",", ":")).encode() + b"\n")

    async def _read(self) -> None:
        buffer = bytearray()
        try:
            while True:
                chunk = await self.reader.read(65536)
                if not chunk:
                    break
                buffer.extend(chunk)
                while (newline := buffer.find(b"\n")) >= 0:
                    line = bytes(buffer[:newline]).strip()
                    del buffer[:newline + 1]
                    if line:
                        self._dispatch(line)
                if len(buffer) > MAX_LINE:
                    log.warning("an agent sent a message over 10 MB; closing it")
                    break
        finally:
            self.close()

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        for future in self.pending.values():
            if not future.done():
                future.set_exception(RpcError(-32000, "the agent stopped"))
        for task in self.tasks:
            task.cancel()
        if self.on_close:
            self.on_close()

    def _dispatch(self, line: bytes) -> None:
        try:
            message = json.loads(line)
        except ValueError:
            log.debug("agent printed a line that is not JSON: %r", line[:200])
            return
        if not isinstance(message, dict):
            return
        if "method" in message and "id" in message:
            task = asyncio.create_task(self._answer(message))
            self.tasks.add(task)
            task.add_done_callback(self.tasks.discard)
        elif "id" in message:
            future = self.pending.get(message["id"])
            if future is None or future.done():
                return
            error = message.get("error")
            if isinstance(error, dict):
                future.set_exception(RpcError(int(error.get("code", -32000)), str(error.get("message", "error"))))
            else:
                future.set_result(message.get("result"))
        elif "method" in message and self.on_notification:
            self.on_notification(str(message["method"]), message.get("params") or {})

    async def _answer(self, message: dict[str, Any]) -> None:
        handler = self.handlers.get(str(message["method"]))
        try:
            if handler is None:
                raise RpcError(-32601, f"method not found: {message['method']}")
            reply: dict[str, Any] = {"result": await handler(message.get("params") or {})}
        except RpcError as exc:
            reply = {"error": {"code": exc.code, "message": str(exc)}}
        except Exception as exc:  # an agent's request must always get an answer
            log.exception("answering %s", message.get("method"))
            reply = {"error": {"code": -32603, "message": str(exc) or type(exc).__name__}}
        if not self.closed:
            self._send({"jsonrpc": "2.0", "id": message["id"], **reply})


class Session:
    def __init__(self, cwd: str) -> None:
        self.cwd = cwd
        self.turn: Turn | None = None
        self.loading = False
        self.modes: dict[str, Any] | None = None  # {"current": id, "available": [{id, name, description}]}

    def set_modes(self, raw: Any) -> None:
        if isinstance(raw, dict) and isinstance(raw.get("availableModes"), list):
            self.modes = {"current": str(raw.get("currentModeId") or ""),
                          "available": [{"id": str(m.get("id")), "name": str(m.get("name") or m.get("id")),
                                         "description": str(m.get("description") or "")}
                                        for m in raw["availableModes"] if isinstance(m, dict) and m.get("id")]}


class AgentProcess:
    def __init__(self, spec: Agent) -> None:
        self.spec = spec
        self.proc: asyncio.subprocess.Process | None = None
        self.rpc: Rpc | None = None
        self.capabilities: dict[str, Any] = {}
        self.sessions: dict[str, Session] = {}
        self.stderr = bytearray()
        self.last_used = time.monotonic()
        self.lock = asyncio.Lock()

    @property
    def running(self) -> bool:
        return self.rpc is not None and not self.rpc.closed

    @property
    def busy(self) -> bool:
        return any(session.turn is not None for session in self.sessions.values())

    async def start(self) -> None:
        async with self.lock:
            if self.running:
                return
            try:
                self.proc = await asyncio.create_subprocess_exec(
                    *self.spec.command, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE, cwd=self.spec.cwd if os.path.isdir(self.spec.cwd) else None,
                    limit=MAX_LINE)
            except FileNotFoundError:
                raise AgentError(f"{self.spec.name}: the command {self.spec.command[0]!r} was not found. Install "
                                 f"it, or fix AGENT_{self.spec.id.upper()}_COMMAND in .env.") from None
            self.stderr.clear()
            asyncio.create_task(self._drain_stderr(self.proc))
            assert self.proc.stdout and self.proc.stdin
            self.rpc = Rpc(self.proc.stdout, self.proc.stdin)  # type: ignore[arg-type]
            self.rpc.handlers = {"session/request_permission": self._permission,
                                 "fs/read_text_file": self._read_file, "fs/write_text_file": self._write_file}
            self.rpc.on_notification = self._notification
            self.rpc.on_close = self.sessions.clear
            self.sessions.clear()
            try:
                result = await self.rpc.request("initialize", {
                    "protocolVersion": PROTOCOL_VERSION,
                    "clientCapabilities": {"fs": {"readTextFile": True, "writeTextFile": True}, "terminal": False},
                    "clientInfo": {"name": "agentwebui-lite", "version": __version__}}, timeout=60)
            except (RpcError, TimeoutError) as exc:
                await self.stop()
                raise AgentError(self._why(exc)) from None
            self.capabilities = (result or {}).get("agentCapabilities") or {}
            log.info("started agent %s (pid %s)", self.spec.id, self.proc.pid)

    async def stop(self) -> None:
        if self.rpc:
            self.rpc.close()
        proc, self.proc = self.proc, None
        if proc and proc.returncode is None:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), 5)
            except TimeoutError:
                proc.kill()
                await proc.wait()
        self.sessions.clear()

    async def open(self, cwd: str, session_id: str = "") -> tuple[str, Session, bool]:
        """The chat's session: still open, reloaded, or new. The flag is True when earlier context was lost."""
        await self.start()
        assert self.rpc
        self.last_used = time.monotonic()
        if session_id in self.sessions:
            return session_id, self.sessions[session_id], False
        params = {"cwd": cwd, "mcpServers": []}
        if session_id and self.capabilities.get("loadSession"):
            session = Session(cwd)
            session.loading = True  # the agent replays the history as updates; the chat already has it
            self.sessions[session_id] = session
            try:
                loaded = await self.rpc.request("session/load", {"sessionId": session_id, **params})
                session.set_modes((loaded or {}).get("modes"))
                return session_id, session, False
            except (RpcError, TimeoutError):
                self.sessions.pop(session_id, None)
            finally:
                session.loading = False
        try:
            result = await self.rpc.request("session/new", params)
        except (RpcError, TimeoutError) as exc:
            raise AgentError(self._why(exc)) from None
        new_id = str((result or {}).get("sessionId") or "")
        if not new_id:
            raise AgentError(f"{self.spec.name} did not return a session")
        session = Session(cwd)
        session.set_modes((result or {}).get("modes"))
        self.sessions[new_id] = session
        return new_id, session, bool(session_id)

    async def prompt(self, session_id: str, session: Session, turn: Turn, text: str) -> dict[str, Any]:
        assert self.rpc
        session.turn = turn
        try:
            result = await self.rpc.request("session/prompt", {
                "sessionId": session_id, "prompt": [{"type": "text", "text": text}]}, timeout=None)
            return result or {}
        except RpcError as exc:
            raise AgentError(self._why(exc)) from None
        finally:
            session.turn = None
            self.last_used = time.monotonic()

    def cancel(self, session_id: str) -> None:
        if self.rpc:
            self.rpc.notify("session/cancel", {"sessionId": session_id})

    async def set_mode(self, session_id: str, mode_id: str) -> dict[str, Any] | None:
        session = self.sessions.get(session_id)
        if session is None or self.rpc is None or session.modes is None:
            raise AgentError(f"{self.spec.name} is not running this chat right now")
        if mode_id not in {m["id"] for m in session.modes["available"]}:
            raise AgentError(f"{self.spec.name} has no mode {mode_id!r}")
        try:
            await self.rpc.request("session/set_mode", {"sessionId": session_id, "modeId": mode_id})
        except (RpcError, TimeoutError) as exc:
            raise AgentError(self._why(exc)) from None
        session.modes["current"] = mode_id
        return session.modes

    def state(self, session_id: str) -> dict[str, Any]:
        session = self.sessions.get(session_id) if self.running else None
        return {"connected": session is not None, "running": self.running,
                "modes": session.modes if session else None}

    def _why(self, exc: Exception) -> str:
        if isinstance(exc, TimeoutError):
            return f"{self.spec.name} did not answer in time"
        tail = self.stderr.decode("utf-8", "replace").strip().splitlines()[-3:]
        detail = f": {' / '.join(tail)}" if tail and not self.running else ""
        if isinstance(exc, RpcError) and "auth" in str(exc).lower():
            return f"{self.spec.name} needs you to sign in. Sign in with its own command in a terminal, then retry."
        return f"{self.spec.name}: {exc}{detail}"

    async def _drain_stderr(self, proc: asyncio.subprocess.Process) -> None:
        assert proc.stderr
        while chunk := await proc.stderr.read(4096):
            self.stderr.extend(chunk)
            del self.stderr[:-8192]

    def _notification(self, method: str, params: dict[str, Any]) -> None:
        if method != "session/update":
            return
        session = self.sessions.get(str(params.get("sessionId")))
        update = params.get("update")
        if session is None or not isinstance(update, dict):
            return
        if update.get("sessionUpdate") == "current_mode_update" and session.modes is not None:
            session.modes["current"] = str(update.get("currentModeId") or session.modes["current"])
            if session.turn:
                session.turn.emit("modes", modes=session.modes)
        elif session.turn and not session.loading:
            session.turn.apply(update)

    async def _permission(self, params: dict[str, Any]) -> dict[str, Any]:
        session = self.sessions.get(str(params.get("sessionId")))
        if session is None or session.turn is None:
            return {"outcome": {"outcome": "cancelled"}}
        option = await session.turn.ask(params.get("toolCall") or {}, params.get("options") or [])
        if option is None:
            return {"outcome": {"outcome": "cancelled"}}
        return {"outcome": {"outcome": "selected", "optionId": option}}

    def _path(self, params: dict[str, Any]) -> Path:
        session = self.sessions.get(str(params.get("sessionId")))
        if session is None:
            raise RpcError(-32602, "unknown session")
        path = Path(str(params.get("path") or ""))
        root = Path(session.cwd).resolve()
        if not path.is_absolute():
            raise RpcError(-32602, "the path must be absolute")
        resolved = path.resolve()
        if resolved != root and root not in resolved.parents:
            raise RpcError(-32602, f"{path} is outside the chat's folder {root}")
        return resolved

    async def _read_file(self, params: dict[str, Any]) -> dict[str, Any]:
        path = self._path(params)
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            raise RpcError(-32603, f"cannot read {path}: {exc}") from None
        line, limit = params.get("line"), params.get("limit")
        if isinstance(line, int) or isinstance(limit, int):
            lines = text.splitlines(keepends=True)
            start = max((line or 1) - 1, 0)
            text = "".join(lines[start:start + limit] if isinstance(limit, int) else lines[start:])
        return {"content": text}

    async def _write_file(self, params: dict[str, Any]) -> None:
        path = self._path(params)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(str(params.get("content") or ""), encoding="utf-8")
        except OSError as exc:
            raise RpcError(-32603, f"cannot write {path}: {exc}") from None
        return None


class Agents:
    def __init__(self, specs: tuple[Agent, ...], idle_minutes: float) -> None:
        self.processes = {spec.id: AgentProcess(spec) for spec in specs}
        self.idle = idle_minutes * 60
        self._reaper: asyncio.Task[None] | None = None

    def get(self, agent_id: str) -> AgentProcess | None:
        return self.processes.get(agent_id)

    def start_reaper(self) -> None:
        self._reaper = asyncio.create_task(self._reap())

    async def _reap(self) -> None:
        while True:
            await asyncio.sleep(min(30, max(self.idle / 4, 1)))
            for process in self.processes.values():
                if process.running and not process.busy and time.monotonic() - process.last_used > self.idle:
                    log.info("stopping idle agent %s", process.spec.id)
                    await process.stop()

    async def close(self) -> None:
        if self._reaper:
            self._reaper.cancel()
        await asyncio.gather(*(process.stop() for process in self.processes.values()))
