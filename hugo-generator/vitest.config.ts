import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Default: run unit tests only (*.test.ts)
    // E2E tests use *.e2e.ts extension and require Hugo installed
    include: ["src/**/*.test.ts"],
    // E2E tests have longer timeouts
    testTimeout: 60000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules", "dist", "**/*.test.ts", "**/*.e2e.ts"],
    },
  },
});
