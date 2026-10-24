from __future__ import annotations

import asyncio
import json
import re
import sys

import pytest

from agentwebui_lite import config
from agentwebui_lite.acp import AgentProcess, RpcError, Session
from agentwebui_lite.server import AGENTS, SETTINGS
from agentwebui_lite.config import Agent

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
    reply = saved["messages"][1]
    assert reply["meta"]["usage"]["completion_tokens"] == 2
    assert reply["meta"]["model"] == "local/small" and reply["meta"]["seconds"] >= 0
    thought, text = reply["parts"]
    assert thought["type"] == "thought" and thought["text"] == "Hmm." and thought["seconds"] >= 0
    assert text == {"type": "text", "text": "Hello there"}


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
            part = event["part"]
            assert [o["id"] for o in part["options"]] == ["allow", "reject"]
            assert part["state"] == "waiting" and part["input"].endswith("hello.txt")
            assert (await (await client.get("/api/chats")).json())[0]["waiting"]
            answer = await client.post(f"/api/chats/{chat['id']}/permissions/{part['id']}", json={"option": "allow"})
            assert answer.status == 204
    kinds = [e["type"] for e in seen]
    assert kinds[0] == "user" and kinds[-1] == "end"
    assert {"thought", "plan", "tool", "permission", "permission_answered", "delta", "message"} <= set(kinds)
    assert (tmp_path / "hello.txt").read_text() == "hello\n"
    saved = (await (await client.get(f"/api/chats/{chat['id']}")).json())
    reply = saved["messages"][-1]
    assert reply["content"] == "Done."
    tool = next(p for p in reply["parts"] if p["type"] == "tool")
    assert tool["status"] == "completed" and tool["diffs"][0]["new"] == "hello\n" and tool["seconds"] >= 0
    asked = next(p for p in reply["parts"] if p["type"] == "permission")
    assert asked["state"] == "answered" and asked["answer_name"] == "Allow once"
    assert saved["session_id"] == "sess-1" and reply["meta"]["stop_reason"] == "end_turn"
    assert reply["meta"]["agent"] == "Fake agent"
    assert saved["agent"]["connected"] and saved["agent"]["modes"]["current"] == "ask"


async def test_rejecting_the_permission_reaches_the_agent(settings_for, client_for, tmp_path):
    client = await client_for(settings_for())
    chat = await (await client.post("/api/chats", json={"target": "agent:fake"})).json()
    response = await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "write hello"})
    async for line in response.content:
        if line.startswith(b"data: ") and (event := json.loads(line[6:]))["type"] == "permission":
            await client.post(f"/api/chats/{chat['id']}/permissions/{event['part']['id']}", json={"option": "reject"})
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
    assert (await (await client.get("/api/session")).json()) == {"password_required": True, "email_required": False,
                                                                  "signed_in": False}
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


async def test_search_finds_titles_and_message_text(settings_for, client_for, fake_openai):
    client = await client_for(settings_for(fake_openai=fake_openai))
    chat = await (await client.post("/api/chats", json={"target": "model:local/small"})).json()
    await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "Plan the trip"}))
    by_title = await (await client.get("/api/search", params={"q": "trip"})).json()
    assert [c["id"] for c in by_title] == [chat["id"]] and by_title[0]["in_title"]
    by_text = await (await client.get("/api/search", params={"q": "there"})).json()
    assert by_text[0]["snippet"].startswith("Hello there")
    assert await (await client.get("/api/search", params={"q": "100%"})).json() == []


async def test_retry_replaces_the_last_reply(settings_for, client_for, fake_openai):
    client = await client_for(settings_for(fake_openai=fake_openai))
    chat = await (await client.post("/api/chats", json={"target": "model:local/small"})).json()
    await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "Hi"}))
    got = await events(await client.post(f"/api/chats/{chat['id']}/retry"))
    assert [e["type"] for e in got][0] != "user"
    saved = await (await client.get(f"/api/chats/{chat['id']}")).json()
    assert [m["role"] for m in saved["messages"]] == ["user", "assistant"]
    assert [m["content"] for m in fake_openai.seen[-1]["messages"]] == ["Hi"]


async def test_a_model_chat_can_switch_models_but_an_agent_chat_cannot(settings_for, client_for, fake_openai):
    client = await client_for(settings_for(fake_openai=fake_openai))
    chat = await (await client.post("/api/chats", json={"target": "model:local/small"})).json()
    moved = await client.patch(f"/api/chats/{chat['id']}", json={"target": "model:local/large"})
    assert (await moved.json())["target"] == "local/large"
    await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "Hi"}))
    assert fake_openai.seen[-1]["model"] == "large"
    agent = await (await client.post("/api/chats", json={"target": "agent:fake"})).json()
    assert (await client.patch(f"/api/chats/{agent['id']}", json={"target": "model:local/small"})).status == 422


