import { defineConfig } from "vitest/config";

// Scope Vitest to src/ so it does not try to load Playwright specs from
// e2e/. The Playwright runner has its own loader and a different test
// API; running them under Vitest produces spurious failures.
export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
