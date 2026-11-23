// ESLint flat config. CommonJS on purpose: the package is not "type": "module",
// so DOM-free extension modules can keep a `module.exports` guard for tests.
const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: ["node_modules/**", "release/**", "dist/**", "build/**", "coverage/**"]
  },
  js.configs.recommended,
  {
    // Extension sources: classic browser scripts (content scripts, popup, service worker).
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.serviceworker,
        // CommonJS export guard used by DOM-free modules (e.g. src/matching.js).
        module: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // `let x = ""` defaults before a try block are an intentional style here.
      "no-useless-assignment": "off",
      // Subject normalization deliberately strips zero-width / variation-selector code points.
      "no-misleading-character-class": "warn",
      // Localized number parsing matches literal NBSP / narrow NBSP inside regexes.
      "no-irregular-whitespace": ["error", { skipRegExps: true, skipStrings: true }]
    }
  },
  {
    // Node-side tooling (CommonJS).
    files: ["eslint.config.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node }
    }
  },
  {
    // Tests and vitest config are ES modules running in Node (with jsdom globals).
    files: ["vitest.config.mjs", "tests/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser }
    }
  }
];
