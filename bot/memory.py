"""The three-tier memory model.

- SOUL.md       — identity and disposition. Read-only at runtime.
- SEMANTIC      — durable knowledge organized by topic. Rewritten in place.
- EPISODIC      — append-only log of past sessions. One JSON object per line.

The structure is borrowed from the Claude-Code-based agents harness. The
behavior here is different: a small model doesn't reliably edit these
files itself, so the framework owns the writes (via consolidation passes
between sessions) and the model just reads them as system context.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class EpisodicEntry:
    timestamp: str
    summary: str
    detail: str

    def to_json_line(self) -> str:
        return json.dumps(
            {"timestamp": self.timestamp, "summary": self.summary, "detail": self.detail},
            ensure_ascii=False,
        )


class Memory:
    """Loads and updates the workspace memory files."""

    def __init__(self, workspace: Path):
        self.workspace = Path(workspace)
        self.soul_path = self.workspace / "SOUL.md"
        self.semantic_path = self.workspace / "SEMANTIC_MEMORY.md"
        self.episodic_md_path = self.workspace / "EPISODIC_MEMORY.md"
        self.episodic_log_path = self.workspace / "EPISODIC_MEMORY.jsonl"

    @property
    def soul(self) -> str:
        return self.soul_path.read_text() if self.soul_path.exists() else ""

    @property
    def semantic(self) -> str:
        return self.semantic_path.read_text() if self.semantic_path.exists() else ""

    def write_semantic(self, content: str) -> None:
        if not content.endswith("\n"):
            content += "\n"
        self.semantic_path.write_text(content)

    def episodic_summaries(self, limit: int | None = None) -> list[EpisodicEntry]:
        if not self.episodic_log_path.exists():
            return []
        entries: list[EpisodicEntry] = []
        for line in self.episodic_log_path.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            entries.append(
                EpisodicEntry(
                    timestamp=obj.get("timestamp", ""),
                    summary=obj.get("summary", ""),
                    detail=obj.get("detail", ""),
                )
            )
        if limit is not None:
            entries = entries[-limit:]
        return entries

    def append_episodic(
        self, summary: str, detail: str, timestamp: str | None = None
    ) -> EpisodicEntry:
        entry = EpisodicEntry(
            timestamp=timestamp or _utc_now_iso(),
            summary=summary,
            detail=detail,
        )
        with self.episodic_log_path.open("a", encoding="utf-8") as f:
            f.write(entry.to_json_line() + "\n")
        return entry
