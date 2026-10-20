"""Managed mode: a server that another site frames (EMBED_SECRET, FRAME_ANCESTORS) and that fixes the agent's
model and folder (LOCK_MODEL, LOCK_FOLDER)."""
from __future__ import annotations

import dataclasses

import pytest

from agentwebui_lite import config
from agentwebui_lite.server import embed_link_token

from .conftest import events

SECRET = "s" * 40
DASHBOARD = "https://app.example.com"


def test_embed_settings_are_checked(tmp_path):
    env = tmp_path / ".env"
    env.write_text("EMBED_SECRET=" + SECRET + "\n")
    with pytest.raises(config.ConfigError, match="needs PASSWORD"):
        config.load(env, {})
    env.write_text("PASSWORD=p\nEMBED_SECRET=short\n")
    with pytest.raises(config.ConfigError, match="too short"):
        config.load(env, {})
    env.write_text("PASSWORD=p\nFRAME_ANCESTORS=app.example.com\n")
    with pytest.raises(config.ConfigError, match="full origins"):
        config.load(env, {})
    env.write_text(f"PASSWORD=p\nEMBED_SECRET={SECRET}\nFRAME_ANCESTORS={DASHBOARD} https://b.example\n"
                   "LOCK_MODEL=true\nLOCK_FOLDER=1\n")
    settings = config.load(env, {})
    assert settings.frame_ancestors == (DASHBOARD, "https://b.example")
    assert settings.lock_model and settings.lock_folder


async def test_only_this_server_may_frame_the_page_unless_told(settings_for, client_for):
    plain = await client_for(settings_for())
    assert (await plain.get("/")).headers["Content-Security-Policy"] == "frame-ancestors 'self'"
    framed = await client_for(settings_for(frame_ancestors=(DASHBOARD,)))
    assert (await framed.get("/")).headers["Content-Security-Policy"] == f"frame-ancestors 'self' {DASHBOARD}"


async def test_an_embed_link_signs_in_once(settings_for, client_for):
    client = await client_for(settings_for(password="secret", embed_secret=SECRET, frame_ancestors=(DASHBOARD,)))
    token = embed_link_token(SECRET)
    first = await client.get(f"/embed?token={token}", allow_redirects=False)
    assert first.status == 302 and first.headers["Location"] == "/"
    cookie = first.cookies["awl_session"]
    assert cookie["samesite"] == "None" and cookie["secure"]
    # Secure cookies don't travel over the test's plain HTTP, so hand it back the way a browser on HTTPS would.
    assert (await client.get("/api/chats", headers={"Cookie": f"awl_session={cookie.value}"})).status == 200
    assert (await client.get(f"/embed?token={token}", allow_redirects=False)).status == 401  # used up


async def test_bad_and_old_embed_links_are_refused(settings_for, client_for):
    client = await client_for(settings_for(password="secret", embed_secret=SECRET))
    assert (await client.get(f"/embed?token={embed_link_token('x' * 40)}")).status == 401  # another secret
    assert (await client.get(f"/embed?token={embed_link_token(SECRET, now=1)}")).status == 401  # expired
    token = embed_link_token(SECRET)
    assert (await client.get(f"/embed?token={token[:-2]}00")).status == 401
    assert (await client.get("/embed?token=nonsense")).status == 401
    assert (await client.get("/api/chats")).status == 401
    off = await client_for(settings_for(password="secret"))
    assert (await off.get(f"/embed?token={token}")).status == 404


async def test_config_reports_the_locks(settings_for, client_for):
    client = await client_for(settings_for(lock_model=True, lock_folder=True))
    got = await (await client.get("/api/config")).json()
    assert got["lock_model"] is True and got["lock_folder"] is True


async def test_a_locked_folder_ignores_the_folder_asked_for(settings_for, client_for, tmp_path):
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    client = await client_for(settings_for(lock_folder=True))
    chat = await (await client.post("/api/chats", json={"target": "agent:fake", "cwd": str(elsewhere)})).json()
    assert chat["cwd"] == str(tmp_path.resolve())


