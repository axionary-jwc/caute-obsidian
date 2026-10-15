/**
 * Signing Obsidian in to Caute (ADR 0115).
 *
 * On the desktop: OAuth 2.1 with PKCE as the pre-registered client
 * `caute-obsidian`. The plugin listens for one request on a free loopback
 * port, opens Caute's sign-in in the browser, and takes the code from the
 * hand-back (RFC 8252 7.3). `resource` is the API, found from its own
 * metadata (INV-41), so a development server works the same way.
 *
 * On a phone or tablet nothing can listen on a port, so the person pastes a
 * personal token instead, as the extension did before ADR 0086. The desktop
 * keeps that under Advanced too.
 *
 * Secrets (the refresh token, a pasted token) go in Obsidian's secret
 * storage, kept on this device, never in the plugin's data.json, which lives
 * in the vault and travels with its sync or git. Refresh tokens rotate, and
 * reusing one revokes the grant, so refreshing is serialised.
 */

import { Notice, Platform, requestUrl, type App } from "obsidian";
import type { TokenSource } from "./api";
import {
  CLIENT_ID, SignInError, authorizeUrl, challengeFor, codeFrom, handBackPage, randomString, stillGood,
  type Access,
} from "./oauth";

const REFRESH_SECRET = "caute-refresh-token";
const TOKEN_SECRET = "caute-personal-token";
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

/** Where the grant lives, which is not secret and may be kept in data.json. */
export interface OAuthState {
  apiUrl: string;
  tokenEndpoint: string;
  revocationEndpoint: string | null;
  resource: string;
  scopes: string[];
}

export class CauteAuth implements TokenSource {
  private access: Access | null = null;
  private refreshing: Promise<string> | null = null;

  constructor(
    private app: App,
    private apiUrl: () => string,
    private state: () => OAuthState | null,
    private saveState: (s: OAuthState | null) => Promise<void>,
    private changed: () => void,
  ) {}

  // --- secrets -------------------------------------------------------------

  private secret(id: string): string {
    return this.app.secretStorage.getSecret(id) ?? "";
  }

  private setSecret(id: string, value: string): void {
    this.app.secretStorage.setSecret(id, value); // there is no delete; empty means none
  }

  personalToken(): string {
    return this.secret(TOKEN_SECRET);
  }

  setPersonalToken(token: string): void {
    this.setSecret(TOKEN_SECRET, token.trim());
    this.changed();
  }

  // --- what the settings tab shows -----------------------------------------

  signedIn(): boolean {
    const s = this.state();
    return !!s && s.apiUrl === this.apiUrl() && !!this.secret(REFRESH_SECRET);
  }

  /** The scopes this connection holds; a pasted token's are not known here. */
  scopes(): string[] | null {
    return this.signedIn() ? this.state()!.scopes : null;
  }

  connected(): boolean {
    return this.signedIn() || !!this.personalToken();
  }

  // --- TokenSource ---------------------------------------------------------

  async token(): Promise<string> {
    if (this.signedIn()) {
      if (stillGood(this.access)) return this.access.token;
      return this.refresh();
    }
    return this.personalToken();
  }

  async rejected(): Promise<string> {
    if (!this.signedIn()) return "";
    this.access = null;
    return this.refresh();
  }

