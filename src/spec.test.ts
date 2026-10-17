/**
 * The plugin keeps its own narrow types for the calls it makes (api.ts), so
 * that its public mirror builds on its own. In this repository, check them
 * against the spec, so a field the plugin reads can't disappear or be renamed
 * without this failing.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SPEC = new URL("../../../openapi/openapi.json", import.meta.url);
const spec = existsSync(SPEC) ? JSON.parse(readFileSync(SPEC, "utf8")) : null;

function props(name: string): string[] {
  return Object.keys(spec.components.schemas[name].properties);
}

describe.skipIf(!spec)("the API the plugin reads", () => {
  it("has every path the plugin calls", () => {
    for (const path of ["/v1/items/preview:batch", "/v1/search", "/v1/related", "/v1/items"]) {
      expect(spec.paths[path]?.post, path).toBeTruthy();
    }
    expect(spec.paths["/v1/highlights"]?.get).toBeTruthy();
  });

  it("has every field the plugin reads", () => {
    expect(props("Preview")).toEqual(expect.arrayContaining(
      ["id", "status", "canonical_url", "title", "kind", "provenance", "privacy", "captured_at"]));
    expect(props("PreviewSpace")).toEqual(expect.arrayContaining(["name", "visibility"]));
    expect(props("SearchResult")).toEqual(expect.arrayContaining(["item", "space", "match"]));
    expect(props("ResultItem")).toEqual(expect.arrayContaining(["id", "title", "kind", "captured_at"]));
    expect(props("Match")).toEqual(expect.arrayContaining(["snippet", "anchor"]));
    expect(props("RelatedItem")).toEqual(expect.arrayContaining(["item", "snippet", "score", "passage"]));
    expect(props("RelatedPassage")).toEqual(expect.arrayContaining(["chunk_id", "text", "anchor", "highlighted"]));
    expect(props("Highlight")).toEqual(expect.arrayContaining(
      ["id", "item_id", "title", "kind", "anchor", "excerpt", "captured_at"]));
    expect(props("SearchResponse")).toEqual(expect.arrayContaining(["answer", "results"]));
    expect(props("Answer")).toEqual(expect.arrayContaining(["text", "citations", "left_out"]));
    expect(props("AnswerCitation")).toEqual(expect.arrayContaining(["result_index", "anchor"]));
    expect(props("ItemCaptured")).toEqual(expect.arrayContaining(["id", "status", "duplicate", "supersedes"]));
  });

  it("takes every field the plugin sends", () => {
    const capture = spec.paths["/v1/items"].post.requestBody.content["application/json"].schema;
    expect(Object.keys(capture.properties)).toEqual(expect.arrayContaining(
      ["text", "title", "source", "context", "external_id", "replace_earlier"]));
    expect(props("SearchRequest")).toEqual(expect.arrayContaining(["query", "mode", "limit"]));
    expect(props("RelatedQuery")).toEqual(expect.arrayContaining(["text", "limit", "per_item"]));
  });
});
