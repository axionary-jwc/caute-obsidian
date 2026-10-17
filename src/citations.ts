/**
 * Citations from a card's properties (ADR 0132, W7): a draft full of card
 * links becomes one with footnotes, or gains a list of its sources. One plain
 * author-year style, the one the DOI processor writes
 * (`docs/integrations/processors/doi/`): `Authors (Year). Title. Venue.
 * https://doi.org/<doi>`. CSL styles can come later.
 *
 * Only confirmed properties are on a card (INV-50), and they are still the
 * library's words, so every one is defanged on its way into the note (INV-19).
 * A card the person can't open says only that (INV-43).
 */

import { defang } from "./defang";
import { findCardLinks, linkLabel, type CardLink } from "./links";

/** What a citation is made from: a card as `GET /v1/items/{id}` returns it, or null when it can't be opened. */
export interface Citable {
  title: string | null;
  captured_at: string;
  properties?: { key: string; value: unknown; state?: string }[];
}

function prop(card: Citable, key: string): unknown {
  return card.properties?.find((p) => p.key === key && (p.state ?? "confirmed") === "confirmed")?.value;
}

function text(v: unknown): string {
  return typeof v === "string" || typeof v === "number" ? defang(String(v).replace(/\s+/g, " ").trim()) : "";
}

/** One line of citation, without the card link. */
export function citation(card: Citable | null): string {
  if (!card) return "A card in Caute that isn't available.";
  const raw = prop(card, "authors");
  const authors = (Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []).map(text).filter(Boolean);
  const year = text(prop(card, "year"));
  const title = text(prop(card, "title")) || text(card.title) || "Untitled";
  const venue = text(prop(card, "venue"));
  const doi = text(prop(card, "doi")).replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  if (!authors.length && !year && !venue && !doi) {
    const caught = new Date(card.captured_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    return `${title}. Caught ${caught}.`;
  }
  const who = authors.slice(0, 3).join(", ") + (authors.length > 3 ? " and others" : "");
  const head = [who, year ? `(${year}).` : who ? "." : ""].filter(Boolean).join(" ").replace(/ \.$/, ".");
  const rest = [title, venue].filter(Boolean).map((p) => `${p}.`).join(" ");
  return [head, rest, doi ? `https://doi.org/${doi}` : ""].filter(Boolean).join(" ");
}

/** A citation and the card link after it. */
export function entry(card: Citable | null, url: string): string {
  return `${citation(card)} [In Caute](${url})`;
}

/** The card links a note cites, leaving out ones in footnote definitions already there. */
export function citedLinks(note: string, appUrl: string): CardLink[] {
  const definitions: [number, number][] = [];
  for (const m of note.matchAll(/^\[\^[^\]\n]+\]:.*$/gm)) definitions.push([m.index, m.index + m[0].length]);
  return findCardLinks(note, appUrl).filter((l) => !definitions.some(([a, b]) => l.from >= a && l.from < b));
}

/**
 * The note with each card link turned into a footnote: a link whose words are
 * the card's own title becomes just the marker, any other keeps its words with
 * the marker after them, and the same link twice is the same footnote. New
 * footnotes are numbered after any already in the note.
 */
export function toFootnotes(note: string, appUrl: string, cards: Map<string, Citable | null>): string {
  const links = citedLinks(note, appUrl);
  if (!links.length) return note;
  let next = Math.max(0, ...[...note.matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1]))) + 1;
  const numbers = new Map<string, number>();
  let out = "";
  let at = 0;
  for (const l of links) {
    let n = numbers.get(l.url);
    if (n === undefined) {
      n = next++;
      numbers.set(l.url, n);
    }
    const card = cards.get(l.id) ?? null;
    // A link whose words are the card's own name, as the picker and Ask write
    // them, is only a pointer, so the footnote marker takes its place.
    const names = card ? [linkLabel(card.title), linkLabel(typeof prop(card, "title") === "string" ? (prop(card, "title") as string) : "")] : [];
    const own = l.label === null || names.includes(l.label.trim());
    let before = note.slice(at, l.from);
    if (own) before = before.replace(/[ \t]+$/, "");
    out += before + (own ? `[^${n}]` : `${l.label}[^${n}]`);
    at = l.to;
  }
  out += note.slice(at);
  const defs = [...numbers].map(([url, n]) => {
    const link = links.find((l) => l.url === url)!;
    return `[^${n}]: ${entry(cards.get(link.id) ?? null, url)}`;
  });
  return `${out.replace(/\s*$/, "")}\n\n${defs.join("\n")}\n`;
}

/** A list of the cards a note cites, one entry per card, in the order first cited. */
export function sourcesList(note: string, appUrl: string, cards: Map<string, Citable | null>): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  // Every card link counts here, footnotes included: a list is often added after them.
  for (const l of findCardLinks(note, appUrl)) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    lines.push(`- ${entry(cards.get(l.id) ?? null, l.url.replace(/#.*$/, ""))}`);
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}
