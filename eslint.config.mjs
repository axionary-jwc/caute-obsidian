// Obsidian's own rules, which its community directory's automated review applies.
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  { ignores: ["main.js", "node_modules", "src/**/*.test.ts", "esbuild.config.mjs"] },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.mjs"] },
      },
    },
    rules: {
      "obsidianmd/ui/sentence-case": ["warn", { brands: ["Caute", "Obsidian"] }],
    },
  },
]);
