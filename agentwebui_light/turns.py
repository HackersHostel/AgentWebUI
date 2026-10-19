"""One reply in progress: its events (replayed to every viewer, so a reload picks the stream back up), the parts it
is building, and the permission questions it is waiting on."""
from __future__ import annotations

import asyncio
import secrets
from collections.abc import AsyncIterator
from typing import Any

PERMISSION_TIMEOUT = 600


class Turn:
    def __init__(self, chat_id: str) -> None:
        self.chat_id = chat_id
        self.events: list[dict[str, Any]] = []
        self.parts: list[dict[str, Any]] = []
        self.text = ""
        self.done = False
        self.cancelled = False
        self.task: asyncio.Task[None] | None = None
        self.questions: dict[str, asyncio.Future[str | None]] = {}
        self._wake = asyncio.Event()

    def emit(self, event: str, /, **data: Any) -> None:
        self.events.append({"type": event, **data})
        wake, self._wake = self._wake, asyncio.Event()
        wake.set()

    def finish(self) -> None:
        self.done = True
        self.emit("end")

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

    def add_text(self, kind: str, text: str) -> None:
        if kind == "text":
            self.text += text
        if self.parts and self.parts[-1].get("type") == kind:
            self.parts[-1]["text"] += text
        else:
            self.parts.append({"type": kind, "text": text})
        self.emit("delta" if kind == "text" else "thought", text=text)

    def apply(self, update: dict[str, Any]) -> None:
        """Fold one ACP `session/update` into the reply."""
        kind = update.get("sessionUpdate")
        if kind in ("agent_message_chunk", "agent_thought_chunk"):
            text = _text_of(update.get("content"))
            if text:
                self.add_text("text" if kind == "agent_message_chunk" else "thought", text)
        elif kind == "plan":
            items = [{"text": str(entry.get("content") or ""), "status": str(entry.get("status") or "pending")}
                     for entry in update.get("entries") or [] if isinstance(entry, dict)]
            part = {"type": "plan", "items": items}
            self.parts = [p for p in self.parts if p.get("type") != "plan"] + [part]
            self.emit("plan", part=part)
        elif kind in ("tool_call", "tool_call_update"):
            call_id = str(update.get("toolCallId") or "")
            part = next((p for p in self.parts if p.get("type") == "tool" and p["id"] == call_id), None)
            if part is None:
                part = {"type": "tool", "id": call_id, "title": "", "kind": "", "status": "pending",
                        "locations": [], "output": "", "diffs": []}
                self.parts.append(part)
            for field in ("title", "kind", "status"):
                if isinstance(update.get(field), str) and update[field]:
                    part[field] = update[field]
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
                    elif item.get("type") == "content":
                        texts.append(_text_of(item.get("content")))
                part["output"] = "\n".join(t for t in texts if t)
                part["diffs"] = diffs
            self.emit("tool", part=part)

    async def ask(self, tool_call: dict[str, Any], options: list[dict[str, Any]]) -> str | None:
        """Put a permission question to whoever is watching. The chosen option id, or None when nobody answers."""
        question_id = secrets.token_hex(6)
        future: asyncio.Future[str | None] = asyncio.get_running_loop().create_future()
        self.questions[question_id] = future
        self.emit("permission", id=question_id, title=str(tool_call.get("title") or "The agent wants to act"),
                  kind=str(tool_call.get("kind") or ""),
                  options=[{"id": str(o.get("optionId")), "name": str(o.get("name") or o.get("optionId")),
                            "kind": str(o.get("kind") or "")} for o in options if isinstance(o, dict)])
        try:
            answer = await asyncio.wait_for(future, PERMISSION_TIMEOUT)
        except TimeoutError:
            answer = None
        finally:
            self.questions.pop(question_id, None)
        self.emit("permission_answered", id=question_id, option=answer)
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


def _text_of(content: Any) -> str:
    if isinstance(content, dict) and content.get("type") == "text" and isinstance(content.get("text"), str):
        return content["text"]
    return ""
