"""Which providers are local (#16): where the address goes, what answers there, PROVIDER_<ID>_LOCAL, and why."""
from __future__ import annotations

import asyncio
import ipaddress
import time

import aiohttp
import pytest
from aiohttp import web

from agentwebui_lite import locality
from agentwebui_lite.config import ConfigError, Provider, load
from agentwebui_lite.locality import Locality, classify, least_local

A = ipaddress.ip_address


def routes(table: dict[str, str | None]):
    """A fake `source_for`: the source address this server would use for each target (None: no route)."""
    return lambda address: A(table[str(address)]) if table.get(str(address)) else None


def dns(table: dict[str, list[str]]):
    """A fake resolver; a missing name doesn't resolve."""
    async def resolve(host, port):
        if host not in table:
            raise OSError("no such name")
        return table[host]
    return resolve


@pytest.fixture
async def http():
    async with aiohttp.ClientSession() as session:
        yield session


# --- where an address leads ---------------------------------------------------------------------------------------

@pytest.mark.parametrize("address, source, where", [
    ("127.0.0.1", None, "machine"),                    # loopback
    ("::1", None, "machine"),
    ("10.0.0.9", "10.0.0.9", "machine"),               # one of this server's own addresses
    ("192.168.1.20", "192.168.1.5", "network"),        # private, and this server is on a private network
    ("192.168.1.20", "8.8.4.4", "internet"),           # private, but this server isn't on one
    ("10.0.0.9", None, "internet"),                    # no route at all
    ("100.101.1.2", "100.80.3.4", "network"),          # 100.64/10, and this server is in that range (tailnet)
    ("100.101.1.2", "192.168.1.5", "internet"),        # 100.64/10 this server isn't in: carrier-grade NAT
    ("192.168.1.20", "100.80.3.4", "internet"),        # a tailnet source doesn't make a LAN address yours
    ("fd12::5", "fd12::2", "network"),                 # IPv6 private (fc00::/7)
    ("fe80::1", "fe80::2", "network"),                 # IPv6 link-local
    ("fd12::5", "2001:4860::1", "internet"),
    ("8.8.8.8", "192.168.1.5", "internet"),            # public
])
def test_an_address_is_classed_by_the_route_this_server_has_to_it(address, source, where):
    assert classify(A(address), A(source) if source else None) == where


def test_a_host_is_only_as_local_as_its_least_local_address():
    assert least_local(["machine", "machine"]) == "machine"
    assert least_local(["machine", "network"]) == "network"
    assert least_local(["network", "internet"]) == "internet"


# --- the check, with faked DNS and routes -------------------------------------------------------------------------

async def test_a_name_any_spelling_is_judged_by_where_it_resolves(http):
    names = {"ollama": ["172.18.0.5"], "gpu-box": ["192.168.1.20"], "box.tailnet.ts.net": ["100.101.1.2"],
             "api.openai.com": ["162.159.140.245"]}
    route = routes({"172.18.0.5": "172.18.0.2", "192.168.1.20": "192.168.1.5", "100.101.1.2": "100.80.3.4",
                    "162.159.140.245": "192.168.1.5"})
    place = Locality((), http, resolver=dns(names), source=route)
    found = {name: (await place.check(Provider("p", "P", f"http://{name}:11434/v1"))).endpoint for name in names}
    assert found == {"ollama": "network", "gpu-box": "network", "box.tailnet.ts.net": "network",
                     "api.openai.com": "internet"}


async def test_a_host_with_a_local_and_a_public_address_is_not_local(http):
    place = Locality((), http, resolver=dns({"mixed": ["192.168.1.20", "203.0.114.9"]}),
                     source=routes({"192.168.1.20": "192.168.1.5", "203.0.114.9": "192.168.1.5"}))
    result = await place.check(Provider("p", "P", "http://mixed:8000/v1"))
    assert result.endpoint == "internet" and not result.local
    assert result.why == "Not local: mixed also resolves to 203.0.114.9, on the internet"


async def test_a_name_whose_addresses_are_all_public_says_so_once(http):
    place = Locality((), http, resolver=dns({"api.example.com": ["8.8.8.8", "8.8.4.4"]}),
                     source=routes({"8.8.8.8": "192.168.1.5", "8.8.4.4": "192.168.1.5"}))
    result = await place.check(Provider("p", "P", "https://api.example.com/v1"))
    assert result.why == "Not local: api.example.com (8.8.8.8) is on the internet"


async def test_a_name_that_does_not_resolve_or_times_out_is_not_local(http, monkeypatch):
    place = Locality((), http, resolver=dns({}))
    result = await place.check(Provider("p", "P", "http://nowhere:1/v1"))
    assert (result.endpoint, result.local, result.checking) == (None, False, False)
    assert result.why == "Not local: nowhere: its name did not resolve"

    async def slow(host, port):
        raise TimeoutError
    result = await Locality((), http, resolver=slow).check(Provider("p", "P", "http://slow:1/v1"))
    assert result.why == "Not local: slow: the lookup timed out"


