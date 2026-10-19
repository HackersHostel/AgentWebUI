"""`python -m agentwebui_lite` or `agentwebui-lite`: read .env and serve.
`agentwebui-lite backup [FILE]` writes a consistent copy of the chats database, safe while the server runs."""
from __future__ import annotations

import logging
import sys
import time
from pathlib import Path

from aiohttp import web

from . import config
from .server import create_app
from .store import Store


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("aiohttp.access").setLevel(logging.WARNING)
    try:
        settings = config.load()
    except config.ConfigError as exc:
        print(f"agentwebui-lite: {exc}", file=sys.stderr)
        return 2
    if args[:1] == ["backup"]:
        return backup(settings, args[1] if len(args) > 1 else "")
    if args:
        print("usage: agentwebui-lite [backup [FILE]]", file=sys.stderr)
        return 2
    log = logging.getLogger("agentwebui_lite")
    log.info("%d model provider(s), %d agent(s); data in %s", len(settings.providers), len(settings.agents),
             settings.data_dir.resolve())
    if not settings.providers and not settings.agents:
        log.warning("nothing to chat with yet: add a PROVIDER_* or AGENT_* entry to .env (see .env.example)")
    host = f"[{settings.host}]" if ":" in settings.host else settings.host
    web.run_app(create_app(settings), host=settings.host, port=settings.port, access_log=None,
                print=lambda _: log.info("open http://%s:%d", host, settings.port))
    return 0


def backup(settings: config.Settings, target: str) -> int:
    source = settings.data_dir / "chats.db"
    if not source.is_file():
        print(f"agentwebui-lite: no database at {source}", file=sys.stderr)
        return 1
    path = Path(target or settings.data_dir / "backups" / f"chats-{time.strftime('%Y%m%d-%H%M%S')}.db")
    path.parent.mkdir(parents=True, exist_ok=True)
    store = Store(source)
    try:
        store.backup(path)
    finally:
        store.close()
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
