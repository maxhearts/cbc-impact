/**
 * Vite middleware: a single POST /chat endpoint that proxies to the
 * local bot server (bin/bot-server tutor) and returns
 *   { text, a2ui }
 *
 * The bot server (Python, bot/server.py) wraps an Agent with
 * SOUL/SEMANTIC/EPISODIC memory, calls Gemma via Ollama for the
 * conversational reply, and runs a separate structured-output call to
 * decide whether to attach a practice quiz. This middleware just
 * forwards the request, sanitizes the quiz items defensively, and
 * converts the quiz to A2UI components for the Lit renderer.
 *
 * BOT_SERVER_URL (default http://127.0.0.1:8765) configures the
 * upstream. Start the upstream with:
 *
 *   bin/bot-server tutor
 */

import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

const DEFAULT_BOT_SERVER = "http://127.0.0.1:8765";

type Kind = "mcq" | "type" | "multi" | "flip" | "cloze" | "order";

interface ClozeBlank {
  expected: string[];
  expectedLabel?: string;
}

interface QuizItem {
  kind: Kind;
  prompt: string;
  category?: string;
  explanation?: string;
  options?: { label: string; isCorrect: boolean }[];
  expected?: string[];
  expectedLabel?: string;
  back?: string;
  blanks?: ClozeBlank[];
  tokens?: string[];
  answer?: string[];
}

interface QuizPayload {
  title?: string;
  items: QuizItem[];
}

interface BotReply {
  text: string;
  quiz: QuizPayload | null;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const VALID_KINDS = new Set<Kind>([
  "mcq",
  "type",
  "multi",
  "flip",
  "cloze",
  "order",
]);

// Defense-in-depth — the Python server already validates, but we don't
// want a bad payload to crash the Lit renderer.
function sanitizeItem(raw: unknown): QuizItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind as Kind;
  if (!VALID_KINDS.has(kind)) return null;
  const prompt = typeof r.prompt === "string" ? r.prompt : null;
  if (!prompt) return null;

  const item: QuizItem = { kind, prompt };
  if (typeof r.category === "string") item.category = r.category;
  if (typeof r.explanation === "string") item.explanation = r.explanation;

  switch (kind) {
    case "mcq":
    case "multi": {
      const opts = Array.isArray(r.options) ? r.options : [];
      item.options = opts
        .map((o) => {
          if (!o || typeof o !== "object") return null;
          const oo = o as Record<string, unknown>;
          const label = typeof oo.label === "string" ? oo.label : null;
          if (!label) return null;
          return { label, isCorrect: !!oo.isCorrect };
        })
        .filter((x): x is { label: string; isCorrect: boolean } => !!x);
      if (item.options.length < 2) return null;
      if (kind === "mcq" && item.options.filter((o) => o.isCorrect).length !== 1) {
        return null;
      }
      break;
    }
    case "type": {
      const exp = Array.isArray(r.expected) ? r.expected : [];
      item.expected = exp.filter((x): x is string => typeof x === "string");
      if (item.expected.length === 0) return null;
      if (typeof r.expectedLabel === "string") item.expectedLabel = r.expectedLabel;
      break;
    }
    case "flip": {
      if (typeof r.back !== "string") return null;
      item.back = r.back;
      break;
    }
    case "cloze":
    case "order":
      // Reserved for future use; the Python server limits to mcq/type/flip.
      return null;
  }
  return item;
}

function sanitizeQuiz(raw: unknown): QuizPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  const items = Array.isArray(q.items) ? q.items : [];
  const cleaned = items.map(sanitizeItem).filter((x): x is QuizItem => !!x);
  if (cleaned.length === 0) return null;
  return {
    title: typeof q.title === "string" ? q.title : undefined,
    items: cleaned,
  };
}