async def test_an_agent_mode_can_be_changed(settings_for, client_for, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "echo")
    client = await client_for(settings_for())
    chat = await (await client.post("/api/chats", json={"target": "agent:fake"})).json()
    assert (await client.post(f"/api/chats/{chat['id']}/mode", json={"mode": "code"})).status == 409  # not started
    got = await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "hi"}))
    modes = next(e for e in got if e["type"] == "modes")["modes"]
    assert [m["id"] for m in modes["available"]] == ["ask", "code"]
    changed = await client.post(f"/api/chats/{chat['id']}/mode", json={"mode": "code"})
    assert (await changed.json())["modes"]["current"] == "code"
    assert (await client.post(f"/api/chats/{chat['id']}/mode", json={"mode": "nope"})).status == 409


async def test_config_describes_providers_agents_and_the_user(tmp_path, client_for, fake_openai):
    from .conftest import make_settings
    client = await client_for(make_settings(tmp_path, fake_openai=fake_openai, user_name="Labib"))
    from agentwebui_lite.server import PROVIDERS
    await client.server.app[PROVIDERS].locality.check_all()
    body = await (await client.get("/api/config")).json()
    assert body["user_name"] == "Labib"
    provider = body["providers"][0]
    assert provider["models"] == 2 and provider["endpoint"] == "machine" and provider["checking"] is False
    # On this machine, but a plain OpenAI-compatible server, not a known local engine (#16): not local.
    assert not provider["local"] and provider["why"].startswith("Not local: no known local engine answered")
    assert not any(m["local"] for m in body["models"])
    assert body["agents"][0]["running"] is False


async def test_a_provider_with_listed_models_is_still_checked(tmp_path, client_for, fake_openai):
    from agentwebui_lite.config import Provider
    from .conftest import make_settings
    settings = make_settings(tmp_path)
    listed = Provider("listed", "Listed", str(fake_openai.make_url("/v1")).rstrip("/"), "", ("only-this",))
    gone = Provider("gone", "Gone", "http://127.0.0.1:9/v1", "", ("x",))
    client = await client_for(settings.__class__(**{**settings.__dict__, "providers": (listed, gone)}))
    body = await (await client.get("/api/config")).json()
    assert [m["id"] for m in body["models"]] == ["listed/only-this", "gone/x"]
    summary = {p["id"]: p for p in body["providers"]}
    assert summary["listed"]["error"] == "" and summary["listed"]["models"] == 1
    assert "could not be reached" in summary["gone"]["error"]


# --- agent › model › workspace ---
async def _agent_chat(client, **body):
    return await (await client.post("/api/chats", json={"target": "agent:fake", **body})).json()


def _option(options, option_id):
    return next(o for o in options if o["id"] == option_id)


async def test_an_agent_chat_lists_the_agents_models_and_effort(settings_for, client_for, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "echo")
    monkeypatch.setenv("FAKE_CONFIG", "options")
    client = await client_for(settings_for())
    chat = await _agent_chat(client)
    got = await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "hi"}))
    config = next(e for e in got if e["type"] == "config")["config"]
    assert [c["value"] for c in _option(config, "model")["options"]] == ["opus", "sonnet"]
    assert _option(config, "effort")["category"] == "thought_level"
    saved = await (await client.get(f"/api/chats/{chat['id']}")).json()
    assert _option(saved["agent"]["config"], "model")["currentValue"] == "opus"
    assert saved["agent"]["modes"]["option"] == "mode"  # the mode button uses the config option
    assert saved["messages"][-1]["meta"]["agent_model"] == "Opus · High"


async def test_a_chosen_model_is_applied_before_the_first_prompt(settings_for, client_for, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_MODE", "echo")
    monkeypatch.setenv("FAKE_CONFIG", "options")
    log = tmp_path / "methods.log"
    monkeypatch.setenv("FAKE_LOG", str(log))
    client = await client_for(settings_for())
    chat = await _agent_chat(client, config={"model": "sonnet"})
    got = await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "hi"}))
    assert "".join(e["text"] for e in got if e["type"] == "delta") == "You said: hi [sonnet]"
    methods = [m for m in log.read_text().split() if m.startswith("session/")]
    assert methods == ["session/new", "session/set_config_option", "session/prompt"]


async def test_the_model_can_change_between_turns(settings_for, client_for, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "echo")
    monkeypatch.setenv("FAKE_CONFIG", "options")
    client = await client_for(settings_for())
    chat = await _agent_chat(client)
    await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "one"}))
    changed = await client.post(f"/api/chats/{chat['id']}/config", json={"id": "model", "value": "sonnet"})
    assert _option((await changed.json())["config"], "model")["currentValue"] == "sonnet"
    got = await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "two"}))
    assert "".join(e["text"] for e in got if e["type"] == "delta") == "You said: two [sonnet]"
    assert (await client.post(f"/api/chats/{chat['id']}/config", json={"id": "model", "value": "gpt"})).status == 422
    assert (await client.post(f"/api/chats/{chat['id']}/config", json={"id": "nope", "value": "x"})).status == 422


