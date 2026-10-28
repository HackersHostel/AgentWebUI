"""Which model providers are local, judged by where their address goes and what answers there (issue #16).

A provider's model is local only with two pieces of evidence: its address leads to this server or to a network this
server is on, and a known local inference engine answers there (Ollama, LM Studio, vLLM, llama.cpp's server). A
gateway on localhost that forwards to the cloud is therefore not local, and an engine nobody recognises isn't either:
a gap in coverage, never a false claim. PROVIDER_<ID>_LOCAL=true|false overrides the result both ways.

Every result carries `why`, the evidence in words, so a wrong answer can be seen and fixed. Checks run in the
background, never while a page waits; until the first one ends a provider is "checking" and not local.
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

import aiohttp

from .config import Provider

log = logging.getLogger("agentwebui")

RECHECK_SECONDS = 300
LOOKUP_SECONDS = 3.0
PROBE_SECONDS = 3.0
CGNAT = ipaddress.ip_network("100.64.0.0/10")  # shared address space: Tailscale, and some ISPs' carrier-grade NAT
RANK = {"machine": 0, "network": 1, "internet": 2}
WHERE = {"machine": "this machine", "network": "your network", "internet": "the internet"}

Address = ipaddress.IPv4Address | ipaddress.IPv6Address
Resolver = Callable[[str, int], Awaitable[list[str]]]
SourceFor = Callable[[Address], "Address | None"]


@dataclass
class Result:
    endpoint: str | None = None  # "machine", "network" or "internet"; None while checking or when unresolved
    engine: str = ""  # the local engine that answered, e.g. "Ollama"
    local: bool = False
    why: str = "Checking…"
    checking: bool = True
    remote_models: frozenset[str] = frozenset()  # models the engine serves from elsewhere (Ollama cloud models)
    checked_at: float = 0.0
    addresses: tuple[str, ...] = field(default_factory=tuple)

    def model_local(self, model: str) -> tuple[bool, str]:
        """Whether one of the provider's models is local, and why."""
        if not self.local:
            return False, self.why
        if self.engine == "Ollama" and (model in self.remote_models or _ollama_cloud_name(model)):
            return False, f"Not local: {model} is an Ollama cloud model, served from elsewhere"
        return True, self.why


def classify(address: Address, source: Address | None) -> str:
    """Where one address leads, given the source address this server would use to reach it (None: no route).

    A private or shared-space address counts as your network only when this server reaches it from an address of
    the same kind, so it is on that network itself; otherwise, or with no route, it is the internet."""
    if address.is_loopback or (source is not None and source == address):
        return "machine"
    if source is None:
        return "internet"
    if _shared(address):
        return "network" if _shared(source) else "internet"
    if address.is_private or address.is_link_local:
        return "network" if (source.is_private or source.is_link_local) and not _shared(source) else "internet"
    return "internet"


def _shared(address: Address) -> bool:
    """In 100.64.0.0/10, judged on its own: some Python versions also call it private."""
    return address.version == 4 and address in CGNAT


def least_local(places: list[str]) -> str:
    """A host is only as local as its least local address."""
    return max(places, key=RANK.__getitem__) if places else "internet"


async def resolve(host: str, port: int) -> list[str]:
    """The addresses `host` resolves to (an IP literal is itself), within LOOKUP_SECONDS."""
    try:
        return [str(ipaddress.ip_address(host))]
    except ValueError:
        pass
    infos = await asyncio.wait_for(asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM),
                                   LOOKUP_SECONDS)
    return sorted({str(info[4][0]).split("%", 1)[0] for info in infos})


def source_for(address: Address) -> Address | None:
    """The source address this server would use to reach `address`; None when there is no route. Connecting a UDP
    socket only asks the kernel for a route: nothing is sent."""
    family = socket.AF_INET6 if address.version == 6 else socket.AF_INET
    try:
        with socket.socket(family, socket.SOCK_DGRAM) as sock:
            sock.connect((str(address), 9))
            return ipaddress.ip_address(sock.getsockname()[0].split("%", 1)[0])
    except OSError:
        return None


def engine_root(url: str) -> str:
    """The engine's own address: the provider URL without its OpenAI-compatible `/v1`."""
    url = url.rstrip("/")
    return url[:-3] if url.endswith("/v1") else url


def _ollama_cloud_name(model: str) -> bool:
    name, _, tag = model.partition(":")
    return tag == "cloud" or tag.endswith("-cloud") or name.endswith("-cloud")


async def _get_json(http: aiohttp.ClientSession, url: str, headers: dict[str, str]) -> Any:
    """GET and parse JSON, or None for any failure (a probe never raises)."""
    try:
        async with http.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=PROBE_SECONDS),
                            allow_redirects=False) as response:
            if response.status != 200:
                return None
            return await response.json(content_type=None)
    except (aiohttp.ClientError, TimeoutError, ValueError, UnicodeDecodeError):
        return None


