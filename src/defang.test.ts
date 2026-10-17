import { describe, expect, it } from "vitest";
import { defang } from "./defang";
import { HOSTILE, ORDINARY } from "./defang.fixtures";
import { linkLabel } from "./links";
import { markdownQuote } from "./quote";

const quote = (text: string, sourceTitle = "A saved page") =>
  markdownQuote({ text, sourceTitle, sourceUrl: "https://app.getcaute.com/c/0190f3a2-7c1d-7e4b-9a10-3f2e1d0c9b8a#page=4",
                  capturedAt: "2026-03-14T09:00:00Z" });

describe("nothing quoted can run in the vault", () => {
  it.each(HOSTILE)("makes $name inert", ({ text, inert }) => {
    expect(defang(text)).toBe(inert);
  });

  it.each(ORDINARY)("leaves ordinary prose as it was", (text) => {
    expect(defang(text)).toBe(text);
  });

  it.each(HOSTILE)("quotes $name inertly", ({ text, inert }) => {
    const q = quote(text);
    expect(q.startsWith(inert.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n"))).toBe(true);
    for (const live of ["```", "<%", "[[", "%%", "::", "<iframe", "<img"]) {
      expect(q.includes(live), `${live} in ${q}`).toBe(false);
    }
  });

  it.each(HOSTILE)("defangs a title holding $name", ({ text }) => {
    const label = linkLabel(text);
    for (const live of ["```", "<%", "[[", "%%", "::", "<iframe"]) expect(label.includes(live)).toBe(false);
    expect(quote("words", text)).not.toMatch(/<%|\[\[|%%|::|```/);
  });

});