async def test_changing_the_model_replaces_the_options_that_depend_on_it(settings_for, client_for, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "echo")
    monkeypatch.setenv("FAKE_CONFIG", "options")
    client = await client_for(settings_for())
    chat = await _agent_chat(client)
    await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "one"}))
    await client.post(f"/api/chats/{chat['id']}/config", json={"id": "effort", "value": "max"})
    config = (await (await client.post(f"/api/chats/{chat['id']}/config",
                                       json={"id": "model", "value": "sonnet"})).json())["config"]
    effort = _option(config, "effort")
    assert [c["value"] for c in effort["options"]] == ["low", "high"] and effort["currentValue"] == "high"
    toggled = await client.post(f"/api/chats/{chat['id']}/config", json={"id": "fast", "value": True})
    assert _option((await toggled.json())["config"], "fast")["currentValue"] is True


async def test_a_restart_reapplies_the_stored_model_after_load(settings_for, client_for, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_MODE", "echo")
    monkeypatch.setenv("FAKE_CONFIG", "options")
    log = tmp_path / "methods.log"
    monkeypatch.setenv("FAKE_LOG", str(log))
    client = await client_for(settings_for())
    chat = await _agent_chat(client)
    await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "one"}))
    await client.post(f"/api/chats/{chat['id']}/config", json={"id": "model", "value": "sonnet"})
    await _stop_agent(client)
    got = await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "two"}))
    assert "".join(e["text"] for e in got if e["type"] == "delta") == "You said: two [sonnet]"
    methods = [m for m in log.read_text().split() if m.startswith("session/")]
    assert methods[-3:] == ["session/load", "session/set_config_option", "session/prompt"]


async def test_a_choice_made_while_the_agent_is_stopped_is_kept_for_later(settings_for, client_for, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "echo")
    monkeypatch.setenv("FAKE_CONFIG", "options")
    client = await client_for(settings_for())
    chat = await _agent_chat(client)
    await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "one"}))
    await _stop_agent(client)
    stored = await client.post(f"/api/chats/{chat['id']}/config", json={"id": "model", "value": "sonnet"})
    assert stored.status == 200 and _option((await stored.json())["config"], "model")["currentValue"] == "sonnet"
    saved = await (await client.get(f"/api/chats/{chat['id']}")).json()
    assert _option(saved["agent"]["config"], "model")["currentValue"] == "sonnet"


async def test_the_legacy_models_shape_switches_through_set_model(settings_for, client_for, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_MODE", "echo")
    monkeypatch.setenv("FAKE_CONFIG", "legacy")
    log = tmp_path / "methods.log"
    monkeypatch.setenv("FAKE_LOG", str(log))
    client = await client_for(settings_for())
    chat = await _agent_chat(client)
    await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "one"}))
    config = (await (await client.post(f"/api/chats/{chat['id']}/config",
                                       json={"id": "model", "value": "sonnet"})).json())["config"]
    assert config[0]["category"] == "model" and config[0]["currentValue"] == "sonnet"
    assert "session/set_model" in log.read_text().split()
    got = await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "two"}))
    assert "".join(e["text"] for e in got if e["type"] == "delta") == "You said: two [sonnet]"


async def test_an_agent_with_no_model_options_has_none(settings_for, client_for, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "echo")
    client = await client_for(settings_for())
    chat = await _agent_chat(client)
    await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "hi"}))
    saved = await (await client.get(f"/api/chats/{chat['id']}")).json()
    assert saved["agent"]["config"] is None and "agent_model" not in saved["messages"][-1]["meta"]


async def test_the_probe_caches_options_and_a_second_call_starts_nothing(settings_for, client_for, monkeypatch,
                                                                        tmp_path):
    monkeypatch.setenv("FAKE_CONFIG", "options")
    log = tmp_path / "methods.log"
    monkeypatch.setenv("FAKE_LOG", str(log))
    client = await client_for(settings_for())
    first = await (await client.get("/api/agents/fake/options")).json()
    second = await (await client.get("/api/agents/fake/options")).json()
    assert first == second and _option(first["options"], "model")["currentValue"] == "opus"
    assert log.read_text().split().count("session/new") == 1
    assert _option((await (await client.get("/api/config")).json())["agents"][0]["options"], "effort")
    assert (await client.get("/api/agents/nobody/options")).status == 404


async def test_changing_the_model_during_a_reply_is_refused(settings_for, client_for, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "slow")
    monkeypatch.setenv("FAKE_CONFIG", "options")
    client = await client_for(settings_for())
    chat = await _agent_chat(client)
    response = await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "go"})
    async for line in response.content:
        if line.startswith(b"data: ") and json.loads(line[6:])["type"] == "delta":
            refused = await client.post(f"/api/chats/{chat['id']}/config", json={"id": "model", "value": "sonnet"})
            assert refused.status == 409
            await client.post(f"/api/chats/{chat['id']}/cancel")


