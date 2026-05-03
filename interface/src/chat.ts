/**
 * Chat shell. Sends user messages to /chat (which calls Haiku via
 * OpenRouter) and renders the agent's text reply plus the A2UI Quiz
 * payload that ships with it.
 */

import { v0_8 } from "@a2ui/lit";
import {
  LANGUAGES,
  DEFAULT_NATIVE,
  DEFAULT_TARGET,
  findLang,
} from "./languages.js";
import { greet } from "./greetings.js";

const AGENT_NAME = "Maxx";
const AGENT_AVATAR = "/maxx.png";

interface AgentReply {
  text?: string;
  a2ui: unknown[];
  error?: string;
}

interface A2UIThemeProviderEl extends HTMLElement {
  surfaceId: string;
  surface: v0_8.Types.Surface;
  processor: InstanceType<typeof v0_8.Data.A2uiMessageProcessor>;
}

const messages = document.getElementById("messages") as HTMLDivElement;
const form = document.getElementById("composer") as HTMLFormElement;
const input = document.getElementById("composer-input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("composer-send") as HTMLButtonElement;
const statusDot = document.getElementById("status-dot") as HTMLSpanElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const nativeSel = document.getElementById("native-lang") as HTMLSelectElement;
const targetSel = document.getElementById("target-lang") as HTMLSelectElement;
const swapBtn = document.getElementById("swap-lang") as HTMLButtonElement;
const modelChip = document.getElementById("model-chip") as HTMLSpanElement;

// ---- language pair selector ----------------------------------------------

const NATIVE_KEY = "lingomaxxing.native";
const TARGET_KEY = "lingomaxxing.target";

function fillSelect(sel: HTMLSelectElement, current: string) {
  sel.innerHTML = "";
  for (const lang of LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = lang.code;
    opt.textContent = lang.flag ? `${lang.flag} ${lang.name}` : lang.name;
    if (lang.code === current) opt.selected = true;
    sel.appendChild(opt);
  }
}

function loadPair(): { native: string; target: string } {
  const native = localStorage.getItem(NATIVE_KEY) || DEFAULT_NATIVE;
  let target = localStorage.getItem(TARGET_KEY) || DEFAULT_TARGET;
  if (target === native) {
    // Avoid the degenerate same-language pair.
    target = native === DEFAULT_TARGET ? DEFAULT_NATIVE : DEFAULT_TARGET;
  }
  return { native, target };
}

function savePair() {
  localStorage.setItem(NATIVE_KEY, nativeSel.value);
  localStorage.setItem(TARGET_KEY, targetSel.value);
}

const initial = loadPair();
fillSelect(nativeSel, initial.native);
fillSelect(targetSel, initial.target);

function onPairChange(changed: "native" | "target") {
  // Prevent picking the same language on both sides — flip the other.
  if (nativeSel.value === targetSel.value) {
    const other = changed === "native" ? targetSel : nativeSel;
    const fallback = LANGUAGES.find((l) => l.code !== nativeSel.value);
    if (fallback) other.value = fallback.code;
  }
  savePair();
}

nativeSel.addEventListener("change", () => onPairChange("native"));
targetSel.addEventListener("change", () => onPairChange("target"));
swapBtn.addEventListener("click", () => {
  const a = nativeSel.value;
  nativeSel.value = targetSel.value;
  targetSel.value = a;
  savePair();
});

function currentPair() {
  return {
    native: findLang(nativeSel.value)?.name ?? "English",
    target: findLang(targetSel.value)?.name ?? "Spanish",
  };
}

function scroll() {
  messages.scrollTop = messages.scrollHeight;
}

function appendUserMessage(text: string) {
  const wrap = document.createElement("div");
  wrap.className = "msg user";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  wrap.appendChild(bubble);
  messages.appendChild(wrap);
  scroll();
}

function appendAgentMessage(reply: AgentReply) {
  const wrap = document.createElement("div");
  wrap.className = "msg agent";

  const avatar = document.createElement("img");
  avatar.className = "avatar";
  avatar.src = AGENT_AVATAR;
  avatar.alt = AGENT_NAME;
  avatar.draggable = false;
  wrap.appendChild(avatar);

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const label = document.createElement("div");
  label.className = "label";
  label.textContent = AGENT_NAME;
  bubble.appendChild(label);

  if (reply.text) {
    const t = document.createElement("div");
    t.className = "text";
    t.textContent = reply.text;
    bubble.appendChild(t);
  }

  if (reply.a2ui && reply.a2ui.length > 0) {
    mountA2UI(bubble, reply.a2ui);
  }

  wrap.appendChild(bubble);
  messages.appendChild(wrap);
  scroll();
}

function mountA2UI(parent: HTMLElement, a2uiMessages: unknown[]) {
  const processor = v0_8.Data.createSignalA2uiMessageProcessor();
  try {
    processor.processMessages(a2uiMessages as v0_8.Types.ServerToClientMessage[]);
  } catch (err) {
    console.error("[chat] processMessages failed:", err, a2uiMessages);
    const errEl = document.createElement("div");
    errEl.className = "text";
    errEl.style.color = "#f87171";
    errEl.textContent = "[render error — see console]";
    parent.appendChild(errEl);
    return;
  }

  for (const [sid, surface] of processor.getSurfaces().entries()) {
    const provider = document.createElement("a2ui-theme-provider") as A2UIThemeProviderEl;
    provider.surfaceId = sid;
    provider.surface = surface;
    provider.processor = processor;
    parent.appendChild(provider);
  }
}

function setStatus(state: "idle" | "thinking" | "error", msg: string) {
  statusDot.classList.toggle("live", state === "idle");
  statusDot.classList.toggle("thinking", state === "thinking");
  statusText.textContent = msg;
  sendBtn.disabled = state === "thinking" || input.value.trim() === "";
}

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
  if (!statusDot.classList.contains("thinking")) {
    sendBtn.disabled = input.value.trim() === "";
  }
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) form.requestSubmit();
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  appendUserMessage(text);
  input.value = "";
  input.style.height = "auto";
  setStatus("thinking", `${AGENT_NAME} is thinking…`);

  try {
    const { native, target } = currentPair();
    const r = await fetch("/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, native, target }),
    });
    const data = (await r.json().catch(() => ({}))) as AgentReply;
    if (!r.ok) {
      appendAgentMessage({
        text: `[chat error ${r.status}: ${data.error ?? "unknown"}]`,
        a2ui: [],
      });
      setStatus("error", "request failed — try again");
    } else {
      appendAgentMessage(data);
      setStatus("idle", "ready");
    }
  } catch (err: any) {
    appendAgentMessage({ text: `[network error: ${err.message ?? err}]`, a2ui: [] });
    setStatus("error", "network error");
  }
});

