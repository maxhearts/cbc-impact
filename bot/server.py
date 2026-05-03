"""HTTP server wrapping a single Agent for the Lingomaxxing UI.

Stdlib only — same constraint as the rest of the framework.

Endpoints
---------
GET  /health        -> {ok, bot, model, session_id}
POST /chat          -> {text, quiz}
                       body: {text, native?, target?, force_quiz?}
POST /chat/reset    -> {ok, session_id}
                       ends the current session (consolidates if
                       configured), starts a fresh one

Run
---
    bin/bot-server tutor               # default :8765
    bin/bot-server tutor --port 9000

The Vite middleware in interface/server/chat-api.ts proxies to this.
One agent per process; one in-memory session at a time. Restart to
pick up SOUL/SEMANTIC edits.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .agent import Agent
from .llm import make_client
from .quiz import maybe_make_quiz


# --llm shortcuts → (backend, model). Add more presets here as needed.
_LLM_PRESETS = {
    "gemma":  ("ollama",     "gemma3:1b"),
    "gemma3": ("ollama",     "gemma3:1b"),
    "haiku":  ("openrouter", "anthropic/claude-haiku-4.5"),
}


def _wrap_with_header(text: str, native: str, target: str) -> str:
    """Prepend a language-pair header to the user message.

    The tutor's SOUL.md documents this header — it tells the model
    which language to reply in and which to draw examples from. We
    inject per-message rather than via system prompt so we don't have
    to thread an `extra` parameter through Agent.turn.
    """
    header = f"[Native: {native}. Learning: {target}.]"
    return f"{header} {text}"


# Patterns that indicate the model started writing practice questions
# inline. Small models keep doing this no matter how strongly the SOUL
# tells them not to — when we've successfully generated a quiz card,
# truncate the prose at the first such marker so the questions live
# only in the card.
_INLINE_PRACTICE_PATTERNS = [
    re.compile(r"\n\s*\d+\s*[\.\):\-]\s+\S"),                # "1. ..." / "1) ..." / "1: ..."
    re.compile(r"\n\s*\*\*\s*Question\s*\d+\s*\*\*", re.I),  # "**Question 1**"
    re.compile(r"\b(Question|Q)\s*\d+\s*[:.]", re.I),        # "Question 1:" / "Q1:"
    re.compile(r"\n\s*[a-d]\s*[\)\.]\s+\S"),                 # "a) ..." mcq option
    re.compile(r"_{3,}"),                                     # "___" fill-in blank
    re.compile(r"\n\s*[-*]\s+\S.*\?\s*$", re.M),             # "- something?" bullet
]

# Used as a stand-in if stripping leaves nothing usable.
_FALLBACK_LEAD_IN = "Here's a quick drill:"


def _strip_inline_practice(text: str) -> str:
    """Cut everything from the first practice marker onward.

    Only call this when a quiz card was generated — otherwise we'd
    promise practice that isn't there.
    """
    earliest: int | None = None
    for pat in _INLINE_PRACTICE_PATTERNS:
        m = pat.search(text)
        if m and (earliest is None or m.start() < earliest):
            earliest = m.start()
    if earliest is None:
        return text
    head = text[:earliest].rstrip()
    # If trimming leaves nothing meaningful (e.g. the model jumped
    # straight into "1. ..." with no lead-in), drop in a generic one
    # so the user sees something coherent above the card.
    if len(head) < 8:
        return _FALLBACK_LEAD_IN
    # Make sure the lead-in ends with punctuation that signals "card
    # below" rather than a dangling sentence fragment.
    if head[-1] not in ":.!?":
        head = head.rstrip(",;-—") + ":"
    return head


class _Handler(BaseHTTPRequestHandler):
    server_version = "BotServer/0.1"

    # Quiet the default per-request logging.
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[server] " + (fmt % args) + "\n")

    # --- helpers ---
    def _send_json(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        # CORS — useful if the browser talks to us directly during dev.
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "content-type")
        self.send_header("access-control-allow-methods", "POST, GET, OPTIONS")
        self.end_headers()
        self.wfile.write(payload)

    def _read_json(self) -> dict:
        n = int(self.headers.get("content-length") or 0)
        if n <= 0:
            return {}
        raw = self.rfile.read(n).decode("utf-8")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            raise ValueError(f"bad JSON: {e}") from None
        if not isinstance(data, dict):
            raise ValueError("body must be a JSON object")
        return data

    # --- routes ---
    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send_json(204, {})

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            agent = self.server.agent  # type: ignore[attr-defined]
            return self._send_json(
                200,
                {
                    "ok": True,
                    "bot": agent.config.name,
                    "model": agent.config.model,
                    "session_id": agent.session.session_id,
                },
            )
        self._send_json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/chat":
            return self._handle_chat()
        if self.path == "/chat/reset":
            return self._handle_reset()
        self._send_json(404, {"error": "not found"})

    def _handle_chat(self) -> None:
        agent: Agent = self.server.agent  # type: ignore[attr-defined]
        lock: threading.Lock = self.server.agent_lock  # type: ignore[attr-defined]
        try:
            body = self._read_json()
        except ValueError as e:
            return self._send_json(400, {"error": str(e)})

        text = (body.get("text") or "").strip()
        if not text:
            return self._send_json(400, {"error": "missing text"})
        native = (body.get("native") or "English").strip() or "English"
        target = (body.get("target") or "Spanish").strip() or "Spanish"
        force_quiz = bool(body.get("force_quiz"))

        # Serialize calls — Agent owns mutable session state and we don't
        # want two requests interleaving turns.
        with lock:
            try:
                reply = agent.turn(_wrap_with_header(text, native, target))
            except Exception as e:
                return self._send_json(502, {"error": f"agent error: {e}"})

            try:
                quiz = maybe_make_quiz(
                    agent.client,
                    user_text=text,
                    agent_reply=reply,
                    native=native,
                    target=target,
                    force=force_quiz,
                )
            except Exception as e:
                # A quiz failure should never break the conversational reply.
                sys.stderr.write(f"[server] quiz error (non-fatal): {e}\n")
                quiz = None

        # Small models keep inlining the practice questions in prose
        # despite SOUL instructions. When a card was produced, strip
        # the duplicated content so questions live only in the card.
        if quiz is not None:
            reply = _strip_inline_practice(reply)

        self._send_json(200, {"text": reply, "quiz": quiz})

    def _handle_reset(self) -> None:
        agent: Agent = self.server.agent  # type: ignore[attr-defined]
        lock: threading.Lock = self.server.agent_lock  # type: ignore[attr-defined]
        with lock:
            try:
                agent.end()
            except Exception as e:
                sys.stderr.write(f"[server] consolidate error (non-fatal): {e}\n")
            from .session import Session

            agent.session = Session(agent.log_dir)
        self._send_json(200, {"ok": True, "session_id": agent.session.session_id})


def serve(
    bot_name: str,
    *,
    host: str = "127.0.0.1",
    port: int = 8765,
    backend: str | None = None,
    model: str | None = None,
) -> None:
    root = Path(__file__).resolve().parent.parent
    agent_dir = root / "bots" / bot_name
    if not agent_dir.exists():
        sys.exit(f"no such bot: {bot_name} (looked in {agent_dir})")

    agent = Agent(agent_dir)

    # Runtime override of the LLM. The bot's SOUL/SEMANTIC/EPISODIC
    # files are reused — only the underlying model changes.
    if backend or model:
        new_backend = backend or agent.config.backend
        new_model = model or agent.config.model
        kw: dict = {}
        if agent.config.base_url:
            kw["base_url"] = agent.config.base_url
        if agent.config.api_key and new_backend.lower() == "openrouter":
            kw["api_key"] = agent.config.api_key
        try:
            agent.client = make_client(new_backend, new_model, **kw)
        except RuntimeError as e:
            sys.exit(f"[server] {e}")
        agent.config.backend = new_backend
        agent.config.model = new_model

    httpd = ThreadingHTTPServer((host, port), _Handler)
    httpd.agent = agent  # type: ignore[attr-defined]
    httpd.agent_lock = threading.Lock()  # type: ignore[attr-defined]

    sys.stderr.write(
        f"[server] bot={agent.config.name} model={agent.config.model} "
        f"backend={agent.config.backend} session={agent.session.session_id}\n"
        f"[server] listening on http://{host}:{port}\n"
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("\n[server] shutting down\n")
    finally:
        try:
            agent.end()
        except Exception as e:
            sys.stderr.write(f"[server] end error: {e}\n")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="bot-server")
    p.add_argument("bot", help="bot name under bots/")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument(
        "--llm",
        choices=sorted(_LLM_PRESETS),
        help="preset that overrides backend+model: "
        + ", ".join(f"{k}={v[0]}/{v[1]}" for k, v in _LLM_PRESETS.items()),
    )
    p.add_argument(
        "--backend",
        help="override config backend (ollama|openrouter); pairs with --model",
    )
    p.add_argument("--model", help="override config model")
    args = p.parse_args(argv)

    backend, model = None, None
    if args.llm:
        backend, model = _LLM_PRESETS[args.llm]
    if args.backend:
        backend = args.backend
    if args.model:
        model = args.model

    serve(args.bot, host=args.host, port=args.port, backend=backend, model=model)


if __name__ == "__main__":
    main()