async def test_the_agent_can_change_its_own_options_and_lists_its_commands(settings_for, client_for, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "echo")
    monkeypatch.setenv("FAKE_CONFIG", "options")
    client = await client_for(settings_for())
    chat = await _agent_chat(client)
    got = await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "change model"}))
    assert _option([e for e in got if e["type"] == "config"][-1]["config"], "model")["currentValue"] == "sonnet"
    saved = await (await client.get(f"/api/chats/{chat['id']}")).json()
    assert saved["agent"]["commands"] == [{"name": "review", "description": "Review the changes",
                                           "hint": "what to look at"}]


async def test_an_env_model_is_where_a_new_agent_chat_starts(settings_for, client_for, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_MODE", "echo")
    monkeypatch.setenv("FAKE_CONFIG", "options")
    settings = settings_for()
    agent = Agent("fake", "Fake agent", settings.agents[0].command, str(tmp_path), "sonnet")
    client = await client_for(settings.__class__(**{**settings.__dict__, "agents": (agent,)}))
    chat = await _agent_chat(client)
    got = await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "hi"}))
    assert "".join(e["text"] for e in got if e["type"] == "delta") == "You said: hi [sonnet]"


# --- files in and out ---
def tmp_path_of(client):
    return client.app[SETTINGS].data_dir


def _b64(data: bytes) -> str:
    import base64
    return base64.b64encode(data).decode()


async def _upload(client, name, data, mime):
    response = await client.post("/api/files", json={"name": name, "type": mime, "data": _b64(data)})
    assert response.status == 201
    return await response.json()


async def test_a_model_chat_sends_images_and_text_files_as_parts(settings_for, client_for, fake_openai):
    client = await client_for(settings_for(fake_openai=fake_openai))
    image = await _upload(client, "cat.png", b"\x89PNG\r\n", "image/png")
    notes = await _upload(client, "notes.md", b"# Notes\n", "text/markdown")
    chat = await (await client.post("/api/chats", json={"target": "model:local/small"})).json()
    await events(await client.post(f"/api/chats/{chat['id']}/messages",
                                   json={"text": "What is this?", "files": [image["id"], notes["id"]]}))
    parts = fake_openai.seen[-1]["messages"][-1]["content"]
    assert parts[0]["image_url"]["url"].startswith("data:image/png;base64,")
    assert "# Notes" in parts[1]["text"] and parts[2] == {"type": "text", "text": "What is this?"}
    saved = await (await client.get(f"/api/chats/{chat['id']}")).json()
    assert [f["name"] for f in saved["messages"][0]["meta"]["files"]] == ["cat.png", "notes.md"]
    assert (await (await client.get(f"/api/files/{image['id']}")).read()) == b"\x89PNG\r\n"
    assert (await client.delete(f"/api/chats/{chat['id']}")).status == 204
    assert (await client.get(f"/api/files/{image['id']}")).status == 404
    assert not (tmp_path_of(client) / "files" / image["id"]).exists()


async def test_an_agent_gets_attachments_as_acp_blocks(settings_for, client_for, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_MODE", "echo")
    log = tmp_path / "methods.log"
    monkeypatch.setenv("FAKE_LOG", str(log))
    client = await client_for(settings_for())
    image = await _upload(client, "cat.png", b"\x89PNG\r\n", "image/png")
    notes = await _upload(client, "notes.txt", b"hello", "text/plain")
    archive = await _upload(client, "data.zip", b"PK\x03\x04\x00\x00", "application/zip")
    chat = await _agent_chat(client)
    await events(await client.post(f"/api/chats/{chat['id']}/messages",
                                   json={"text": "look", "files": [image["id"], notes["id"], archive["id"]]}))
    assert "blocks:image,resource,resource_link,text" in log.read_text().split()


async def test_an_agent_can_send_images_and_files_back(settings_for, client_for, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_MODE", "media")
    client = await client_for(settings_for())
    chat = await _agent_chat(client)
    await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "draw"}))
    reply = (await (await client.get(f"/api/chats/{chat['id']}")).json())["messages"][-1]
    image, link = [p for p in reply["parts"] if p["type"] == "file"]
    assert image["mime"] == "image/png" and image["size"] == 8
    assert (await client.get(f"/api/files/{image['id']}")).status == 200
    assert link["name"] == "chart.svg" and link["path"] == str(tmp_path / "chart.svg")
    outputs = next(p for p in reply["parts"] if p["type"] == "outputs")
    assert outputs["paths"] == [str(tmp_path / "chart.svg")]
    local = await client.get(f"/api/chats/{chat['id']}/local", params={"path": "chart.svg"})
    assert local.status == 200 and "sandbox" in local.headers["Content-Security-Policy"]
    assert (await client.get(f"/api/chats/{chat['id']}/local", params={"path": "/etc/passwd"})).status == 403


async def test_uploaded_html_never_runs_as_a_page(settings_for, client_for):
    client = await client_for(settings_for())
    page = await _upload(client, "x.html", b"<script>alert(1)</script>", "text/html")
    response = await client.get(f"/api/files/{page['id']}")
    assert response.headers["Content-Security-Policy"].startswith("sandbox")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    download = await client.get(f"/api/files/{page['id']}", params={"download": "1"})
    assert download.headers["Content-Disposition"].startswith("attachment")
    assert (await client.post("/api/files", json={"name": "x", "data": "not base64!"})).status == 422


