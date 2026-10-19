from __future__ import annotations

import asyncio
import json
import sys

import pytest

from agentwebui_light import config
from agentwebui_light.acp import AgentProcess, RpcError, Session
from agentwebui_light.server import AGENTS
from agentwebui_light.config import Agent

from .conftest import events


def test_env_file_defines_providers_and_agents(tmp_path):
    env = tmp_path / ".env"
    env.write_text('PROVIDER_OPENAI_URL=https://api.openai.com/v1/\nPROVIDER_OPENAI_KEY="sk-x"\n'
                   "PROVIDER_OPENAI_MODELS=gpt-a, gpt-b\n"
                   "AGENT_CLAUDE_COMMAND=claude-agent-acp --flag 'two words'\nAGENT_CLAUDE_NAME=Claude\n"
                   "# a comment\nPORT=4000  # inline comment\n")
    settings = config.load(env, environ={})
    assert settings.port == 4000
    assert settings.provider("openai").url == "https://api.openai.com/v1"
    assert settings.provider("openai").models == ("gpt-a", "gpt-b")
    assert settings.agent("claude").command == ("claude-agent-acp", "--flag", "two words")
    assert settings.agent("claude").name == "Claude"


def test_a_value_can_name_an_environment_variable(tmp_path):
    env = tmp_path / ".env"
    env.write_text("PROVIDER_OPENAI_URL=https://api.openai.com/v1\nPROVIDER_OPENAI_KEY=${OPENAI_API_KEY}\n")
    assert config.load(env, environ={"OPENAI_API_KEY": "sk-env"}).provider("openai").key == "sk-env"
    assert config.load(env, environ={}).provider("openai").key == ""


def test_environment_wins_and_a_public_host_needs_a_password(tmp_path):
    env = tmp_path / ".env"
    env.write_text("PORT=4000\n")
    assert config.load(env, environ={"PORT": "5000"}).port == 5000
    with pytest.raises(config.ConfigError, match="PASSWORD"):
        config.load(env, environ={"HOST": "0.0.0.0"})
    assert config.load(env, environ={"HOST": "0.0.0.0", "PASSWORD": "pw"}).host == "0.0.0.0"


async def test_models_are_listed_from_the_provider(settings_for, client_for, fake_openai):
    client = await client_for(settings_for(fake_openai=fake_openai))
    body = await (await client.get("/api/config")).json()
    assert [m["id"] for m in body["models"]] == ["local/large", "local/small"]
    assert body["agents"][0]["id"] == "fake"


async def test_a_model_reply_streams_and_is_saved_with_the_history(settings_for, client_for, fake_openai):
    client = await client_for(settings_for(fake_openai=fake_openai))
    chat = await (await client.post("/api/chats", json={"target": "model:local/small"})).json()
    first = await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "Hi"}))
    assert "".join(e["text"] for e in first if e["type"] == "delta") == "Hello there"
    assert [e["text"] for e in first if e["type"] == "thought"] == ["Hmm."]
    await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "Again"}))
    assert [m["content"] for m in fake_openai.seen[-1]["messages"]] == ["Hi", "Hello there", "Again"]
    saved = await (await client.get(f"/api/chats/{chat['id']}")).json()
    assert saved["title"] == "Hi"
    assert [m["role"] for m in saved["messages"]] == ["user", "assistant", "user", "assistant"]
    assert saved["messages"][1]["meta"]["usage"]["completion_tokens"] == 2
    assert saved["messages"][1]["parts"] == [{"type": "thought", "text": "Hmm."}, {"type": "text", "text": "Hello there"}]


async def test_a_provider_error_is_shown_and_saved(settings_for, client_for, fake_openai):
    client = await client_for(settings_for(fake_openai=fake_openai))
    chat = await (await client.post("/api/chats", json={"target": "model:local/broken"})).json()
    got = await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "Hi"}))
    assert any(e["type"] == "error" and "no such model" in e["message"] for e in got)
    saved = await (await client.get(f"/api/chats/{chat['id']}")).json()
    assert "no such model" in saved["messages"][-1]["meta"]["error"]


async def test_an_agent_asks_permission_writes_in_its_folder_and_answers(settings_for, client_for, tmp_path):
    client = await client_for(settings_for())
    chat = await (await client.post("/api/chats", json={"target": "agent:fake"})).json()
    assert chat["cwd"] == str(tmp_path.resolve())
    response = await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "write hello"})
    seen = []
    async for line in response.content:
        if not line.startswith(b"data: "):
            continue
        event = json.loads(line[6:])
        seen.append(event)
        if event["type"] == "permission":
            assert [o["id"] for o in event["options"]] == ["allow", "reject"]
            answer = await client.post(f"/api/chats/{chat['id']}/permissions/{event['id']}", json={"option": "allow"})
            assert answer.status == 204
    kinds = [e["type"] for e in seen]
    assert kinds[0] == "user" and kinds[-1] == "end"
    assert {"thought", "plan", "tool", "permission", "permission_answered", "delta", "message"} <= set(kinds)
    assert (tmp_path / "hello.txt").read_text() == "hello\n"
    saved = (await (await client.get(f"/api/chats/{chat['id']}")).json())
    reply = saved["messages"][-1]
    assert reply["content"] == "Done."
    tool = next(p for p in reply["parts"] if p["type"] == "tool")
    assert tool["status"] == "completed" and tool["diffs"][0]["new"] == "hello\n"
    assert saved["session_id"] == "sess-1" and reply["meta"]["stop_reason"] == "end_turn"


