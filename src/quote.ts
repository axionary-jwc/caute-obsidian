/**
 * The Markdown quote, the same one the web app builds in
 * `web/src/lib/quote.ts` (DESIGN.md 22.3). It says where it came from in its
 * own text: the quote, then the source's title, its card link with an anchor,
 * and when it was caught. Change the rules there first; a test checks the two
 * agree.
 */

export interface QuotePayload {
  text: string;
  sourceTitle: string;
  /** Canonical card URL with anchor, e.g. https://app.getcaute.com/c/<id>#page=4 */
  sourceUrl: string;
  capturedAt: string;
}

export function anchorFragment(anchor: Record<string, unknown> | undefined | null): string {
  if (!anchor) return "";
  if (typeof anchor.page === "number") return `#page=${anchor.page}`;
  if (typeof anchor.t_start === "number") return `#t=${Math.floor(anchor.t_start)}`;
  if (typeof anchor.char_start === "number") return `#char=${anchor.char_start}`;
  return "";
}

export function markdownQuote(p: QuotePayload): string {
  const quoted = p.text
    .trim()
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  const date = new Date(p.capturedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const title = p.sourceTitle.replace(/[[\]]/g, "");
  return `${quoted}\n>\n> — [${title}](${p.sourceUrl}), captured ${date}\n`;
}
