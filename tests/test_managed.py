"""Managed mode: a server that another site frames (EMBED_SECRET, FRAME_ANCESTORS) and that fixes the agent's
model and folder (LOCK_MODEL, LOCK_FOLDER)."""
from __future__ import annotations

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
