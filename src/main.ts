/**
 * Caute for Obsidian (ADR 0115): Caute as a companion inside Obsidian, on the
 * same contract Thoute uses (DESIGN.md 22.3). Card links render as chips,
 * cards and quotes come in from a picker, a note can be published to the
 * library, and the Caute pane finds sources for the paragraph being written
 * (ADR 0132).
 *
 * Nothing from the vault reaches Caute except the note being published, the
 * paragraph sent for sources and what is typed into the pane's search, each
 * on an explicit action (INV-44).
 */

import { Editor, MarkdownView, Notice, Plugin, TFile, normalizePath } from "obsidian";
import { Caute, CauteError, type SearchResult } from "./api";
import { CauteAuth, type OAuthState } from "./auth";
import { PreviewCache, chipPostProcessor, chipViewPlugin } from "./chips";
import { cardUrl, findCardLinks, markdownLink } from "./links";
import { answerFileName, answerNote } from "./answers";
import { citedLinks, sourcesList, toFootnotes, type Citable } from "./citations";
import { CardLinkSuggest, CardSearchModal, ask, askQuestion } from "./modals";
import { CautePane, PANE } from "./pane";
import { paragraphAt } from "./passages";
import { PUBLISH_SCOPES, SignInError, hasScopes } from "./oauth";
import { POINTER_ACTION, cardsIn, gone, noteAt, pointerFor, type Registry } from "./quotedin";
import { ID_PROPERTY, publishId, publishRequest, publishedBody } from "./publishing";
import { anchorFragment, markdownQuote } from "./quote";
import { CauteSettingTab, DEFAULT_SETTINGS, type CauteSettings } from "./settings";

interface Stored extends CauteSettings {
  oauth: OAuthState | null;
  /** "Quoted in" (ADR 0134): null until asked, then the person's answer. */
  quotedIn?: boolean | null;
  quotedRegistry?: Registry;
}

export default class CautePlugin extends Plugin {
  settings: CauteSettings = { ...DEFAULT_SETTINGS };
  private oauth: OAuthState | null = null;
  quotedIn: boolean | null = null;
  private registry: Registry = {};
  private reconciling = new Map<string, number>();
  private editorFile: TFile | null = null;
  auth!: CauteAuth;
  private api!: Caute;
  private cache!: PreviewCache;
  private tab!: CauteSettingTab;
  /** The editor last typed in, so the pane can read and write it while it has focus itself. */
  private editor: Editor | null = null;
  private statusEl!: HTMLElement;
  private statusTimer: number | null = null;

