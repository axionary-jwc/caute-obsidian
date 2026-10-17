/**
 * The Caute pane (ADR 0132, W3): the library beside the editor. Three tabs —
 * sources for the paragraph being written, search, and the person's own
 * highlights — each a list of passages to quote, drag or open.
 *
 * Nothing is sent while the person types (DESIGN.md 22.3): For this paragraph
 * fills only from the command or the pane's button, and says so in the status
 * bar. Everything from Caute is set as text, never as HTML, and every quote is
 * defanged on its way into the note (INV-19).
 */

import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { CauteError, type Caute } from "./api";
import { cardUrl, markdownLink } from "./links";
import { hueOf } from "./plate";
import { anchorFragment } from "./quote";
import {
  SHORTEST_PARAGRAPH, fromHighlights, fromRelated, fromSearch, narrow, quotePassage, sortPassages, whereIs,
  type Passage,
} from "./passages";

export const PANE = "caute-pane";

type Tab = "paragraph" | "search" | "highlights";

/** What the pane needs from the plugin. */
export interface PaneHost {
  api(): Caute | null;
  appUrl(): string;
  /** The paragraph at the cursor of the last editor used, or "" when there is none. */
  paragraph(): string;
  /** Put text at the cursor of the last editor used; false when there is none. */
  insert(text: string): boolean;
  /** Say something in the status bar for a few seconds. */
  status(text: string): void;
}

const KINDS: Record<string, string> = {
  web_page: "Page", document: "Document", image: "Image", audio: "Audio", video: "Video", email: "Email",
  note: "Note", text: "Text", agent_conversation: "Conversation", archive: "Archive",
};

const DEBOUNCE_MS = 300;

