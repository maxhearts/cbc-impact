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
You are a memory consolidation engine for a chatbot agent.

You will be given (1) the agent's current SEMANTIC_MEMORY.md, and
(2) the transcript of a finished conversation between the user and the
agent.

Produce ONLY a JSON object with this shape:

{
  "episodic": {
    "summary": "<one short past-tense sentence describing what happened>",
    "detail":  "<one short paragraph, slightly more context>"
  },
  "semantic_patches": [
    {"topic": "<topic name>", "content": "<bullets to put under that topic>"}
  ]
}

Rules:
- Output JSON only. No prose, no code fences, no commentary.
- Episodic summary is one short past-tense sentence. Detail is one short
  paragraph. Skip move-by-move narration.
- Only emit a semantic_patch when there is durable, generalizable
  knowledge worth keeping (a fact about the user, a stated preference,
  a decision, a correction the user made). Skip transient state.
- If a topic already exists in SEMANTIC_MEMORY.md, the patch will
  REPLACE that topic's body — so include any existing bullets you want
  to keep.
- If nothing is worth remembering semantically, return an empty list.
"""


def consolidate(client: LLMClient, memory: Memory, session: Session) -> dict:
    """Run consolidation on the given session. Mutates memory files."""
    if not session.turns:
        return {"episodic": None, "semantic_patches": []}

    user_block = (
        "=== current SEMANTIC_MEMORY.md ===\n"
        f"{memory.semantic}\n\n"
        "=== conversation transcript ===\n"
        f"{session.transcript()}"
    )
    msgs = [
        Message("system", CONSOLIDATION_PROMPT),
        Message("user", user_block),
    ]
    raw = client.complete(msgs, max_tokens=1024, temperature=0.2)
    obj = _parse_json(raw)
    if not obj:
        return {"episodic": None, "semantic_patches": [], "raw": raw}

    ep = obj.get("episodic") or {}
    if isinstance(ep, dict) and ep.get("summary"):
        memory.append_episodic(ep["summary"], ep.get("detail", ""))

    patches = obj.get("semantic_patches") or []
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
