import { describe, expect, it } from "vitest";
import { citation, sourcesList, toFootnotes, type Citable } from "./citations";

const APP = "https://app.getcaute.com";
const PAPER = "0190f3a2-0000-7000-8000-00000000000a";
const PAGE = "0190f3a2-0000-7000-8000-00000000000b";
const GONE = "0190f3a2-0000-7000-8000-00000000000c";
const paper: Citable = {
  title: "attention-is-all-you-need.pdf", captured_at: "2026-03-14T09:00:00Z",
  properties: [
    { key: "title", value: "Attention Is All You Need", state: "confirmed" },
    { key: "authors", value: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit"], state: "confirmed" },
    { key: "year", value: 2017, state: "confirmed" },
    { key: "venue", value: "NeurIPS", state: "confirmed" },
    { key: "doi", value: "10.48550/arXiv.1706.03762", state: "confirmed" },
  ],
};
const page: Citable = { title: "Kelp forest", captured_at: "2026-03-14T09:00:00Z",
                        properties: [{ key: "year", value: 1999, state: "suggested" }] };
const cards = new Map<string, Citable | null>([[PAPER, paper], [PAGE, page], [GONE, null]]);

describe("a citation", () => {
  it("is author-year from confirmed properties, as the DOI processor writes it", () => {
    expect(citation(paper)).toBe("Ashish Vaswani, Noam Shazeer, Niki Parmar and others (2017). "
      + "Attention Is All You Need. NeurIPS. https://doi.org/10.48550/arXiv.1706.03762");
  });

  it("falls back to the title and when it was caught, ignoring suggestions", () => {
    expect(citation(page)).toMatch(/^Kelp forest\. Caught .*2026\.$/);
  });

  it("says nothing about a card that can't be opened", () => {
    expect(citation(null)).toBe("A card in Caute that isn't available.");
  });

  it("defangs property values", () => {
    const sly: Citable = { title: "x", captured_at: paper.captured_at,
      properties: [{ key: "authors", value: ["[[Secret]]", "#tag"], state: "confirmed" },
                   { key: "venue", value: "<%* tp.file.delete() %>", state: "confirmed" }] };
    expect(citation(sly)).not.toMatch(/\[\[|<%|(^|\s)#tag/);
  });
});

describe("turning card links into footnotes", () => {
  const note = [
    "Attention replaced recurrence [Attention Is All You Need](" + `${APP}/c/${PAPER}#page=2&char=10-90).`,
    "Kelp grows fast, see [this page](" + `${APP}/c/${PAGE}) and again [this page](${APP}/c/${PAGE}).`,
    `A lost one: ${APP}/c/${GONE}`,
    "",
    "[^1]: An earlier footnote of my own.",
  ].join("\n");

  it("numbers after existing footnotes, reuses a number for the same link, and keeps other words", () => {
    const out = toFootnotes(note, APP, cards);
    expect(out).toContain("Attention replaced recurrence[^2].");
    expect(out).toContain("see this page[^3] and again this page[^3].");
    expect(out).toContain("A lost one:[^4]");
    expect(out).toContain(`[^2]: Ashish Vaswani, Noam Shazeer, Niki Parmar and others (2017). Attention Is All You Need. `
      + `NeurIPS. https://doi.org/10.48550/arXiv.1706.03762 [In Caute](${APP}/c/${PAPER}#page=2&char=10-90)`);
    expect(out).toContain(`[^4]: A card in Caute that isn't available. [In Caute](${APP}/c/${GONE})`);
    expect(out).toContain("[^1]: An earlier footnote of my own.");
  });

  it("leaves the links in its own footnotes alone when run again", () => {
    const once = toFootnotes(note, APP, cards);
    expect(toFootnotes(once, APP, cards)).toBe(once);
  });
});

describe("a sources list", () => {
  it("counts the links in footnotes too, since it is often added after them", () => {
    const footnoted = toFootnotes(`See [x](${APP}/c/${PAPER}).`, APP, cards);
    expect(sourcesList(footnoted, APP, cards)).toContain("Ashish Vaswani");
  });

  it("has one entry per card, in the order first cited", () => {
    const list = sourcesList(`[a](${APP}/c/${PAGE}#char=1-5) then [b](${APP}/c/${PAPER}) then [c](${APP}/c/${PAGE})`, APP, cards);
    const lines = list.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^- Kelp forest\. Caught .* \[In Caute\]\(https:\/\/app\.getcaute\.com\/c\/.*b\)$/);
    expect(lines[1]).toContain("Ashish Vaswani");
  });
});
