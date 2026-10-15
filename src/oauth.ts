/**
 * The parts of signing in that need nothing from Obsidian or the network:
 * PKCE, the authorization URL, reading the answer, and token lifetimes.
 * The same steps as the extension's (ADR 0086), for the client
 * `caute-obsidian` (ADR 0115).
 */

export const CLIENT_ID = "caute-obsidian";
/** Enough to show chips, insert cards and quotes, and ask for related cards. */
export const READ_SCOPES = ["items:read", "search"];
/** Asked for only when the person first publishes a note. */
export const PUBLISH_SCOPES = [...READ_SCOPES, "items:write"];

export class SignInError extends Error {}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomString(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function authorizeUrl(endpoint: string, p: {
  redirectUri: string; challenge: string; state: string; resource: string; scopes: string[];
}): string {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    response_type: "code", client_id: CLIENT_ID, redirect_uri: p.redirectUri, scope: p.scopes.join(" "),
    code_challenge: p.challenge, code_challenge_method: "S256", state: p.state, resource: p.resource,
  }).toString();
  return url.toString();
}

/** The code from the loopback hand-back, or why there isn't one. */
export function codeFrom(query: URLSearchParams, state: string): string {
  if (query.get("error")) {
    throw new SignInError(query.get("error") === "access_denied"
      ? "Sign-in was cancelled."
      : (query.get("error_description") ?? "Caute didn't sign Obsidian in."));
  }
  if (query.get("state") !== state) throw new SignInError("That sign-in didn't come from this vault.");
  const code = query.get("code");
  if (!code) throw new SignInError("Caute didn't send a sign-in code.");
  return code;
}

export interface Access {
  token: string;
  expiresAt: number; // ms since epoch
}

/** Refresh a minute early, so a request never leaves with a token about to lapse. */
export function stillGood(access: Access | null | undefined, now = Date.now()): access is Access {
  return !!access && access.expiresAt - 60_000 > now;
}

export function hasScopes(granted: string[], wanted: string[]): boolean {
  return wanted.every((s) => granted.includes(s));
}

/** The page the browser shows once it has handed the code to Obsidian. */
export function handBackPage(ok: boolean): string {
  const [title, line] = ok
    ? ["Signed in", "Caute is connected to Obsidian. You can close this tab and go back to Obsidian."]
    : ["Not signed in", "Obsidian wasn't signed in. Go back to Obsidian to see why."];
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>`
    + `<body style="font:16px system-ui;margin:4rem auto;max-width:32rem"><h1>${title}</h1><p>${line}</p>`;
}
