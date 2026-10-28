from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from aiohttp import web

from agentwebui.config import Agent, Provider, Settings
from agentwebui.server import create_app

FAKE_AGENT = str(Path(__file__).with_name("fake_agent.py"))


@pytest.fixture
async def fake_openai(aiohttp_server):
    """An OpenAI-compatible server: lists two models and streams "Hello there" in two chunks."""
    seen: list[dict] = []

    async def models(request):
        return web.json_response({"data": [{"id": "small"}, {"id": "large"}]})

    async def completions(request):
        body = await request.json()
        seen.append(body)
        if body["model"] == "broken":
            return web.json_response({"error": {"message": "no such model"}}, status=404)
        response = web.StreamResponse(headers={"Content-Type": "text/event-stream"})
        await response.prepare(request)
        for chunk in ({"choices": [{"delta": {"reasoning_content": "Hmm."}}]},
                      {"choices": [{"delta": {"content": "Hello "}}]},
                      {"choices": [{"delta": {"content": "there"}}]},
                      {"choices": [], "usage": {"prompt_tokens": 3, "completion_tokens": 2}}):
            await response.write(f"data: {json.dumps(chunk)}\n\n".encode())
        await response.write(b"data: [DONE]\n\n")
        return response

    app = web.Application()
    app.add_routes([web.get("/v1/models", models), web.post("/v1/chat/completions", completions)])
    server = await aiohttp_server(app)
    server.seen = seen
    return server


def make_settings(tmp_path: Path, fake_openai=None, mode: str = "full", password: str = "", **extra) -> Settings:
    providers = (Provider("local", "Local", str(fake_openai.make_url("/v1")).rstrip("/")),) if fake_openai else ()
    agents = (Agent("fake", "Fake agent", (sys.executable, FAKE_AGENT), str(tmp_path)),)
    return Settings(data_dir=tmp_path / "data", password=password, providers=providers, agents=agents,
                    workspace=str(tmp_path), **{"rich_replies": False, **extra})


@pytest.fixture
def settings_for(tmp_path):
    return lambda **kw: make_settings(tmp_path, **kw)


@pytest.fixture
async def client_for(aiohttp_client):
    async def make(settings: Settings):
        return await aiohttp_client(create_app(settings))
    return make


async def events(response):
    """Parse a server-sent event stream into a list of events."""
    out = []
    async for line in response.content:
        line = line.strip()
        if line.startswith(b"data: "):
            out.append(json.loads(line[6:]))
    return out