setStatus("idle", "ready");

// Friendly hello in the user's native language. Pure client-side — no
// LLM call, no chat-history pollution; fires once per page load.
appendAgentMessage({
  text: greet(nativeSel.value, targetSel.value),
  a2ui: [],
});

// ---- model badge --------------------------------------------------------

interface ModelInfo {
  model: string;
  bot?: string;
  backend?: string;
}

/**
 * Pretty-print the upstream model id. Examples:
 *   "anthropic/claude-haiku-4.5" → "Haiku 4.5"
 *   "anthropic/claude-sonnet-4-6" → "Sonnet 4.6"
 *   "gemma3:1b" → "Gemma 3 · 1B"
 *   "llama3.2:3b" → "Llama 3.2 · 3B"
 *   anything else → as-is
 */
function formatModel(raw: string): string {
  if (!raw) return "";
  const lower = raw.toLowerCase();

  // Anthropic Claude — drop vendor prefix, capitalize family.
  const claude = /(?:^|\/)claude-(haiku|sonnet|opus)[-_]?([\w.\-]+)?/i.exec(lower);
  if (claude) {
    const family = claude[1][0].toUpperCase() + claude[1].slice(1);
    const ver = (claude[2] ?? "").replace(/-/g, ".");
    return ver ? `${family} ${ver}` : family;
  }

  // Ollama-style "<name><ver>:<tag>"  e.g. gemma3:1b, llama3.2:3b, qwen2.5:7b
  const ollama = /^([a-z]+)(\d[\w.]*)?(?::([\w.\-]+))?$/i.exec(lower);
  if (ollama) {
    const name = ollama[1][0].toUpperCase() + ollama[1].slice(1);
    const ver = ollama[2] ? ` ${ollama[2]}` : "";
    const tag = ollama[3] ? ` · ${ollama[3].toUpperCase()}` : "";
    return `${name}${ver}${tag}`;
  }

  return raw;
}

function modelFamily(raw: string): "cloud" | "local" | "" {
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower.includes("claude") || lower.includes("gpt") || lower.includes("gemini")) {
    return "cloud";
  }
  // Ollama / open-weights → assume local.
  if (/^(gemma|llama|qwen|mistral|phi|deepseek|smol)/.test(lower)) {
    return "local";
  }
  return "";
}

async function refreshModelChip() {
  try {
    const r = await fetch("/chat/info");
    if (!r.ok) {
      modelChip.hidden = true;
      return;
    }
    const info = (await r.json()) as ModelInfo;
    const label = formatModel(info.model);
    if (!label) {
      modelChip.hidden = true;
      return;
    }
    modelChip.textContent = label;
    modelChip.title = info.model + (info.bot ? ` · ${info.bot}` : "");
    modelChip.classList.remove("cloud", "local");
    const fam = modelFamily(info.model);
    if (fam) modelChip.classList.add(fam);
    modelChip.hidden = false;
  } catch {
    modelChip.hidden = true;
  }
}

refreshModelChip();