async def test_a_locked_model_cannot_be_chosen_or_changed(settings_for, client_for, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_MODE", "echo")
    monkeypatch.setenv("FAKE_CONFIG", "options")
    client = await client_for(settings_for(lock_model=True))
    chat = await (await client.post("/api/chats", json={"target": "agent:fake",
                                                        "config": {"model": "sonnet", "fast": True}})).json()
    assert chat["config"] == {"fast": True}
    got = await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "hi"}))
    assert "".join(e["text"] for e in got if e["type"] == "delta") == "You said: hi [opus]"
    refused = await client.post(f"/api/chats/{chat['id']}/config", json={"id": "model", "value": "sonnet"})
    assert refused.status == 403
    assert (await client.post(f"/api/chats/{chat['id']}/config", json={"id": "effort", "value": "low"})).status == 200


# --- A managed box: AGENT_IDLE_MINUTES, LOGIN_EMAIL, AGENT_<ID>_MODELS ---

def test_agent_idle_minutes_is_a_setting_not_an_agent(tmp_path):
    env = tmp_path / ".env"
    env.write_text("AGENT_IDLE_MINUTES=30\nAGENT_HERMES_COMMAND=hermes acp\n")
    settings = config.load(env, {})
    assert settings.agent_idle_minutes == 30
    assert [a.id for a in settings.agents] == ["hermes"]


def test_login_email_and_the_model_list_are_read(tmp_path):
    env = tmp_path / ".env"
    env.write_text("LOGIN_EMAIL=Admin@Example.com\nAGENT_HERMES_COMMAND=hermes acp\n"
                   "AGENT_HERMES_MODELS=a/one, b/two ,\n")
    with pytest.raises(config.ConfigError, match="needs PASSWORD"):
        config.load(env, {})
    settings = config.load(env, {"PASSWORD": "p"})
    assert settings.login_email == "admin@example.com"
    assert settings.agents[0].models == ("a/one", "b/two")


async def test_login_email_is_asked_for_with_the_password(settings_for, client_for):
    client = await client_for(settings_for(password="secret", login_email="admin@example.com"))
    assert (await (await client.get("/api/session")).json())["email_required"] is True
    assert (await client.post("/api/login", json={"password": "secret"})).status == 401
    wrong = await client.post("/api/login", json={"email": "someone@example.com", "password": "secret"})
    assert wrong.status == 401 and (await wrong.json())["error"] == "wrong email or password"
    assert (await client.post("/api/login", json={"email": "admin@example.com", "password": "no"})).status == 401
    assert (await client.post("/api/login", json={"email": " Admin@Example.com", "password": "secret"})).status == 200
    assert (await client.get("/api/chats")).status == 200


def _managed(settings, models):
    agent = settings.agents[0]
    return dataclasses.replace(settings, agents=(dataclasses.replace(agent, models=models),))


def _model_choices(options):
    model = next(o for o in options if o["id"] == "model")
    return [(c["value"], c["name"]) for c in model["options"]]


@pytest.mark.parametrize("shape", ["options", "legacy"])
async def test_only_the_listed_models_are_offered(settings_for, client_for, monkeypatch, shape):
    monkeypatch.setenv("FAKE_MODE", "echo")
    monkeypatch.setenv("FAKE_CONFIG", shape)
    client = await client_for(_managed(settings_for(), ("sonnet", "z-ai/glm-5.1")))
    options = (await (await client.get("/api/agents/fake/options")).json())["options"]
    # The agent's own name stays; a model it doesn't list is offered by its id.
    assert _model_choices(options) == [("sonnet", "Sonnet"), ("z-ai/glm-5.1", "z-ai/glm-5.1")]
    chat = await (await client.post("/api/chats", json={"target": "agent:fake"})).json()
    await events(await client.post(f"/api/chats/{chat['id']}/messages", json={"text": "hi"}))
    refused = await client.post(f"/api/chats/{chat['id']}/config", json={"id": "model", "value": "opus"})
    assert refused.status == 422
    assert (await client.post(f"/api/chats/{chat['id']}/config", json={"id": "model", "value": "sonnet"})).status == 200


async def test_options_cached_before_the_list_changed_are_trimmed(settings_for, client_for, monkeypatch):
    monkeypatch.setenv("FAKE_CONFIG", "options")
    plain = settings_for()
    first = await client_for(plain)
    assert len(_model_choices((await (await first.get("/api/agents/fake/options")).json())["options"])) == 2
    client = await client_for(_managed(plain, ("sonnet",)))
    cached = (await (await client.get("/api/config")).json())["agents"][0]["options"]
    assert _model_choices(cached) == [("sonnet", "Sonnet")]
