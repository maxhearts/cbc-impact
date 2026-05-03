/**
 * <a2ui-quiz> — composite multi-style quiz component.
 *
 * Receives a `quizId`, `title`, and an `items` array of question objects.
 * Drives all interaction locally: shows one item at a time, gives
 * immediate per-item feedback, then advances. On the final item's submit,
 * fires `quiz-complete` (composed, bubbles).
 *
 * Whenever state changes (advance, answer, self-grade), fires a
 * `quiz-state-change` event so the chat client can attach a fresh
 * snapshot to outgoing user messages.
 *
 * Item kinds (the agent picks per card):
 *   - mcq    — multiple choice, exactly one correct
 *   - type   — type the answer (compared to `expected: string[]`)
 *   - multi  — checkbox multi-select; correct iff selected set === isCorrect set
 *   - flip   — flashcard with self-grade (Got it / Missed it)
 *
 * Item objects (plain JSON, not StringValue-wrapped):
 *
 *   { kind: "mcq",   prompt, options: [{label, isCorrect}], explanation, category? }
 *   { kind: "type",  prompt, expected: string[], expectedLabel, explanation, category? }
 *   { kind: "multi", prompt, options: [{label, isCorrect}], explanation, category? }
 *   { kind: "flip",  prompt, back, category? }
 */

import { html, css, nothing, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

type StringValue = { literalString?: string | null } | string | null;

type Kind = "mcq" | "type" | "multi" | "flip" | "cloze" | "order";

interface OptionItem {
  label: string;
  isCorrect: boolean;
}

interface BlankSpec {
  expected: string[];
  expectedLabel?: string;
}

interface BaseItem {
  kind: Kind;
  prompt: string;
  category?: string;
  explanation?: string;
}

interface McqItem extends BaseItem { kind: "mcq"; options: OptionItem[]; }
interface TypeItem extends BaseItem { kind: "type"; expected: string[]; expectedLabel?: string; }
interface MultiItem extends BaseItem { kind: "multi"; options: OptionItem[]; }
interface FlipItem extends BaseItem { kind: "flip"; back: string; }
/**
 * Multi-blank fill-in. The prompt contains `___` (3+ underscores) at each
 * blank position; `blanks[i]` describes what's expected for the i-th
 * occurrence in left-to-right order.
 */
interface ClozeItem extends BaseItem {
  kind: "cloze";
  blanks: BlankSpec[];
  expectedLabel?: string;  // optional whole-sentence canonical answer
}
/**
 * Jumbled-tokens reorder. `tokens` is the bank as displayed (we shuffle
 * for the user); `answer` is the correct ordered sequence of token
 * strings — we compare by joined string so duplicates are fine.
 */
interface OrderItem extends BaseItem {
  kind: "order";
  tokens: string[];
  answer: string[];
  expectedLabel?: string;
}

type Item = McqItem | TypeItem | MultiItem | FlipItem | ClozeItem | OrderItem;

interface AnswerResult {
  index: number;
  kind: Kind;
  isCorrect: boolean | null;
  selected: string | string[] | null;
}

function resolveString(v: StringValue): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "literalString" in v && v.literalString != null) return v.literalString;
  return "";
}

function normalizeJa(s: string): string {
  // Collapse whitespace, lowercase ascii. Don't touch CJK.
  return s.replace(/\s+/g, "").toLowerCase();
}

@customElement("a2ui-quiz")
export class Quiz extends LitElement {
  @property({ attribute: false }) quizId: StringValue = null;
  // NOTE: named `quizTitle` (not `title`) to avoid colliding with
  // HTMLElement.title. The agent's JSON also uses `quizTitle`.
  @property({ attribute: false }) quizTitle: StringValue = null;
  @property({ attribute: false }) items: Item[] = [];

  // Per-item working state
  @state() private currentIndex = 0;
  @state() private answers: AnswerResult[] = [];
  @state() private startedAt = Date.now();

  // mcq/multi: which option(s) the user picked
  @state() private picked: Set<number> = new Set();
  // type: the typed string
  @state() private typed = "";
  // cloze: one string per blank
  @state() private clozeTyped: string[] = [];
  // order: indices of bank tokens picked, in order
  @state() private orderPicked: number[] = [];
  // order: stable shuffle of the bank, indexed by 0..tokens.length-1
  @state() private orderShuffle: number[] = [];
  // flip: has the back been revealed?
  @state() private flipped = false;
  // post-submit lock
  @state() private submitted = false;

