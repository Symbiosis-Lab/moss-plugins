/**
 * Step definitions for GitHub Deployer validation tests
 *
 * Uses @symbiosis-lab/moss-api/testing to mock Tauri IPC commands
 */

import { loadFeature, describeFeature } from "@amiceli/vitest-cucumber";
import { expect, vi } from "vitest";
import {
  setupMockTauri,
  type MockTauriContext,
} from "@symbiosis-lab/moss-api/testing";
import type { OnDeployContext, HookResult } from "../../src/types";

// Load the feature file
const feature = await loadFeature("features/deploy/validation.feature");

// Mock the utils module
vi.mock("../../src/utils", () => ({
  log: vi.fn().mockResolvedValue(undefined),
  reportProgress: vi.fn().mockResolvedValue(undefined),
  reportError: vi.fn().mockResolvedValue(undefined),
  setCurrentHookName: vi.fn(),
}));

// Import after mocking
const { on_deploy } = await import("../../src/main");

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  // Test state
  let ctx: MockTauriContext;
  let projectPath: string;
  let deployResult: HookResult | null = null;

  /**
   * Create a mock OnDeployContext for testing
   */
  function createMockContext(): OnDeployContext {
    return {
      project_path: projectPath,
      moss_dir: `${projectPath}/.moss`,
      output_dir: `${projectPath}/.moss/site`,
      site_files: ["index.html"],
      project_info: {
        project_type: "markdown",
        content_folders: ["posts"],
        total_files: 10,
        homepage_file: "index.md",
      },
      config: {},
    };
  }

  BeforeEachScenario(() => {
    ctx = setupMockTauri();
    projectPath = "/test/project";
    deployResult = null;
    vi.clearAllMocks();
  });

  AfterEachScenario(() => {
    ctx.cleanup();
  });

  // ============================================================================
  // Scenario: Deploy from non-git directory shows repo setup UI
  // The new behavior shows a browser UI for repo setup instead of an error
  // ============================================================================

  Scenario("Deploy from non-git directory", ({ Given, When, Then, And }) => {
    Given("the directory is not a git repository", () => {
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: false,
        exitCode: 128,
        stdout: "",
        stderr: "fatal: not a git repository",
      });
      // Git --version check passes (git is available)
      ctx.binaryConfig.setResult("git --version", {
        success: true,
        exitCode: 0,
        stdout: "git version 2.39.0",
        stderr: "",
      });
    });

    When("I attempt to deploy", async () => {
      // The deploy hook will try to show repo-setup browser, which times out or cancels
      // in test environment since there's no UI interaction
      deployResult = await on_deploy(createMockContext());
    });

    Then("the deployment should fail", () => {
      expect(deployResult?.success).toBe(false);
    });

    And('the error should indicate setup was cancelled', () => {
      // New behavior: shows repo setup UI, returns cancelled when no interaction
      expect(deployResult?.message).toContain("cancelled");
    });
  });

  // ============================================================================
  // Scenario: Deploy without any git remote
  // ============================================================================

  Scenario("Deploy without any git remote", ({ Given, When, Then, And }) => {
    Given("the directory is a git repository", () => {
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });
    });

    And("no git remote is configured", () => {
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: false,
        exitCode: 128,
        stdout: "",
        stderr: "fatal: No such remote 'origin'",
      });
      // Set up site files so that validation proceeds to remote check
      ctx.filesystem.setFile(`${projectPath}/.moss/site/index.html`, "<html></html>");
    });

    When("I attempt to deploy", async () => {
      deployResult = await on_deploy(createMockContext());
    });

    Then("the deployment should fail", () => {
      expect(deployResult?.success).toBe(false);
    });

    And('the error should mention "No git remote configured"', () => {
      // Updated to reflect new repo creation flow messaging
      expect(deployResult?.message).toContain("No GitHub repository configured");
    });

    And("the error should include instructions to add a GitHub remote", () => {
      // Updated to reflect new repo creation flow messaging
      expect(deployResult?.message).toContain("create a repository or add a remote");
    });
  });

  // ============================================================================
  // Scenario: Deploy with non-GitHub remote
  // ============================================================================

  Scenario("Deploy with non-GitHub remote", ({ Given, When, Then, And }) => {
    Given("the directory is a git repository", () => {
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });
    });

    And('the git remote is "git@gitlab.com:user/repo.git"', () => {
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@gitlab.com:user/repo.git",
        stderr: "",
      });
    });

    And('the site is compiled with files in ".moss/site/"', () => {
      ctx.filesystem.setFile(`${projectPath}/.moss/site/index.html`, "<html></html>");
    });

    When("I attempt to deploy", async () => {
      deployResult = await on_deploy(createMockContext());
    });

    Then("the deployment should fail", () => {
      expect(deployResult?.success).toBe(false);
    });

    And('the error should mention "is not a GitHub URL"', () => {
      expect(deployResult?.message).toContain("is not a GitHub URL");
    });

    And("the error should explain that GitHub Pages only works with GitHub", () => {
      expect(deployResult?.message).toContain("GitHub Pages deployment only works with GitHub");
    });
  });

  // ============================================================================
  // Scenario: Deploy with empty site directory
  // ============================================================================

  Scenario("Deploy with empty site directory", ({ Given, When, Then, And }) => {
    Given("the directory is a git repository", () => {
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });
    });

    And('the git remote is "git@github.com:user/repo.git"', () => {
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });
    });

    And("the site directory is empty", () => {
      // Don't set any files in .moss/site/
      // The mock filesystem is empty by default
    });

    When("I attempt to deploy", async () => {
      deployResult = await on_deploy(createMockContext());
    });

    Then("the deployment should fail", () => {
      expect(deployResult?.success).toBe(false);
    });

    And("the error should mention that the site needs to be compiled", () => {
      expect(deployResult?.message).toMatch(/site.*empty|compile.*first|not found/i);
    });
  });

  // ============================================================================
  // Scenario: Successful deployment with SSH remote
  // ============================================================================

  Scenario("Successful deployment with SSH remote", ({ Given, When, Then, And }) => {
    Given("the directory is a git repository", () => {
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });
    });

    And('the git remote is "git@github.com:testuser/testrepo.git"', () => {
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:testuser/testrepo.git",
        stderr: "",
      });
    });

    And('the site is compiled with files in ".moss/site/"', () => {
      ctx.filesystem.setFile(`${projectPath}/.moss/site/index.html`, "<html></html>");
    });

    And("the GitHub Actions workflow already exists", () => {
      ctx.binaryConfig.setResult("git ls-files --error-unmatch .github/workflows/moss-deploy.yml", {
        success: true,
        exitCode: 0,
        stdout: ".github/workflows/moss-deploy.yml",
        stderr: "",
      });
      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });
      // Default success for other git commands
      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
    });

    When("I attempt to deploy", async () => {
      deployResult = await on_deploy(createMockContext());
    });

    Then("the deployment should succeed", () => {
      expect(deployResult?.success).toBe(true);
    });

    And('the deployment URL should be "https://testuser.github.io/testrepo"', () => {
      expect(deployResult?.deployment?.url).toBe("https://testuser.github.io/testrepo");
    });
  });

  // ============================================================================
  // Scenario: First-time deployment creates workflow
  // ============================================================================

  Scenario("First-time deployment creates workflow", ({ Given, When, Then, And }) => {
    Given("the directory is a git repository", () => {
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });
    });

    And('the git remote is "git@github.com:user/repo.git"', () => {
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });
    });

    And('the site is compiled with files in ".moss/site/"', () => {
      ctx.filesystem.setFile(`${projectPath}/.moss/site/index.html`, "<html></html>");
      ctx.filesystem.setFile(`${projectPath}/.gitignore`, "node_modules/");
    });

    And("the GitHub Actions workflow does not exist", () => {
      ctx.binaryConfig.setResult("git ls-files --error-unmatch .github/workflows/moss-deploy.yml", {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "error: pathspec did not match",
      });
      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });
      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });
      // Default success for other git commands
      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
    });

    When("I attempt to deploy", async () => {
      deployResult = await on_deploy(createMockContext());
    });

    Then("the deployment should succeed", () => {
      expect(deployResult?.success).toBe(true);
    });

    And("the result should indicate first-time setup", () => {
      expect(deployResult?.deployment?.metadata?.was_first_setup).toBe("true");
    });
  });
});
