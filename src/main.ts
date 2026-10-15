/**
 * Caute for Obsidian (ADR 0115): Caute as a companion inside Obsidian, on the
 * same contract Thoute uses (DESIGN.md 22.3). Card links render as chips,
 * cards and quotes come in from a picker, a note can be published to the
 * library, and a paragraph can ask for related cards.
 *
 * Nothing from the vault reaches Caute except the note being published and
 * the paragraph sent for related cards, each on an explicit command (INV-44).
 */

import { Editor, Notice, Plugin, TFile } from "obsidian";
import { Caute, CauteError, type SearchResult } from "./api";
import { CauteAuth, type OAuthState } from "./auth";
import { PreviewCache, chipPostProcessor, chipViewPlugin } from "./chips";
import { cardUrl, markdownLink } from "./links";
import { CardLinkSuggest, CardSearchModal, RelatedModal, ask } from "./modals";
import { PUBLISH_SCOPES, SignInError, hasScopes } from "./oauth";
import { ID_PROPERTY, publishId, publishRequest, publishedBody } from "./publishing";
import { anchorFragment, markdownQuote } from "./quote";
import { CauteSettingTab, DEFAULT_SETTINGS, type CauteSettings } from "./settings";

interface Stored extends CauteSettings {
  oauth: OAuthState | null;
}

export default class CautePlugin extends Plugin {
  settings: CauteSettings = { ...DEFAULT_SETTINGS };
  private oauth: OAuthState | null = null;
  auth!: CauteAuth;
  private api!: Caute;
  private cache!: PreviewCache;
  private tab!: CauteSettingTab;

  async onload(): Promise<void> {
    const stored = (await this.loadData()) as Partial<Stored> | null;
    this.settings = {
      apiUrl: stored?.apiUrl || DEFAULT_SETTINGS.apiUrl,
      appUrl: stored?.appUrl || DEFAULT_SETTINGS.appUrl,
    };
    this.oauth = stored?.oauth ?? null;

    this.auth = new CauteAuth(this.app, () => this.settings.apiUrl, () => this.oauth,
      async (s) => { this.oauth = s; await this.persist(); },
      () => { this.cache?.clear(); this.tab?.refresh(); });
    this.api = new Caute(() => this.settings.apiUrl, this.auth);
    this.cache = new PreviewCache(() => (this.auth.connected() ? this.api : null));

    const appUrl = () => this.settings.appUrl;
    this.registerMarkdownPostProcessor(chipPostProcessor(this.cache, appUrl));
    this.registerEditorExtension(chipViewPlugin(this.cache, appUrl));
    this.registerEditorSuggest(new CardLinkSuggest(this.app, () => (this.auth.connected() ? this.api : null),
      (r) => this.linkTo(r)));

    this.addCommand({
      id: "insert-card", name: "Insert a card",
      editorCallback: (editor) => this.whenConnected(() => new CardSearchModal(this.app, this.api, "picker",
        "Find a card to link", (r) => editor.replaceSelection(this.linkTo(r))).open()),
    });
    this.addCommand({
      id: "quote", name: "Quote a passage",
      editorCallback: (editor) => this.whenConnected(() => new CardSearchModal(this.app, this.api, "search",
        "Find a passage to quote", (r) => editor.replaceSelection(this.quoteOf(r))).open()),
    });
    this.addCommand({
      id: "publish", name: "Publish this note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) void this.publish(file);
        return true;
      },
    });
    this.addCommand({
      id: "related", name: "Related cards for this paragraph",
      editorCallback: (editor) => void this.related(editor),
    });