  static styles = css`
    :host {
      display: block;
      width: 100%;
      font-family: "Nunito", "Hiragino Maru Gothic Pro", -apple-system,
                   BlinkMacSystemFont, sans-serif;
      color: #4B4B4B;
      --green:        #58CC02;
      --green-dark:   #58A700;
      --green-light:  #D7FFB8;
      --green-text:   #58A700;
      --blue:         #1CB0F6;
      --blue-dark:    #1899D6;
      --blue-light:   #DDF4FF;
      --red:          #FF4B4B;
      --red-dark:     #EA2B2B;
      --red-light:    #FFDFE0;
      --red-text:     #EA2B2B;
      --yellow:       #FFC800;
      --yellow-dark:  #E5A100;
      --border:       #E5E5E5;
      --text:         #4B4B4B;
      --text-muted:   #777777;
      --text-dim:     #AFAFAF;
    }

    /* ---- card shell ---- */
    .wrap {
      background: white;
      border: 2px solid var(--border);
      border-radius: 18px;
      padding: 20px 22px 22px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    /* ---- top bar: title + segmented progress ---- */
    .top {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .top-row {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 12px; color: var(--text-muted);
      font-weight: 800;
      text-transform: uppercase; letter-spacing: 0.6px;
    }
    .title { color: var(--text); }
    .counter { color: var(--text-dim); }
    .progress {
      display: flex;
      gap: 4px;
      height: 10px;
    }
    .pip {
      flex: 1;
      background: var(--border);
      border-radius: 6px;
      transition: background 0.2s;
    }
    .pip.done.correct    { background: var(--green); }
    .pip.done.incorrect  { background: var(--red); }
    .pip.done.ungraded   { background: var(--text-dim); }
    .pip.current         { background: var(--blue); }

    /* ---- category chip + prompt ---- */
    .category {
      align-self: flex-start;
      font-size: 11px;
      font-weight: 800;
      color: var(--blue-dark);
      background: var(--blue-light);
      padding: 4px 10px;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .prompt {
      font-size: 22px;
      font-weight: 800;
      line-height: 1.3;
      color: var(--text);
      letter-spacing: -0.01em;
    }
    .prompt.huge {
      font-size: 56px;
      text-align: center;
      padding: 24px 0 16px;
      letter-spacing: -0.02em;
      line-height: 1.05;
    }

    /* ---- option buttons (mcq / multi) ---- */
    .options {
      display: flex; flex-direction: column; gap: 10px;
    }
    .option {
      display: flex; align-items: center; gap: 14px;
      padding: 14px 16px;
      background: white;
      border: 2px solid var(--border);
      border-bottom-width: 4px;
      border-radius: 14px;
      cursor: pointer;
      transition: background 0.1s, border-color 0.1s, transform 0.05s;
      user-select: none;
    }
    .option:hover:not(.disabled) {
      background: #FAFAFA;
    }
    .option:active:not(.disabled) {
      transform: translateY(2px);
      border-bottom-width: 2px;
    }
    .option.picked {
      background: var(--blue-light);
      border-color: #84D8FF;
      color: var(--blue-dark);
    }
    .option.disabled { cursor: default; }
    .option.correct {
      background: var(--green-light);
      border-color: #B8E994;
      color: var(--green-text);
    }
    .option.incorrect {
      background: var(--red-light);
      border-color: #FFB6B7;
      color: var(--red-text);
    }
    .option.correct-answer {
      border-color: var(--green);
      color: var(--green-text);
    }
    .marker {
      width: 28px; height: 28px;
      border-radius: 8px;
      border: 2px solid var(--border);
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 800; flex-shrink: 0;
      background: white;
      color: var(--text-muted);
    }
    .option.picked .marker {
      border-color: #84D8FF;
      background: var(--blue);
      color: white;
    }
    .option.correct .marker {
      border-color: var(--green);
      background: var(--green);
      color: white;
    }
    .option.incorrect .marker {
      border-color: var(--red);
      background: var(--red);
      color: white;
    }
    .option .label {
      font-size: 16px;
      line-height: 1.3;
      font-weight: 700;
    }

    /* ---- cloze (multi-blank fill-in) ---- */
    .cloze-prompt {
      font-size: 20px;
      font-weight: 700;
      line-height: 1.9;
      color: var(--text);
    }
    .cloze-text { white-space: pre-wrap; }
    .cloze-input {
      display: inline-block;
      vertical-align: baseline;
      margin: 0 4px;
      padding: 4px 10px;
      min-width: 60px;
      border: 2px solid var(--border);
      border-bottom-width: 3px;
      border-radius: 8px;
      background: white;
      color: var(--text);
      font-family: inherit;
      font-size: 18px;
      font-weight: 700;
      outline: none;
      transition: border-color 0.15s;
    }
    .cloze-input:focus { border-color: var(--blue); }
    .cloze-input.correct {
      background: var(--green-light);
      border-color: var(--green);
      color: var(--green-text);
    }
    .cloze-input.incorrect {
      background: var(--red-light);
      border-color: var(--red);
      color: var(--red-text);
    }
    .cloze-error {
      color: var(--red-text);
      font-weight: 700;
      font-size: 13px;
    }
    .cloze-answer-line {
      font-size: 14px;
      font-weight: 700;
      color: var(--text-muted);
      padding: 4px 0;
    }

    /* ---- order (jumbled tokens) ---- */
    .order-line {
      min-height: 56px;
      padding: 12px;
      border: 2px dashed var(--border);
      border-radius: 14px;
      background: #FAFAFA;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .order-line-placeholder {
      color: var(--text-dim);
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.2px;
    }
    .order-bank {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 4px 0;
    }
    .order-chip {
      font-family: inherit;
      font-size: 16px;
      font-weight: 700;
      color: var(--text);
      background: white;
      border: 2px solid var(--border);
      border-bottom-width: 4px;
      border-radius: 12px;
      padding: 8px 14px;
      cursor: pointer;
      line-height: 1.2;
      transition: filter 0.1s, transform 0.05s;
    }
    .order-chip:hover:not(:disabled) { background: #FAFAFA; }
    .order-chip:active:not(:disabled) {
      transform: translateY(2px);
      border-bottom-width: 2px;
    }
    .order-chip.bank.used {
      visibility: hidden;
    }
    .order-chip.placed.correct {
      background: var(--green-light);
      border-color: var(--green);
      color: var(--green-text);
    }
    .order-chip.placed.incorrect {
      background: var(--red-light);
      border-color: var(--red);
      color: var(--red-text);
    }
    .order-chip:disabled {
      cursor: default;
    }

    /* ---- typed input ---- */
    .type-input {
      width: 100%;
      padding: 14px 16px;
      border-radius: 14px;
      background: white;
      border: 2px solid var(--border);
      border-bottom-width: 3px;
      color: var(--text);
      font-size: 22px;
      font-weight: 700;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s;
    }
    .type-input:focus { border-color: var(--blue); }
    .type-input.correct {
      border-color: var(--green);
      background: var(--green-light);
      color: var(--green-text);
    }
    .type-input.incorrect {
      border-color: var(--red);
      background: var(--red-light);
      color: var(--red-text);
    }
    .type-input::placeholder { color: var(--text-dim); font-weight: 600; }

    /* ---- primary buttons (CHECK / NEXT / Show answer) ---- */
    button.primary {
      width: 100%;
      padding: 0 16px;
      height: 52px;
      border: none;
      border-radius: 14px;
      background: var(--green);
      color: white;
      border-bottom: 4px solid var(--green-dark);
      font-family: inherit;
      font-size: 15px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      cursor: pointer;
      transition: filter 0.1s, transform 0.05s;
    }
    button.primary:hover:not(:disabled) { filter: brightness(1.05); }
    button.primary:active:not(:disabled) {
      transform: translateY(2px);
      border-bottom-width: 2px;
    }
    button.primary:disabled {
      background: var(--border);
      color: var(--text-dim);
      border-bottom-color: #D0D0D0;
      cursor: not-allowed;
    }

    /* "Continue" variant on feedback panels matches feedback color */
    button.primary.next-correct {
      background: var(--green); border-bottom-color: var(--green-dark);
    }
    button.primary.next-incorrect {
      background: var(--red); border-bottom-color: var(--red-dark);
    }

    /* ---- flip-card grade row ---- */
    .grade-row {
      display: flex; gap: 10px;
    }
    .grade-row button {
      flex: 1;
      height: 52px;
      border: none; border-radius: 14px;
      font-family: inherit; font-size: 14px;
      font-weight: 800;
      text-transform: uppercase; letter-spacing: 0.6px;
      cursor: pointer;
      color: white;
      transition: filter 0.1s, transform 0.05s;
    }
    .grade-row button:active { transform: translateY(2px); border-bottom-width: 2px; }
    .grade-row button.miss {
      background: var(--red); border-bottom: 4px solid var(--red-dark);
    }
    .grade-row button.got {
      background: var(--green); border-bottom: 4px solid var(--green-dark);
    }
    .grade-row button:hover { filter: brightness(1.05); }

    /* ---- bottom feedback panel (Duolingo-style sliding bar) ---- */
    .feedback {
      margin: 6px -22px -22px;
      padding: 18px 22px 22px;
      background: var(--green-light);
      border-bottom-left-radius: 16px;
      border-bottom-right-radius: 16px;
      border-top: 1px solid #B8E994;
      animation: feedback-slide 0.18s ease-out;
    }
    .feedback.incorrect {
      background: var(--red-light);
      border-top-color: #FFB6B7;
    }
    @keyframes feedback-slide {
      from { transform: translateY(8px); opacity: 0; }
      to   { transform: translateY(0);   opacity: 1; }
    }
    .feedback-head {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 8px;
    }
    .feedback-icon {
      width: 36px; height: 36px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-weight: 900;
      color: white;
      font-size: 18px;
      flex-shrink: 0;
    }
    .feedback .feedback-icon { background: var(--green); }
    .feedback.incorrect .feedback-icon { background: var(--red); }
    .feedback-title {
      font-size: 20px; font-weight: 900;
      color: var(--green-text);
      letter-spacing: -0.01em;
    }
    .feedback.incorrect .feedback-title { color: var(--red-text); }
    .feedback-text {
      font-size: 14px; line-height: 1.45;
      color: var(--green-text); opacity: 0.92;
      white-space: pre-wrap;
      font-weight: 600;
      margin-bottom: 14px;
    }
    .feedback.incorrect .feedback-text { color: var(--red-text); }

    /* ---- final summary ---- */
    .summary {
      text-align: center; padding: 8px 0 4px;
      display: flex; flex-direction: column; align-items: center; gap: 6px;
    }
    .summary .trophy {
      font-size: 56px;
      line-height: 1;
      margin-bottom: 4px;
    }
    .summary .score {
      font-size: 44px; font-weight: 900;
      color: var(--green-text);
      letter-spacing: -0.02em;
      line-height: 1;
    }
    .summary .score.low { color: var(--yellow-dark); }
    .summary .score.bad { color: var(--red-text); }
    .summary .scoreline {
      font-size: 13px; color: var(--text-muted);
      font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px;
    }

    .breakdown {
      display: flex; flex-direction: column; gap: 6px;
      margin-top: 8px;
    }
    .breakdown .row {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px;
      background: #FAFAFA;
      border: 1px solid var(--border);
      border-radius: 10px;
      font-size: 13px;
      font-weight: 700;
      color: var(--text);
    }
    .breakdown .row.correct {
      background: var(--green-light); border-color: #B8E994; color: var(--green-text);
    }
    .breakdown .row.incorrect {
      background: var(--red-light); border-color: #FFB6B7; color: var(--red-text);
    }
    .breakdown .row .icon {
      width: 22px; height: 22px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      font-size: 12px;
      color: white;
      background: var(--text-dim);
    }
    .breakdown .row.correct .icon   { background: var(--green); }
    .breakdown .row.incorrect .icon { background: var(--red); }
  `;

