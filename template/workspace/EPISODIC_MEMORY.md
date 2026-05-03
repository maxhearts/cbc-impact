# EPISODIC_MEMORY.md — What Happened

Past conversations are stored in `EPISODIC_MEMORY.jsonl`, one JSON
object per line:

  { "timestamp": "...", "summary": "...", "detail": "..." }

- `summary`: one short past-tense sentence. Scannable.
- `detail`:  one short paragraph. Slightly more context.
- `timestamp`: `YYYY-MM-DDTHH:MM:SSZ`, UTC.

Append-only. The framework writes one entry per consolidated session;
you read past summaries from your system prompt.

---

_Don't modify this file. Read only._
