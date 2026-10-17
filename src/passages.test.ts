import { describe, expect, it } from "vitest";
import type { RelatedItem } from "./api";
import { fromHighlights, fromRelated, narrow, paragraphAt, quotePassage, sortPassages, whereIs } from "./passages";

const item = { id: "0190f3a2-7c1d-7e4b-9a10-3f2e1d0c9b8a", title: "Why we sleep", kind: "audio",
               captured_at: "2026-03-14T09:00:00Z" };
const related = (text: string, anchor: Record<string, unknown>, highlighted = false): RelatedItem =>
  ({ item, snippet: text.slice(0, 20), score: 0.8, passage: { chunk_id: "c", text, anchor, highlighted } });

describe("the paragraph at the cursor", () => {
  const note = [
    "---", "caute_id: x", "tags: [a]", "---",          // 0-3 front matter
    "# Sleep",                                          // 4 heading
    "Memory consolidates during sleep,",               // 5
    "mostly in slow-wave stages.",                      // 6
    "",                                                 // 7
    "- the hippocampus replays the day",               // 8
    "- [ ] read Walker again",                          // 9
    "",                                                 // 10
    "> Sleep is the price we pay for plasticity.",     // 11
    "```js",                                            // 12
    "const sleep = true;",                              // 13
    "```",                                              // 14
    "After the code.",                                  // 15
  ];

  it("is the lines up to a blank line or heading", () => {
    expect(paragraphAt(note, 6)).toBe("Memory consolidates during sleep,\nmostly in slow-wave stages.");
  });

  it("takes list, task and quote markers off", () => {
    expect(paragraphAt(note, 8)).toBe("the hippocampus replays the day\nread Walker again");
    expect(paragraphAt(note, 11)).toBe("Sleep is the price we pay for plasticity.");
  });

  it("is nothing in front matter, a heading, a code block or a blank line", () => {
    for (const at of [0, 2, 3, 4, 7, 12, 13, 14]) expect(paragraphAt(note, at), `line ${at}`).toBe("");
  });

  it("stops at a fence, and starts again after one", () => {
    expect(paragraphAt(note, 15)).toBe("After the code.");
  });
});

describe("passages", () => {
  it("puts the person's highlights first and keeps Caute's order otherwise", () => {
    const list = fromRelated([related("one", {}), related("two", {}, true), related("three", {})]);
    expect(sortPassages(list).map((p) => p.text)).toEqual(["two", "one", "three"]);
  });

  it("says where a passage is", () => {
    expect(whereIs({ page: 4 })).toBe("p. 4");
    expect(whereIs({ t_start: 754.6 })).toBe("12:34");
    expect(whereIs({ t_start: 3725 })).toBe("1:02:05");
    expect(whereIs({ chapter: 3 })).toBe("ch. 3");
    expect(whereIs({})).toBe("");
  });

  it("quotes a passage with a link that marks it", () => {
    const [p] = fromRelated([related("Replay happens in slow-wave sleep.", { t_start: 754.2, char_start: 120, char_end: 154 })]);
    const q = quotePassage(p, "https://app.getcaute.com");
    expect(q).toContain("> Replay happens in slow-wave sleep.");
    expect(q).toContain(`/c/${item.id}#t=754&char=120-154)`);
  });

  it("narrows an exact passage to the words selected, counting code points", () => {
    // An emoji is two UTF-16 units and one code point (ADR 0051).
    const text = "Sleep 😴 consolidates memory overnight.";
    const [p] = fromRelated([related(text, { char_start: 100, char_end: 100 + Array.from(text).length })]);
    const from = text.indexOf("consolidates");
    const part = narrow(p, from - 1, from + "consolidates memory".length + 1);
    expect(part.text).toBe("consolidates memory");
    expect(part.anchor.char_start).toBe(100 + Array.from(text.slice(0, from)).length);
    expect(part.anchor.char_end).toBe((part.anchor.char_start as number) + "consolidates memory".length);
  });

  it("narrows only the words of a passage that isn't exact, keeping its anchor", () => {
    const [h] = fromHighlights([{ id: "n", item_id: item.id, title: "Notes", kind: "web_page",
                                  anchor: { char_start: 5, char_end: 40 }, excerpt: "a cut short excerpt…",
                                  captured_at: item.captured_at }]);
    const part = narrow(h, 2, 5);
    expect(part.text).toBe("cut");
    expect(part.anchor).toEqual({ char_start: 5, char_end: 40 });
  });

  it("leaves a passage whole when nothing but space is selected", () => {
    const [p] = fromRelated([related("Words here.", { char_start: 0, char_end: 11 })]);
    expect(narrow(p, 5, 6)).toBe(p);
  });
});
