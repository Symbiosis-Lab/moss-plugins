import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/__tests__/**"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/__tests__/*.test.ts"],
          exclude: ["src/__tests__/*.integration.test.ts"],
          environment: "node",
          globals: true,
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/__tests__/*.integration.test.ts"],
          environment: "happy-dom",
          globals: true,
          testTimeout: 30000,
        },
      },
      {
        extends: true,
        test: {
          name: "features",
          include: ["features/steps/**/*.steps.ts"],
          environment: "happy-dom",
          testTimeout: 60000,
          hookTimeout: 30000,
          globals: true,
        },
      },
    ],
  },
});
