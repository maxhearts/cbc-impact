# impact

Adaptive language tutor that takes advantage of small language models.

## Branches

- `master` — shared root.
- `slm` — small language model experiments.
- `interface` — Duolingo-style chat interface (A2A-rendered question cards), Claude Haiku via OpenRouter as the answering LLM for the local test build.
- `agent` — chatbot agent framework with personality, memory, and session logs (this branch).

## `agent` branch — bot framework

A small chatbot framework: each bot has a personality (SOUL), durable
knowledge (SEMANTIC), a log of past conversations (EPISODIC), and a
per-session transcript. Designed for small models — Llama 3.2 3B, Qwen
2.5 3/7B, Mistral 7B — so it doesn't lean on tool-use or self-modifying
memory.

Backends: OpenRouter (or any OpenAI-compatible host) and Ollama.

### Layout

    bot/                  framework code (Python, stdlib only)
    template/             scaffold copied into each new bot
    bots/                 your bot instances live here
    bin/bot               CLI entry point

### Quickstart

Default backend is local Ollama with `gemma3:1b` — runs on CPU, no API
key, no network.

    ollama pull gemma3:1b
    bin/bot run gemma          # ships pre-scaffolded with default config

Or scaffold a fresh bot and customize:

    bin/bot new ada
    $EDITOR bots/ada/workspace/SOUL.md   # write a personality
    $EDITOR bots/ada/config.toml         # change model / switch to OpenRouter
    bin/bot run ada

To use OpenRouter instead, set `backend = "openrouter"` in `config.toml`
and export `OPENROUTER_API_KEY`.

The REPL streams turns into `bots/ada/logs/session_<id>.jsonl`. On
session end (Ctrl-D), consolidation runs: a structured LLM call rolls
the conversation into one EPISODIC entry and (when warranted) patches
SEMANTIC.

### Commands

    bot new <name>                 scaffold
    bot run <name>                 chat REPL
    bot ls                         list bots
    bot logs <name> [session_id]   dump transcript (latest if omitted)
    bot reset <name> [--full]      archive + reset memory
    bot consolidate <name> <id>    re-run consolidation on a past session

### Memory model

Three files in `bots/<name>/workspace/`:

- `SOUL.md` — identity. You write it; the framework never modifies it.
- `SEMANTIC_MEMORY.md` — durable knowledge organized by topic. Patched
  by consolidation between sessions.
- `EPISODIC_MEMORY.jsonl` — append-only log of past conversations, one
  `{timestamp, summary, detail}` object per line. Surfaced in the
  system prompt as one-line summaries.

Each chat turn the framework builds a system prompt of `SOUL` +
`SEMANTIC` + recent `EPISODIC` summaries, then calls the LLM with that
prompt plus the last `history_window` turns of the current session.

### Configuration

`bots/<name>/config.toml` — backend, model, generation params, history
window, episodic limit, auto-consolidate toggle. See
`template/config.toml` for the full set with comments.

### Inspiration & differences

Built off the `harness` agent framework on the `master` branch sibling
project. Carries over the SOUL/SEMANTIC/EPISODIC tiering and the
session-end consolidation idea. Replaces the Claude-Code-CLI core (and
its plugin/hook surface, tool use, self-editing memory) with a plain
HTTP chat-completions client and an explicit consolidation pass — both
because small open-weight models can't be trusted to drive those
mechanisms reliably.
