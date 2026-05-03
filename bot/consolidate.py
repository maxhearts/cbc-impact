"""Consolidation: turn a finished session transcript into memory updates.

The Claude-Code agents framework lets the agent itself rewrite its
memory files between resets. Small models can't be trusted to do that
reliably, so we run consolidation as a separate, structured LLM call
with a strict JSON contract. Cheap to run, easy to debug, easy to skip.
"""

from __future__ import annotations

import json
import re

from .llm import LLMClient, Message
from .memory import Memory
from .session import Session


CONSOLIDATION_PROMPT = """\
Read the conversation. Output a single JSON object describing what to remember.

Schema:
{
  "summary": "one short past-tense sentence",
  "detail":  "one short paragraph",
  "patches": [
    {"topic": "<short noun phrase>", "content": "<bullets>"}
  ]
}

Only include a patch when the user revealed durable info worth keeping
across conversations (a name, a preference, a goal, a correction). If
nothing fits, use an empty patches list. Do not emit anything except
the JSON object.
"""

# Anything before the EDIT-ABOVE marker in SEMANTIC_MEMORY.md is template
# guidance for humans, not memory content. Strip it before showing the
# small model.
_SEMANTIC_MARKER = "<!-- DO NOT EDIT ABOVE THIS LINE -->"


def _semantic_content(semantic_md: str) -> str:
    if _SEMANTIC_MARKER in semantic_md:
        return semantic_md.split(_SEMANTIC_MARKER, 1)[1].strip()
    return semantic_md.strip()


def consolidate(client: LLMClient, memory: Memory, session: Session) -> dict:
    """Run consolidation on the given session. Mutates memory files."""
    if not session.turns:
        return {"episodic": None, "semantic_patches": []}

    existing = _semantic_content(memory.semantic) or "(empty)"
    user_block = (
        f"=== existing memory ===\n{existing}\n\n"
        f"=== conversation ===\n{session.transcript()}"
    )
    msgs = [
        Message("system", CONSOLIDATION_PROMPT),
        Message("user", user_block),
    ]

    # Use Ollama's structured-output mode if the client supports it.
    kwargs: dict = {"max_tokens": 512, "temperature": 0.2, "timeout": 600}
    if "format" in client.complete.__code__.co_varnames:
        kwargs["format"] = "json"
    raw = client.complete(msgs, **kwargs)

    obj = _parse_json(raw)
    if not obj:
        return {"episodic": None, "semantic_patches": [], "raw": raw}

    summary = obj.get("summary") or (obj.get("episodic") or {}).get("summary")
    detail = obj.get("detail") or (obj.get("episodic") or {}).get("detail", "")
    if summary:
        memory.append_episodic(summary, detail or "")

    patches = obj.get("patches") or obj.get("semantic_patches") or []
    if isinstance(patches, list) and patches:
        memory.write_semantic(_apply_patches(memory.semantic, patches))

    return obj


def _parse_json(raw: str) -> dict | None:
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{.*\}", raw, flags=re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def _apply_patches(semantic_md: str, patches: list[dict]) -> str:
    out = semantic_md
    for p in patches:
        if not isinstance(p, dict):
            continue
        topic = (p.get("topic") or "").strip()
        content = (p.get("content") or "").strip()
        if not topic or not content:
            continue
        header = f"## {topic}"
        if header in out:
            pattern = re.compile(
                rf"(^{re.escape(header)}\s*\n)(.*?)(?=^## |\Z)",
                flags=re.DOTALL | re.MULTILINE,
            )
            out = pattern.sub(lambda m: m.group(1) + content + "\n\n", out, count=1)
        else:
            if out and not out.endswith("\n"):
                out += "\n"
            out += f"\n{header}\n{content}\n"
    return out
