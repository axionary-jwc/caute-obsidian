/**
 * The Markdown quote, the same one the web app builds in
 * `web/src/lib/quote.ts` (DESIGN.md 22.3). It says where it came from in its
 * own text: the quote, then the source's title, its card link with an anchor,
 * and when it was caught. Change the rules there first; a test checks the two
 * agree. The one difference: the plugin defangs the words and the title
 * first, so nothing quoted can run in the vault (ADR 0132).
 */

import { defang } from "./defang";

export interface QuotePayload {
  text: string;
  sourceTitle: string;
  /** Canonical card URL with anchor, e.g. https://app.getcaute.com/c/<id>#page=4 */
  sourceUrl: string;
  capturedAt: string;
}

/**
 * The fragment a card link carries: `#page=`, `#t=` and `#char=`, joined with
 * `&`. The shared cases are `docs/anchor-vectors/anchors.json`.
 */
export function anchorFragment(anchor: Record<string, unknown> | undefined | null): string {
  if (!anchor) return "";
  const parts: string[] = [];
  if (typeof anchor.page === "number") parts.push(`page=${anchor.page}`);
  else if (typeof anchor.t_start === "number") parts.push(`t=${Math.floor(anchor.t_start)}`);
  if (typeof anchor.char_start === "number") {
    // A range marks the words themselves (ADR 0133); a start alone, as links
    // made before ranges, still lands (INV-43). Code points, ADR 0051.
    const end = anchor.char_end;
    parts.push(typeof end === "number" && end > anchor.char_start ? `char=${anchor.char_start}-${end}` : `char=${anchor.char_start}`);
  }
  return parts.length ? `#${parts.join("&")}` : "";
}

export function markdownQuote(p: QuotePayload): string {
  const quoted = defang(p.text)
    .trim()
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  const date = new Date(p.capturedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const title = defang(p.sourceTitle.replace(/[[\]]/g, ""));
  return `${quoted}\n>\n> — [${title}](${p.sourceUrl}), captured ${date}\n`;
}
