import { describe, expect, it } from "vitest";
import { cardIdOf, cardUrl, findCardLinks, linkLabel, markdownLink } from "./links";

const APP = "https://app.getcaute.com";
const ID = "0190f3a2-7c1d-7e4b-9a10-3f2e1d0c9b8a";

describe("card links", () => {
  it("reads the id from a card URL, with or without an anchor", () => {
    expect(cardIdOf(`${APP}/c/${ID}`, APP)).toBe(ID);
    expect(cardIdOf(`${APP}/c/${ID.toUpperCase()}#page=4`, APP)).toBe(ID);
    expect(cardIdOf(`${APP}/c/${ID}#t=754`, `${APP}/`)).toBe(ID);
  });

  it("ignores other hosts, other paths and broken ids", () => {
    expect(cardIdOf(`https://evil.example/c/${ID}`, APP)).toBeNull();
    expect(cardIdOf(`${APP}/n/${ID}`, APP)).toBeNull();
    expect(cardIdOf(`${APP}/c/not-a-card`, APP)).toBeNull();
    expect(cardIdOf(`${APP}.evil.example/c/${ID}`, APP)).toBeNull();
  });

  it("works for a development server", () => {
    const dev = "http://app.caute.localhost:8000";
    expect(cardIdOf(`${dev}/c/${ID}`, dev)).toBe(ID);
    expect(cardIdOf(`${APP}/c/${ID}`, dev)).toBeNull();
  });

  it("finds Markdown links and bare URLs, but not images", () => {
    const other = "0190f3a2-0000-7000-8000-000000000001";
    const text = `See [the lease](${APP}/c/${ID}#page=4) and ${APP}/c/${other}.\n![plate](${APP}/c/${other})`;
    const found = findCardLinks(text, APP);
    expect(found.map((l) => [l.id, l.label, text.slice(l.from, l.to)])).toEqual([
      [ID, "the lease", `[the lease](${APP}/c/${ID}#page=4)`],
      [other, null, `${APP}/c/${other}`],
    ]);
  });

  it("keeps an angle-bracketed bare URL whole", () => {
    const text = `<${APP}/c/${ID}>`;
    const [link] = findCardLinks(text, APP);
    expect([link.from, link.to, link.url]).toEqual([0, text.length, `${APP}/c/${ID}`]);
  });

  it("makes canonical links and safe labels", () => {
    expect(cardUrl(`${APP}/`, ID, "#page=2")).toBe(`${APP}/c/${ID}#page=2`);
    expect(linkLabel("A [sneaky](javascript:alert(1))\ntitle")).toBe("A sneaky (javascript:alert(1)) title");
    expect(linkLabel("  ")).toBe("Untitled card");
    expect(markdownLink("Lease.pdf", `${APP}/c/${ID}`)).toBe(`[Lease.pdf](${APP}/c/${ID})`);
  });
});