  // ---- public state snapshot for the chat client ----

  snapshot() {
    const items = this.items ?? [];
    const idx = Math.min(this.currentIndex, items.length);
    return {
      quizId: resolveString(this.quizId),
      title: resolveString(this.quizTitle),
      totalItems: items.length,
      currentIndex: idx,
      currentItem: idx < items.length ? items[idx] : null,
      answers: this.answers.slice(),
    };
  }

  isComplete(): boolean {
    return this.items.length > 0 && this.currentIndex >= this.items.length;
  }

  // ---- lifecycle / event emit ----

  private emitState() {
    this.dispatchEvent(new CustomEvent("quiz-state-change", {
      bubbles: true, composed: true, detail: this.snapshot(),
    }));
  }

  private emitComplete() {
    const correct = this.answers.filter(a => a.isCorrect === true).length;
    this.dispatchEvent(new CustomEvent("quiz-complete", {
      bubbles: true, composed: true,
      detail: {
        quizId: resolveString(this.quizId),
        title: resolveString(this.quizTitle),
        durationMs: Date.now() - this.startedAt,
        score: { correct, total: this.items.length },
        results: this.answers.slice(),
      },
    }));
  }

  protected updated(changed: Map<string, unknown>) {
    if (changed.has("items")) {
      // New quiz dropped in — reset.
      this.currentIndex = 0;
      this.answers = [];
      this.startedAt = Date.now();
      this.resetItemState();
      this.emitState();
    }
  }

