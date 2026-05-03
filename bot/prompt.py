"""Build the system prompt for one chat turn.

Small models have small context windows. We assemble a lean prompt:
identity (SOUL) + topic-organized knowledge (SEMANTIC) + a list of
past-conversation summaries (EPISODIC summaries — never full details).
"""

from __future__ import annotations

from .memory import Memory


def build_system_prompt(
    agent_name: str,
    memory: Memory,
    *,
    episodic_limit: int = 20,
    include_semantic: bool = True,
    extra: str = "",
) -> str:
    parts: list[str] = []

    soul = memory.soul.strip()
    if soul:
        parts.append(soul)

    parts.append(f"You are {agent_name}. Stay in character. Be concise.")

    if include_semantic:
        sem = memory.semantic.strip()
        if sem:
            parts.append("# Your knowledge (SEMANTIC_MEMORY)\n" + sem)

    summaries = memory.episodic_summaries(limit=episodic_limit)
    if summaries:
        lines = ["# Past conversations (EPISODIC_MEMORY summaries)"]
        for e in summaries:
            ts = e.timestamp or "?"
            lines.append(f"- {ts} — {e.summary}")
        parts.append("\n".join(lines))

    if extra:
        parts.append(extra)

    return "\n\n".join(parts)
