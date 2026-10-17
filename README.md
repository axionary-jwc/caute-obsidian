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
  Whatever a saved page holds stays words in your note: code blocks, Dataview queries, Templater commands,
  links, embeds, tags, comments and HTML are all escaped, so nothing quoted can run in your vault.
- **Ask a question** (command): ask something, and Caute answers from what you've caught. The answer is saved as a
  note in a "Caute answers" folder (you can choose another in settings), every claim linked to the card and the
  spot it came from, with its sources listed underneath. The answer is written by a model from your saved content,
  so its links, addresses and hashtags are taken out and the rest escaped before it becomes a note. Caute doesn't
  keep questions asked from Obsidian.
- **Turn card links into footnotes** (command): each Caute card link in the note becomes a footnote, which reads
  `Authors (Year). Title. Venue. https://doi.org/…` from the card's properties in Caute, then a link to the card.
  A card without them gets its title and when it was caught. Only properties you've confirmed in Caute are used.
  One undo puts the links back. **Insert sources list** writes the same entries as a list at the cursor.
- **Quoted in Caute** (asked the first time you quote or link a card; a switch in settings): each card you quote or
  link lists the note on its Links tab in Caute, under "Quoted in your notes", and clicking it there opens the note
  here. Caute keeps only an id for the note, held in its `caute_id` property, never its name, path or text. Removing
  the link from the note removes it from Caute a few seconds later, and so does deleting the note.
- **Publish this note** (command): save the note to your library. Publishing it again after changes
  asks whether to keep the earlier copy as a version or replace it. The first time, the plugin adds a `caute_id`
  property to the note, so it can tell it's the same note after a rename.
- **The Caute pane** (the quote icon in the ribbon, or **Open the pane**): your library beside the note, in three
  tabs.
  - **For this paragraph**: run **Find sources for this paragraph**, or press **Use this paragraph**, and Caute
    shows the passages in your library closest in meaning to the paragraph the cursor is in: from pages, PDFs,
    books, emails and the transcripts of recordings, whether or not you highlighted them. Your own highlights come
    first. Nothing is sent while you type, and the status bar says when a paragraph was sent.
  - **Search**: search your library and see the passage each result matched.
  - **Highlights**: the passages you've marked in Caute.

  Each passage says where it is (a page, a moment in a recording, a chapter). **Insert quote** puts it in your
  note as a quote whose link opens the card at that spot with those words marked; select part of a passage first
  to quote only that part. You can also drag a passage into the note, insert only a link, or open it in Caute.
  With the keyboard, arrow keys move between passages and Enter quotes one.

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
- the paragraph the cursor is in, when you ask for sources for it;
- a question, when you ask one;
- the ids in card links, to show their chips;
- what you type into a Caute search box, in the pane or a picker.
- if you turn on Quoted in Caute, an id for each note that quotes or links a card.

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
