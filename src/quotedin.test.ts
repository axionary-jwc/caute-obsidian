import { describe, expect, it } from "vitest";
import { cardsIn, gone, noteAt, pointerFor, type Registry } from "./quotedin";

const APP = "https://app.getcaute.com";
const A = "0190f3a2-0000-7000-8000-00000000000a";
const B = "0190f3a2-0000-7000-8000-00000000000b";
const NOTE = "0190f3a2-7c1d-7e4b-9a10-3f2e1d0c9b8a";

describe("quoted in", () => {
  it("points at a note by its id and nothing else", () => {
    expect(pointerFor(NOTE)).toBe(`obsidian://caute-note?id=${NOTE}`);
    // The backend's shape for an Obsidian pointer (companion.py _APP_REF).
    expect(pointerFor(NOTE)).toMatch(/^obsidian:\/\/caute-note\?id=[0-9a-f-]{36}$/);
  });

  it("finds each card a quote links to once", () => {
    const quote = `> words\n>\n> — [Title](${APP}/c/${A}#t=5&char=1-9), captured Oct 1\n\nand [again](${APP}/c/${A}) and ${APP}/c/${B}`;
    expect(cardsIn(quote, APP)).toEqual([A, B]);
  });

  it("knows which pointers go when their links are gone", () => {
    const entry = { path: "Draft.md", refs: { [A]: "ref-a", [B]: "ref-b" } };
    expect(gone(entry, `Only [this](${APP}/c/${B}) is left.`, APP)).toEqual([A]);
    expect(gone(entry, "Nothing left.", APP)).toEqual([A, B]);
  });

  it("finds a note by where it is now", () => {
    const registry: Registry = { [NOTE]: { path: "Research/Draft.md", refs: {} } };
    expect(noteAt(registry, "Research/Draft.md")).toBe(NOTE);
    expect(noteAt(registry, "Elsewhere.md")).toBeNull();
  });
});
