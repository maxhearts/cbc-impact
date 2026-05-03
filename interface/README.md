# Lingomaxxing

Duolingo-style chat shell for the impact tutor. Built on the A2A / A2UI
Lit renderer (copied from cbc_prep). Pick any two languages (one you
speak, one you're learning) in the header and chat with Claude Haiku
(via OpenRouter) — it answers, and decides per turn whether to attach a
practice quiz, how many items, and which kinds (mcq / type / multi /
flip), all rendered through the A2UI `Quiz` Lit element.

## Layout

```
A2UI/                       (sibling) — Lit + web_core renderer packages
interface/
├── index.html              shell + language pair selector + theme
├── src/
│   ├── main.ts             entry; registers components, boots chat
│   ├── chat.ts             POST /chat → render reply + Quiz card
│   ├── languages.ts        list of selectable languages
│   ├── quiz.ts             <a2ui-quiz> Lit element (mcq / type / multi / flip)
│   ├── theme.ts            A2UI theme tokens
│   └── theme-provider.ts   wraps a2ui-surface, registers Quiz
└── server/
    └── chat-api.ts         Vite middleware: /chat → Haiku → {text, a2ui}
```

## Run

```bash
cd interface
npm install      # first time only
npm run dev      # http://localhost:5180
```

`OPENROUTER_API_KEY` must be set — the dev server reads `.env.local`.

## How a turn works

1. Browser POSTs `{ text, native, target }` to `/chat`.
2. The Vite middleware builds a system prompt parameterized by the
   language pair and calls `anthropic/claude-haiku-4.5` via OpenRouter.
3. Haiku returns `{ answer, quiz: null | { title, items: [...] } }`.
   It chooses per turn whether to attach a quiz, the count, and the
   kinds — `mcq`, `type` (fill-in-the-blank), `multi`, or `flip`
   (self-graded flashcard).
4. The server sanitizes the items and wraps them in an A2UI Quiz
   payload, returning `{ text, a2ui }`.
5. The browser renders the answer text and mounts the Quiz card.

The A2UI `Quiz` Lit element (`src/quiz.ts`) handles all per-item
interaction (selection, submit, feedback) locally.

## Language pair

The header has two `<select>`s: **Speak** (your native language) and
**Learn** (the one you're studying). The choice persists in
`localStorage` and is sent with each chat request so the LLM knows
which side to translate from / drill toward. Use the `⇄` button to
swap them.
