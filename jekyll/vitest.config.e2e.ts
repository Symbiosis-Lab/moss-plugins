import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // E2E tests only
    include: ["src/**/*.e2e.ts"],
    // E2E tests have longer timeouts
    testTimeout: 120000,
    hookTimeout: 60000,
  },
});
