"""Chats and messages in one SQLite file. Calls are short and local, so they run on the event loop."""
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
CREATE INDEX IF NOT EXISTS messages_chat ON messages (chat_id, id);
CREATE INDEX IF NOT EXISTS chats_updated ON chats (updated_at DESC);
"""


class Store:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript(SCHEMA)

    def close(self) -> None:
        self.db.close()

    def list_chats(self) -> list[dict[str, Any]]:
        rows = self.db.execute("SELECT * FROM chats ORDER BY updated_at DESC").fetchall()
        return [_chat(row) for row in rows]

    def get_chat(self, chat_id: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM chats WHERE id = ?", (chat_id,)).fetchone()
        return _chat(row) if row else None

    def create_chat(self, kind: str, target: str, cwd: str = "", title: str = "") -> dict[str, Any]:
        now = time.time()
        chat_id = secrets.token_hex(8)
        self.db.execute("INSERT INTO chats (id, title, kind, target, cwd, created_at, updated_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?)", (chat_id, title, kind, target, cwd, now, now))
        return self.get_chat(chat_id)  # type: ignore[return-value]

    def update_chat(self, chat_id: str, **fields: Any) -> None:
        allowed = {key: value for key, value in fields.items() if key in ("title", "session_id")}
        allowed["updated_at"] = time.time()
        assignments = ", ".join(f"{key} = ?" for key in allowed)
        self.db.execute(f"UPDATE chats SET {assignments} WHERE id = ?", (*allowed.values(), chat_id))

    def delete_chat(self, chat_id: str) -> bool:
        return self.db.execute("DELETE FROM chats WHERE id = ?", (chat_id,)).rowcount > 0

    def messages(self, chat_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute("SELECT * FROM messages WHERE chat_id = ? ORDER BY id", (chat_id,)).fetchall()
        return [_message(row) for row in rows]

    def add_message(self, chat_id: str, role: str, content: str, parts: list | None = None,
                    meta: dict | None = None) -> dict[str, Any]:
        now = time.time()
        cursor = self.db.execute(
            "INSERT INTO messages (chat_id, role, content, parts, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (chat_id, role, content, json.dumps(parts or []), json.dumps(meta or {}), now))
        self.db.execute("UPDATE chats SET updated_at = ? WHERE id = ?", (now, chat_id))
        row = self.db.execute("SELECT * FROM messages WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return _message(row)


def _chat(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def _message(row: sqlite3.Row) -> dict[str, Any]:
    message = dict(row)
    message["parts"] = json.loads(message["parts"])
    message["meta"] = json.loads(message["meta"])
    return message