async def test_a_file_in_a_shared_folder_can_be_attached(settings_for, client_for, tmp_path):
    client = await client_for(settings_for())
    (tmp_path / "notes.md").write_text("# Plan\n")
    attached = await (await client.post("/api/files", json={"path": str(tmp_path / "notes.md")})).json()
    assert attached["name"] == "notes.md" and attached["mime"] == "text/markdown" and attached["size"] == 7
    assert (await client.post("/api/files", json={"path": "/etc/hostname"})).status == 403


# --- versions, organizing, temporary chats, projects ---
async def test_editing_a_message_adds_a_version_and_both_stay(settings_for, client_for, fake_openai):
    client = await client_for(settings_for(fake_openai=fake_openai))
    chat = await (await client.post("/api/chats", json={"target": "model:local/small"})).json()
    await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "Hi"}))
    first = (await (await client.get(f"/api/chats/{chat['id']}")).json())["messages"]
    got = await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "Hello", "edit": first[0]["id"]}))
    assert len(next(e for e in got if e["type"] == "user")["message"]["siblings"]) == 2
    assert [m["content"] for m in fake_openai.seen[-1]["messages"]] == ["Hello"]
    thread = (await (await client.get(f"/api/chats/{chat['id']}")).json())["messages"]
    assert [m["content"] for m in thread] == ["Hello", "Hello there"]
    assert thread[0]["siblings"] == [first[0]["id"], thread[0]["id"]]
    back = await (await client.post(f"/api/chats/{chat['id']}/version", json={"message": first[0]["id"]})).json()
    assert [m["content"] for m in back["messages"]] == ["Hi", "Hello there"]
    assert back["messages"][1]["id"] == first[1]["id"]


async def test_regenerating_keeps_the_earlier_reply_as_a_version(settings_for, client_for, fake_openai):
    client = await client_for(settings_for(fake_openai=fake_openai))
    chat = await (await client.post("/api/chats", json={"target": "model:local/small"})).json()
    await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "Hi"}))
    await events(await client.post(f"/api/chats/{chat['id']}/retry"))
    thread = (await (await client.get(f"/api/chats/{chat['id']}")).json())["messages"]
    assert len(thread) == 2 and len(thread[1]["siblings"]) == 2


async def test_an_agent_message_cannot_be_edited(settings_for, client_for, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "echo")
    client = await client_for(settings_for())
    chat = await _agent_chat(client)
    await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "hi"}))
    first = (await (await client.get(f"/api/chats/{chat['id']}")).json())["messages"][0]
    assert (await client.post(f"/api/chats/{chat['id']}/messages",
                              json={"text": "x", "edit": first["id"]})).status == 422


async def test_chats_can_be_pinned_archived_cloned_and_tuned(settings_for, client_for, fake_openai):
    client = await client_for(settings_for(fake_openai=fake_openai))
    one = await (await client.post("/api/chats", json={"target": "model:local/small"})).json()
    two = await (await client.post("/api/chats", json={"target": "model:local/small"})).json()
    await client.patch(f"/api/chats/{one['id']}", json={"pinned": True})
    await client.patch(f"/api/chats/{two['id']}", json={"archived": True})
    listed = await (await client.get("/api/chats")).json()
    assert listed[0]["id"] == one["id"] and listed[0]["pinned"] and listed[1]["archived"]
    tuned = await client.patch(f"/api/chats/{one['id']}", json={"config": {"temperature": 0.3, "max_tokens": 50,
                                                                          "bogus": 1}})
    assert (await tuned.json())["config"] == {"temperature": 0.3, "max_tokens": 50}
    await events(await client.post(f"/api/chats/{one['id']}/messages", json={"text": "Hi"}))
    assert fake_openai.seen[-1]["temperature"] == 0.3 and fake_openai.seen[-1]["max_tokens"] == 50
    copy = await (await client.post(f"/api/chats/{one['id']}/clone")).json()
    copied = await (await client.get(f"/api/chats/{copy['id']}")).json()
    assert copy["title"] == "Hi (copy)" and [m["content"] for m in copied["messages"]] == ["Hi", "Hello there"]
    await events(await client.post(f"/api/chats/{one['id']}/messages", json={"text": "More"}))
    thread = (await (await client.get(f"/api/chats/{one['id']}")).json())["messages"]
    branch = await (await client.post(f"/api/chats/{one['id']}/clone", json={"upto": thread[1]["id"]})).json()
    branched = await (await client.get(f"/api/chats/{branch['id']}")).json()
    assert branch["title"] == "Hi (branch)" and len(branched["messages"]) == 2


