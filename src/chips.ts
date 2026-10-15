/**
 * Card links rendered as chips (DESIGN.md 22.3, "Render the chip").
 *
 * Previews come from `preview:batch`, a hundred at a time, and are kept for a
 * few minutes. A card this connection can't read comes back "unavailable",
 * exactly as a deleted one does, and its chip says "Unavailable" and nothing
 * else (INV-43). Titles and the rest are saved content, so they only ever go
 * into text nodes (INV-19).
 */

import { Prec, RangeSetBuilder, StateEffect } from "@codemirror/state";
import {
  Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate,
} from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import type { Caute, Preview } from "./api";
import { cardIdOf, findCardLinks } from "./links";
import { hueOf } from "./plate";

const TTL_MS = 5 * 60_000;
const BATCH = 100;

export class PreviewCache {
  private kept = new Map<string, { preview: Preview; at: number }>();
  private wanted = new Set<string>();
  private inFlight = new Set<string>();
  private timer: number | null = null;
  private listeners = new Set<() => void>();

  constructor(private api: () => Caute | null) {}

  /** The preview if there is a fresh one; otherwise null, and it is fetched. */
  get(id: string): Preview | null {
    const hit = this.kept.get(id);
    if (!hit || Date.now() - hit.at > TTL_MS) this.want(id);
    return hit?.preview ?? null;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.kept.clear();
    this.notify();
  }

  private want(id: string): void {
    if (this.inFlight.has(id)) return;
    this.wanted.add(id);
    this.timer ??= window.setTimeout(() => void this.flush(), 30);
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const api = this.api();
    const ids = [...this.wanted];
    this.wanted.clear();
    if (!api || ids.length === 0) return;
    ids.forEach((id) => this.inFlight.add(id));
    try {
      for (let i = 0; i < ids.length; i += BATCH) {
        const previews = await api.previews(ids.slice(i, i + BATCH));
        const now = Date.now();
        for (const p of previews) this.kept.set(p.id.toLowerCase(), { preview: p, at: now });
      }
      this.notify();
    } catch {
      // Signed out or offline: links stay plain links until it can ask again.
    } finally {
      ids.forEach((id) => this.inFlight.delete(id));
    }
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }
}

const KIND_LABELS: Record<string, string> = {
  web_page: "Page", document: "Document", image: "Image", audio: "Audio", video: "Video", email: "Email",
  note: "Note", text: "Text", agent_conversation: "Conversation", archive: "Archive",
};

/** Fill `el` as a chip for this preview. Text nodes only. */
export function fillChip(el: HTMLElement, preview: Preview): void {
  el.empty();
  el.addClass("caute-chip");
  if (preview.status !== "available") {
    el.addClass("caute-chip-unavailable");
    el.createSpan({ cls: "caute-chip-title", text: "Unavailable" });
    el.setAttribute("aria-label", "Unavailable Caute card");
    return;
  }
  const title = preview.title?.trim() || "Untitled card";
  const dot = el.createSpan({ cls: "caute-chip-dot" });
  dot.setCssProps({ "--caute-hue": String(hueOf(title)) });
  el.createSpan({ cls: "caute-chip-title", text: title });
  const meta = [KIND_LABELS[preview.kind ?? ""] ?? preview.kind, privacyLabel(preview)].filter(Boolean).join(" · ");
  if (meta) el.createSpan({ cls: "caute-chip-meta", text: meta });
  el.setAttribute("aria-label", `${title}, in Caute`);
}

function privacyLabel(p: Preview): string {
  if (!p.privacy) return "";
  return p.privacy.visibility === "private" ? "Private" : p.privacy.name;
}

/** Reading view: links to cards become chips that still open the card. */
export function chipPostProcessor(cache: PreviewCache, appUrl: () => string) {
  return (el: HTMLElement) => {
    const anchors = Array.from(el.querySelectorAll<HTMLAnchorElement>("a.external-link, a[href]"));
    for (const a of anchors) {
      const href = a.getAttribute("href") ?? "";
      const id = cardIdOf(href, appUrl());
      if (!id) continue;
      const render = () => {
        const p = cache.get(id);
        if (p) fillChip(a, p);
      };
      render();
      if (!a.hasClass("caute-chip")) {
        const off = cache.onChange(() => {
          if (!a.isConnected) return off();
          render();
          if (a.hasClass("caute-chip")) off();
        });
      }
    }
  };
}

class ChipWidget extends WidgetType {
  constructor(readonly preview: Preview, readonly url: string) {
    super();
  }

  eq(other: ChipWidget): boolean {
    return other.url === this.url && other.preview.status === this.preview.status
      && other.preview.title === this.preview.title && other.preview.kind === this.preview.kind;
  }

  toDOM(): HTMLElement {
    const a = createEl("a", {
      cls: "external-link", href: this.url, attr: { target: "_blank", rel: "noopener" },
    });
    fillChip(a, this.preview);
    return a;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const refreshChips = StateEffect.define<null>();

/**
 * Live Preview: a card link the cursor isn't in shows as a chip; moving into
 * it shows the Markdown again, as Obsidian does for its own links.
 */
export function chipViewPlugin(cache: PreviewCache, appUrl: () => string) {
  // Highest precedence, or Obsidian's own decorations for a `[text](url)` link,
  // which hide its brackets and address, win over the chip and leave only an icon.
  return Prec.highest(ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    private off: () => void;

    constructor(readonly view: EditorView) {
      this.decorations = this.build();
      this.off = cache.onChange(() => view.dispatch({ effects: refreshChips.of(null) }));
    }

    update(u: ViewUpdate): void {
      const refreshed = u.transactions.some((t) => t.effects.some((e) => e.is(refreshChips)));
      const modeChanged = u.startState.field(editorLivePreviewField, false)
        !== u.state.field(editorLivePreviewField, false);
      if (u.docChanged || u.viewportChanged || u.selectionSet || refreshed || modeChanged) {
        this.decorations = this.build();
      }
    }

    destroy(): void {
      this.off();
    }

    private build(): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const view = this.view;
      if (!view.state.field(editorLivePreviewField, false)) return builder.finish();
      const selection = view.state.selection.ranges;
      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        for (const link of findCardLinks(text, appUrl())) {
          const start = from + link.from;
          const end = from + link.to;
          if (selection.some((r) => r.from <= end && r.to >= start)) continue;
          const preview = cache.get(link.id);
          if (!preview) continue;
          builder.add(start, end, Decoration.replace({ widget: new ChipWidget(preview, link.url) }));
        }
      }
      return builder.finish();
    }
  }, { decorations: (v) => v.decorations }));
}