  private resetItemState() {
    this.picked = new Set();
    this.typed = "";
    this.clozeTyped = [];
    this.orderPicked = [];
    this.orderShuffle = [];
    this.flipped = false;
    this.submitted = false;

    // Pre-populate per-kind state for the current item.
    const idx = this.currentIndex;
    const item = this.items?.[idx];
    if (!item) return;
    if (item.kind === "cloze") {
      this.clozeTyped = new Array(item.blanks.length).fill("");
    } else if (item.kind === "order") {
      this.orderShuffle = shuffledIndices(item.tokens.length);
    }
  }

  // ---- per-kind handlers ----

  private togglePicked(i: number, allowMulti: boolean) {
    if (this.submitted) return;
    const next = new Set(this.picked);
    if (allowMulti) {
      next.has(i) ? next.delete(i) : next.add(i);
    } else {
      next.clear();
      next.add(i);
    }
    this.picked = next;
  }

  private submit(item: Item) {
    if (this.submitted) return;
    let result: AnswerResult;
    switch (item.kind) {
      case "mcq": {
        const idx = [...this.picked][0];
        const opt = idx != null ? item.options[idx] : null;
        result = {
          index: this.currentIndex,
          kind: "mcq",
          isCorrect: opt?.isCorrect ?? false,
          selected: opt?.label ?? null,
        };
        break;
      }
      case "multi": {
        const correctIdxs = item.options
          .map((o, i) => (o.isCorrect ? i : -1))
          .filter(i => i >= 0);
        const correctSet = new Set(correctIdxs);
        const same =
          this.picked.size === correctSet.size &&
          [...this.picked].every(i => correctSet.has(i));
        result = {
          index: this.currentIndex,
          kind: "multi",
          isCorrect: same,
          selected: [...this.picked].map(i => item.options[i].label),
        };
        break;
      }
      case "type": {
        const typed = normalizeJa(this.typed);
        const ok = item.expected.some(e => normalizeJa(e) === typed);
        result = {
          index: this.currentIndex,
          kind: "type",
          isCorrect: ok,
          selected: this.typed,
        };
        break;
      }
      case "cloze": {
        const allOk = item.blanks.every((b, i) => {
          const t = normalizeJa(this.clozeTyped[i] ?? "");
          return t.length > 0 && b.expected.some(e => normalizeJa(e) === t);
        });
        result = {
          index: this.currentIndex,
          kind: "cloze",
          isCorrect: allOk,
          selected: this.clozeTyped.slice(),
        };
        break;
      }
      case "order": {
        const picked = this.orderPicked.map(i => item.tokens[i]);
        const ok = picked.length === item.answer.length &&
          normalizeJa(picked.join(" ")) === normalizeJa(item.answer.join(" "));
        result = {
          index: this.currentIndex,
          kind: "order",
          isCorrect: ok,
          selected: picked,
        };
        break;
      }
      case "flip":
        // Flip uses grade buttons rather than submit; this branch shouldn't fire.
        return;
    }
    this.answers = [...this.answers, result];
    this.submitted = true;
    this.emitState();
  }