export class CautePane extends ItemView {
  private tab: Tab = "paragraph";
  private passages: Passage[] = [];
  private message = "Click in a paragraph, then press Use this paragraph or run Find sources for this paragraph.";
  private query = "";
  private timer: number | null = null;
  private asked = 0;
  private listEl!: HTMLElement;
  private tabsEl!: HTMLElement;
  private toolsEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private host: PaneHost) {
    super(leaf);
  }

  getViewType(): string {
    return PANE;
  }

  getDisplayText(): string {
    return "Caute";
  }

  getIcon(): string {
    return "quote";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("caute-pane");
    this.tabsEl = root.createDiv({ cls: "caute-pane-tabs", attr: { role: "tablist" } });
    this.toolsEl = root.createDiv({ cls: "caute-pane-tools" });
    this.listEl = root.createDiv({ cls: "caute-pane-list", attr: { role: "list" } });
    this.listEl.addEventListener("keydown", (e) => this.onKey(e));
    this.draw();
  }

  async onClose(): Promise<void> {
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  /** Send the paragraph at the cursor and show what Caute finds for it. */
  async findSources(paragraph = this.host.paragraph()): Promise<void> {
    this.tab = "paragraph";
    if (paragraph.trim().length < SHORTEST_PARAGRAPH) {
      this.show([], "Click in a paragraph with a few words in it first.");
      return;
    }
    await this.fetchInto(async (api) => {
      const rows = await api.related(paragraph, 8, 2);
      this.host.status("Sent this paragraph to Caute");
      return { list: sortPassages(fromRelated(rows)), empty: "Nothing you've caught is close to this paragraph." };
    }, "search");
  }

  private async fetchInto(fetch: (api: Caute) => Promise<{ list: Passage[]; empty: string }>, scope: string):
    Promise<void> {
    const api = this.host.api();
    if (!api) {
      this.show([], "Sign in to Caute in the plugin's settings first.");
      return;
    }
    const ticket = ++this.asked;
    this.show(this.passages, "Asking Caute…", true);
    try {
      const { list, empty } = await fetch(api);
      if (ticket === this.asked) this.show(list, list.length ? "" : empty);
    } catch (e) {
      if (ticket !== this.asked) return;
      const said = e instanceof CauteError && e.code === "insufficient_scope"
        ? `This connection to Caute needs the ${scope} permission. Sign in again, or use a token that has it.`
        : e instanceof CauteError ? e.message : "Something went wrong talking to Caute.";
      this.show([], said);
    }
  }

  private show(list: Passage[], message: string, busy = false): void {
    this.passages = list;
    this.message = message;
    this.draw(busy);
  }

  private switchTo(tab: Tab): void {
    if (tab === this.tab) return;
    this.tab = tab;
    this.query = "";
    this.asked++;
    this.passages = [];
    this.message = tab === "paragraph"
      ? "Click in a paragraph, then press Use this paragraph or run Find sources for this paragraph."
      : tab === "search" ? "Type to search your Caute library." : "";
    this.draw();
    if (tab === "highlights") void this.loadHighlights();
  }

  private loadHighlights(): Promise<void> {
    const q = this.query;
    return this.fetchInto(async (api) => ({
      list: fromHighlights(await api.highlights(q)),
      empty: q ? "None of your highlights has those words." : "You haven't highlighted anything in Caute yet.",
    }), "items:read");
  }

  private searchSoon(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (this.tab === "highlights") {
        void this.loadHighlights();
        return;
      }
      const q = this.query.trim();
      if (q.length < 2) {
        this.show([], "Type to search your Caute library.");
        return;
      }
      void this.fetchInto(async (api) => ({
        list: fromSearch(await api.search(q, "search", 20)),
        empty: "Nothing you've caught matches that.",
      }), "search");
    }, DEBOUNCE_MS);
  }

  // --- drawing -------------------------------------------------------------

  private draw(busy = false): void {
    this.drawTabs();
    this.drawTools();
    const list = this.listEl;
    list.empty();
    list.toggleClass("is-busy", busy);
    if (this.message) list.createDiv({ cls: "caute-pane-message", text: this.message, attr: { role: "status" } });
    if (busy && !this.passages.length) return;
    this.passages.forEach((p, n) => this.drawPassage(list, p, n));
  }

  private drawTabs(): void {
    const tabs = this.tabsEl;
    tabs.empty();
    const names: [Tab, string][] = [["paragraph", "For this paragraph"], ["search", "Search"], ["highlights", "Highlights"]];
    for (const [tab, name] of names) {
      const b = tabs.createEl("button", {
        cls: "caute-pane-tab", text: name,
        attr: { role: "tab", "aria-selected": String(tab === this.tab) },
      });
      if (tab === this.tab) b.addClass("is-active");
      b.addEventListener("click", () => this.switchTo(tab));
    }
  }

  private drawTools(): void {
    const tools = this.toolsEl;
    tools.empty();
    if (this.tab === "paragraph") {
      const use = tools.createEl("button", { cls: "mod-cta", text: "Use this paragraph" });
      use.addEventListener("click", () => void this.findSources());
      tools.createDiv({ cls: "caute-pane-note",
        text: "Sends the paragraph your cursor is in to Caute, and nothing else." });
      return;
    }
    const input = tools.createEl("input", {
      type: "search", value: this.query,
      attr: { placeholder: this.tab === "search" ? "Search your library" : "Find in your highlights",
              "aria-label": this.tab === "search" ? "Search your Caute library" : "Find in your highlights" },
    });
    input.addEventListener("input", () => {
      this.query = input.value;
      this.searchSoon();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.focusItem(0);
      }
    });
    window.setTimeout(() => input.focus(), 0);
  }

  private drawPassage(list: HTMLElement, p: Passage, n: number): void {
    const row = list.createDiv({ cls: "caute-passage", attr: { role: "listitem", tabindex: "0",
      "data-index": String(n), "aria-label": `${p.title}${whereIs(p.anchor) ? `, ${whereIs(p.anchor)}` : ""}. ` +
        "Press Enter to quote it." } });
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", quotePassage(this.part(p, row), this.host.appUrl()));
    });

    const head = row.createDiv({ cls: "caute-passage-head" });
    head.createSpan({ cls: "caute-chip-dot" }).setCssProps({ "--caute-hue": String(hueOf(p.title)) });
    head.createSpan({ cls: "caute-passage-title", text: p.title });
    const meta = [KINDS[p.kind] ?? "", whereIs(p.anchor)].filter(Boolean).join(" · ");
    if (meta) head.createSpan({ cls: "caute-passage-meta", text: meta });
    if (p.highlighted) {
      const mark = head.createSpan({ cls: "caute-passage-highlighted", attr: { "aria-label": "You highlighted this" } });
      setIcon(mark, "highlighter");
    }

    const words = row.createDiv({ cls: "caute-passage-text", text: p.text });

    const actions = row.createDiv({ cls: "caute-passage-actions" });
    const button = (label: string, run: () => void) => {
      const b = actions.createEl("button", { text: label });
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        run();
      });
    };
    button("Insert quote", () => this.insertQuote(p, row));
    button("Insert link", () => this.insertText(markdownLink(p.title, this.link(p))));
    const open = actions.createEl("a", { text: "Open in Caute", href: this.link(p), cls: "caute-passage-open" });
    open.addEventListener("click", (e) => e.stopPropagation());
    words.addEventListener("click", () => row.toggleClass("is-open", !row.hasClass("is-open")));
  }

  private link(p: Passage): string {
    return cardUrl(this.host.appUrl(), p.itemId, anchorFragment(p.anchor));
  }

  /** The passage, or the part of it the person selected in this row. */
  private part(p: Passage, row: HTMLElement): Passage {
    const sel = window.getSelection();
    const words = row.querySelector(".caute-passage-text");
    const text = words?.firstChild;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !text) return p;
    const range = sel.getRangeAt(0);
    if (range.startContainer !== text || range.endContainer !== text) return p;
    return narrow(p, range.startOffset, range.endOffset);
  }

  private insertQuote(p: Passage, row: HTMLElement): void {
    this.insertText(quotePassage(this.part(p, row), this.host.appUrl()));
  }

  private insertText(text: string): void {
    if (!this.host.insert(text)) this.host.status("Open a note to put this in first");
  }

  // --- keyboard ------------------------------------------------------------

  private focusItem(n: number): void {
    const rows = this.listEl.querySelectorAll<HTMLElement>(".caute-passage");
    rows[Math.max(0, Math.min(n, rows.length - 1))]?.focus();
  }

  private onKey(e: KeyboardEvent): void {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".caute-passage");
    if (!row || e.target !== row) return;
    const n = Number(row.dataset.index);
    if (e.key === "ArrowDown") this.focusItem(n + 1);
    else if (e.key === "ArrowUp") this.focusItem(n - 1);
    else if (e.key === "Enter") this.insertQuote(this.passages[n], row);
    else return;
    e.preventDefault();
  }
}
