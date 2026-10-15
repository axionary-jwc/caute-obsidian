/**
 * The plugin's settings, described once and shown two ways: as setting
 * definitions on Obsidian 1.13 and later, which its settings search can find,
 * and drawn by `display()` on the versions before, which the plugin still
 * supports (minAppVersion 1.11.4).
 */

import { App, Notice, Platform, PluginSettingTab, Setting, requireApiVersion, type SettingDefinitionItem } from "obsidian";
import type CautePlugin from "./main";
import { READ_SCOPES } from "./oauth";

export interface CauteSettings {
  apiUrl: string;
  appUrl: string;
}

export const DEFAULT_SETTINGS: CauteSettings = {
  apiUrl: "https://api.getcaute.com",
  appUrl: "https://app.getcaute.com",
};

/** One row: its words, when it shows, and how to fill in its controls. */
interface Row {
  name: string;
  desc?: string;
  visible?: () => boolean;
  render?: (setting: Setting) => void;
}

interface Section {
  heading: string;
  rows: Row[];
}

export class CauteSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: CautePlugin) {
    super(app, plugin);
  }

  /** Show what changed, such as signing in or out, in whichever way the tab is drawn. */
  refresh(): void {
    if (requireApiVersion("1.13.0")) {
      this.update();
    } else {
      this.draw();
    }
  }

  private sections(): Section[] {
    const auth = this.plugin.auth;
    const signedIn = () => Platform.isDesktopApp && auth.signedIn();
    return [
      {
        heading: "Account",
        rows: [
          {
            name: "Signed in to Caute",
            desc: auth.scopes()?.includes("items:write")
              ? "Obsidian can read the cards you allowed, search them, and publish notes to Caute."
              : "Obsidian can read the cards you allowed and search them. Publishing a note asks for more.",
            visible: signedIn,
            render: (s) => {
              s.addButton((b) => b.setButtonText("Sign out").onClick(() => {
                void auth.signOut().then(() => new Notice("Signed out of Caute."));
              }));
            },
          },
          {
            name: "Sign in to Caute",
            desc: "Opens Caute in your browser, where you choose which spaces Obsidian can see.",
            visible: () => Platform.isDesktopApp && !auth.signedIn(),
            render: (s) => {
              s.addButton((b) => b.setButtonText("Sign in").setCta()
                .onClick(() => { void this.plugin.signIn(READ_SCOPES); }));
            },
          },
          {
            name: "Personal token",
            desc: Platform.isDesktopApp
              ? "Instead of signing in. Make one in Caute under Settings, Apps and tokens. Kept on this device only."
              : "Make one in Caute under Settings, Apps and tokens, with read and search, and save if you'll"
                + " publish. Kept on this device only.",
            visible: () => !signedIn(),
            render: (s) => {
              s.addText((t) => {
                t.inputEl.type = "password";
                t.setPlaceholder(auth.personalToken() ? "Saved" : "Paste a token")
                  .onChange((v) => auth.setPersonalToken(v));
              });
            },
          },
        ],
      },
      {
        heading: "What leaves this vault",
        rows: [{
          name: "Only what you ask for",
          desc: "A note when you publish it, the paragraph you're in when you ask for related cards, and what you"
            + " type into a search. Card links are looked up by their id. Nothing else in this vault is sent to"
            + " Caute.",
        }],
      },
      {
        heading: "Advanced",
        rows: [
          { name: "Caute API address", render: (s) => this.address(s, "apiUrl") },
          {
            name: "Caute app address", desc: "Card links to this address show as chips.",
            render: (s) => this.address(s, "appUrl"),
          },
        ],
      },
    ];
  }

  private address(s: Setting, key: keyof CauteSettings): void {
    s.addText((t) => t.setValue(this.plugin.settings[key]).onChange((v) => {
      this.plugin.settings[key] = v.trim() || DEFAULT_SETTINGS[key];
      void this.plugin.saveSettings();
    }));
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.sections().map((section) => ({
      type: "group" as const,
      heading: section.heading,
      items: section.rows.map((row) => ({
        name: row.name,
        ...(row.desc ? { desc: row.desc } : {}),
        ...(row.visible ? { visible: row.visible } : {}),
        render: (setting: Setting) => { row.render?.(setting); },
      })),
    }));
  }

  /** Obsidian before 1.13, which has no setting definitions. */
  display(): void {
    this.draw();
  }

  private draw(): void {
    const { containerEl } = this;
    containerEl.empty();
    for (const section of this.sections()) {
      new Setting(containerEl).setName(section.heading).setHeading();
      for (const row of section.rows) {
        if (row.visible && !row.visible()) continue;
        const setting = new Setting(containerEl).setName(row.name);
        if (row.desc) setting.setDesc(row.desc);
        row.render?.(setting);
      }
    }
  }
}