  private grade(got: boolean, item: FlipItem) {
    if (this.submitted) return;
    this.answers = [...this.answers, {
      index: this.currentIndex,
      kind: "flip",
      isCorrect: got,
      selected: null,
    }];
    this.submitted = true;
    this.emitState();
  }

  private next() {
    this.currentIndex = this.currentIndex + 1;
    this.resetItemState();
    if (this.isComplete()) {
      this.emitState();
      this.emitComplete();
    } else {
      this.emitState();
    }
  }

  // ---- render ----

  render() {
    if (!this.items || this.items.length === 0) {
      return html`<div class="wrap"><div class="prompt">No quiz items.</div></div>`;
    }
    if (this.isComplete()) return this.renderSummary();

    const idx = this.currentIndex;
    const item = this.items[idx];
    const titleText = resolveString(this.quizTitle);

    return html`
      <div class="wrap">
        <div class="top">
          <div class="top-row">
            <span class="title">${titleText || "Quiz"}</span>
            <span class="counter">${idx + 1} / ${this.items.length}</span>
          </div>
          <div class="progress">
            ${this.items.map((_, i) => {
              const a = this.answers[i];
              const cls = i === idx
                ? "current"
                : a == null ? ""
                : a.isCorrect === true ? "done correct"
                : a.isCorrect === false ? "done incorrect"
                : "done ungraded";
              return html`<span class="pip ${cls}"></span>`;
            })}
          </div>
        </div>

        ${item.category ? html`<div class="category">${item.category}</div>` : nothing}

        ${this.renderItem(item)}
      </div>
    `;
  }

