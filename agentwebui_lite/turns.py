"""One reply in progress: its events (replayed to every viewer, so a reload picks the stream back up), the parts it
is building, and the permission questions it is waiting on.

Parts are what the saved reply keeps and the page draws: text, thought (with how long it took), plan, tool (with
its input, output, diffs and duration), permission (the question and the answer), file (an image or file the agent
sent, saved on the server, or a file it points to) and outputs (the files it wrote in its folder)."""
from __future__ import annotations

import asyncio
import base64
import binascii
import json
import secrets
import time
from collections.abc import AsyncIterator, Callable
from typing import Any
from urllib.parse import unquote, urlsplit

PERMISSION_TIMEOUT = 600
SaveFile = Callable[[str, str, bytes], dict[str, Any]]  # (name, mime, bytes) -> the stored file


class Turn:
    def __init__(self, chat_id: str, save: SaveFile | None = None) -> None:
        self.chat_id = chat_id
        self.save = save
        self.touched: list[str] = []  # files the agent wrote, in order
        self.on_ask: Callable[[], None] | None = None
        self.events: list[dict[str, Any]] = []
        self.parts: list[dict[str, Any]] = []
        self.text = ""
        self.done = False
        self.cancelled = False
        self.started = time.monotonic()
        self.task: asyncio.Task[None] | None = None
        self.questions: dict[str, asyncio.Future[str | None]] = {}
        self._clock: dict[int, float] = {}  # id(part) -> when it started
        self._wake = asyncio.Event()

    @property
    def seconds(self) -> float:
        return round(time.monotonic() - self.started, 2)

    def emit(self, event: str, /, **data: Any) -> None:
        self.events.append({"type": event, **data})
        wake, self._wake = self._wake, asyncio.Event()
        wake.set()

    def finish(self) -> None:
        self._close_thought()
        self.done = True
        self.emit("end")

    def touch(self, path: str) -> None:
        if path and path not in self.touched:
            self.touched.append(path)

    def add_outputs(self) -> None:
        """List the files the agent wrote this turn, so the reply can offer them."""
        if self.touched:
            part = self._add({"type": "outputs", "id": "outputs", "paths": list(self.touched)})
            self.emit("part", part=part)

    def add_media(self, content: dict[str, Any]) -> dict[str, Any] | None:
        """An image, audio clip, embedded file or file link the agent sent. Bytes are saved, links are kept."""
        kind = content.get("type")
        part: dict[str, Any] | None = None
        if kind in ("image", "audio") and isinstance(content.get("data"), str):
            mime = str(content.get("mimeType") or ("image/png" if kind == "image" else "audio/wav"))
            name = _name_of(content.get("uri")) or f"{kind}-{len(self.parts) + 1}.{mime.split('/')[-1].split('+')[0]}"
            part = self._stored(name, mime, content["data"])
        elif kind == "resource" and isinstance(content.get("resource"), dict):
            resource = content["resource"]
            name = _name_of(resource.get("uri")) or "file"
            mime = str(resource.get("mimeType") or "text/plain")
            if isinstance(resource.get("blob"), str):
                part = self._stored(name, mime, resource["blob"])
            elif isinstance(resource.get("text"), str) and self.save:
                stored = self.save(name, mime, resource["text"].encode())
                part = {"type": "file", "id": stored["id"], "name": name, "mime": mime, "size": stored["size"]}
        elif kind == "resource_link" and content.get("uri"):
            uri = str(content["uri"])
            path = unquote(urlsplit(uri).path) if uri.startswith("file:") else ""
            part = {"type": "file", "id": f"link-{len(self.parts)}", "name": str(content.get("name") or _name_of(uri)),
                    "mime": str(content.get("mimeType") or ""), "size": content.get("size"),
                    "path": path, "url": "" if path else uri}
        if part is None:
            return None
        self._add(part)
        self.emit("part", part=part)
        return part

    def _stored(self, name: str, mime: str, data: str) -> dict[str, Any] | None:
        if not self.save:
            return None
        try:
            raw = base64.b64decode(data, validate=False)
        except (binascii.Error, ValueError):
            return None
        stored = self.save(name, mime, raw)
        return {"type": "file", "id": stored["id"], "name": name, "mime": mime, "size": stored["size"]}

    async def follow(self) -> AsyncIterator[dict[str, Any]]:
        index = 0
        while True:
            wake = self._wake
            while index < len(self.events):
                yield self.events[index]
                index += 1
            if self.done:
                return
            await wake.wait()

    def _add(self, part: dict[str, Any]) -> dict[str, Any]:
        if part.get("type") != "thought":
            self._close_thought()
        self.parts.append(part)
        self._clock[id(part)] = time.monotonic()
        return part

    def _close_thought(self) -> None:
        last = self.parts[-1] if self.parts else None
        if last and last.get("type") == "thought" and "seconds" not in last:
            last["seconds"] = round(time.monotonic() - self._clock.get(id(last), self.started), 1)

    def add_text(self, kind: str, text: str) -> None:
        if kind == "text":
            self.text += text
        if self.parts and self.parts[-1].get("type") == kind:
            self.parts[-1]["text"] += text
        else:
            self._add({"type": kind, "text": text})
        self.emit("delta" if kind == "text" else "thought", text=text)

    def apply(self, update: dict[str, Any]) -> None:
        """Fold one ACP `session/update` into the reply."""
        kind = update.get("sessionUpdate")
        if kind in ("agent_message_chunk", "agent_thought_chunk"):
            content = update.get("content")
            text = _text_of(content)
            if text:
                self.add_text("text" if kind == "agent_message_chunk" else "thought", text)
            elif kind == "agent_message_chunk" and isinstance(content, dict):
                self.add_media(content)
        elif kind == "plan":
            items = [{"text": str(entry.get("content") or ""), "status": str(entry.get("status") or "pending")}
                     for entry in update.get("entries") or [] if isinstance(entry, dict)]
            part = next((p for p in self.parts if p.get("type") == "plan"), None)
            if part is None:
                part = self._add({"type": "plan", "id": "plan", "items": items})
            part["items"] = items
            self.emit("plan", part=part)
        elif kind in ("tool_call", "tool_call_update"):
            self._tool(update)

    def _tool(self, update: dict[str, Any]) -> None:
        call_id = str(update.get("toolCallId") or "")
        part = next((p for p in self.parts if p.get("type") == "tool" and p["id"] == call_id), None)
        if part is None:
            part = self._add({"type": "tool", "id": call_id, "title": "", "kind": "", "status": "pending",
                              "input": "", "locations": [], "output": "", "diffs": []})
        for field in ("title", "kind", "status"):
            if isinstance(update.get(field), str) and update[field]:
                part[field] = update[field]
        if "rawInput" in update:
            part["input"] = summarize(update["rawInput"])
        if isinstance(update.get("locations"), list):
            part["locations"] = [str(loc.get("path")) for loc in update["locations"]
                                 if isinstance(loc, dict) and loc.get("path")]
        if isinstance(update.get("content"), list):
            texts, diffs = [], []
            for item in update["content"]:
                if not isinstance(item, dict):
                    continue
                if item.get("type") == "diff":
                    diffs.append({"path": str(item.get("path") or ""), "old": item.get("oldText") or "",
                                  "new": str(item.get("newText") or "")})
                    self.touch(str(item.get("path") or ""))
                elif item.get("type") == "content":
                    inner = item.get("content")
                    texts.append(_text_of(inner))
                    if isinstance(inner, dict) and inner.get("type") in ("image", "resource", "resource_link") \
                            and not part.get("media_done"):
                        self.add_media(inner)
            part["output"] = "\n".join(t for t in texts if t)
            part["diffs"] = diffs
        elif isinstance(update.get("rawOutput"), (str, dict, list)) and not part["output"]:
            part["output"] = summarize(update["rawOutput"], 4000)
        if part["status"] in ("completed", "failed"):
            part["media_done"] = True  # a later update repeats the content; don't save it twice
        if part["status"] in ("completed", "failed") and "seconds" not in part:
            part["seconds"] = round(time.monotonic() - self._clock.get(id(part), self.started), 1)
        self.emit("tool", part=part)

    async def ask(self, tool_call: dict[str, Any], options: list[dict[str, Any]]) -> str | None:
        """Put a permission question to whoever is watching. The chosen option id, or None when nobody answers."""
        question_id = secrets.token_hex(6)
        future: asyncio.Future[str | None] = asyncio.get_running_loop().create_future()
        self.questions[question_id] = future
        tool = next((p for p in self.parts if p.get("type") == "tool" and p["id"] == tool_call.get("toolCallId")), {})
        part = self._add({
            "type": "permission", "id": question_id, "state": "waiting",
            "title": str(tool_call.get("title") or tool.get("title") or "The agent wants to act"),
            "kind": str(tool_call.get("kind") or tool.get("kind") or ""),
            "input": summarize(tool_call["rawInput"]) if "rawInput" in tool_call else tool.get("input", ""),
            "options": [{"id": str(o.get("optionId")), "name": str(o.get("name") or o.get("optionId")),
                         "kind": str(o.get("kind") or "")} for o in options if isinstance(o, dict)],
            "answer": None, "expires_in": PERMISSION_TIMEOUT})
        self.emit("permission", part=part)
        if self.on_ask:
            self.on_ask()
        try:
            answer = await asyncio.wait_for(future, PERMISSION_TIMEOUT)
        except TimeoutError:
            answer = None
        finally:
            self.questions.pop(question_id, None)
        chosen = next((o for o in part["options"] if o["id"] == answer), None)
        part.update(answer=answer, answer_name=chosen["name"] if chosen else "", answer_kind=chosen["kind"] if chosen else "",
                    state="answered" if chosen else ("cancelled" if self.cancelled else "expired"))
        self.emit("permission_answered", part=part)
        return answer

    def answer(self, question_id: str, option: str | None) -> bool:
        future = self.questions.get(question_id)
        if future is None or future.done():
            return False
        future.set_result(option)
        return True

    def cancel_questions(self) -> None:
        for future in list(self.questions.values()):
            if not future.done():
                future.set_result(None)

    @property
    def waiting(self) -> bool:
        return bool(self.questions)


def summarize(value: Any, limit: int = 600) -> str:
    """A short, readable form of a tool's raw input or output: the command, the path, or compact JSON."""
    if isinstance(value, str):
        return value[:limit]
    if isinstance(value, dict):
        for key in ("command", "cmd", "file_path", "path", "url", "query", "pattern"):
            if isinstance(value.get(key), str):
                return value[key][:limit]
            if isinstance(value.get(key), list) and all(isinstance(v, str) for v in value[key]):
                return " ".join(value[key])[:limit]
    try:
        return json.dumps(value, ensure_ascii=False)[:limit]
    except (TypeError, ValueError):
        return str(value)[:limit]


def _name_of(uri: Any) -> str:
    if not isinstance(uri, str) or not uri:
        return ""
    return unquote(urlsplit(uri).path.rstrip("/").rsplit("/", 1)[-1])


def _text_of(content: Any) -> str:
    if isinstance(content, dict) and content.get("type") == "text" and isinstance(content.get("text"), str):
        return content["text"]
    return ""
