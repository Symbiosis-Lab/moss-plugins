import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["features/steps/**/*.steps.ts"],
    environment: "happy-dom",
    testTimeout: 60000, // Longer timeout for E2E tests
    hookTimeout: 30000,
    globals: true,
    // Separate from unit tests
    name: "features",
  },
});