  private refresh(): Promise<string> {
    // One refresh at a time: a refresh token used twice revokes the grant.
    this.refreshing ??= this.doRefresh().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async doRefresh(): Promise<string> {
    const s = this.state();
    const refreshToken = this.secret(REFRESH_SECRET);
    if (!s || !refreshToken) return "";
    let r;
    try {
      r = await requestUrl({
        url: s.tokenEndpoint, method: "POST", throw: false, contentType: "application/x-www-form-urlencoded",
        body: new URLSearchParams({
          grant_type: "refresh_token", refresh_token: refreshToken, client_id: CLIENT_ID, resource: s.resource,
        }).toString(),
      });
    } catch {
      return ""; // no network: stay signed in and try again next time
    }
    const body = safeJson(r);
    if (r.status === 400 && body.error === "invalid_grant") {
      // Revoked in Caute's settings, or the account is gone (INV-42).
      await this.forget();
      new Notice("Caute signed Obsidian out. Its connection was removed in Caute's settings.");
      return "";
    }
    if (r.status !== 200) return "";
    this.keep(body);
    return this.access!.token;
  }

  private keep(body: Record<string, unknown>): void {
    this.setSecret(REFRESH_SECRET, String(body.refresh_token));
    this.access = { token: String(body.access_token), expiresAt: Date.now() + Number(body.expires_in) * 1000 };
  }

  private async forget(): Promise<void> {
    this.setSecret(REFRESH_SECRET, "");
    this.access = null;
    await this.saveState(null);
    this.changed();
  }

  // --- the flow ------------------------------------------------------------

  /**
   * Open Caute's sign-in in the browser and finish when it hands back.
   * Desktop only; asking again with more scopes replaces the grant.
   */
  async signIn(scopes: string[]): Promise<void> {
    if (!Platform.isDesktopApp) throw new SignInError("On this device, paste a personal token instead.");
    const apiUrl = this.apiUrl();
    const where = await discover(apiUrl);
    const verifier = randomString(48);
    const state = randomString(16);
    const challenge = await challengeFor(verifier);
    const { query, redirectUri } = await this.listen(state, (uri) => {
      window.open(authorizeUrl(where.authorize, { redirectUri: uri, challenge, state, resource: where.resource, scopes }));
    });
    const code = codeFrom(query, state);
    const r = await requestUrl({
      url: where.token, method: "POST", throw: false, contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        grant_type: "authorization_code", code, client_id: CLIENT_ID, code_verifier: verifier,
        redirect_uri: redirectUri, resource: where.resource,
      }).toString(),
    });
    const body = safeJson(r);
    if (r.status !== 200) {
      throw new SignInError(typeof body.error_description === "string"
        ? body.error_description : "Caute didn't sign Obsidian in.");
    }
    const previous = this.secret(REFRESH_SECRET);
    const old = this.state();
    this.keep(body);
    await this.saveState({
      apiUrl, tokenEndpoint: where.token, revocationEndpoint: where.revoke, resource: where.resource,
      scopes: (typeof body.scope === "string" ? body.scope : scopes.join(" ")).split(" ").filter(Boolean),
    });
    // A new grant replaces the old one; don't leave the old one connected.
    if (previous && old?.revocationEndpoint) await revoke(old.revocationEndpoint, previous);
    this.changed();
  }

  async signOut(): Promise<void> {
    const s = this.state();
    const refreshToken = this.secret(REFRESH_SECRET);
    if (s?.revocationEndpoint && refreshToken) await revoke(s.revocationEndpoint, refreshToken);
    await this.forget();
  }

  /**
   * A one-request HTTP server on 127.0.0.1 and a free port. `open` is given
   * the redirect URI once the port is known; the promise settles with the
   * hand-back's query, or fails after five minutes.
   */
  private async listen(state: string, open: (redirectUri: string) => void):
    Promise<{ query: URLSearchParams; redirectUri: string }> {
    // Loaded here, not at the top: a phone has no `http`, and the plugin must load there.
    let http: typeof import("http") | null = null;
    if (Platform.isDesktop && Platform.isDesktopApp) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef -- desktop only
      http = require("http") as typeof import("http");
    }
    if (!http) throw new SignInError("On this device, paste a personal token instead.");
    return new Promise((resolve, reject) => {
      let redirectUri = "";
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const ok = url.searchParams.get("state") === state && url.searchParams.has("code");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
          .end(handBackPage(ok));
        done();
        resolve({ query: url.searchParams, redirectUri });
      });
      const timer = window.setTimeout(() => {
        done();
        reject(new SignInError("Sign-in took too long. Try again."));
      }, SIGN_IN_TIMEOUT_MS);
      const done = () => {
        window.clearTimeout(timer);
        server.close();
      };
      server.on("error", () => {
        done();
        reject(new SignInError("Obsidian couldn't listen for Caute's answer on this computer."));
      });
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        redirectUri = `http://127.0.0.1:${port}/callback`;
        open(redirectUri);
      });
    });
  }
}

function safeJson(r: { json: unknown }): Record<string, unknown> {
  try {
    const j = r.json;
    return j && typeof j === "object" ? j as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  let r;
  try {
    r = await requestUrl({ url, throw: false });
  } catch {
    throw new SignInError(`Can't reach Caute at ${new URL(url).origin}. Check the address in settings.`);
  }
  if (r.status !== 200) throw new SignInError(`Caute at ${new URL(url).origin} didn't say how to sign in.`);
  return safeJson(r);
}

async function discover(apiUrl: string) {
  const api = apiUrl.replace(/\/+$/, "");
  const resource = await getJson(`${api}/.well-known/oauth-protected-resource`);
  const issuer = (resource.authorization_servers as string[] | undefined)?.[0];
  if (!issuer) throw new SignInError("Caute didn't name a sign-in server.");
  const meta = await getJson(`${issuer.replace(/\/+$/, "")}/.well-known/oauth-authorization-server`);
  return {
    resource: String(resource.resource),
    authorize: String(meta.authorization_endpoint),
    token: String(meta.token_endpoint),
    revoke: typeof meta.revocation_endpoint === "string" ? meta.revocation_endpoint : null,
  };
}

async function revoke(endpoint: string, token: string): Promise<void> {
  try {
    await requestUrl({
      url: endpoint, method: "POST", throw: false, contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({ token, client_id: CLIENT_ID }).toString(),
    });
  } catch {
    // Best effort: the grant is forgotten here either way.
  }
}