    this.tab = new CauteSettingTab(this.app, this);
    this.addSettingTab(this.tab);
  }

  async saveSettings(): Promise<void> {
    this.cache.clear();
    await this.persist();
  }

  private async persist(): Promise<void> {
    const data: Stored = { ...this.settings, oauth: this.oauth };
    await this.saveData(data);
  }

  async signIn(scopes: string[]): Promise<boolean> {
    try {
      new Notice("Finish signing in to Caute in your browser.");
      await this.auth.signIn(scopes);
      new Notice("Signed in to Caute.");
      return true;
    } catch (e) {
      new Notice(e instanceof SignInError ? e.message : "Caute didn't sign Obsidian in.");
      return false;
    }
  }

  private whenConnected(go: () => void): void {
    if (!this.auth.connected()) {
      new Notice("Sign in to Caute in the plugin's settings first.");
      return;
    }
    go();
  }

  private linkTo(r: SearchResult): string {
    return markdownLink(r.item.title, cardUrl(this.settings.appUrl, r.item.id));
  }

  private quoteOf(r: SearchResult): string {
    return `\n${markdownQuote({
      text: r.match.snippet,
      sourceTitle: r.item.title?.trim() || "Untitled card",
      sourceUrl: cardUrl(this.settings.appUrl, r.item.id, anchorFragment(r.match.anchor)),
      capturedAt: r.item.captured_at,
    })}`;
  }

  private fail(e: unknown): void {
    new Notice(e instanceof CauteError ? e.message : "Something went wrong talking to Caute.");
  }

  // --- publishing ----------------------------------------------------------

  private async publish(file: TFile): Promise<void> {
    if (!this.auth.connected()) {
      new Notice("Sign in to Caute in the plugin's settings first.");
      return;
    }
    // Saving to Caute is asked for the first time it's needed, not at sign-in.
    const scopes = this.auth.scopes();
    if (scopes && !hasScopes(scopes, PUBLISH_SCOPES)) {
      const go = await ask(this.app, "Allow Obsidian to save to Caute?",
        ["Publishing needs permission to save to your Caute library. Caute will open in your browser to ask."],
        [{ label: "Continue", value: true, cta: true }, { label: "Cancel", value: false }]);
      if (!go || !(await this.signIn(PUBLISH_SCOPES))) return;
    }

    let id = publishId(this.app.metadataCache.getFileCache(file)?.frontmatter);
    let replaceEarlier = false;
    if (!id) {
      const go = await ask(this.app, "Publish to Caute?", [
        `This saves "${file.basename}" to your Caute library.`,
        `It also adds a ${ID_PROPERTY} property to the note, so publishing it again updates the same card.`,
      ], [{ label: "Publish", value: true, cta: true }, { label: "Cancel", value: false }]);
      if (!go) return;
      id = crypto.randomUUID();
      const fresh = id;
      await this.app.fileManager.processFrontMatter(file, (fm) => { (fm as Record<string, unknown>)[ID_PROPERTY] = fresh; });
    } else {
      // The same question every client asks before saving something again (ADR 0096).
      const choice = await ask(this.app, "Publish again?", [
        "This note is already in Caute. If it changed, keep the earlier copy as a version, or replace it?",
      ], [
        { label: "Save as new version", value: "version" as const, cta: true },
        { label: "Replace saved copy", value: "replace" as const },
      ]);
      if (!choice) return;
      replaceEarlier = choice === "replace";
    }

    const body = publishedBody(await this.app.vault.read(file));
    if (!body.trim()) {
      new Notice("This note is empty, so there's nothing to publish.");
      return;
    }
    try {
      const r = await this.api.publish(
        publishRequest({ body, title: file.basename, id, replaceEarlier }), crypto.randomUUID());
      new Notice(r.duplicate ? "Already up to date in Caute."
        : r.supersedes ? "Published to Caute as a new version." : "Published to Caute.");
    } catch (e) {
      if (e instanceof CauteError && e.code === "insufficient_scope") {
        new Notice("This token can't save to Caute. Make one that can, or sign in.");
      } else {
        this.fail(e);
      }
    }
  }

  // --- related -------------------------------------------------------------

  private async related(editor: Editor): Promise<void> {
    if (!this.auth.connected()) {
      new Notice("Sign in to Caute in the plugin's settings first.");
      return;
    }
    const paragraph = paragraphAt(editor);
    if (paragraph.trim().length < 3) {
      new Notice("Click in a paragraph first.");
      return;
    }
    try {
      const items = await this.api.related(paragraph);
      new RelatedModal(this.app, items,
        (r) => editor.replaceSelection(markdownLink(r.item.title, cardUrl(this.settings.appUrl, r.item.id)))).open();
    } catch (e) {
      this.fail(e);
    }
  }
}

/** The paragraph holding the cursor: the lines around it up to blank lines. */
function paragraphAt(editor: Editor): string {
  const at = editor.getCursor().line;
  const blank = (n: number) => editor.getLine(n).trim() === "";
  if (blank(at)) return "";
  let first = at;
  let last = at;
  while (first > 0 && !blank(first - 1)) first--;
  while (last < editor.lineCount() - 1 && !blank(last + 1)) last++;
  const lines: string[] = [];
  for (let n = first; n <= last; n++) lines.push(editor.getLine(n));
  return lines.join("\n");
}
