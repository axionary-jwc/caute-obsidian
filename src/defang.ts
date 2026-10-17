/**
 * Makes text from the library inert once it is in a note (INV-19 on the vault's
 * side, ADR 0132). A saved page can hold anything, and Obsidian and its common
 * plugins treat some note text as instructions: Dataview runs `dataviewjs`
 * blocks and inline `$=` code, Templater runs `<% %>`, `[[...]]` and `![[...]]`
 * link and embed, `#word` tags, `%%` hides, `key:: value` makes a field, and
 * HTML renders. Every passage, title, answer and property value the plugin
 * writes into a note goes through here first.
 *
 * Ordinary prose comes out unchanged. Where something has to be escaped it is
 * escaped the Markdown way, so it reads the same once rendered.
 */

// C0 controls but tab and newline, DEL, and the bidirectional overrides that
// can make text read differently from what it says.
// eslint-disable-next-line no-control-regex -- matching them is the point
const CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;

export function defang(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(CONTROLS, "")
    // First, so no escape below can be undone by a backslash already there.
    .replace(/\\/g, "\\\\")
    // HTML and Templater: no `<` survives in the source, so no tag and no `<%`.
    .replace(/</g, "&lt;")
    // Code spans and fences, so no `dataviewjs` block or inline `$=` query.
    .replace(/`/g, "\\`")
    .replace(/^(\s*)~~~/gm, "$1\\~~~")
    // Links, wikilinks, embeds, images, footnotes and callouts.
    .replace(/[[\]]/g, (b) => `\\${b}`)
    // Obsidian comments.
    .replace(/%%/g, "%&#37;")
    // Dataview inline fields.
    .replace(/::/g, ":\\:")
    // Tags: a `#` that starts a word.
    .replace(/(^|[\s(])#(?=[^\s#])/g, "$1\\#");
}
