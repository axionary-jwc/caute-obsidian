/**
 * The pickers and questions the plugin shows. Everything from Caute is saved
 * content, so it is set as text, never as HTML (INV-19).
 */

import {
  App, Editor, EditorSuggest, Modal, Setting, SuggestModal, type EditorPosition, type EditorSuggestContext,
  type EditorSuggestTriggerInfo, type TFile,
} from "obsidian";
import type { Caute, CauteError, SearchResult } from "./api";

const DEBOUNCE_MS = 250;

function wait(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

function renderCard(el: HTMLElement, title: string | null, line: string): void {
  el.createDiv({ cls: "caute-suggestion-title", text: title?.trim() || "Untitled card" });
  if (line) el.createDiv({ cls: "caute-suggestion-line", text: line });
}

/** Search Caute as you type, then hand back the chosen result. */
export class CardSearchModal extends SuggestModal<SearchResult> {
  private latest = "";

  constructor(app: App, private api: Caute, private mode: "picker" | "search", placeholder: string,
              private chose: (r: SearchResult) => void) {
    super(app);
    this.setPlaceholder(placeholder);
    this.emptyStateText = "Type to search your Caute library.";
  }

  async getSuggestions(query: string): Promise<SearchResult[]> {
    this.latest = query;
    if (query.trim().length < 2) return [];
    await wait(DEBOUNCE_MS);
    if (query !== this.latest) return [];
    try {
      const results = await this.api.search(query.trim(), this.mode);
      this.emptyStateText = "Nothing you've caught matches that.";
      return results;
    } catch (e) {
      this.emptyStateText = (e as CauteError).message;
      return [];
    }
  }

  renderSuggestion(r: SearchResult, el: HTMLElement): void {
    const where = r.space.name ? ` · ${r.space.name}` : "";
    renderCard(el, r.item.title, `${r.match.snippet}${where}`);
  }

  onChooseSuggestion(r: SearchResult): void {
    this.chose(r);
  }
}

/** `@@` followed by words offers cards to link, as the web's `@` does. */
export class CardLinkSuggest extends EditorSuggest<SearchResult> {
  private latest = "";

  constructor(app: App, private api: () => Caute | null, private insert: (r: SearchResult) => string) {
    super(app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    const m = /@@([^@\n]{0,80})$/.exec(before);
    if (!m || !this.api()) return null;
    return { start: { line: cursor.line, ch: cursor.ch - m[0].length }, end: cursor, query: m[1] };
  }

  async getSuggestions(context: EditorSuggestContext): Promise<SearchResult[]> {
    const api = this.api();
    this.latest = context.query;
    if (!api || context.query.trim().length < 2) return [];
    await wait(DEBOUNCE_MS);
    if (context.query !== this.latest) return [];
    try {
      return await api.search(context.query.trim(), "picker", 10);
    } catch {
      return [];
    }
  }

  renderSuggestion(r: SearchResult, el: HTMLElement): void {
    renderCard(el, r.item.title, r.match.snippet);
  }

  selectSuggestion(r: SearchResult): void {
    const ctx = this.context;
    if (!ctx) return;
    ctx.editor.replaceRange(this.insert(r), ctx.start, ctx.end);
  }
}

/** A question with buttons; resolves with the chosen value, or null if closed. */
export function ask<T>(app: App, title: string, lines: string[], choices: { label: string; value: T; cta?: boolean }[]):
  Promise<T | null> {
  return new Promise((resolve) => {
    let answered = false;
    const modal = new Modal(app);
    modal.setTitle(title);
    for (const line of lines) modal.contentEl.createEl("p", { text: line });
    const row = new Setting(modal.contentEl);
    for (const c of choices) {
      row.addButton((b) => {
        b.setButtonText(c.label).onClick(() => {
          answered = true;
          resolve(c.value);
          modal.close();
        });
        if (c.cta) b.setCta();
      });
    }
    modal.onClose = () => {
      if (!answered) resolve(null);
    };
    modal.open();
  });
}

/** A box for a question; resolves with what was typed, or null if closed. */
export function askQuestion(app: App): Promise<string | null> {
  return new Promise((resolve) => {
    let asked = false;
    const modal = new Modal(app);
    modal.setTitle("Ask Caute");
    modal.contentEl.createEl("p", { cls: "caute-pane-note",
      text: "Answered from what you've caught, with every claim linked to its card. The answer is saved as a note in this vault." });
    const input = modal.contentEl.createEl("textarea", {
      cls: "caute-question", attr: { rows: "3", placeholder: "Your question", "aria-label": "Your question" },
    });
    const go = () => {
      const q = input.value.trim();
      if (q.length < 3) return;
      asked = true;
      resolve(q);
      modal.close();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        go();
      }
    });
    new Setting(modal.contentEl).addButton((b) => b.setButtonText("Ask").setCta().onClick(go));
    modal.onClose = () => {
      if (!asked) resolve(null);
    };
    modal.open();
    window.setTimeout(() => input.focus(), 0);
  });
}
