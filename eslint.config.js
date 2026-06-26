// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // Tuning: keep the bug-catching hook rule as a hard error (it caught the
    // scan.tsx "hook after early return" crash), and downgrade the noisy
    // React-Compiler advisory rules to warnings so `npm run check` stays a
    // clean, meaningful gate instead of drowning in pre-existing style hits.
    rules: {
      // Crash-class: a hook called conditionally / after an early return.
      "react-hooks/rules-of-hooks": "error",
      // React-Compiler advisories — real signal, but noisy here (reactCompiler
      // is on). Visible as warnings; they don't fail the gate.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      // Missing-deps: several intentional omissions exist; keep visible, audit
      // before promoting to error.
      "react-hooks/exhaustive-deps": "warn",
      // Pure style — apostrophes/quotes in JSX text render fine.
      "react/no-unescaped-entities": "off",
    },
  },
]);
