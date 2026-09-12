import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  // Native Electron windows share macOS focus even across separate test files.
  workers: 1,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
});