async def test_rejecting_the_permission_reaches_the_agent(settings_for, client_for, tmp_path):
    client = await client_for(settings_for())
    chat = await (await client.post("/api/chats", json={"target": "agent:fake"})).json()
    response = await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "write hello"})
    async for line in response.content:
        if line.startswith(b"data: ") and (event := json.loads(line[6:]))["type"] == "permission":
            await client.post(f"/api/chats/{chat['id']}/permissions/{event['id']}", json={"option": "reject"})
    assert not (tmp_path / "hello.txt").exists()
    saved = await (await client.get(f"/api/chats/{chat['id']}")).json()
    assert saved["messages"][-1]["content"] == "Rejected."


async def test_stop_cancels_the_agent_turn(settings_for, client_for, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "slow")
    client = await client_for(settings_for())
    chat = await (await client.post("/api/chats", json={"target": "agent:fake"})).json()
    response = await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "go"})
    async for line in response.content:
        if line.startswith(b"data: ") and json.loads(line[6:])["type"] == "delta":
            assert (await client.post(f"/api/chats/{chat['id']}/cancel")).status == 202
    saved = await (await client.get(f"/api/chats/{chat['id']}")).json()
    assert saved["messages"][-1]["content"] == "Working"
    assert saved["messages"][-1]["meta"]["stop_reason"] == "cancelled"
    assert not saved["running"]


async def test_a_reload_follows_the_running_reply(settings_for, client_for, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "slow")
    client = await client_for(settings_for())
    chat = await (await client.post("/api/chats", json={"target": "agent:fake"})).json()
    first = await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "go"})
    await first.content.readline()
    first.close()  # the tab closes; the reply keeps running
    await asyncio.sleep(0.3)
    assert (await (await client.get(f"/api/chats/{chat['id']}")).json())["running"]
    assert (await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "again"})).status == 409
    again = await client.get(f"/api/chats/{chat['id']}/events")
    await client.post(f"/api/chats/{chat['id']}/cancel")
    kinds = [e["type"] for e in await events(again)]
    assert kinds[0] == "user" and "delta" in kinds and kinds[-1] == "end"


async def test_an_agent_restart_reloads_the_session(settings_for, client_for, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_MODE", "echo")
    log = tmp_path / "methods.log"
    monkeypatch.setenv("FAKE_LOG", str(log))
    client = await client_for(settings_for())
    chat = await (await client.post("/api/chats", json={"target": "agent:fake"})).json()
    await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "one"}))
    await _stop_agent(client)
    got = await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "two"}))
    assert "".join(e["text"] for e in got if e["type"] == "delta") == "You said: two"  # not the replay
    assert not any(e["type"] == "notice" for e in got)
    assert log.read_text().split().count("session/load") == 1


async def _stop_agent(client):
    await client.app[AGENTS].get("fake").stop()


async def test_a_missing_agent_command_says_what_to_fix(client_for, settings_for, tmp_path):
    settings = settings_for()
    broken = Agent("gone", "Gone", ("no-such-agent-command",), str(tmp_path))
    client = await client_for(settings.__class__(**{**settings.__dict__, "agents": (broken,)}))
    chat = await (await client.post("/api/chats", json={"target": "agent:gone"})).json()
    got = await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "hi"}))
    error = next(e for e in got if e["type"] == "error")["message"]
    assert "no-such-agent-command" in error and "AGENT_GONE_COMMAND" in error


async def test_agent_file_requests_stay_in_the_chat_folder(tmp_path):
    process = AgentProcess(Agent("x", "X", (sys.executable,), str(tmp_path)))
    process.sessions["s"] = Session(str(tmp_path))
    (tmp_path / "a.txt").write_text("1\n2\n3\n")
    assert (await process._read_file({"sessionId": "s", "path": str(tmp_path / "a.txt"), "line": 2, "limit": 1})) \
        == {"content": "2\n"}
    for path in ("/etc/passwd", str(tmp_path / ".." / "x"), "relative.txt"):
        with pytest.raises(RpcError):
            await process._write_file({"sessionId": "s", "path": path, "content": "no"})


async def test_a_password_guards_everything_but_sign_in(settings_for, client_for):
    client = await client_for(settings_for(password="secret"))
    assert (await client.get("/api/chats")).status == 401
    assert (await client.get("/")).status == 200
    assert (await (await client.get("/api/session")).json()) == {"password_required": True, "signed_in": False}
    assert (await client.post("/api/login", json={"password": "wrong"})).status == 401
    assert (await client.post("/api/login", json={"password": "secret"})).status == 200
    assert (await client.get("/api/chats")).status == 200


async def test_cross_site_and_non_json_writes_are_refused(settings_for, client_for):
    client = await client_for(settings_for())
    refused = await client.post("/api/chats", json={"target": "agent:fake"}, headers={"Origin": "https://evil.test"})
    assert refused.status == 403
    assert (await client.post("/api/chats", data="target=agent:fake",
                              headers={"Content-Type": "text/plain"})).status == 415
    assert (await client.get("/api/chats", headers={"Host": "evil.test"})).status == 403