  private renderItem(item: Item) {
    switch (item.kind) {
      case "mcq":   return this.renderMcq(item);
      case "multi": return this.renderMulti(item);
      case "type":  return this.renderType(item);
      case "flip":  return this.renderFlip(item);
      case "cloze": return this.renderCloze(item);
      case "order": return this.renderOrder(item);
    }
  }

  private renderMcq(item: McqItem) {
    return html`
      <div class="prompt">${item.prompt}</div>
      <div class="options">
        ${item.options.map((o, i) => {
          const picked = this.picked.has(i);
          const showCorrect = this.submitted && o.isCorrect;
          const showIncorrect = this.submitted && picked && !o.isCorrect;
          return html`
            <div
              class=${classMap({
                option: true, picked: picked && !this.submitted,
                disabled: this.submitted,
                correct: showCorrect && picked,
                "correct-answer": showCorrect && !picked,
                incorrect: showIncorrect,
              })}
              @click=${() => this.togglePicked(i, false)}
            >
              <div class="marker">
                ${this.submitted
                  ? o.isCorrect ? "✓" : (picked ? "✗" : String.fromCharCode(65 + i))
                  : String.fromCharCode(65 + i)}
              </div>
              <div class="label">${o.label}</div>
            </div>
          `;
        })}
      </div>
      ${this.renderSubmitOrFeedback(item, this.picked.size === 0)}
    `;
  }

  private renderMulti(item: MultiItem) {
    return html`
      <div class="prompt">${item.prompt}</div>
      <div class="options">
        ${item.options.map((o, i) => {
          const picked = this.picked.has(i);
          const showCorrect = this.submitted && o.isCorrect;
          const showIncorrect = this.submitted && picked && !o.isCorrect;
          const showMissed = this.submitted && o.isCorrect && !picked;
          return html`
            <div
              class=${classMap({
                option: true, picked: picked && !this.submitted,
                disabled: this.submitted,
                correct: showCorrect && picked,
                "correct-answer": showMissed,
                incorrect: showIncorrect,
              })}
              @click=${() => this.togglePicked(i, true)}
            >
              <div class="marker">
                ${this.submitted
                  ? o.isCorrect ? "✓" : (picked ? "✗" : "•")
                  : (picked ? "✓" : "")}
              </div>
              <div class="label">${o.label}</div>
            </div>
          `;
        })}
      </div>
      ${this.renderSubmitOrFeedback(item, this.picked.size === 0)}
    `;
  }

  private renderType(item: TypeItem) {
    const last = this.answers[this.answers.length - 1];
    const wasCorrect = this.submitted && last && last.isCorrect === true;
    return html`
      <div class="prompt">${item.prompt}</div>
      <input
        class=${classMap({
          "type-input": true,
          correct: !!wasCorrect,
          incorrect: this.submitted && !wasCorrect,
        })}
        type="text"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        ?disabled=${this.submitted}
        .value=${this.typed}
        @input=${(e: InputEvent) => (this.typed = (e.target as HTMLInputElement).value)}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter" && !this.submitted && this.typed.trim()) {
            e.preventDefault();
            this.submit(item);
          }
        }}
      />
      ${this.renderSubmitOrFeedback(item, !this.typed.trim())}
    `;
  }

