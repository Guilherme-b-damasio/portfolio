import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "test-results", "playwright-report"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: { globals: globals.node },
    rules: {
      // `_name` marks a value that is destructured away on purpose (e.g. dropping `body`).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      eqeqeq: ["error", "smart"],
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: { globals: globals.browser, sourceType: "module" },
    rules: {
      // API data must reach the DOM through textContent, never as markup.
      "no-restricted-properties": [
        "error",
        { property: "innerHTML", message: "Build nodes and use textContent." },
        { property: "outerHTML", message: "Build nodes and use textContent." },
        { property: "insertAdjacentHTML", message: "Build nodes and use textContent." },
      ],
    },
  },
  {
    files: ["*.config.js"],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
