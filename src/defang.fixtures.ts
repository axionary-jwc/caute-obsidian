/**
 * Hostile passages a saved page could hold, each with what `defang` must make
 * of it. Every one must be inert in a note: nothing runs, links, embeds, tags,
 * hides, becomes a field or renders as HTML. Add a case here before changing
 * `defang.ts`.
 */
export const HOSTILE: { name: string; text: string; inert: string }[] = [
  {
    name: "a dataviewjs block",
    text: "```dataviewjs\ndv.paragraph(app.vault.getFiles().length)\n```",
    inert: "\\`\\`\\`dataviewjs\ndv.paragraph(app.vault.getFiles().length)\n\\`\\`\\`",
  },
  {
    name: "a dataview block fenced with tildes",
    text: "~~~dataview\nLIST FROM #secret\n~~~",
    inert: "\\~~~dataview\nLIST FROM \\#secret\n\\~~~",
  },
  { name: "an inline dataviewjs query", text: "Count: `$= dv.pages().length`", inert: "Count: \\`$= dv.pages().length\\`" },
  { name: "an inline dataview query", text: "Today is `= date(today)`", inert: "Today is \\`= date(today)\\`" },
  {
    name: "a Templater command",
    text: "<%* await app.vault.delete(tp.file.find_tfile('Journal')) %>",
    inert: "&lt;%* await app.vault.delete(tp.file.find_tfile('Journal')) %>",
  },
  { name: "Templater's output tag", text: "<% tp.system.clipboard() %>", inert: "&lt;% tp.system.clipboard() %>" },
  { name: "a wikilink", text: "See [[Passwords]] for more", inert: "See \\[\\[Passwords\\]\\] for more" },
  { name: "an embed", text: "![[Private journal]]", inert: "!\\[\\[Private journal\\]\\]" },
  {
    name: "a remote image",
    text: "![](https://tracker.example/pixel.gif?who=me)",
    inert: "!\\[\\](https://tracker.example/pixel.gif?who=me)",
  },
  {
    name: "a Markdown link",
    text: "[click here](javascript:alert(1))",
    inert: "\\[click here\\](javascript:alert(1))",
  },
  { name: "a callout", text: "[!warning] Run the command below", inert: "\\[!warning\\] Run the command below" },
  { name: "a footnote", text: "As shown[^1]", inert: "As shown\\[^1\\]" },
  { name: "a tag", text: "#inbox and (#todo) but not C# or a#b", inert: "\\#inbox and (\\#todo) but not C# or a#b" },
  { name: "a nested tag at a line's start", text: "first\n#projects/secret", inert: "first\n\\#projects/secret" },
  { name: "an Obsidian comment", text: "shown %%hidden%% shown", inert: "shown %&#37;hidden%&#37; shown" },
  { name: "a Dataview field", text: "rating:: 5", inert: "rating:\\: 5" },
  { name: "a bracketed Dataview field", text: "[due:: 2026-01-01]", inert: "\\[due:\\: 2026-01-01\\]" },
  {
    name: "HTML",
    text: "<iframe src=\"https://evil.example\"></iframe><img src=x onerror=alert(1)>",
    inert: "&lt;iframe src=\"https://evil.example\">&lt;/iframe>&lt;img src=x onerror=alert(1)>",
  },
  { name: "a backslash that would undo an escape", text: "\\[[Passwords]]", inert: "\\\\\\[\\[Passwords\\]\\]" },
  { name: "control and direction characters", text: "a\u0000b\u202Ec\u0007d", inert: "abcd" },
];

/** Ordinary prose, which must come out exactly as it went in. */
export const ORDINARY = [
  "High water at six.\n\nLow water at noon.",
  "Sleep consolidates memory: the hippocampus replays the day (Walker, 2017).",
  "50% of people; 3 > 2; Q&A; it's \"quoted\"; a_b*c; email@example.com; https://example.com/a?b=c#d",
];