function quizToA2ui(quiz: QuizPayload, surfaceId: string): unknown[] {
  const items = quiz.items.map((it) => {
    const out: Record<string, unknown> = {
      kind: it.kind,
      prompt: it.prompt,
    };
    if (it.category) out.category = it.category;
    if (it.explanation) out.explanation = it.explanation;
    if (it.kind === "mcq" || it.kind === "multi") {
      out.options = (it.options ?? []).map((o) => ({
        label: o.label,
        isCorrect: o.isCorrect,
      }));
    } else if (it.kind === "type") {
      out.expected = it.expected ?? [];
      if (it.expectedLabel) out.expectedLabel = it.expectedLabel;
    } else if (it.kind === "flip") {
      out.back = it.back ?? "";
    }
    return out;
  });

  return [
    { beginRendering: { surfaceId, root: "root" } },
    {
      surfaceUpdate: {
        surfaceId,
        components: [
          {
            id: "root",
            component: {
              Column: {
                children: { explicitList: ["q"] },
                distribution: "start",
                alignment: "stretch",
              },
            },
          },
          {
            id: "q",
            component: {
              Quiz: {
                quizId: { literalString: surfaceId },
                quizTitle: { literalString: quiz.title ?? "Practice" },
                items,
              },
            },
          },
        ],
      },
    },
  ];
}

async function callBotServer(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<unknown> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`bot-server ${res.status}: ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`bot-server returned non-JSON: ${text.slice(0, 200)}`);
  }
}

export function chatApiPlugin(): Plugin {
  const baseUrl = (process.env.BOT_SERVER_URL || DEFAULT_BOT_SERVER).replace(
    /\/+$/,
    "",
  );
  let surfaceCounter = 0;

  return {
    name: "impact-interface:chat-api",
    configureServer(server: ViteDevServer) {
      // NOTE: more-specific routes MUST come first — Vite's middleware
      // does prefix matching, so `/chat` would otherwise swallow
      // `/chat/info` and `/chat/reset`.

      // Surface the upstream model + bot name so the frontend can show
      // which backend is active. Just a thin proxy of /health.
      server.middlewares.use("/chat/info", async (req, res) => {
        if (req.method !== "GET") return send(res, 405, { error: "GET required" });
        try {
          const r = await fetch(`${baseUrl}/health`);
          const text = await r.text();
          if (!r.ok) {
            return send(res, 502, {
              error: `bot-server ${r.status}: ${text.slice(0, 200)}`,
            });
          }
          let data: { model?: string; bot?: string; backend?: string };
          try {
            data = JSON.parse(text);
          } catch {
            return send(res, 502, { error: "bot-server returned non-JSON for /health" });
          }
          send(res, 200, {
            model: data.model ?? "",
            bot: data.bot ?? "",
            backend: data.backend ?? "",
          });
        } catch (err: any) {
          send(res, 502, { error: err.message ?? String(err) });
        }
      });

      server.middlewares.use("/chat/reset", async (req, res) => {
        if (req.method !== "POST") return send(res, 405, { error: "POST required" });
        try {
          await callBotServer(baseUrl, "/chat/reset", {});
          send(res, 200, { ok: true });
        } catch (err: any) {
          console.error("[chat-api] reset error:", err);
          send(res, 502, { error: err.message ?? String(err) });
        }
      });

      server.middlewares.use("/chat", async (req, res) => {
        if (req.method !== "POST") return send(res, 405, { error: "POST required" });

        let body: { text?: string; native?: string; target?: string };
        try {
          const raw = await readBody(req);
          body = raw ? JSON.parse(raw) : {};
        } catch (err: any) {
          return send(res, 400, { error: `bad JSON: ${err.message ?? err}` });
        }
        const text = body.text?.trim();
        if (!text) return send(res, 400, { error: "missing text" });
        const native = body.native?.trim() || "English";
        const target = body.target?.trim() || "Spanish";

        try {
          const reply = (await callBotServer(baseUrl, "/chat", {
            text,
            native,
            target,
          })) as Partial<BotReply>;
          const replyText = typeof reply.text === "string" ? reply.text : "";
          if (!replyText) {
            throw new Error("bot-server returned empty text");
          }
          const quiz = sanitizeQuiz(reply.quiz);
          const a2ui = quiz ? quizToA2ui(quiz, `t${++surfaceCounter}`) : [];
          send(res, 200, { text: replyText, a2ui });
        } catch (err: any) {
          console.error("[chat-api] error:", err);
          send(res, 502, {
            error:
              err.message ??
              `failed to reach bot server at ${baseUrl} — start it with \`bin/bot-server tutor\``,
          });
        }
      });
    },
  };
}