  private renderCloze(item: ClozeItem) {
    const segments = splitOnBlanks(item.prompt);
    // segments.length === blanks + 1 only when the prompt has exactly
    // `blanks.length` placeholders. If they don't match, render a fallback.
    if (segments.length !== item.blanks.length + 1) {
      return html`
        <div class="prompt">${item.prompt}</div>
        <div class="cloze-error">[malformed cloze: ${item.blanks.length} blanks
          expected, ${segments.length - 1} placeholders found]</div>
      `;
    }

    const submitDisabled = this.clozeTyped.some(s => !s.trim());
    const last = this.answers[this.answers.length - 1];
    const wasCorrect = this.submitted && last && last.isCorrect === true;

    return html`
      <div class="cloze-prompt">
        ${segments.map((seg, i) => {
          const blankIdx = i; // input goes after segment i, except after last
          if (i === segments.length - 1) {
            return html`<span class="cloze-text">${seg}</span>`;
          }
          const blank = item.blanks[blankIdx];
          const value = this.clozeTyped[blankIdx] ?? "";
          const blankCorrect = this.submitted &&
            blank.expected.some(e => normalizeJa(e) === normalizeJa(value));
          return html`
            <span class="cloze-text">${seg}</span>
            <input
              class=${classMap({
                "cloze-input": true,
                correct: !!blankCorrect,
                incorrect: this.submitted && !blankCorrect,
              })}
              type="text"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              ?disabled=${this.submitted}
              .value=${value}
              placeholder="…"
              style=${`width: ${Math.max(60, value.length * 14 + 24)}px`}
              @input=${(e: InputEvent) => {
                const next = this.clozeTyped.slice();
                next[blankIdx] = (e.target as HTMLInputElement).value;
                this.clozeTyped = next;
              }}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter" && !this.submitted &&
                    !this.clozeTyped.some(s => !s.trim())) {
                  e.preventDefault();
                  this.submit(item);
                }
              }}
            />
          `;
        })}
      </div>
      ${this.submitted && !wasCorrect && item.expectedLabel ? html`
        <div class="cloze-answer-line">Answer: ${item.expectedLabel}</div>
      ` : nothing}
      ${this.renderSubmitOrFeedback(item, submitDisabled)}
    `;
  }

  private renderOrder(item: OrderItem) {
    const shuffle = this.orderShuffle.length > 0
      ? this.orderShuffle
      : item.tokens.map((_, i) => i);
    const usedSet = new Set(this.orderPicked);

    const submitDisabled = this.orderPicked.length !== item.answer.length;

    const onPickBank = (tokenIdx: number) => {
      if (this.submitted || usedSet.has(tokenIdx)) return;
      // Only allow picking up to answer.length items.
      if (this.orderPicked.length >= item.answer.length) return;
      this.orderPicked = [...this.orderPicked, tokenIdx];
    };
    const onUnpick = (positionInPicked: number) => {
      if (this.submitted) return;
      const next = this.orderPicked.slice();
      next.splice(positionInPicked, 1);
      this.orderPicked = next;
    };

    // Per-position correctness for post-submit coloring.
    const correctTokens = item.answer.map(s => normalizeJa(s));
    const pickedNorm = this.orderPicked.map(i => normalizeJa(item.tokens[i]));
    const positionOk = (pos: number) =>
      pos < correctTokens.length && pickedNorm[pos] === correctTokens[pos];

    return html`
      <div class="prompt">${item.prompt}</div>
      <div class="order-line">
        ${this.orderPicked.length === 0 ? html`
          <span class="order-line-placeholder">Tap words below to assemble your answer</span>
        ` : nothing}
        ${this.orderPicked.map((tokenIdx, pos) => {
          const ok = positionOk(pos);
          return html`
            <button
              type="button"
              class=${classMap({
                "order-chip": true,
                placed: true,
                correct: this.submitted && ok,
                incorrect: this.submitted && !ok,
              })}
              ?disabled=${this.submitted}
              @click=${() => onUnpick(pos)}
            >${item.tokens[tokenIdx]}</button>
          `;
        })}
      </div>
      <div class="order-bank">
        ${shuffle.map((tokenIdx) => {
          const used = usedSet.has(tokenIdx);
          return html`
            <button
              type="button"
              class=${classMap({
                "order-chip": true,
                bank: true,
                used,
              })}
              ?disabled=${used || this.submitted}
              @click=${() => onPickBank(tokenIdx)}
            >${item.tokens[tokenIdx]}</button>
          `;
        })}
      </div>
      ${this.submitted && item.expectedLabel ? html`
        <div class="cloze-answer-line">Answer: ${item.expectedLabel}</div>
      ` : nothing}
      ${this.renderSubmitOrFeedback(item, submitDisabled)}
    `;
  }

  private renderFlip(item: FlipItem) {
    if (!this.flipped && !this.submitted) {
      return html`
        <div class="prompt huge">${item.prompt}</div>
        <button class="primary" @click=${() => (this.flipped = true)}>Show answer</button>
      `;
    }
    if (this.flipped && !this.submitted) {
      return html`
        <div class="prompt huge">${item.prompt}</div>
        <div class="feedback">
          <div class="feedback-head">
            <div class="feedback-icon">?</div>
            <div class="feedback-title">Answer</div>
          </div>
          <div class="feedback-text">${item.back}</div>
          <div class="grade-row">
            <button class="miss" @click=${() => this.grade(false, item)}>Missed it</button>
            <button class="got" @click=${() => this.grade(true, item)}>Got it</button>
          </div>
        </div>
      `;
    }
    // submitted
    const last = this.answers[this.answers.length - 1];
    const got = last?.isCorrect === true;
    return html`
      <div class="prompt huge">${item.prompt}</div>
      <div class=${classMap({ feedback: true, incorrect: !got })}>
        <div class="feedback-head">
          <div class="feedback-icon">${got ? "✓" : "✗"}</div>
          <div class="feedback-title">${got ? "Got it!" : "Missed it"}</div>
        </div>
        <div class="feedback-text">${item.back}</div>
        <button
          class=${classMap({ primary: true, "next-correct": got, "next-incorrect": !got })}
          @click=${() => this.next()}
        >
          ${this.currentIndex + 1 < this.items.length ? "Continue" : "Finish"}
        </button>
      </div>
    `;
  }

  private renderSubmitOrFeedback(item: Item, submitDisabled: boolean) {
    if (!this.submitted) {
      return html`
        <button class="primary" ?disabled=${submitDisabled} @click=${() => this.submit(item)}>
          Check
        </button>
      `;
    }
    const last = this.answers[this.answers.length - 1];
    const ok = last?.isCorrect === true;
    const expectedLine = item.kind === "type" && item.expectedLabel
      ? `Answer: ${item.expectedLabel}\n`
      : "";
    const explanation = item.explanation ?? "";
    const text = (expectedLine + explanation).trim();
    const title = ok
      ? randomCelebrate()
      : "Not quite — give it another look.";
    return html`
      <div class=${classMap({ feedback: true, incorrect: !ok })}>
        <div class="feedback-head">
          <div class="feedback-icon">${ok ? "✓" : "✗"}</div>
          <div class="feedback-title">${title}</div>
        </div>
        ${text ? html`<div class="feedback-text">${text}</div>` : nothing}
        <button
          class=${classMap({ primary: true, "next-correct": ok, "next-incorrect": !ok })}
          @click=${() => this.next()}
        >
          ${this.currentIndex + 1 < this.items.length ? "Continue" : "Finish"}
        </button>
      </div>
    `;
  }

  private renderSummary() {
    const correct = this.answers.filter(a => a.isCorrect === true).length;
    const total = this.items.length;
    const pct = total > 0 ? correct / total : 0;
    const scoreClass = pct >= 0.8 ? "" : pct >= 0.5 ? "low" : "bad";
    const trophy = pct === 1 ? "🏆" : pct >= 0.8 ? "🎉" : pct >= 0.5 ? "💪" : "🌱";
    const headline =
      pct === 1   ? "Perfect run!" :
      pct >= 0.8  ? "Nice work!" :
      pct >= 0.5  ? "Good effort." :
                    "Keep going.";
    return html`
      <div class="wrap">
        <div class="summary">
          <div class="trophy">${trophy}</div>
          <div class="score ${scoreClass}">${correct} / ${total}</div>
          <div class="scoreline">${headline} · ${resolveString(this.quizTitle) || "Quiz"}</div>
        </div>
        <div class="breakdown">
          ${this.items.map((it, i) => {
            const a = this.answers[i];
            const cls = !a ? "ungraded" : a.isCorrect ? "correct" : "incorrect";
            const icon = !a ? "·" : a.isCorrect ? "✓" : "✗";
            return html`
              <div class="row ${cls}">
                <span class="icon">${icon}</span>
                <span>${it.category ?? `#${i + 1}`} — ${shortPrompt(it.prompt)}</span>
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }
}

function shortPrompt(s: string): string {
  if (s.length <= 60) return s;
  return s.slice(0, 57) + "…";
}

/**
 * Split a cloze prompt on runs of 3+ underscores. Returns N+1 segments
 * for N blanks; segments may be empty strings when blanks are adjacent
 * or at the prompt's edges.
 */
function splitOnBlanks(prompt: string): string[] {
  return prompt.split(/_{3,}/);
}

function shuffledIndices(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const CELEBRATIONS = ["Nailed it!", "Excellent!", "Correct!", "Nice!", "Way to go!"];
function randomCelebrate(): string {
  return CELEBRATIONS[Math.floor(Math.random() * CELEBRATIONS.length)];
}

declare global {
  interface HTMLElementTagNameMap {
    "a2ui-quiz": Quiz;
  }
}
