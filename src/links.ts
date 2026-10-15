/**
 * Card links: `https://app.getcaute.com/c/<item_id>`, with an optional anchor
 * such as `#page=4` or `#t=754` (INV-43, DESIGN.md 22.3).
 *
 * The app's address is a setting, so a development server
 * (`http://app.caute.localhost:8000`) is recognised the same way.
 */

export interface CardLink {
  id: string;
  /** The whole URL as written, anchor included. */
  url: string;
  /** Where it sits in the text it was found in. */
  from: number;
  to: number;
  /** For `[text](url)`, the written text; null for a bare URL. */
  label: string | null;
}

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normaliseOrigin(appUrl: string): string {
  try {
    return new URL(appUrl).origin;
  } catch {
    return appUrl.replace(/\/+$/, "");
  }
}

function cardUrlPattern(appUrl: string): string {
  return `${escapeRegExp(normaliseOrigin(appUrl))}/c/(${UUID})(?:#[^\\s)\\]>]*)?`;
}

/** The card id in a URL, or null when it isn't a card link for this app. */
export function cardIdOf(url: string, appUrl: string): string | null {
  const m = new RegExp(`^${cardUrlPattern(appUrl)}$`).exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * Every card link in a piece of Markdown: `[text](url)` links first, then
 * bare URLs that aren't inside one. Images (`![...](...)`) are left alone.
 */
export function findCardLinks(text: string, appUrl: string): CardLink[] {
  const url = cardUrlPattern(appUrl);
  const found: CardLink[] = [];
  const taken: [number, number][] = [];
  const md = new RegExp(`(!?)\\[([^\\]\\n]*)\\]\\((${url})\\)`, "g");
  for (let m = md.exec(text); m; m = md.exec(text)) {
    taken.push([m.index, m.index + m[0].length]);
    if (m[1] === "!") continue; // an embed, which Obsidian draws itself
    found.push({ id: m[4].toLowerCase(), url: m[3], from: m.index, to: m.index + m[0].length, label: m[2] });
  }
  const bare = new RegExp(`<?(${url})>?`, "g");
  for (let m = bare.exec(text); m; m = bare.exec(text)) {
    const from = m.index;
    if (taken.some(([a, b]) => from >= a && from < b)) continue;
    found.push({ id: m[2].toLowerCase(), url: m[1], from, to: from + m[0].length, label: null });
  }
  return found.sort((a, b) => a.from - b.from);
}

/** The canonical link to a card, with an anchor into it when there is one. */
export function cardUrl(appUrl: string, id: string, fragment = ""): string {
  return `${normaliseOrigin(appUrl)}/c/${id}${fragment}`;
}

/**
 * Text that is safe as the label of a Markdown link: no brackets, which would
 * end the label early, and no line breaks. Titles come from saved content and
 * are not trusted (INV-19).
 */
export function linkLabel(title: string | null | undefined): string {
  const clean = (title ?? "").replace(/[[\]\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return clean || "Untitled card";
}

export function markdownLink(title: string | null | undefined, url: string): string {
  return `[${linkLabel(title)}](${url})`;
}
