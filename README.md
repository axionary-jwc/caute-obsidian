# Caute for Obsidian

Link, quote and search what you've caught in [Caute](https://getcaute.com), and publish notes to your library,
from inside Obsidian. By Axionary Labs, MIT licensed.

You need a Caute account. Caute is a separate service, with a free plan, at https://getcaute.com.

## What it does

- **Card links show as chips.** Paste a link to a card (`https://app.getcaute.com/c/…`) and it shows the card's
  title, what kind of thing it is, and where it lives. A link to a card you can't open shows "Unavailable" and
  nothing more.
- **Insert a card** (command, or type `@@` and a few words): search your library and insert a link to a card.
- **Quote a passage** (command): search for a passage and insert it as a quote that says where it came from.
- **Publish this note** (command): save the note to your library. Publishing it again after changes
  asks whether to keep the earlier copy as a version or replace it. The first time, the plugin adds a `caute_id`
  property to the note, so it can tell it's the same note after a rename.
- **Related cards for this paragraph** (command): cards in your library close in meaning to the paragraph
  the cursor is in, to link to.

## Signing in

On a computer, open the plugin's settings and choose **Sign in**. Caute opens in your browser, where you choose
which spaces Obsidian can see. Obsidian asks for permission to read and search; it asks to save only the first
time you publish a note.

On a phone or tablet, make a personal token in Caute (Settings, Apps and tokens) and paste it in the plugin's
settings.

Your sign-in is kept in Obsidian's secret storage on this device. It is never written into the vault, so it
doesn't travel with your sync or git. To disconnect, sign out here, or remove "Caute for Obsidian" under Apps
and tokens in Caute's settings; the plugin notices on its next request.

## What leaves your vault

Only what you ask for:

- a note, when you publish it;
- the paragraph the cursor is in, when you ask for related cards;
- the ids in card links, to show their chips;
- what you type into the Caute search box.

Nothing else in the vault is read or sent. Caute keeps nothing from Obsidian except the notes you publish.

## Building

```sh
npm install
npm run build      # main.js, beside manifest.json and styles.css
npm test
```

To try it, copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/caute/` and turn
it on under Community plugins. For a development server, set the addresses under Advanced (for example
`http://api.caute.localhost:8000` and `http://app.caute.localhost:8000`).