async def identify(http: aiohttp.ClientSession, provider: Provider) -> tuple[str, frozenset[str]]:
    """The local engine answering at the provider's address ("" when none is recognised), and the models it serves
    from elsewhere. Each engine is recognised by a response only it gives, with the provider's key sent along."""
    root = engine_root(provider.url)
    headers = {"Authorization": f"Bearer {provider.key}"} if provider.key else {}
    version = await _get_json(http, f"{root}/api/version", headers)
    tags = await _get_json(http, f"{root}/api/tags", headers) if isinstance(version, dict) else None
    if isinstance(version, dict) and "version" in version and isinstance(tags, dict) \
            and isinstance(tags.get("models"), list):
        remote = frozenset(str(m.get("name") or m.get("model")) for m in tags["models"]
                           if isinstance(m, dict) and (m.get("remote_host") or m.get("remote_model")))
        return "Ollama", remote
    lmstudio = await _get_json(http, f"{root}/api/v0/models", headers)
    if isinstance(lmstudio, dict) and isinstance(lmstudio.get("data"), list) and lmstudio["data"] \
            and all(isinstance(m, dict) and "state" in m and "type" in m for m in lmstudio["data"]):
        return "LM Studio", frozenset()
    props = await _get_json(http, f"{root}/props", headers)
    if isinstance(props, dict) and "default_generation_settings" in props:
        return "llama.cpp", frozenset()
    models = await _get_json(http, f"{provider.url.rstrip('/')}/models", headers)
    owners = {str(m.get("owned_by")) for m in (models or {}).get("data") or [] if isinstance(m, dict)} \
        if isinstance(models, dict) else set()
    if owners and owners <= {"vllm"}:
        return "vLLM", frozenset()
    if owners and owners <= {"llamacpp"}:
        return "llama.cpp", frozenset()
    return "", frozenset()


class Locality:
    """Each provider's Result, checked in the background and again every RECHECK_SECONDS."""

    def __init__(self, providers: tuple[Provider, ...], http: aiohttp.ClientSession, *,
                 resolver: Resolver | None = None, source: SourceFor | None = None) -> None:
        self.providers = {p.id: p for p in providers}
        self.http = http
        self.resolver = resolver  # None: `resolve` and `source_for`, looked up when used (tests replace them)
        self.source = source
        self.results: dict[str, Result] = {p.id: Result() for p in providers}
        self._task: asyncio.Task | None = None
        self._wake = asyncio.Event()

    def get(self, provider_id: str) -> Result:
        return self.results.get(provider_id) or Result()

    def start(self) -> None:
        if self._task is None and self.providers:
            self._task = asyncio.get_running_loop().create_task(self._run())

    def recheck(self) -> None:
        """Check every provider again now (Settings › Test all, or ?refresh). Each keeps its last result, marked
        checking, until the new one is in."""
        for result in self.results.values():
            result.checking = True
        self._wake.set()

    async def close(self) -> None:
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None

    async def check_all(self) -> None:
        await asyncio.gather(*(self._check(p) for p in self.providers.values()))

    async def _run(self) -> None:
        while True:
            try:
                await self.check_all()
            except Exception:  # one bad provider must not stop the checks
                log.exception("checking where the model providers are failed")
            self._wake.clear()
            try:
                await asyncio.wait_for(self._wake.wait(), RECHECK_SECONDS)
            except TimeoutError:
                pass

    async def _check(self, provider: Provider) -> None:
        self.results[provider.id] = await self.check(provider)

    async def check(self, provider: Provider) -> Result:
        parts = urlsplit(provider.url)
        host = (parts.hostname or "").lower()
        port = parts.port or (443 if parts.scheme == "https" else 80)
        now = time.monotonic()
        try:
            addresses = await (self.resolver or resolve)(host, port) if host else []
        except (OSError, TimeoutError, UnicodeError) as exc:
            reason = "the lookup timed out" if isinstance(exc, TimeoutError) else "its name did not resolve"
            return self._decided(provider, Result(None, why=f"Not local: {host or 'the address'}: {reason}",
                                                  checking=False, checked_at=now))
        if not addresses:
            return self._decided(provider, Result(None, why=f"Not local: {host or 'the address'} did not resolve",
                                                  checking=False, checked_at=now))
        places = []
        for text in addresses:
            address = ipaddress.ip_address(text)
            places.append(classify(address, (self.source or source_for)(address)))
        endpoint = least_local(places)
        shown = ", ".join(addresses[:3])
        result = Result(endpoint, checking=False, checked_at=now, addresses=tuple(addresses))
        if provider.local is not None:
            return self._decided(provider, result)
        if endpoint == "internet":
            far = next(a for a, p in zip(addresses, places) if p == "internet")
            if all(p == "internet" for p in places):
                named = far if far == host else f"{host} ({far})"
                result.why = f"Not local: {named} is on {WHERE['internet']}"
            else:
                result.why = f"Not local: {host} also resolves to {far}, on {WHERE['internet']}"
            return result
        engine, remote = await identify(self.http, provider)
        if not engine:
            result.why = f"Not local: no known local engine answered at {parts.netloc} ({WHERE[endpoint]})"
            return result
        result.engine, result.remote_models, result.local = engine, remote, True
        result.why = f"Local: {engine} answered at {shown} ({WHERE[endpoint]})"
        return result

    @staticmethod
    def _decided(provider: Provider, result: Result) -> Result:
        """Apply PROVIDER_<ID>_LOCAL, which wins over what was found."""
        if provider.local is True:
            result.local, result.engine, result.why = True, "", "Local: marked local in .env"
        elif provider.local is False:
            result.local, result.why = False, "Not local: marked not local in .env"
        return result
