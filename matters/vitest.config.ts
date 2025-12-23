import { defineConfig } from "vitest/config.js";

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
          testTimeout: 60000,
          hookTimeout: 30000,
          globals: true,
        },
      },
    ],
  },
});
