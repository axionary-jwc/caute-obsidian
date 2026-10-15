import { App, Notice, Platform, PluginSettingTab, Setting } from "obsidian";
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

export class CauteSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: CautePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const auth = this.plugin.auth;
    containerEl.empty();

    new Setting(containerEl).setName("Account").setHeading();
    if (Platform.isDesktopApp) {
      if (auth.signedIn()) {
        const publishing = auth.scopes()?.includes("items:write");
        new Setting(containerEl)
          .setName("Signed in to Caute")
          .setDesc(publishing
            ? "Obsidian can read the cards you allowed, search them, and publish notes to Caute."
            : "Obsidian can read the cards you allowed and search them. Publishing a note asks for more.")
          .addButton((b) => b.setButtonText("Sign out").onClick(async () => {
            await auth.signOut();
            new Notice("Signed out of Caute.");
          }));
      } else {
        new Setting(containerEl)
          .setName("Sign in to Caute")
          .setDesc("Opens Caute in your browser, where you choose which spaces Obsidian can see.")
          .addButton((b) => b.setButtonText("Sign in").setCta().onClick(() => this.plugin.signIn(READ_SCOPES)));
      }
    }

    const tokenSetting = new Setting(containerEl)
      .setName("Personal token")
      .setDesc(Platform.isDesktopApp
        ? "Instead of signing in. Make one in Caute under Settings, Apps and tokens. Kept on this device only."
        : "Make one in Caute under Settings, Apps and tokens, with read and search, and save if you'll publish."
          + " Kept on this device only.")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder(auth.personalToken() ? "Saved" : "Paste a token")
          .onChange((v) => auth.setPersonalToken(v));
      });
    if (Platform.isDesktopApp && auth.signedIn()) tokenSetting.settingEl.hide();

    new Setting(containerEl).setName("What leaves this vault").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Only what you ask for: a note when you publish it, and the paragraph you're in when you ask for"
        + " related cards. Card links are looked up by their id. Nothing else in this vault is sent to Caute.",
    });

    new Setting(containerEl).setName("Advanced").setHeading();
    new Setting(containerEl)
      .setName("Caute API address")
      .addText((t) => t.setValue(this.plugin.settings.apiUrl).onChange(async (v) => {
        this.plugin.settings.apiUrl = v.trim() || DEFAULT_SETTINGS.apiUrl;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("Caute app address")
      .setDesc("Card links to this address show as chips.")
      .addText((t) => t.setValue(this.plugin.settings.appUrl).onChange(async (v) => {
        this.plugin.settings.appUrl = v.trim() || DEFAULT_SETTINGS.appUrl;
        await this.plugin.saveSettings();
      }));
  }
}
