/**
 * The few `/v1` calls the plugin makes, through Obsidian's `requestUrl`.
 *
 * `requestUrl` runs outside the page, so Caute needs no CORS rule for
 * Obsidian and none is added (INV-48). That is also why the generated client
 * in `clients/typescript` isn't used: it is built on `fetch`, and the
 * plugin's public mirror must build on its own. The types below are the
 * subset of `openapi/openapi.json` read here; `spec.test.ts` checks them
 * against the spec.
 */

import { requestUrl } from "obsidian";
import type { Answer } from "./answers";
import type { Citable } from "./citations";
import type { PublishRequest } from "./publishing";

export interface Preview {
  id: string;
  status: "available" | "unavailable";
  canonical_url: string;
  title?: string | null;
  kind?: string | null;
  provenance?: string | null;
  privacy?: { name: string; visibility: string } | null;
  captured_at?: string | null;
}

export interface SearchResult {
  item: { id: string; title: string | null; kind: string; captured_at: string };
  space: { name: string; workspace_name: string };
  match: { snippet: string; anchor: Record<string, unknown> };
}

export interface RelatedItem {
  item: { id: string; title: string | null; kind: string; captured_at: string };
  snippet: string;
  score: number;
  /** The words that matched, cut from the card's own text, and where they are (ADR 0133). */
  passage?: { chunk_id: string; text: string; anchor: Record<string, unknown>; highlighted: boolean } | null;
}

/** One of the person's marked passages (`GET /v1/highlights`). */
export interface Highlight {
  id: string;
  item_id: string;
  title: string | null;
  kind: string;
  anchor: Record<string, unknown>;
  excerpt: string;
  captured_at: string;
}

export interface Captured {
  id: string;
  status: string;
  duplicate: boolean;
  supersedes?: string | null;
}

/** What went wrong, in words for the person, with the API's stable code. */
export class CauteError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null) {
    super(message);
  }
}

/** Supplies a bearer token, and is told when Caute refused it. */
export interface TokenSource {
  token(): Promise<string>;
  /** A 401: refresh and return a new token, or "" when signed out. */
  rejected(): Promise<string>;
}

function explain(status: number, body: Record<string, unknown>): string {
  const code = typeof body.code === "string" ? body.code : null;
  if (status === 401) return "Caute signed Obsidian out. Sign in again in the plugin's settings.";
  if (code === "insufficient_scope") return "This connection to Caute isn't allowed to do that.";
  if (code === "quota_exceeded") {
    return typeof body.detail === "string" ? body.detail : "That's past your plan's limit in Caute.";
  }
  if (status === 429) return "Caute is busy. Try again in a minute.";
  if (typeof body.detail === "string") return body.detail;
  return `Caute answered ${status}.`;
}

export class Caute {
  constructor(private apiUrl: () => string, private tokens: TokenSource) {}

  private async call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}):
    Promise<T> {
    let token = await this.tokens.token();
    if (!token) throw new CauteError("Sign in to Caute in the plugin's settings first.", 401);
    for (let attempt = 0; ; attempt++) {
      let r;
      try {
        r = await requestUrl({
          url: `${this.apiUrl().replace(/\/+$/, "")}${path}`, method, throw: false,
          headers: { Authorization: `Bearer ${token}`, ...headers },
          ...(body === undefined ? {} : { contentType: "application/json", body: JSON.stringify(body) }),
        });
      } catch {
        throw new CauteError(`Can't reach Caute at ${this.apiUrl()}.`, 0);
      }
      if (r.status === 401 && attempt === 0) {
        token = await this.tokens.rejected();
        if (token) continue;
      }
      let parsed: Record<string, unknown> = {};
      try {
        parsed = (r.json as Record<string, unknown> | null) ?? {};
      } catch {
        parsed = {};
      }
      if (r.status >= 400) {
        throw new CauteError(explain(r.status, parsed), r.status,
          typeof parsed.code === "string" ? parsed.code : null);
      }
      return parsed as T;
    }
  }

  /** Previews for up to 100 cards. An unreadable card is "unavailable", like a deleted one (INV-43). */
  async previews(ids: string[]): Promise<Preview[]> {
    const r = await this.call<{ previews: Preview[] }>("POST", "/v1/items/preview:batch", { ids });
    return r.previews;
  }

  async search(query: string, mode: "picker" | "search", limit = 20): Promise<SearchResult[]> {
    const r = await this.call<{ results: SearchResult[] }>("POST", "/v1/search", { query, mode, limit });
    return r.results;
  }

  async related(text: string, limit = 8, perItem = 1): Promise<RelatedItem[]> {
    return this.call<RelatedItem[]>("POST", "/v1/related", { text, limit, per_item: perItem });
  }

  /** A card's title, when it was caught and its properties, or null when it can't be opened (INV-43). */
  async card(id: string): Promise<Citable | null> {
    try {
      return await this.call<Citable>("GET", `/v1/items/${encodeURIComponent(id)}`);
    } catch (e) {
      if (e instanceof CauteError && (e.status === 404 || e.status === 403)) return null;
      throw e;
    }
  }

  /** Tell Caute this card is quoted in a note, by the note's opaque pointer (ADR 0134). Returns the pointer's id. */
  async addRef(itemId: string, opaqueRef: string): Promise<{ id: string }> {
    return this.call("PUT", `/v1/items/${encodeURIComponent(itemId)}/external-refs`,
      { app: "obsidian", opaque_ref: opaqueRef });
  }

  async removeRef(itemId: string, refId: string): Promise<void> {
    try {
      await this.call("DELETE", `/v1/items/${encodeURIComponent(itemId)}/external-refs/${encodeURIComponent(refId)}`);
    } catch (e) {
      // Already gone, with the card or by hand: the same outcome.
      if (!(e instanceof CauteError && e.status === 404)) throw e;
    }
  }

  /** A question answered from the library, with the results its citations point into. */
  async ask(question: string): Promise<{ answer: Answer | null; results: SearchResult[] }> {
    return this.call("POST", "/v1/search", { query: question, mode: "ask", limit: 20 });
  }

  /** The person's marked passages, newest first; `q` searches their words. */
  async highlights(q = "", limit = 30): Promise<Highlight[]> {
    const params = new URLSearchParams({ limit: String(limit), ...(q.trim() ? { q: q.trim() } : {}) });
    const r = await this.call<{ data: Highlight[] }>("GET", `/v1/highlights?${params.toString()}`);
    return r.data;
  }

  async publish(req: PublishRequest, idempotencyKey: string): Promise<Captured> {
    return this.call<Captured>("POST", "/v1/items", req, { "Idempotency-Key": idempotencyKey });
  }
}