async def test_a_temporary_chat_is_never_saved(settings_for, client_for, fake_openai, tmp_path):
    client = await client_for(settings_for(fake_openai=fake_openai))
    chat = await (await client.post("/api/chats", json={"target": "model:local/small", "temporary": True})).json()
    assert chat["temporary"]
    await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "secret plans"}))
    assert (await (await client.get(f"/api/chats/{chat['id']}")).json())["messages"][1]["content"] == "Hello there"
    assert await (await client.get("/api/chats")).json() == []
    assert await (await client.get("/api/search", params={"q": "secret"})).json() == []
    assert b"secret plans" not in (tmp_path / "data" / "chats.db").read_bytes()
    assert (await client.delete(f"/api/chats/{chat['id']}")).status == 204
    assert (await client.get(f"/api/chats/{chat['id']}")).status == 404


async def test_a_project_gives_its_chats_a_folder_and_instructions(settings_for, client_for, fake_openai, tmp_path):
    client = await client_for(settings_for(fake_openai=fake_openai))
    folder = tmp_path / "site"
    folder.mkdir()
    project = await (await client.post("/api/projects", json={"name": "Site", "folder": str(folder),
                                                             "instructions": "Use British English."})).json()
    agent = await _agent_chat(client, project_id=project["id"])
    assert agent["cwd"] == str(folder.resolve()) and agent["project_id"] == project["id"]
    chat = await (await client.post("/api/chats", json={"target": "model:local/small",
                                                        "project_id": project["id"]})).json()
    await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "Hi"}))
    assert fake_openai.seen[-1]["messages"][0] == {"role": "system", "content": "Use British English."}
    renamed = await client.patch(f"/api/projects/{project['id']}", json={"name": "Website"})
    assert (await renamed.json())["name"] == "Website"
    assert [p["name"] for p in await (await client.get("/api/projects")).json()] == ["Website"]
    assert (await client.post("/api/projects", json={"name": "x", "folder": "/etc"})).status == 403
    assert (await client.delete(f"/api/projects/{project['id']}")).status == 204
    assert (await (await client.get(f"/api/chats/{chat['id']}")).json())["project_id"] == ""


async def test_the_rich_reply_note_is_sent_once_to_an_agent_and_always_to_a_model(settings_for, client_for,
                                                                                    fake_openai, monkeypatch,
                                                                                    tmp_path):
    monkeypatch.setenv("FAKE_MODE", "echo")
    log = tmp_path / "methods.log"
    monkeypatch.setenv("FAKE_LOG", str(log))
    client = await client_for(settings_for(fake_openai=fake_openai, rich_replies=True))
    chat = await (await client.post("/api/chats", json={"target": "model:local/small"})).json()
    await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "Hi"}))
    system = fake_openai.seen[-1]["messages"][0]
    assert system["role"] == "system" and "```choices" not in system["content"] and "`choices`" in system["content"]
    agent = await _agent_chat(client)
    for text in ("one", "two"):
        await events(await client.post(f"/api/chats/{agent['id']}/messages", json={"text": text}))
    assert [line for line in log.read_text().split() if line.startswith("blocks:")] == ["blocks:text,text",
                                                                                         "blocks:text"]


# --- the file manager and Git ---
async def test_the_file_manager_works_inside_the_roots_only(settings_for, client_for, tmp_path):
    client = await client_for(settings_for())
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "app.py").write_text("print('hi')\n")
    listing = await (await client.get("/api/fs/list", params={"path": str(tmp_path)})).json()
    assert [e["name"] for e in listing["entries"] if e["dir"]] == ["data", "src"]
    read = await (await client.get("/api/fs/read", params={"path": str(tmp_path / "src" / "app.py")})).json()
    assert read["text"] == "print('hi')\n"
    await client.post("/api/fs/write", json={"path": str(tmp_path / "src" / "app.py"), "content": "x = 1\n"})
    assert (tmp_path / "src" / "app.py").read_text() == "x = 1\n"
    assert (await client.post("/api/fs/mkdir", json={"path": str(tmp_path / "docs")})).status == 201
    await client.post("/api/fs/rename", json={"path": str(tmp_path / "docs"), "to": str(tmp_path / "notes")})
    up = await client.post("/api/fs/upload", json={"folder": str(tmp_path / "notes"), "name": "a.txt",
                                                    "data": _b64(b"one")})
    again = await client.post("/api/fs/upload", json={"folder": str(tmp_path / "notes"), "name": "a.txt",
                                                       "data": _b64(b"two")})
    assert (await up.json())["name"] == "a.txt" and (await again.json())["name"] == "a (2).txt"
    found = await (await client.get("/api/fs/find", params={"path": str(tmp_path), "q": "apy"})).json()
    assert found[0]["rel"] == "src/app.py"
    grep = await (await client.get("/api/fs/grep", params={"path": str(tmp_path), "q": "X = 1"})).json()
    assert grep["files"][0]["hits"] == [{"line": 1, "text": "x = 1"}]
    assert (await client.post("/api/fs/delete", json={"path": str(tmp_path / "notes")})).status == 204
    assert not (tmp_path / "notes").exists()
    (tmp_path / "escape").symlink_to("/etc")
    for path in ("/etc/passwd", str(tmp_path / ".." / "x"), str(tmp_path / "escape" / "passwd")):
        assert (await client.get("/api/fs/read", params={"path": path})).status == 403
    assert (await client.post("/api/fs/delete", json={"path": str(tmp_path)})).status == 403
    assert (await client.get("/api/fs/raw", params={"path": "/etc/hostname"})).status == 403


