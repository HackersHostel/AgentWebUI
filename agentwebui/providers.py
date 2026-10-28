"""Any OpenAI-compatible chat completions API: OpenAI, OpenRouter, Ollama, LM Studio, vLLM, Groq, and others."""
from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import urlsplit

import aiohttp

from .config import Provider
from .locality import Locality

log = logging.getLogger("agentwebui")
MODELS_TTL = 300


class ProviderError(Exception):
    pass


class Providers:
    def __init__(self, providers: tuple[Provider, ...], http: aiohttp.ClientSession) -> None:
        self.providers = {p.id: p for p in providers}
        self.http = http
        self.locality = Locality(providers, http)
        self._models: dict[str, tuple[float, list[str], str]] = {}

    def forget(self) -> None:
        """Ask every provider for its models again on the next look, and check again where each one is."""
        self._models.clear()
        self.locality.recheck()

    def _headers(self, provider: Provider) -> dict[str, str]:
        return {"Authorization": f"Bearer {provider.key}"} if provider.key else {}

    async def models(self) -> list[dict[str, Any]]:
        """Every model of every provider, as `{id: "<provider>/<model>", ...}`."""
        out = []
        for provider in self.providers.values():
            names, _ = await self._models_of(provider)
            place = self.locality.get(provider.id)
            for name in names:
                local, why = place.model_local(name)
                out.append({"id": f"{provider.id}/{name}", "provider": provider.id,
                            "provider_name": provider.name, "model": name, "local": local, "why": why})
        return out

    async def summary(self) -> list[dict[str, Any]]:
        """Each provider as the settings page shows it: where it is, how many models, and why it failed."""
        out = []
        for provider in self.providers.values():
            names, error = await self._fetch(provider)
            if provider.models:
                names = list(provider.models)
            place = self.locality.get(provider.id)
            out.append({"id": provider.id, "name": provider.name, "host": urlsplit(provider.url).netloc,
                        "url": provider.url, "local": place.local, "endpoint": place.endpoint,
                        "engine": place.engine, "why": place.why, "checking": place.checking,
                        "has_key": bool(provider.key), "listed": bool(provider.models), "models": len(names),
                        "error": error})
        return out

    async def _models_of(self, provider: Provider) -> tuple[list[str], str]:
        if provider.models:
            return list(provider.models), ""
        return await self._fetch(provider)

    async def _fetch(self, provider: Provider) -> tuple[list[str], str]:
        """The provider's own model list, cached for a few minutes. Also tells whether it answers at all."""
        cached = self._models.get(provider.id)
        if cached and time.monotonic() - cached[0] < MODELS_TTL:
            return cached[1], cached[2]
        names, error = [], ""
        try:
            async with self.http.get(f"{provider.url}/models", headers=self._headers(provider),
                                     timeout=aiohttp.ClientTimeout(total=10)) as response:
                if response.status != 200:
                    error = f"{provider.name} answered {response.status} for its model list"
                else:
                    body = await response.json(content_type=None)
                    names = sorted(str(item["id"]) for item in body.get("data") or [] if item.get("id"))
        except (aiohttp.ClientError, TimeoutError, ValueError) as exc:
            error = f"{provider.name} could not be reached ({type(exc).__name__})"
        if error:
            log.warning(error)
        self._models[provider.id] = (time.monotonic(), names, error)
        return names, error

    async def stream(self, target: str, history: list[dict[str, Any]],
                     params: dict[str, Any] | None = None) -> AsyncIterator[tuple[str, Any]]:
        """Yield ("delta", text), ("thought", text), ("finish", reason) and finally ("usage", dict) for one reply."""
        provider_id, _, model = target.partition("/")
        provider = self.providers.get(provider_id)
        if provider is None or not model:
            raise ProviderError(f"unknown model {target!r}")
        body = {"model": model, "messages": history, "stream": True, "stream_options": {"include_usage": True},
                **(params or {})}
        timeout = aiohttp.ClientTimeout(total=None, sock_connect=15, sock_read=300)
        try:
            async with self.http.post(f"{provider.url}/chat/completions", json=body,
                                      headers=self._headers(provider), timeout=timeout) as response:
                if response.status != 200:
                    raise ProviderError(f"{provider.name}: {response.status} {_error_text(await response.text())}")
                async for line in response.content:
                    line = line.strip()
                    if not line.startswith(b"data:"):
                        continue
                    data = line[5:].strip()
                    if data == b"[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except ValueError:
                        continue
                    if chunk.get("error"):
                        raise ProviderError(f"{provider.name}: {_error_text(json.dumps(chunk))}")
                    for choice in chunk.get("choices") or []:
                        delta = choice.get("delta") or {}
                        thought = delta.get("reasoning_content") or delta.get("reasoning")
                        if isinstance(thought, str) and thought:
                            yield "thought", thought
                        if isinstance(delta.get("content"), str) and delta["content"]:
                            yield "delta", delta["content"]
                        if choice.get("finish_reason"):
                            yield "finish", str(choice["finish_reason"])
                    if isinstance(chunk.get("usage"), dict):
                        yield "usage", chunk["usage"]
        except (aiohttp.ClientError, TimeoutError) as exc:
            raise ProviderError(f"{provider.name} could not be reached ({type(exc).__name__})") from None


def _error_text(text: str) -> str:
    try:
        body = json.loads(text)
        error = body.get("error", body)
        if isinstance(error, dict):
            return str(error.get("message") or error)[:300]
        return str(error)[:300]
    except ValueError:
        return text[:300]
