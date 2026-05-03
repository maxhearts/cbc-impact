"""A session is one conversation. Every event is appended to a JSONL
transcript so the framework can replay, audit, or consolidate later.

This is the chatbot analog of the Claude-Code session log: rather than
the harness streaming opaque tool events out of the CLI, we write the
turns ourselves and own the format.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .llm import Message


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class Session:
    log_dir: Path
    session_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    started_at: str = field(default_factory=_utc_now_iso)
    turns: list[Message] = field(default_factory=list)

    @property
    def transcript_path(self) -> Path:
        return self.log_dir / f"session_{self.session_id}.jsonl"

    def __post_init__(self):
        self.log_dir = Path(self.log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        if not self.transcript_path.exists():
            self._write_event(
                {
                    "type": "session_start",
                    "session_id": self.session_id,
                    "timestamp": self.started_at,
                }
            )

    def add_user(self, text: str) -> Message:
        msg = Message("user", text)
        self.turns.append(msg)
        self._write_event(
            {"type": "turn", "role": "user", "content": text, "timestamp": _utc_now_iso()}
        )
        return msg

    def add_assistant(self, text: str) -> Message:
        msg = Message("assistant", text)
        self.turns.append(msg)
        self._write_event(
            {"type": "turn", "role": "assistant", "content": text, "timestamp": _utc_now_iso()}
        )
        return msg

    def end(self) -> None:
        self._write_event(
            {
                "type": "session_end",
                "session_id": self.session_id,
                "timestamp": _utc_now_iso(),
                "turn_count": len(self.turns),
            }
        )

    def recent(self, limit: int) -> list[Message]:
        if limit <= 0:
            return []
        return self.turns[-limit:]

    def transcript(self) -> str:
        return "\n".join(f"{m.role}: {m.content}" for m in self.turns)

    def _write_event(self, obj: dict) -> None:
        with self.transcript_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(obj, ensure_ascii=False) + "\n")

    @classmethod
    def load(cls, log_dir: Path, session_id: str) -> "Session":
        log_dir = Path(log_dir)
        path = log_dir / f"session_{session_id}.jsonl"
        if not path.exists():
            raise FileNotFoundError(path)
        s = cls.__new__(cls)
        s.log_dir = log_dir
        s.session_id = session_id
        s.turns = []
        s.started_at = _utc_now_iso()
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            kind = obj.get("type")
            if kind == "session_start":
                s.started_at = obj.get("timestamp", s.started_at)
            elif kind == "turn":
                role = obj.get("role")
                if role in ("user", "assistant"):
                    s.turns.append(Message(role, obj.get("content", "")))
        return s