async def test_an_agent_folder_outside_the_roots_is_refused(settings_for, client_for, tmp_path):
    shared = tmp_path / "shared"
    shared.mkdir()
    client = await client_for(settings_for(files_roots=(str(shared),)))
    assert (await client.post("/api/chats", json={"target": "agent:fake", "cwd": "/tmp"})).status == 403
    assert (await client.post("/api/chats", json={"target": "agent:fake", "cwd": str(shared)})).status == 201


async def test_git_status_commit_branches_and_log_run_through_git(settings_for, client_for, tmp_path):
    import subprocess
    client = await client_for(settings_for())
    repo = tmp_path / "repo"
    repo.mkdir()
    assert (await (await client.post("/api/git/init", json={"path": str(repo)})).json())["repo"]
    for key, value in (("user.name", "Test"), ("user.email", "test@example.com")):
        subprocess.run(["git", "-C", str(repo), "config", key, value], check=True)
    (repo / "a.txt").write_text("one\n")
    status = await (await client.get("/api/git/status", params={"path": str(repo)})).json()
    assert [(c["rel"], c["status"]) for c in status["changes"]] == [("a.txt", "untracked")]
    diff = await (await client.get("/api/git/diff", params={"path": str(repo)})).json()
    assert diff["files"][0]["new"] == "one\n" and diff["files"][0]["old"] == ""
    assert (await client.post("/api/git/commit", json={"path": str(repo), "message": ""})).status == 422
    committed = await (await client.post("/api/git/commit", json={"path": str(repo), "message": "Add a"})).json()
    assert committed["changes"] == []
    (repo / "a.txt").write_text("two\n")
    diff = await (await client.get("/api/git/diff", params={"path": str(repo), "file": str(repo / "a.txt")})).json()
    assert diff["files"][0]["old"] == "one\n" and diff["files"][0]["new"] == "two\n"
    switched = await (await client.post("/api/git/switch", json={"path": str(repo), "branch": "feature",
                                                                 "create": True})).json()
    assert switched["branch"] == "feature"
    assert "feature" in (await (await client.get("/api/git/branches", params={"path": str(repo)})).json())["branches"]
    assert [c["subject"] for c in await (await client.get("/api/git/log", params={"path": str(repo)})).json()] \
        == ["Add a"]
    assert (await client.post("/api/git/switch", json={"path": str(repo), "branch": "--evil"})).status == 422
    pulled = await client.post("/api/git/sync", json={"path": str(repo), "action": "pull"})
    assert pulled.status == 409  # no upstream: git's own message comes back
    assert (await client.post("/api/git/clone", json={"url": "file:///etc", "into": str(tmp_path)})).status == 422


# --- running on a server ---
async def test_wrong_passwords_are_limited(settings_for, client_for):
    client = await client_for(settings_for(password="secret"))
    from agentwebui_lite import server
    server.LOGIN_TRIES = 2
    try:
        for _ in range(2):
            assert (await client.post("/api/login", json={"password": "no"})).status == 401
        assert (await client.post("/api/login", json={"password": "secret"})).status == 429
    finally:
        server.LOGIN_TRIES = 8


async def test_behind_a_trusted_proxy_the_cookie_is_secure(settings_for, client_for):
    client = await client_for(settings_for(password="secret", trust_proxy=True))
    response = await client.post("/api/login", json={"password": "secret"}, headers={"X-Forwarded-Proto": "https"})
    assert "Secure" in response.headers["Set-Cookie"]


async def test_the_brand_names_the_page_and_the_installable_app(settings_for, client_for):
    client = await client_for(settings_for(brand_name="Hostel AI"))
    assert "<title>Hostel AI</title>" in await (await client.get("/")).text()
    manifest = await (await client.get("/manifest.webmanifest")).json()
    assert manifest["name"] == "Hostel AI"
    assert (await client.get("/brand/logo")).status == 200
    assert (await (await client.get("/api/config")).json())["brand"]["name"] == "Hostel AI"


async def test_the_installable_app_has_the_logo_in_every_size_it_needs(settings_for, client_for):
    client = await client_for(settings_for(password="secret"))
    icons = (await (await client.get("/manifest.webmanifest")).json())["icons"]
    assert {(i["sizes"], i.get("purpose", "any")) for i in icons} >= {("192x192", "any"), ("512x512", "any"), ("512x512", "maskable")}
    for icon in icons:  # open before sign-in, like the sign-in page's own logo
        assert (await client.get(icon["src"])).status == 200
    assert "data-own-logo" not in await (await client.get("/")).text()


