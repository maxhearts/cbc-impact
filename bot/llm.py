"""LLM client abstraction.

The framework targets small language models. We deliberately keep the
client surface narrow — chat-style completion only, no tool use, no
streaming — because small open-weight models don't reliably do tool
calls and our agent loop doesn't need them.

Two backends ship: OpenRouter (or any OpenAI-compatible /chat/completions
host) and Ollama. Adding a new backend is a one-class job.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass


@dataclass
class Message:
    role: str  # "system" | "user" | "assistant"
    content: str

    def to_dict(self) -> dict:
        return {"role": self.role, "content": self.content}


class LLMClient:
    """Minimal chat-completion interface."""

    default_timeout: float = 120.0

    def complete(
        self,
        messages: list[Message],
        *,
        max_tokens: int = 512,
        temperature: float = 0.7,
        timeout: float | None = None,
    ) -> str:
        raise NotImplementedError


class OpenRouterClient(LLMClient):
    """Works with OpenRouter and any OpenAI-compatible /chat/completions host."""

    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        base_url: str = "https://openrouter.ai/api/v1",
    ):
        self.model = model
        self.api_key = api_key or os.environ.get("OPENROUTER_API_KEY", "")
        self.base_url = base_url.rstrip("/")
        if not self.api_key:
            raise RuntimeError(
                "OPENROUTER_API_KEY not set. Export it or pass api_key=..."
            )

    def complete(self, messages, *, max_tokens=512, temperature=0.7, timeout=None):
        body = json.dumps(
            {
                "model": self.model,
                "messages": [m.to_dict() for m in messages],
                "max_tokens": max_tokens,
                "temperature": temperature,
            }
        ).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.default_timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"openrouter HTTP {e.code}: {detail}") from None
        return data["choices"][0]["message"]["content"]


class OllamaClient(LLMClient):
    """Local Ollama server. `ollama serve` defaults to :11434."""

    def __init__(self, model: str, base_url: str = "http://localhost:11434"):
        self.model = model
        self.base_url = base_url.rstrip("/")

    # Default longer than OpenRouter — local models are slow on cold load and
    # consolidation calls in particular can churn for a while on tiny CPUs.
    default_timeout = 600.0

    def complete(self, messages, *, max_tokens=512, temperature=0.7, timeout=None, format=None):
        payload: dict = {
            "model": self.model,
            "messages": [m.to_dict() for m in messages],
            "stream": False,
            "options": {"num_predict": max_tokens, "temperature": temperature},
        }
        # Ollama supports a structured-output mode: format="json" forces the
        # model to emit valid JSON. Useful for the consolidation pass on
        # small models that otherwise drift into prose.
        if format is not None:
            payload["format"] = format
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/api/chat",
            data=body,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.default_timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"ollama HTTP {e.code}: {detail}") from None
        return data["message"]["content"]


def make_client(backend: str, model: str, **kwargs) -> LLMClient:
    backend = backend.lower()
    if backend == "openrouter":
        return OpenRouterClient(model, **kwargs)
    if backend == "ollama":
        return OllamaClient(model, **kwargs)
    raise ValueError(f"unknown backend: {backend!r}")
