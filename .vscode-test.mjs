import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  // Unit tests run under Vitest; only tests that need the extension host
  // are compiled and launched here.
  files: "out/test/**/*.integration.test.js",
});
