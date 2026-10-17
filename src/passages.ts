/**
 * Passages for the Caute pane (ADR 0132, W3): what related, search and the
 * person's highlights return, in one shape, and the pure work around them —
 * finding the paragraph being written, saying where a passage is, narrowing a
 * quote to part of it, and building the quote. The pane (`pane.ts`) draws
 * these; nothing here touches Obsidian.
 */

import type { Highlight, RelatedItem, SearchResult } from "./api";
import { cardUrl } from "./links";
import { anchorFragment, markdownQuote } from "./quote";

export interface Passage {
  /** Unique within one list. */
  key: string;
  itemId: string;
  title: string;
  kind: string;
  capturedAt: string;
  text: string;
  anchor: Record<string, unknown>;
  highlighted: boolean;
  /**
   * Whether `text` is exactly the card's text at the anchor's range, so a
   * part of it can be quoted with a range of its own. Related passages are
   * (ADR 0133); a search snippet or a highlight's excerpt may be cut short.
   */
  exact: boolean;
}

export function fromRelated(rows: RelatedItem[]): Passage[] {
  return rows.map((r, n) => ({
    key: `r${n}`, itemId: r.item.id, title: r.item.title?.trim() || "Untitled card", kind: r.item.kind,
    capturedAt: r.item.captured_at, text: (r.passage?.text ?? r.snippet).trim(),
    anchor: r.passage?.anchor ?? {}, highlighted: r.passage?.highlighted ?? false,
    exact: Boolean(r.passage && typeof r.passage.anchor.char_start === "number"),
  }));
}

export function fromSearch(rows: SearchResult[]): Passage[] {
  return rows.map((r, n) => ({
    key: `s${n}`, itemId: r.item.id, title: r.item.title?.trim() || "Untitled card", kind: r.item.kind,
    capturedAt: r.item.captured_at, text: r.match.snippet.trim(), anchor: r.match.anchor ?? {},
    highlighted: false, exact: false,
  }));
}

export function fromHighlights(rows: Highlight[]): Passage[] {
  return rows.map((h) => ({
    key: `h${h.id}`, itemId: h.item_id, title: h.title?.trim() || "Untitled card", kind: h.kind,
    capturedAt: h.captured_at, text: h.excerpt.trim(), anchor: h.anchor ?? {}, highlighted: true, exact: false,
  }));
}

/** The person's own highlights first, otherwise in the order Caute gave. */
export function sortPassages(list: Passage[]): Passage[] {
  return [...list.filter((p) => p.highlighted), ...list.filter((p) => !p.highlighted)];
}

/** Where a passage is, in a few characters: "p. 4", "12:34", "ch. 3". */
export function whereIs(anchor: Record<string, unknown>): string {
  if (typeof anchor.page === "number") return `p. ${anchor.page}`;
  if (typeof anchor.t_start === "number") return clock(anchor.t_start);
  if (typeof anchor.chapter === "number") return `ch. ${anchor.chapter}`;
  if (typeof anchor.chapter === "string" && anchor.chapter) return anchor.chapter;
  return "";
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** Code points in a string: Caute's offsets count them (ADR 0051), JavaScript counts UTF-16 units. */
function codePoints(s: string): number {
  return Array.from(s).length;
}

/**
 * Part of a passage, chosen by selecting it: the words, and for an exact
 * passage its own range. `from` and `to` are UTF-16 offsets into `p.text`,
 * as a DOM selection gives them; this is the one place they become code
 * points. Surrounding whitespace is left out of both.
 */
export function narrow(p: Passage, from: number, to: number): Passage {
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(p.text.length, Math.max(from, to));
  let start = a;
  let end = b;
  while (start < end && /\s/.test(p.text[start])) start++;
  while (end > start && /\s/.test(p.text[end - 1])) end--;
  if (end <= start) return p;
  const text = p.text.slice(start, end);
  if (!p.exact || typeof p.anchor.char_start !== "number") return { ...p, text };
  const base = p.anchor.char_start;
  return {
    ...p, text,
    anchor: { ...p.anchor, char_start: base + codePoints(p.text.slice(0, start)),
              char_end: base + codePoints(p.text.slice(0, end)) },
  };
}

/** The Markdown quote of a passage, defanged, with a link that marks it (ADR 0133). */
export function quotePassage(p: Passage, appUrl: string): string {
  return `\n${markdownQuote({
    text: p.text, sourceTitle: p.title,
    sourceUrl: cardUrl(appUrl, p.itemId, anchorFragment(p.anchor)), capturedAt: p.capturedAt,
  })}`;
}

/**
 * The paragraph the cursor is in, as it should be sent to Caute: the lines
 * around it up to a blank line, a heading or a fence, with list and quote
 * markers taken off. Nothing in front matter or a code block is a paragraph,
 * and neither is a heading.
 */
export function paragraphAt(lines: string[], at: number): string {
  if (at < 0 || at >= lines.length) return "";
  const front = frontMatterEnd(lines);
  if (at <= front) return "";
  // Inside a code block when an odd number of fences come before the cursor.
  let fenced = false;
  for (let n = front + 1; n < at; n++) if (FENCE.test(lines[n])) fenced = !fenced;
  if (fenced) return "";
  const stops = (n: number) => lines[n].trim() === "" || HEADING.test(lines[n]) || FENCE.test(lines[n]);
  if (stops(at)) return "";
  let first = at;
  let last = at;
  while (first > front + 1 && !stops(first - 1)) first--;
  while (last < lines.length - 1 && !stops(last + 1)) last++;
  return lines.slice(first, last + 1)
    .map((l) => l.replace(/^\s*(>\s?)+/, "").replace(/^\s*([-*+]|\d+[.)])\s+(\[.\]\s+)?/, "").trim())
    .filter(Boolean)
    .join("\n");
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s*#{1,6}\s/;

/** The index of front matter's closing line, or -1 when there is none. */
function frontMatterEnd(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return -1;
  for (let n = 1; n < lines.length; n++) if (lines[n].trim() === "---") return n;
  return -1;
}

/** At least this many characters, or Caute has nothing to go on. */
export const SHORTEST_PARAGRAPH = 12;