async def test_a_brand_logo_replaces_the_logo_of_every_theme(settings_for, client_for, tmp_path):
    logo = tmp_path / "hostel.png"
    logo.write_bytes(b"\x89PNG\r\n\x1a\n")
    client = await client_for(settings_for(brand_logo=str(logo)))
    assert '<html lang="en" class="app" data-own-logo>' in await (await client.get("/")).text()
    assert (await (await client.get("/manifest.webmanifest")).json())["icons"] == [{"src": "/brand/logo", "sizes": "any", "type": "image/png"}]
    assert await (await client.get("/brand/logo")).read() == b"\x89PNG\r\n\x1a\n"


async def test_the_browser_checks_client_files_after_an_update(settings_for, client_for):
    client = await client_for(settings_for())
    response = await client.get("/assets/js/main.js")
    assert response.status == 200 and response.headers["Cache-Control"] == "no-cache"


async def test_the_page_loads_the_client_from_an_address_that_changes_with_it(settings_for, client_for):
    client = await client_for(settings_for())
    page = await (await client.get("/")).text()
    script = re.search(r'<script type="module" src="(/assets/[0-9a-f]{12}/js/main\.js)"', page)
    assert script and (await client.get(script.group(1))).status == 200
    assert '"/assets/css/' not in page


async def test_every_logo_the_client_names_is_served(settings_for, client_for):
    from agentwebui_lite.server import STATIC
    client = await client_for(settings_for())
    names = re.findall(r"'([\w-]+\.(?:svg|png))'", (STATIC / "js" / "logos.js").read_text())
    assert len(names) >= 19
    for name in names:
        assert (await client.get(f"/assets/logos/{name}")).status == 200, name


async def test_a_webhook_hears_when_a_reply_finishes(settings_for, client_for, fake_openai, aiohttp_server):
    from aiohttp import web as aioweb
    heard = []

    async def hook(request):
        heard.append(await request.json())
        return aioweb.Response()

    app = aioweb.Application()
    app.add_routes([aioweb.post("/hook", hook)])
    receiver = await aiohttp_server(app)
    client = await client_for(settings_for(fake_openai=fake_openai, notify_webhook=str(receiver.make_url("/hook"))))
    chat = await (await client.post("/api/chats", json={"target": "model:local/small"})).json()
    await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "Hi"}))
    for _ in range(50):
        if heard:
            break
        await asyncio.sleep(0.02)
    assert heard[0]["event"] == "finished" and heard[0]["title"] == "Hi" and "has a reply" in heard[0]["text"]


def test_an_older_database_gains_versions_and_settings(tmp_path):
    import sqlite3
    from agentwebui_lite.store import Store
    path = tmp_path / "old.db"
    db = sqlite3.connect(path)
    db.executescript("""
        CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, target TEXT NOT
            NULL, cwd TEXT NOT NULL DEFAULT '', session_id TEXT NOT NULL DEFAULT '', created_at REAL NOT NULL,
            updated_at REAL NOT NULL);
        CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, role TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '', parts TEXT NOT NULL DEFAULT '[]', meta TEXT NOT NULL DEFAULT '{}',
            created_at REAL NOT NULL);
        INSERT INTO chats VALUES ('c1', 'Old', 'model', 'p/m', '', '', 1, 1);
        INSERT INTO messages (chat_id, role, content, created_at) VALUES ('c1', 'user', 'a', 1), ('c1', 'assistant',
            'b', 2), ('c1', 'user', 'c', 3);
    """)
    db.commit()
    db.close()
    store = Store(path)
    assert [m["content"] for m in store.messages("c1")] == ["a", "b", "c"]
    assert store.get_chat("c1")["config"] == {} and store.get_chat("c1")["pinned"] is False
    backup = tmp_path / "copy.db"
    store.backup(backup)
    assert Store(backup).get_chat("c1")["title"] == "Old"


def test_the_backup_command_copies_the_database(tmp_path, monkeypatch):
    from agentwebui_lite.__main__ import main
    from agentwebui_lite.store import Store
    monkeypatch.setenv("AWL_ENV_FILE", str(tmp_path / "none.env"))
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    Store(tmp_path / "data" / "chats.db").create_chat("model", "p/m", title="Keep me")
    assert main(["backup", str(tmp_path / "copy.db")]) == 0
    assert Store(tmp_path / "copy.db").list_chats()[0]["title"] == "Keep me"
    assert main(["nonsense"]) == 2


def test_a_file_link_from_an_agent_is_only_ever_a_web_or_local_address():
    from agentwebui_lite.turns import Turn
    turn = Turn("c")
    turn.add_media({"type": "resource_link", "uri": "javascript:alert(1)", "name": "x"})
    turn.add_media({"type": "resource_link", "uri": "https://example.com/a.pdf", "name": "a.pdf"})
    turn.add_media({"type": "resource_link", "uri": "file:///work/b%20c.png", "name": "b c.png"})
    assert [(p["url"], p["path"]) for p in turn.parts] == [("", ""), ("https://example.com/a.pdf", ""), ("", "/work/b c.png")]
