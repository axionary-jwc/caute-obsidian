import { describe, expect, it } from "vitest";
import type { SearchResult } from "./api";
import { answerFileName, answerNote, plainModelText, type Answer } from "./answers";
import { HOSTILE } from "./defang.fixtures";

const APP = "https://app.getcaute.com";
const result = (id: string, title: string, anchor: Record<string, unknown> = {}): SearchResult => ({
  item: { id, title, kind: "web_page", captured_at: "2026-03-14T09:00:00Z" },
  space: { name: "Inbox", workspace_name: "Personal" },
  match: { snippet: "", anchor },
});
const results = [
  result("0190f3a2-0000-7000-8000-000000000001", "Why we sleep", { t_start: 754.2, char_start: 10, char_end: 90 }),
  result("0190f3a2-0000-7000-8000-000000000002", "Sleep and memory", { page: 4, char_start: 5, char_end: 60 }),
  result("0190f3a2-0000-7000-8000-000000000003", "Pasta recipes"),
];
const answer: Answer = {
  text: "Memory consolidates during slow-wave sleep [2], when the day is replayed [1].\n\n- Why we sleep [1]\n- Sleep and memory: page four [2]",
  citations: [{ result_index: 1, anchor: { page: 4, char_start: 5, char_end: 60 } }],
};

describe("an answer as a note", () => {
  it("links each citation to its card at the passage it cited", () => {
    const note = answerNote(answer, results, "How does sleep help memory?", APP, new Date("2026-10-17T12:00:00Z"));
    expect(note.startsWith("---\ncaute_asked: 2026-10-17\n---\n# How does sleep help memory?\n")).toBe(true);
    expect(note).toContain(`[Sleep and memory](${APP}/c/${results[1].item.id}#page=4&char=5-60)`);
    expect(note).toContain(`[Why we sleep](${APP}/c/${results[0].item.id}#t=754&char=10-90)`);
    // Sources, in the order first cited.
    const sources = note.slice(note.indexOf("## Sources"));
    expect(sources.indexOf("Sleep and memory")).toBeLessThan(sources.indexOf("Why we sleep"));
    expect(sources).not.toContain("Pasta");
  });

  it("says how many cards were kept away from AI", () => {
    const note = answerNote({ ...answer, left_out: 2 }, results, "q?", APP, new Date());
    expect(note).toContain("2 cards were left out because their space is kept away from AI.");
  });

  it("takes links, card references, addresses and hashtags out of model text", () => {
    expect(plainModelText("See [this](https://evil.example) and card:0190 at https://x.example/a #secret [1]"))
      .toBe("See this and at #secret".replace("#secret", "secret") + " [1]");
    expect(plainModelText("![](https://tracker.example/p.gif)Done")).toBe("Done");
  });

  it.each(HOSTILE)("leaves $name inert in an answer", ({ text }) => {
    const note = answerNote({ text: `${text} [1]`, citations: [] }, results, text, APP, new Date());
    for (const live of ["```", "<%", "[[", "%%", "::", "<iframe", "<img"]) {
      expect(note.includes(live), `${live} in ${note}`).toBe(false);
    }
    // A link that could act: an unescaped bracket straight before a script address.
    expect(note).not.toMatch(/(?<!\\)\]\(javascript:/);
  });

  it("names the file by the question", () => {
    expect(answerFileName("What did [[Walker]] say about #sleep?")).toBe("What did Walker say about sleep");
    expect(answerFileName("  ?  ")).toBe("Question");
  });
});
