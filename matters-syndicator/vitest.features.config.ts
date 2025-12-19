import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["features/steps/**/*.steps.ts"],
    // Use node environment for E2E tests with real network requests
    // happy-dom's fetch doesn't work well with external APIs
    environment: "node",
    testTimeout: 60000, // Longer timeout for E2E tests
    hookTimeout: 30000,
    globals: true,
    // Separate from unit tests
    name: "features",
  },
});
