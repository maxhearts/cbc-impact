"""The agent loop.

One Agent owns: a workspace (the three memory files), a current Session
(transcript log), and an LLMClient. Each turn:

  1. Append the user message to the session.
  2. Build a system prompt from SOUL + SEMANTIC + EPISODIC summaries.
  3. Call the LLM with [system, ...recent_history].
  4. Append the reply to the session.

At session end, optionally run consolidation to roll the conversation
into EPISODIC and patch SEMANTIC.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path

from .llm import LLMClient, Message, make_client
from .memory import Memory
from .prompt import build_system_prompt
from .session import Session


@dataclass
class AgentConfig:
    name: str
    backend: str = "openrouter"
    model: str = "meta-llama/llama-3.2-3b-instruct"
    base_url: str | None = None
    api_key: str | None = None
    max_tokens: int = 512
    temperature: float = 0.7
    history_window: int = 12
    episodic_limit: int = 20
    auto_consolidate: bool = True
    extra_system: str = ""

    @classmethod
    def from_toml(cls, path: Path, default_name: str) -> "AgentConfig":
        with open(path, "rb") as f:
            data = tomllib.load(f)
        section = dict(data.get("agent", {}))
        section.setdefault("name", default_name)
        valid = {f for f in cls.__dataclass_fields__}
        unknown = set(section) - valid
        if unknown:
            raise ValueError(f"unknown config keys in {path}: {sorted(unknown)}")
        return cls(**section)


class Agent:
    def __init__(self, agent_dir: Path, *, client: LLMClient | None = None):
        self.agent_dir = Path(agent_dir)
        if not self.agent_dir.exists():
            raise FileNotFoundError(self.agent_dir)

        self.config = AgentConfig.from_toml(
            self.agent_dir / "config.toml", default_name=self.agent_dir.name
        )

        self.workspace = self.agent_dir / "workspace"
        self.log_dir = self.agent_dir / "logs"
        self.workspace.mkdir(exist_ok=True)
        self.log_dir.mkdir(exist_ok=True)

        self.memory = Memory(self.workspace)
        self.session = Session(self.log_dir)

        if client is None:
            kw: dict = {}
            if self.config.base_url:
                kw["base_url"] = self.config.base_url
            if self.config.api_key and self.config.backend.lower() == "openrouter":
                kw["api_key"] = self.config.api_key
            client = make_client(self.config.backend, self.config.model, **kw)
        self.client = client

    def turn(self, user_text: str, *, extra: str = "") -> str:
        self.session.add_user(user_text)
        merged_extra = "\n\n".join(p for p in (self.config.extra_system, extra) if p)
        system = build_system_prompt(
            self.config.name,
            self.memory,
            episodic_limit=self.config.episodic_limit,
            extra=merged_extra,
        )
        history = self.session.recent(self.config.history_window)
        messages = [Message("system", system), *history]
        reply = self.client.complete(
            messages,
            max_tokens=self.config.max_tokens,
            temperature=self.config.temperature,
        )
        self.session.add_assistant(reply)
        return reply

    def end(self, *, consolidate: bool | None = None) -> dict | None:
        self.session.end()
        do_consolidate = self.config.auto_consolidate if consolidate is None else consolidate
        if not do_consolidate or not self.session.turns:
            return None
        from .consolidate import consolidate as run_consolidate
        return run_consolidate(self.client, self.memory, self.session)