  async onload(): Promise<void> {
    const stored = (await this.loadData()) as Partial<Stored> | null;
    this.settings = {
      apiUrl: stored?.apiUrl || DEFAULT_SETTINGS.apiUrl,
      appUrl: stored?.appUrl || DEFAULT_SETTINGS.appUrl,
      answersFolder: stored?.answersFolder || DEFAULT_SETTINGS.answersFolder,
    };
    this.oauth = stored?.oauth ?? null;
    this.quotedIn = stored?.quotedIn ?? null;
    this.registry = stored?.quotedRegistry ?? {};

    this.auth = new CauteAuth(this.app, () => this.settings.apiUrl, () => this.oauth,
      async (s) => { this.oauth = s; await this.persist(); },
      () => { this.cache?.clear(); this.tab?.refresh(); });
    this.api = new Caute(() => this.settings.apiUrl, this.auth);
    this.cache = new PreviewCache(() => (this.auth.connected() ? this.api : null));

    const appUrl = () => this.settings.appUrl;
    this.registerMarkdownPostProcessor(chipPostProcessor(this.cache, appUrl));
    this.registerEditorExtension(chipViewPlugin(this.cache, appUrl));
    this.registerEditorSuggest(new CardLinkSuggest(this.app, () => (this.auth.connected() ? this.api : null),
      (r) => this.inserting(this.app.workspace.getActiveFile(), this.linkTo(r))));

    this.addCommand({
      id: "insert-card", name: "Insert a card",
      editorCallback: (editor) => this.whenConnected(() => new CardSearchModal(this.app, this.api, "picker",
        "Find a card to link", (r) => editor.replaceSelection(this.inserting(this.app.workspace.getActiveFile(),
          this.linkTo(r)))).open()),
    });
    this.addCommand({
      id: "quote", name: "Quote a passage",
      editorCallback: (editor) => this.whenConnected(() => new CardSearchModal(this.app, this.api, "search",
        "Find a passage to quote", (r) => editor.replaceSelection(this.inserting(this.app.workspace.getActiveFile(),
          this.quoteOf(r)))).open()),
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
    this.statusEl = this.addStatusBarItem();
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf?.view instanceof MarkdownView) {
        this.editor = leaf.view.editor;
        this.editorFile = leaf.view.file;
      }
    }));
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    this.editor = view?.editor ?? null;
    this.editorFile = view?.file ?? null;
    this.registerView(PANE, (leaf) => new CautePane(leaf, {
      api: () => (this.auth.connected() ? this.api : null),
      appUrl: () => this.settings.appUrl,
      paragraph: () => (this.editor ? paragraphOf(this.editor) : ""),
      insert: (text) => {
        if (!this.editor) return false;
        this.editor.replaceSelection(this.inserting(this.editorFile, text));
        this.editor.focus();
        return true;
      },
      status: (text) => this.status(text),
    }));
    this.addRibbonIcon("quote", "Open the Caute pane", () => void this.openPane());
    this.addCommand({ id: "open-pane", name: "Open the pane", callback: () => void this.openPane() });
    // Keeps the id of the command it replaces, so a hotkey someone gave it still works.
    this.addCommand({
      id: "related", name: "Find sources for this paragraph",
      editorCallback: (editor) => {
        this.editor = editor;
        void this.findSources(editor);
      },
    });

    this.addCommand({ id: "ask", name: "Ask a question", callback: () => void this.askCaute() });
    this.addCommand({
      id: "footnotes", name: "Turn card links into footnotes",
      editorCallback: (editor) => void this.cite(editor, "footnotes"),
    });
    this.addCommand({
      id: "sources", name: "Insert sources list",
      editorCallback: (editor) => void this.cite(editor, "list"),
    });

    this.registerEvent(this.app.vault.on("modify", (f) => {
      if (f instanceof TFile && noteAt(this.registry, f.path)) this.reconcileSoon(f);
    }));
    this.registerEvent(this.app.vault.on("rename", (f, oldPath) => {
      const id = noteAt(this.registry, oldPath);
      if (id) {
        this.registry[id].path = f.path;
        void this.persist();
      }
    }));
    this.registerEvent(this.app.vault.on("delete", (f) => {
      const id = noteAt(this.registry, f.path);
      if (id) void this.forget(id);
    }));
    this.registerObsidianProtocolHandler(POINTER_ACTION, (params) => void this.openPointer(params.id));

    this.tab = new CauteSettingTab(this.app, this);
    this.addSettingTab(this.tab);
  }

  async saveSettings(): Promise<void> {
    this.cache.clear();
    await this.persist();
  }

  private async persist(): Promise<void> {
    const data: Stored = { ...this.settings, oauth: this.oauth, quotedIn: this.quotedIn,
                           quotedRegistry: this.registry };
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

  // --- the pane ----------------------------------------------------------

  private async openPane(): Promise<CautePane | null> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(PANE)[0];
    if (!leaf) {
      const side = workspace.getRightLeaf(false);
      if (!side) return null;
      await side.setViewState({ type: PANE, active: true });
      leaf = side;
    }
    await workspace.revealLeaf(leaf);
    return leaf.view instanceof CautePane ? leaf.view : null;
  }

  private async findSources(editor: Editor): Promise<void> {
    if (!this.auth.connected()) {
      new Notice("Sign in to Caute in the plugin's settings first.");
      return;
    }
    const paragraph = paragraphOf(editor);
    const pane = await this.openPane();
    await pane?.findSources(paragraph);
  }

  // --- quoted in ----------------------------------------------------------

  /** Text about to go into a note: returned as it is, and its card links registered once it's in. */
  private inserting(file: TFile | null, text: string): string {
    window.setTimeout(() => void this.quoted(file, text), 0);
    return text;
  }

  private async quoted(file: TFile | null, text: string): Promise<void> {
    if (!file || file.extension !== "md" || !this.auth.connected()) return;
    const cards = cardsIn(text, this.settings.appUrl);
    if (!cards.length) return;
    if (this.quotedIn === null) {
      const yes = await ask(this.app, "Show in Caute where you quote each card?", [
        "Caute can list, on each card, the notes here that quote or link it, so rereading a source takes you"
          + " back to what you wrote.",
        `Caute keeps only an id for each note, never its name or text. Each note that quotes a card gets a ${ID_PROPERTY}`
          + " property to hold that id. You can turn this off in the plugin's settings.",
      ], [{ label: "Show them", value: true, cta: true }, { label: "Not now", value: false }]);
      this.quotedIn = yes === true;
      await this.persist();
      this.tab?.refresh();
    }
    if (!this.quotedIn) return;
    let id = publishId(this.app.metadataCache.getFileCache(file)?.frontmatter);
    if (!id) {
      const fresh = crypto.randomUUID();
      await this.app.fileManager.processFrontMatter(file, (fm) => { (fm as Record<string, unknown>)[ID_PROPERTY] = fresh; });
      id = fresh;
    }
    const entry = (this.registry[id] ??= { path: file.path, refs: {} });
    entry.path = file.path;
    try {
      for (const card of cards) {
        if (entry.refs[card]) continue;
        try {
          entry.refs[card] = (await this.api.addRef(card, pointerFor(id))).id;
        } catch (e) {
          if (!(e instanceof CauteError && e.status === 404)) throw e;
        }
      }
    } catch (e) {
      this.fail(e);
    } finally {
      await this.persist();
    }
  }

  /** A few seconds after a note changes, take away the pointers of cards it no longer links to. */
  private reconcileSoon(file: TFile): void {
    const waiting = this.reconciling.get(file.path);
    if (waiting) window.clearTimeout(waiting);
    this.reconciling.set(file.path, window.setTimeout(() => {
      this.reconciling.delete(file.path);
      void this.reconcile(file);
    }, 3000));
  }

  private async reconcile(file: TFile): Promise<void> {
    const id = noteAt(this.registry, file.path);
    if (!id || !this.auth.connected()) return;
    const entry = this.registry[id];
    try {
      for (const card of gone(entry, await this.app.vault.cachedRead(file), this.settings.appUrl)) {
        await this.api.removeRef(card, entry.refs[card]);
        delete entry.refs[card];
      }
    } catch {
      return; // tried again on the next change
    } finally {
      if (!Object.keys(entry.refs).length) delete this.registry[id];
      await this.persist();
    }
  }

  /** Take every pointer of one note out of Caute, as when the note is deleted. */
  private async forget(id: string): Promise<void> {
    const entry = this.registry[id];
    if (!entry) return;
    try {
      for (const [card, ref] of Object.entries(entry.refs)) {
        await this.api.removeRef(card, ref);
        delete entry.refs[card];
      }
      delete this.registry[id];
    } catch (e) {
      this.fail(e);
    } finally {
      await this.persist();
    }
  }

  /** Turn "Quoted in" on or off; turning it off offers to take away what Caute already has. */
  async setQuotedIn(on: boolean): Promise<void> {
    this.quotedIn = on;
    await this.persist();
    if (on || !Object.keys(this.registry).length) return;
    const remove = await ask(this.app, "Remove them from Caute too?", [
      "Caute still lists the notes here that quoted its cards before. Remove those, or keep them?",
    ], [{ label: "Remove them", value: true, cta: true }, { label: "Keep them", value: false }]);
    if (!remove) return;
    for (const id of Object.keys(this.registry)) await this.forget(id);
    new Notice("Removed from Caute.");
  }

  /** `obsidian://caute-note?id=…`, from a card's Links tab in Caute: open that note. */
  private async openPointer(id: string | undefined): Promise<void> {
    // Only the notes this plugin registered, where it last saw them (renames
    // are followed), rather than searching the whole vault: the plugin never
    // needs to list every file to do this.
    const wanted = (id ?? "").trim().toLowerCase();
    const known = this.registry[wanted]?.path;
    const file = known ? this.app.vault.getAbstractFileByPath(known) : null;
    if (!(file instanceof TFile) || publishId(this.app.metadataCache.getFileCache(file)?.frontmatter) !== wanted) {
      new Notice("That note isn't in this vault, or it was quoted from another device.");
      return;
    }
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  // --- ask ---------------------------------------------------------------

  /**
   * A question answered from the library, written as a note in the vault on
   * this device (INV-45). Only the question goes to Caute, which doesn't keep
   * it (ADR 0113 keeps Caute's own apps' questions only).
   */
  private async askCaute(): Promise<void> {
    if (!this.auth.connected()) {
      new Notice("Sign in to Caute in the plugin's settings first.");
      return;
    }
    const question = await askQuestion(this.app);
    if (!question) return;
    const asking = new Notice("Asking Caute…", 0);
    let said;
    try {
      said = await this.api.ask(question);
    } catch (e) {
      asking.hide();
      this.fail(e);
      return;
    } finally {
      asking.hide();
    }
    const { answer, results } = said;
    if (!answer) {
      new Notice("Caute can't answer questions right now. Try a search in the pane instead.");
      return;
    }
    if (!answer.citations.length && !/\[\d{1,2}\]/.test(answer.text)) {
      new Notice(answer.left_out
        ? `${answer.text} Some cards were left out because their space is kept away from AI.`
        : answer.text);
      return;
    }
    const folder = normalizePath(this.settings.answersFolder || DEFAULT_SETTINGS.answersFolder);
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    const base = answerFileName(question);
    let path = normalizePath(`${folder}/${base}.md`);
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${base} ${n}.md`);
    const file = await this.app.vault.create(path, answerNote(answer, results, question, this.settings.appUrl, new Date()));
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  // --- citations -----------------------------------------------------------

  /** Footnotes for every card link in the note, or a sources list at the cursor, from each card's properties. */
  private async cite(editor: Editor, shape: "footnotes" | "list"): Promise<void> {
    if (!this.auth.connected()) {
      new Notice("Sign in to Caute in the plugin's settings first.");
      return;
    }
    const note = editor.getValue();
    const appUrl = this.settings.appUrl;
    const links = shape === "footnotes" ? citedLinks(note, appUrl) : findCardLinks(note, appUrl);
    const ids = [...new Set(links.map((l) => l.id))];
    if (!ids.length) {
      new Notice("This note has no Caute card links.");
      return;
    }
    const cards = new Map<string, Citable | null>();
    try {
      for (let i = 0; i < ids.length; i += 6) {
        const batch = ids.slice(i, i + 6);
        const found = await Promise.all(batch.map((id) => this.api.card(id)));
        batch.forEach((id, n) => cards.set(id, found[n]));
      }
    } catch (e) {
      this.fail(e);
      return;
    }
    if (editor.getValue() !== note) {
      new Notice("The note changed while Caute was asked. Run it again.");
      return;
    }
    if (shape === "list") {
      editor.replaceSelection(sourcesList(note, appUrl, cards));
      return;
    }
    const last = editor.lastLine();
    // One change, so one undo puts every link back.
    editor.transaction({ changes: [{ from: { line: 0, ch: 0 }, to: { line: last, ch: editor.getLine(last).length },
                                     text: toFootnotes(note, appUrl, cards) }] });
    new Notice(`${ids.length === 1 ? "1 card" : `${ids.length} cards`} cited as footnotes.`);
  }

  private status(text: string): void {
    this.statusEl.setText(text);
    if (this.statusTimer !== null) window.clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => {
      this.statusEl.setText("");
      this.statusTimer = null;
    }, 4000);
  }
}

/** The paragraph holding the cursor, as `passages.paragraphAt` finds it. */
function paragraphOf(editor: Editor): string {
  const lines: string[] = [];
  for (let n = 0; n < editor.lineCount(); n++) lines.push(editor.getLine(n));
  return paragraphAt(lines, editor.getCursor().line);
}
