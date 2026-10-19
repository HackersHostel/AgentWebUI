"""`python -m agentwebui_light` or `agentwebui-light`: read .env and serve."""
from __future__ import annotations

import logging
import sys

from aiohttp import web

from . import config
from .server import create_app


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("aiohttp.access").setLevel(logging.WARNING)
    try:
        settings = config.load()
    except config.ConfigError as exc:
        print(f"agentwebui-light: {exc}", file=sys.stderr)
        return 2
    log = logging.getLogger("agentwebui_light")
    log.info("%d model provider(s), %d agent(s); data in %s", len(settings.providers), len(settings.agents),
             settings.data_dir.resolve())
    if not settings.providers and not settings.agents:
        log.warning("nothing to chat with yet: add a PROVIDER_* or AGENT_* entry to .env (see .env.example)")
    host = f"[{settings.host}]" if ":" in settings.host else settings.host
    web.run_app(create_app(settings), host=settings.host, port=settings.port, access_log=None,
                print=lambda _: log.info("open http://%s:%d", host, settings.port))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
