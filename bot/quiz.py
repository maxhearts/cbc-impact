"""Optional quiz generation, separate from the conversational turn.

The Lingomaxxing UI can render a practice card alongside any chat
reply. The agent itself doesn't produce that JSON — the prompt budget
on a 1B model is better spent on staying conversational. Instead we
make a second, structured-output call here.

Schema is deliberately narrow (mcq / type / flip only) — small models
fall apart on the full six-kind schema the OpenRouter version uses.
The Vite middleware (`interface/server/chat-api.ts`) sanitizes again
and converts to A2UI components.

Returns None when no quiz is warranted, or when the model produces
something we can't validate.
"""

from __future__ import annotations

import json
import re
from typing import Any

from .llm import LLMClient, Message, OllamaClient, OpenRouterClient

# Heuristic: skip the second LLM call on pure chit-chat. Match against
# BOTH sides — the user's intent and the tutor's reply. If the tutor is
# offering practice ("here's a drill", "let's try this", a lead-in
# ending with a colon), we want to render a card even when the user
# message itself was generic.
_USER_TRIGGERS = re.compile(
    r"\b(quiz|practice|drill|test me|give me .* questions?|exercise|"
    r"flashcard|review|what (does|is) .* mean|how do you say|translate|"
    r"how do i say|conjugate)\b",
    re.IGNORECASE,
)

_AGENT_TRIGGERS = re.compile(
    r"\b(here'?s a (quick )?(drill|quiz|practice|exercise|check)|"
    r"let'?s (practice|try|drill)|try (this|these)|quick (check|drill)|"
    r"practice (the|some)|warm[- ]?up)\b",
    re.IGNORECASE,
)


def _should_quiz(user_text: str, agent_reply: str) -> bool:
    if _USER_TRIGGERS.search(user_text):
        return True
    if _AGENT_TRIGGERS.search(agent_reply):
        return True
    # A short reply that ends with ":" is almost always a lead-in.
    stripped = agent_reply.rstrip()
    if 0 < len(stripped) < 200 and stripped.endswith(":"):
        return True
    return False

_QUIZ_SYSTEM = """You generate ONE small practice card for a language learner.

Input: the learner's message, your tutor's reply, and the language pair.
Output: ONE JSON object, no prose, no fences:

{
  "title": "<short, e.g. 'Quick check'>",
  "items": [<1 to 5 items>]
}

Each item is exactly ONE of these three shapes:

  { "kind": "mcq",  "prompt": "...", "options": [
      {"label":"...","isCorrect":true},
      {"label":"...","isCorrect":false},
      {"label":"...","isCorrect":false},
      {"label":"...","isCorrect":false}
    ], "explanation": "..." }

  { "kind": "type", "prompt": "...", "expected": ["..."],
    "expectedLabel": "<canonical answer>", "explanation": "..." }

  { "kind": "flip", "prompt": "...", "back": "<answer / back of card>" }

Rules:
- mcq: EXACTLY one option with isCorrect=true; 3 or 4 options total.
- type: 1 to 3 acceptable spellings in "expected".
- flip: best for free-form recall (full sentences, descriptions).
- Keep prompts SHORT. One concept per item.
- Tie items to what the tutor and learner just discussed.
- If nothing useful can be drilled from the conversation, return:
    {"title":"","items":[]}
- Never return an item kind other than mcq / type / flip.
"""

_KINDS_OK = {"mcq", "type", "flip"}


def _sanitize_item(raw: Any) -> dict | None:
    if not isinstance(raw, dict):
        return None
    kind = raw.get("kind")
    if kind not in _KINDS_OK:
        return None
    prompt = raw.get("prompt") or raw.get("question") or raw.get("title")
    if not isinstance(prompt, str) or not prompt.strip():
        return None
    item: dict = {"kind": kind, "prompt": prompt.strip()}
    if isinstance(raw.get("category"), str):
        item["category"] = raw["category"]
    if isinstance(raw.get("explanation"), str):
        item["explanation"] = raw["explanation"]

    if kind in ("mcq",):
        opts_raw = raw.get("options")
        if not isinstance(opts_raw, list):
            return None
        opts = []
        for o in opts_raw:
            if not isinstance(o, dict):
                continue
            label = o.get("label")
            if not isinstance(label, str):
                continue
            opts.append({"label": label, "isCorrect": bool(o.get("isCorrect"))})
        if len(opts) < 2:
            return None
        if sum(1 for o in opts if o["isCorrect"]) != 1:
            return None
        item["options"] = opts
        return item

    if kind == "type":
        exp = raw.get("expected")
        if not isinstance(exp, list):
            return None
        exp = [s for s in exp if isinstance(s, str) and s.strip()]
        if not exp:
            return None
        item["expected"] = exp
        if isinstance(raw.get("expectedLabel"), str):
            item["expectedLabel"] = raw["expectedLabel"]
        return item

    if kind == "flip":
        back = raw.get("back")
        if not isinstance(back, str) or not back.strip():
            return None
        item["back"] = back.strip()
        return item

    return None


def _extract_json(text: str) -> dict | None:
    s = text.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.I)
        s = re.sub(r"```\s*$", "", s)
        s = s.strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    a, b = s.find("{"), s.rfind("}")
    if a >= 0 and b > a:
        try:
            return json.loads(s[a : b + 1])
        except json.JSONDecodeError:
            return None
    return None


def maybe_make_quiz(
    client: LLMClient,
    *,
    user_text: str,
    agent_reply: str,
    native: str,
    target: str,
    force: bool = False,
) -> dict | None:
    """Returns {title, items} or None.

    Skips the LLM call entirely unless `force` is set or the user
    message looks like a practice / explanation request.
    """
    if not force and not _should_quiz(user_text, agent_reply):
        return None

    user_msg = (
        f"Language pair — native: {native}, target: {target}.\n"
        f"Learner said: {user_text}\n"
        f"Tutor replied: {agent_reply}\n\n"
        "Produce the JSON quiz card now."
    )

    kwargs: dict = {"max_tokens": 600, "temperature": 0.3}
    if isinstance(client, (OllamaClient, OpenRouterClient)):
        # Both backends honor `format="json"` (Ollama natively, OpenRouter
        # via response_format). Big reliability win on small models, and
        # cheap insurance on Haiku too.
        kwargs["format"] = "json"

    try:
        raw = client.complete(
            [Message("system", _QUIZ_SYSTEM), Message("user", user_msg)],
            **kwargs,
        )
    except Exception:
        return None

    parsed = _extract_json(raw)
    if not isinstance(parsed, dict):
        return None
    items_raw = parsed.get("items")
    if not isinstance(items_raw, list):
        return None
    items = [it for it in (_sanitize_item(x) for x in items_raw) if it]
    if not items:
        return None
    title = parsed.get("title")
    return {
        "title": title if isinstance(title, str) and title.strip() else "Practice",
        "items": items,
    }
