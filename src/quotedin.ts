/**
 * "Quoted in" (ADR 0134): with the person's say-so, each card quoted or linked
 * from a note learns that this note points at it, so rereading the card in
 * Caute shows the notes that use it. What Caute keeps is an opaque pointer,
 * `obsidian://caute-note?id=<caute_id>`: the note's own id from its front
 * matter, never its vault, path, title or text (INV-44). The plugin opens it
 * through the `caute-note` protocol handler.
 *
 * The record of what was registered (note id to card ids and their pointer
 * ids) holds no secret, so it lives in the plugin's data file.
 */

import { findCardLinks } from "./links";

export const POINTER_ACTION = "caute-note";

export function pointerFor(noteId: string): string {
  return `obsidian://${POINTER_ACTION}?id=${noteId}`;
}

/** One note's pointers: where the note is now, and each card it points at with the pointer's id in Caute. */
export interface NoteRefs {
  path: string;
  refs: Record<string, string>;
}

export type Registry = Record<string, NoteRefs>;

/** The cards a piece of text links to, each once. */
export function cardsIn(text: string, appUrl: string): string[] {
  return [...new Set(findCardLinks(text, appUrl).map((l) => l.id))];
}

/** Which registered cards a note no longer links to, so their pointers go. */
export function gone(entry: NoteRefs, note: string, appUrl: string): string[] {
  const still = new Set(cardsIn(note, appUrl));
  return Object.keys(entry.refs).filter((card) => !still.has(card));
}

/** The note id a path is registered under, if any. */
export function noteAt(registry: Registry, path: string): string | null {
  return Object.keys(registry).find((id) => registry[id].path === path) ?? null;
}
