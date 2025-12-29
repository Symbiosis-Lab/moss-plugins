import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/__generated__/**"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          environment: "happy-dom",
        },
      },
      {
        extends: true,
        test: {
          name: "features",
          include: ["features/steps/**/*.steps.ts"],
          environment: "node",
          testTimeout: 120000, // 2 minutes for real API calls
          hookTimeout: 60000,
          globals: true,
          setupFiles: ["./test-setup/e2e.ts"],
        },
      },
    ],
  },
});
