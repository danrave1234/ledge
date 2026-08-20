import js from "@eslint/js";
import ts from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import globals from "globals";

/** Flat config. Formatting is Prettier's job — this file is only about
    correctness rules, so the two never fight over the same code. */
export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2021 },
    },
    rules: {
      // Unused code is either a leftover or a bug; `_`-prefixed args are the
      // documented way to say "intentionally ignored".
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-var": "error",
    },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts"],
    languageOptions: {
      parserOptions: { parser: ts.parser },
    },
    rules: {
      // Svelte 5 runes ($state/$derived/$props) are reassigned by the compiler,
      // so they must be declared with `let`. The core rule can't see that and
      // would demand `const` on every rune.
      "prefer-const": "off",
    },
  },
  {
    // Build/tooling config runs in Node, not the browser.
    files: ["*.config.js", "*.config.ts", "svelte.config.js"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Tests get the Vitest globals they import explicitly plus Node APIs.
    files: ["**/*.test.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    ignores: ["build/", ".svelte-kit/", "src-tauri/", "node_modules/", "static/"],
  },
);
