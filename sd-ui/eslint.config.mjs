import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // The browser suite's own build (playwright.config.js), and what a run
    // leaves behind: the HTML report's bundled trace viewer is minified code.
    ".next-e2e/**",
    "tests-e2e/report/**",
    "tests-e2e/results/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
