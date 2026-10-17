/**
 * Ask Caute, answered in the vault (ADR 0132, W6): an answer becomes a note,
 * every citation a card link with its anchor. The rewrite of `[n]` markers is
 * the web's `components/Answer.tsx::asMarkdown`, with links to the card's
 * address rather than `card:` mentions; a test checks the two agree.
 *
 * The answer is model text written from saved content, so it is untrusted
 * twice over (INV-19). Before it becomes a note it loses links, `card:`
 * references, bare addresses and hashtags, as a brief's text does (ADR 0106),
 * and is then defanged so nothing in it can run in the vault.
 */

import type { SearchResult } from "./api";
import { defang } from "./defang";
import { cardUrl, linkLabel } from "./links";
import { anchorFragment } from "./quote";

export interface Answer {
  text: string;
  citations: { result_index: number; anchor: Record<string, unknown> }[];
  left_out?: number | null;
}

/** Model text with nothing that could link, tag or point anywhere. */
export function plainModelText(line: string): string {
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")      // Markdown links and images keep their words
    .replace(/<?(card:|https?:\/\/|www\.)[^\s>)]*>?/gi, "")
    .replace(/(^|[\s(])#(?=[^\s#])/g, "$1")         // a hashtag keeps its word
    .replace(/[ \t]{2,}/g, " ");
}

/**
 * The question as a heading and the answer under it, each `[n]` replaced by
 * `link(results[n - 1], n)`. A list item that already starts with its card's
 * title links that title instead (issue #120), as the web does.
 */
export function answerBody(answer: Answer, results: SearchResult[], question: string,
                           link: (r: SearchResult, n: number) => string): string {
  const titleOf = (n: string) => linkLabel(results[Number(n) - 1]?.item.title ?? "Untitled");
  const linked = (n: string) => {
    const result = results[Number(n) - 1];
    return result ? `[${titleOf(n)}](${link(result, Number(n))})` : "";
  };
  // Escaped by defang, so a marker reads `\[3\]` by the time it is replaced.
  const MARKER = /\\\[(\d{1,2})\\\]/g;
  const body = answer.text.split("\n").map((raw) => {
    const line = defang(plainModelText(raw));
    const item = /^- (.*?)\s*\\\[(\d{1,2})\\\]\s*$/.exec(line);
    if (item && item[1].startsWith(titleOf(item[2])) && results[Number(item[2]) - 1]) {
      return `- ${linked(item[2])}${item[1].slice(titleOf(item[2]).length)}`;
    }
    return line.replace(MARKER, (_marker, n: string) => linked(n));
  }).join("\n");
  return `# ${defang(question.trim())}\n\n${body.trim()}\n`;
}

/** Where a citation points: the anchor the answer cited, else where the result matched. */
function anchorOf(answer: Answer, r: SearchResult, n: number): Record<string, unknown> {
  return answer.citations.find((c) => c.result_index === n - 1)?.anchor ?? r.match.anchor ?? {};
}

/** The order cited results first appear in, as the web numbers its source chips. */
function citedInOrder(text: string): number[] {
  const order: number[] = [];
  for (const m of text.matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(m[1]);
    if (!order.includes(n)) order.push(n);
  }
  return order;
}

/** The whole note: when it was asked, the question, the answer, its sources, and what was left out. */
export function answerNote(answer: Answer, results: SearchResult[], question: string, appUrl: string,
                           askedOn: Date): string {
  const link = (r: SearchResult, n: number) => cardUrl(appUrl, r.item.id, anchorFragment(anchorOf(answer, r, n)));
  const parts = [
    `---\ncaute_asked: ${askedOn.toISOString().slice(0, 10)}\n---\n`,
    answerBody(answer, results, question, link),
  ];
  const sources = citedInOrder(answer.text).filter((n) => results[n - 1]);
  if (sources.length) {
    parts.push(`\n## Sources\n\n${sources.map((n) =>
      `- [${linkLabel(results[n - 1].item.title)}](${link(results[n - 1], n)})`).join("\n")}\n`);
  }
  if (answer.left_out) {
    const cards = answer.left_out === 1 ? "1 card was" : `${answer.left_out} cards were`;
    parts.push(`\n${cards} left out because their space is kept away from AI.\n`);
  }
  return parts.join("");
}

/** A file name for the note: the question, without what a file name can't hold. */
export function answerFileName(question: string): string {
  const name = question.replace(/[\\/:*?"<>|#^[\]\n\r\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).trim();
  return name || "Question";
}
