import { describe, expect, it } from "vitest";
import { externalId, publishId, publishRequest, publishedBody } from "./publishing";

const ID = "0190f3a2-7c1d-7e4b-9a10-3f2e1d0c9b8a";

describe("publishing a note", () => {
  it("reads the id from the note's properties, and only a real one", () => {
    expect(publishId({ caute_id: ID })).toBe(ID);
    expect(publishId({ caute_id: ` ${ID.toUpperCase()} ` })).toBe(ID);
    expect(publishId({ caute_id: "notes/lease.md" })).toBeNull();
    expect(publishId({ caute_id: 7 })).toBeNull();
    expect(publishId(null)).toBeNull();
  });

  it("keys the card by the id, never the path", () => {
    expect(externalId(ID)).toBe(`obsidian:${ID}`);
  });

  it("publishes the note without its properties", () => {
    expect(publishedBody(`---\ncaute_id: ${ID}\ntags: [a]\n---\n\n# Lease\n\nRent is due.\n`))
      .toBe("# Lease\n\nRent is due.\n");
    expect(publishedBody("# No properties\n")).toBe("# No properties\n");
    expect(publishedBody("Text\n---\nwith a rule\n")).toBe("Text\n---\nwith a rule\n");
  });

  it("sends what POST /v1/items takes, and replaces only when asked", () => {
    expect(publishRequest({ body: "Hi", title: "Note", id: ID })).toEqual({
      text: "Hi", title: "Note", source: "api", context: { source_app: "obsidian" }, external_id: `obsidian:${ID}`,
    });
    expect(publishRequest({ body: "Hi", title: "Note", id: ID, replaceEarlier: true }).replace_earlier).toBe(true);
  });
});
