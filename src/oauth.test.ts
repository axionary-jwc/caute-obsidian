import { describe, expect, it } from "vitest";
import {
  CLIENT_ID, PUBLISH_SCOPES, READ_SCOPES, SignInError, authorizeUrl, challengeFor, codeFrom, handBackPage, hasScopes,
  stillGood,
} from "./oauth";

describe("signing in", () => {
  it("asks for reading and searching only, and saving only to publish", () => {
    expect(READ_SCOPES).toEqual(["items:read", "search"]);
    expect(PUBLISH_SCOPES).toEqual(["items:read", "search", "items:write"]);
    expect(hasScopes(["items:read", "search"], PUBLISH_SCOPES)).toBe(false);
    expect(hasScopes(["items:read", "items:write", "search"], PUBLISH_SCOPES)).toBe(true);
  });

  it("builds the authorization URL with PKCE and the resource", async () => {
    const challenge = await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"); // RFC 7636 appendix B
    const url = new URL(authorizeUrl("https://app.getcaute.com/oauth/authorize", {
      redirectUri: "http://127.0.0.1:51734/callback", challenge, state: "s1",
      resource: "https://api.getcaute.com", scopes: READ_SCOPES,
    }));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code", client_id: CLIENT_ID, redirect_uri: "http://127.0.0.1:51734/callback",
      scope: "items:read search", code_challenge: challenge, code_challenge_method: "S256", state: "s1",
      resource: "https://api.getcaute.com",
    });
  });

  it("takes the code only from its own hand-back", () => {
    expect(codeFrom(new URLSearchParams("code=abc&state=s1"), "s1")).toBe("abc");
    expect(() => codeFrom(new URLSearchParams("code=abc&state=other"), "s1")).toThrow(SignInError);
    expect(() => codeFrom(new URLSearchParams("error=access_denied&state=s1"), "s1")).toThrow("cancelled");
    expect(() => codeFrom(new URLSearchParams("state=s1"), "s1")).toThrow(SignInError);
  });

  it("refreshes a minute early", () => {
    const now = 1_000_000;
    expect(stillGood({ token: "t", expiresAt: now + 120_000 }, now)).toBe(true);
    expect(stillGood({ token: "t", expiresAt: now + 30_000 }, now)).toBe(false);
    expect(stillGood(null, now)).toBe(false);
  });

  it("says plainly what happened in the browser", () => {
    expect(handBackPage(true)).toContain("go back to Obsidian");
    expect(handBackPage(false)).toContain("Not signed in");
  });
});