async def test_a_dns_answer_that_changes_is_picked_up_by_the_next_check(http):
    table = {"gpu-box": ["8.8.8.8"]}
    provider = Provider("p", "P", "http://gpu-box:11434/v1")
    place = Locality((provider,), http, resolver=dns(table),
                     source=routes({"8.8.8.8": "192.168.1.5", "192.168.1.20": "192.168.1.5"}))
    await place.check_all()
    assert place.get("p").endpoint == "internet"
    table["gpu-box"] = ["192.168.1.20"]
    await place.check_all()
    assert place.get("p").endpoint == "network"


async def test_a_provider_is_checking_and_not_local_until_its_first_check():
    async with aiohttp.ClientSession() as session:
        place = Locality((Provider("p", "P", "http://127.0.0.1:1/v1"),), session)
        assert (place.get("p").checking, place.get("p").local, place.get("p").why) == (True, False, "Checking…")


# --- what answers there --------------------------------------------------------------------------------------------

def engine_app(kind: str, key: str = "") -> web.Application:
    """A fake server answering like one engine (or a gateway), optionally only with a key."""
    def answer(body):
        async def handler(request):
            if key and request.headers.get("Authorization") != f"Bearer {key}":
                return web.json_response({"error": "unauthorized"}, status=401)
            return web.json_response(body)
        return handler

    app = web.Application()
    if kind == "ollama":
        app.add_routes([
            web.get("/api/version", answer({"version": "0.12.6"})),
            web.get("/api/tags", answer({"models": [
                {"name": "llama3.2:latest", "model": "llama3.2:latest"},
                {"name": "gpt-oss:120b-cloud", "model": "gpt-oss:120b-cloud", "remote_host": "https://ollama.com"}]})),
            web.get("/v1/models", answer({"data": [{"id": "llama3.2:latest", "owned_by": "library"},
                                                                {"id": "gpt-oss:120b-cloud", "owned_by": "library"}]}))])
    elif kind == "lmstudio":
        app.add_routes([
            web.get("/api/v0/models", answer({"object": "list", "data": [
                {"id": "qwen2.5-7b", "object": "model", "type": "llm", "state": "loaded"}]})),
            web.get("/v1/models", answer({"data": [{"id": "qwen2.5-7b", "owned_by": "organization_owner"}]}))])
    elif kind == "vllm":
        app.add_routes([web.get("/v1/models", answer({"data": [{"id": "mistral", "owned_by": "vllm"}]}))])
    elif kind == "llamacpp":
        app.add_routes([
            web.get("/props", answer({"default_generation_settings": {}, "total_slots": 1})),
            web.get("/v1/models", answer({"data": [{"id": "model.gguf", "owned_by": "llamacpp"}]}))])
    elif kind == "gateway":  # a LiteLLM-style proxy on localhost that forwards to the cloud
        app.add_routes([web.get("/v1/models", answer({"data": [{"id": "gpt-4o", "owned_by": "openai"}]}))])
    return app


@pytest.mark.parametrize("kind, engine", [("ollama", "Ollama"), ("lmstudio", "LM Studio"), ("vllm", "vLLM"),
                                          ("llamacpp", "llama.cpp")])
async def test_each_known_local_engine_is_recognised(aiohttp_server, http, kind, engine):
    server = await aiohttp_server(engine_app(kind))
    result = await Locality((), http).check(Provider("p", "P", str(server.make_url("/v1"))))
    assert (result.endpoint, result.engine, result.local) == ("machine", engine, True)
    assert result.why == f"Local: {engine} answered at 127.0.0.1 (this machine)"


async def test_a_gateway_on_localhost_is_not_local(aiohttp_server, http):
    server = await aiohttp_server(engine_app("gateway"))
    result = await Locality((), http).check(Provider("p", "P", str(server.make_url("/v1"))))
    assert result.endpoint == "machine" and not result.local and result.engine == ""
    assert result.why == f"Not local: no known local engine answered at 127.0.0.1:{server.port} (this machine)"


async def test_an_ollama_cloud_model_is_not_local(aiohttp_server, http):
    server = await aiohttp_server(engine_app("ollama"))
    result = await Locality((), http).check(Provider("p", "P", str(server.make_url("/v1"))))
    assert result.model_local("llama3.2:latest") == (True, "Local: Ollama answered at 127.0.0.1 (this machine)")
    local, why = result.model_local("gpt-oss:120b-cloud")
    assert not local and why == "Not local: gpt-oss:120b-cloud is an Ollama cloud model, served from elsewhere"
    assert not result.model_local("deepseek-v3.1:671b-cloud")[0]  # by its name too, when not listed


