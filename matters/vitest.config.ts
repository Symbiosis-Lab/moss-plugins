import { createSocialPluginConfig } from "../vitest.shared.ts";

export default createSocialPluginConfig(import.meta.dirname, {
  coverageExclude: ["src/**/*.test.ts", "src/__generated__/**"],
  extraProjects: [
    {
      extends: true,
      test: {
        name: "features",
        include: ["features/steps/**/*.steps.ts"],
        environment: "node",
        testTimeout: 120000,
        hookTimeout: 60000,
        globals: true,
        setupFiles: ["./test-setup/e2e.ts"],
      },
    },
    {
      extends: true,
      test: {
        name: "e2e",
        include: ["e2e/**/*.test.ts"],
        environment: "node",
        testTimeout: 120000,
        hookTimeout: 60000,
      },
    },
  ],
});
