/**
 * Publishing a note to Caute (DESIGN.md 22.3, "Publish a page"). The note is
 * sent as text with an `external_id`, so publishing it again with changes
 * makes a new version of the same card (section 6.9), and publishing it
 * unchanged is a duplicate that changes nothing.
 *
 * The id lives in the note's own properties as `caute_id`, never its path,
 * which would break on rename. It is written only after saying so.
 */

export const ID_PROPERTY = "caute_id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The note's publishing id from its properties, if it has a usable one. */
export function publishId(frontmatter: Record<string, unknown> | null | undefined): string | null {
  const v = frontmatter?.[ID_PROPERTY];
  return typeof v === "string" && UUID.test(v.trim()) ? v.trim().toLowerCase() : null;
}

export function externalId(id: string): string {
  return `obsidian:${id}`;
}

/**
 * What is published: the note without its properties block, which holds
 * `caute_id` and whatever else the person keeps there for Obsidian.
 */
export function publishedBody(markdown: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
  return (m ? markdown.slice(m[0].length) : markdown).replace(/^\s*\n/, "");
}

export interface PublishRequest {
  text: string;
  title: string;
  source: "api";
  context: { source_app: "obsidian" };
  external_id: string;
  replace_earlier?: boolean;
}

export function publishRequest(p: { body: string; title: string; id: string; replaceEarlier?: boolean }):
  PublishRequest {
  return {
    text: p.body, title: p.title, source: "api", context: { source_app: "obsidian" },
    external_id: externalId(p.id), ...(p.replaceEarlier ? { replace_earlier: true } : {}),
  };
}