async def test_an_engine_that_needs_a_key_is_recognised_with_the_providers_key(aiohttp_server, http):
    server = await aiohttp_server(engine_app("vllm", key="sk-local"))
    url = str(server.make_url("/v1"))
    assert not (await Locality((), http).check(Provider("p", "P", url))).local
    assert (await Locality((), http).check(Provider("p", "P", url, key="sk-local"))).engine == "vLLM"


async def test_an_engine_on_the_internet_is_not_even_asked(aiohttp_server, http):
    server = await aiohttp_server(engine_app("ollama"))
    asked = []
    original = locality.identify

    async def spy(*args):
        asked.append(args)
        return await original(*args)
    locality.identify, keep = spy, original
    try:
        place = Locality((), http, resolver=dns({"far": ["8.8.8.8"]}), source=routes({"8.8.8.8": "192.168.1.5"}))
        result = await place.check(Provider("p", "P", f"http://far:{server.port}/v1"))
    finally:
        locality.identify = keep
    assert not result.local and asked == []
    assert result.why == "Not local: far (8.8.8.8) is on the internet"


# --- PROVIDER_<ID>_LOCAL --------------------------------------------------------------------------------------------

async def test_provider_local_overrides_the_check_both_ways(aiohttp_server, http):
    gateway = await aiohttp_server(engine_app("gateway"))
    marked = await Locality((), http).check(Provider("p", "P", str(gateway.make_url("/v1")), local=True))
    assert marked.local and marked.why == "Local: marked local in .env"
    far = await Locality((), http, resolver=dns({})).check(Provider("p", "P", "http://far/v1", local=True))
    assert far.local and far.endpoint is None  # declared local even where the name doesn't resolve here

    ollama = await aiohttp_server(engine_app("ollama"))
    unmarked = await Locality((), http).check(Provider("p", "P", str(ollama.make_url("/v1")), local=False))
    assert not unmarked.local and unmarked.why == "Not local: marked not local in .env"


def test_provider_local_is_read_from_env(tmp_path):
    env = {"PROVIDER_GPU_URL": "http://gpu-box:8000/v1", "PROVIDER_GPU_LOCAL": "true",
           "PROVIDER_PROXY_URL": "http://127.0.0.1:4000/v1", "PROVIDER_PROXY_LOCAL": "no",
           "PROVIDER_PLAIN_URL": "http://127.0.0.1:11434/v1"}
    by_id = {p.id: p.local for p in load(tmp_path / "none.env", env).providers}
    assert by_id == {"gpu": True, "proxy": False, "plain": None}
    with pytest.raises(ConfigError, match="PROVIDER_GPU_LOCAL takes true or false"):
        load(tmp_path / "none.env", {"PROVIDER_GPU_URL": "http://gpu-box/v1", "PROVIDER_GPU_LOCAL": "maybe"})


# --- the API, and never waiting ------------------------------------------------------------------------------------

async def test_config_never_waits_on_a_check(tmp_path, client_for, monkeypatch):
    from .conftest import make_settings
    stuck = asyncio.Event()

    async def hang(host, port):
        await stuck.wait()
        return ["127.0.0.1"]
    monkeypatch.setattr(locality, "resolve", hang)
    settings = make_settings(tmp_path)
    slow = Provider("slow", "Slow", "http://slow.example:1/v1", "", ("m",))
    client = await client_for(settings.__class__(**{**settings.__dict__, "providers": (slow,)}))
    started = time.monotonic()
    body = await (await client.get("/api/config")).json()
    assert time.monotonic() - started < 2
    assert body["providers"][0]["checking"] is True and body["providers"][0]["why"] == "Checking…"
    assert body["models"] == [{"id": "slow/m", "provider": "slow", "provider_name": "Slow", "model": "m",
                               "local": False, "why": "Checking…"}]
    stuck.set()


async def test_config_reports_the_endpoint_engine_and_why_of_each_model(tmp_path, client_for, aiohttp_server):
    from agentwebui_lite.server import PROVIDERS
    from .conftest import make_settings
    ollama = await aiohttp_server(engine_app("ollama"))
    gateway = await aiohttp_server(engine_app("gateway"))
    settings = make_settings(tmp_path)
    providers = (Provider("ollama", "Ollama", str(ollama.make_url("/v1"))),
                 Provider("proxy", "Proxy", str(gateway.make_url("/v1"))))
    client = await client_for(settings.__class__(**{**settings.__dict__, "providers": providers}))
    await client.server.app[PROVIDERS].locality.check_all()
    body = await (await client.get("/api/config")).json()
    summary = {p["id"]: p for p in body["providers"]}
    assert (summary["ollama"]["endpoint"], summary["ollama"]["engine"], summary["ollama"]["local"]) == \
        ("machine", "Ollama", True)
    assert (summary["proxy"]["endpoint"], summary["proxy"]["local"]) == ("machine", False)
    local = {m["id"]: m["local"] for m in body["models"]}
    assert local == {"ollama/gpt-oss:120b-cloud": False, "ollama/llama3.2:latest": True, "proxy/gpt-4o": False}
