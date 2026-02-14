/**
 * Step definitions for GitHub Deployer validation tests
 *
 * Uses @symbiosis-lab/moss-api/testing to mock Tauri IPC commands
 *
 * Updated for REST API deployment flow (replaces git CLI worktree+push).
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
  reportComplete: vi.fn().mockResolvedValue(undefined),
  setCurrentHookName: vi.fn(),
  showToast: vi.fn().mockResolvedValue(undefined),
  dismissToast: vi.fn().mockResolvedValue(undefined),
  closeBrowser: vi.fn().mockResolvedValue(undefined),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

// Mock the github-deploy module (REST API functions)
vi.mock("../../src/github-deploy", () => ({
  getGhPagesState: vi.fn(),
  getRemoteTree: vi.fn(),
  diffFiles: vi.fn(),
  deployViaAPI: vi.fn(),
}));

// Mock the auth module
vi.mock("../../src/auth", () => ({
  promptLogin: vi.fn(),
  checkAuthentication: vi.fn(),
  validateToken: vi.fn(),
  hasRequiredScopes: vi.fn(),
}));

// Mock the token module
vi.mock("../../src/token", () => ({
  getToken: vi.fn(),
  getTokenFromGit: vi.fn(),
  storeToken: vi.fn(),
  clearToken: vi.fn(),
}));

// Mock the git module (only functions still imported by main.ts)
vi.mock("../../src/git", () => ({
  extractGitHubPagesUrl: vi.fn().mockImplementation((remoteUrl: string) => {
    const m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (m) return `https://${m[1]}.github.io/${m[2]}`;
    return "https://user.github.io/repo";
  }),
  parseGitHubUrl: vi.fn().mockImplementation((remoteUrl: string) => {
    const m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (m) return { owner: m[1], repo: m[2] };
    return null;
  }),
  tryGetRemoteUrl: vi.fn(),
  getLocalSiteFingerprint: vi.fn(),
  isGitRepository: vi.fn(),
  isGitAvailable: vi.fn(),
  getRemoteUrl: vi.fn(),
  hasGitRemote: vi.fn(),
  initGitRepository: vi.fn(),
  addRemote: vi.fn(),
  ensureRemote: vi.fn(),
  hasUpstream: vi.fn(),
  hasLocalCommits: vi.fn(),
  remoteHasCommits: vi.fn(),
  pushWithUpstream: vi.fn(),
  pushWithRetry: vi.fn(),
}));

// Mock the validation module (main.ts imports from this)
vi.mock("../../src/validation", () => ({
  validateAll: vi.fn().mockImplementation(async (existingUrl?: string) => {
    return existingUrl || "git@github.com:test-user/test-repo.git";
  }),
  isSSHRemote: vi.fn().mockImplementation((url: string) => {
    return url.startsWith("git@") || url.startsWith("ssh://");
  }),
  isGitRepository: vi.fn().mockResolvedValue(true),
  isGitAvailable: vi.fn().mockResolvedValue(true),
  initGitRepository: vi.fn().mockResolvedValue(undefined),
  ensureRemote: vi.fn().mockResolvedValue(undefined),
  hasRemote: vi.fn().mockResolvedValue(true),
  hasUpstream: vi.fn().mockResolvedValue(true),
  hasLocalCommits: vi.fn().mockResolvedValue(true),
  remoteHasCommits: vi.fn().mockResolvedValue(true),
  pushWithUpstream: vi.fn().mockResolvedValue(undefined),
  pushWithRetry: vi.fn().mockResolvedValue(undefined),
}));

// Mock the repo-setup module
vi.mock("../../src/repo-setup", () => ({
  ensureGitHubRepo: vi.fn(),
}));

// Mock the github-api module
vi.mock("../../src/github-api", () => ({
  checkPagesStatus: vi.fn().mockResolvedValue({ status: "built" }),
  getAuthenticatedUser: vi.fn(),
  checkRepoExists: vi.fn(),
  createRepository: vi.fn(),
}));

// Import after mocking
const { on_deploy } = await import("../../src/main");
const { getGhPagesState, getRemoteTree, diffFiles, deployViaAPI } = await import("../../src/github-deploy");
const { getToken, getTokenFromGit } = await import("../../src/token");
const { tryGetRemoteUrl, getLocalSiteFingerprint, parseGitHubUrl, extractGitHubPagesUrl } = await import("../../src/git");
const { checkPagesStatus } = await import("../../src/github-api");
const { validateAll, isGitRepository, isGitAvailable, isSSHRemote } = await import("../../src/validation");
const { ensureGitHubRepo } = await import("../../src/repo-setup");

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  // Test state
  let ctx: MockTauriContext;
  let projectPath: string;
  let deployResult: HookResult | null = null;
  let scenarioSiteFiles: string[] = ["index.html"]; // Default site files (Bug 13: context-based validation)

  /**
   * Create a mock OnDeployContext for testing
   * Bug 13 fix: Uses scenarioSiteFiles which can be overridden per scenario
   */
  function createMockContext(): OnDeployContext {
    return {
      project_path: projectPath,
      moss_dir: `${projectPath}/.moss`,
      output_dir: `${projectPath}/.moss/site`,
      site_files: scenarioSiteFiles, // Bug 13: use context.site_files for validation
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
    scenarioSiteFiles = ["index.html"]; // Reset to default (Bug 13)
    vi.clearAllMocks();

    // Restore default implementations after clearAllMocks
    // (clearAllMocks removes mockImplementation set in factory functions)
    vi.mocked(parseGitHubUrl).mockImplementation((remoteUrl: string) => {
      const m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
      if (m) return { owner: m[1], repo: m[2] };
      return null;
    });
    vi.mocked(extractGitHubPagesUrl).mockImplementation((remoteUrl: string) => {
      const m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
      if (m) return `https://${m[1]}.github.io/${m[2]}`;
      return "https://user.github.io/repo";
    });
    vi.mocked(validateAll).mockImplementation(async (existingUrl?: string) => {
      return existingUrl || "git@github.com:test-user/test-repo.git";
    });
    vi.mocked(isSSHRemote).mockImplementation((url: string) => {
      return url.startsWith("git@") || url.startsWith("ssh://");
    });
    vi.mocked(isGitRepository).mockResolvedValue(true);
    vi.mocked(isGitAvailable).mockResolvedValue(true);
    vi.mocked(checkPagesStatus).mockResolvedValue({ status: "built" });
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
      // Not a git repo
      vi.mocked(isGitRepository).mockResolvedValue(false);
      // Git is available
      vi.mocked(isGitAvailable).mockResolvedValue(true);
      // tryGetRemoteUrl returns null
      vi.mocked(tryGetRemoteUrl).mockResolvedValue(null);
      // ensureGitHubRepo returns null (user cancelled)
      vi.mocked(ensureGitHubRepo).mockResolvedValue(null);
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
      vi.mocked(isGitRepository).mockResolvedValue(true);
    });

    And("no git remote is configured", () => {
      // No remote
      vi.mocked(tryGetRemoteUrl).mockResolvedValue(null);
      // ensureGitHubRepo returns null (user cancelled)
      vi.mocked(ensureGitHubRepo).mockResolvedValue(null);
      vi.mocked(isGitAvailable).mockResolvedValue(true);
    });

    When("I attempt to deploy", async () => {
      deployResult = await on_deploy(createMockContext());
    });

    Then("the deployment should fail", () => {
      expect(deployResult?.success).toBe(false);
    });

    And('the error should mention "No git remote configured"', () => {
      // Feature 20: Consolidated repo setup - shows cancelled message
      expect(deployResult?.message).toContain("cancelled");
    });

    And("the error should include instructions to add a GitHub remote", () => {
      // Feature 20: Consolidated repo setup - simplified messaging
      expect(deployResult?.message).toContain("Repository setup cancelled");
    });
  });

  // ============================================================================
  // Scenario: Deploy with non-GitHub remote
  // ============================================================================

  Scenario("Deploy with non-GitHub remote", ({ Given, When, Then, And }) => {
    Given("the directory is a git repository", () => {
      vi.mocked(isGitRepository).mockResolvedValue(true);
    });

    And('the git remote is "git@gitlab.com:user/repo.git"', () => {
      // Mock tryGetRemoteUrl to return gitlab URL
      vi.mocked(tryGetRemoteUrl).mockResolvedValue("git@gitlab.com:user/repo.git");
      // parseGitHubUrl returns null for non-GitHub
      vi.mocked(parseGitHubUrl).mockReturnValue(null);
      // Token available
      vi.mocked(getToken).mockResolvedValue("test-token");
      // validateAll throws for non-GitHub URL
      vi.mocked(validateAll).mockRejectedValue(
        new Error(
          "Remote 'git@gitlab.com:user/repo.git' is not a GitHub URL.\n\n" +
          "GitHub Pages deployment only works with GitHub repositories.\n" +
          "Please add a GitHub remote or use a different deployment method."
        )
      );
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
      vi.mocked(isGitRepository).mockResolvedValue(true);
    });

    And('the git remote is "git@github.com:user/repo.git"', () => {
      vi.mocked(tryGetRemoteUrl).mockResolvedValue("git@github.com:user/repo.git");
    });

    And("the site directory is empty", () => {
      // Bug 13 fix: Use context.site_files for validation instead of listFiles()
      // Set empty site_files array to simulate no compiled site
      scenarioSiteFiles = [];
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
  // Updated for REST API flow
  // ============================================================================

  Scenario("Successful deployment with SSH remote", ({ Given, When, Then, And }) => {
    Given("the directory is a git repository", () => {
      vi.mocked(isGitRepository).mockResolvedValue(true);
    });

    And('the git remote is "git@github.com:testuser/testrepo.git"', () => {
      vi.mocked(tryGetRemoteUrl).mockResolvedValue("git@github.com:testuser/testrepo.git");
      vi.mocked(validateAll).mockResolvedValue("git@github.com:testuser/testrepo.git");
    });

    And('the site is compiled with files in ".moss/site/"', () => {
      ctx.filesystem.setFile(`${projectPath}/.moss/site/index.html`, "<html></html>");
    });

    And("the GitHub Actions workflow already exists", () => {
      // REST API flow: token available, gh-pages exists
      vi.mocked(getToken).mockResolvedValue("test-token");
      vi.mocked(getTokenFromGit).mockResolvedValue(null);

      // gh-pages exists (returning user)
      vi.mocked(getGhPagesState).mockResolvedValue({
        exists: true,
        commitSha: "abc123",
        treeSha: "tree123",
      });

      // Local fingerprint
      vi.mocked(getLocalSiteFingerprint).mockResolvedValue(
        new Map([["index.html", "hash1"]])
      );

      // Remote tree
      vi.mocked(getRemoteTree).mockResolvedValue(
        new Map([["index.html", { sha: "old-hash", mode: "100644" }]])
      );

      // diffFiles returns changes
      vi.mocked(diffFiles).mockReturnValue({
        changed: [{ path: "index.html", localHash: "hash1" }],
        unchanged: [],
        deleted: [],
      });

      // deployViaAPI returns commit sha
      vi.mocked(deployViaAPI).mockResolvedValue("new-commit-sha");

      // Pages status check
      vi.mocked(checkPagesStatus).mockResolvedValue({ status: "built" });
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
  // Updated for REST API flow
  // ============================================================================

  Scenario("First-time deployment creates workflow", ({ Given, When, Then, And }) => {
    Given("the directory is a git repository", () => {
      vi.mocked(isGitRepository).mockResolvedValue(true);
    });

    And('the git remote is "git@github.com:user/repo.git"', () => {
      vi.mocked(tryGetRemoteUrl).mockResolvedValue("git@github.com:user/repo.git");
      vi.mocked(validateAll).mockResolvedValue("git@github.com:user/repo.git");
    });

    And('the site is compiled with files in ".moss/site/"', () => {
      ctx.filesystem.setFile(`${projectPath}/.moss/site/index.html`, "<html></html>");
      ctx.filesystem.setFile(`${projectPath}/.gitignore`, "node_modules/");
    });

    And("the GitHub Actions workflow does not exist", () => {
      // REST API flow: token available, gh-pages does NOT exist (first-time)
      vi.mocked(getToken).mockResolvedValue("test-token");
      vi.mocked(getTokenFromGit).mockResolvedValue(null);

      // gh-pages does NOT exist (first-time deploy)
      vi.mocked(getGhPagesState).mockResolvedValue({ exists: false });

      // Local fingerprint
      vi.mocked(getLocalSiteFingerprint).mockResolvedValue(
        new Map([["index.html", "hash1"]])
      );

      // No remote tree for first deploy (getRemoteTree should not be called)

      // diffFiles returns all files as changed
      vi.mocked(diffFiles).mockReturnValue({
        changed: [{ path: "index.html", localHash: "hash1" }],
        unchanged: [],
        deleted: [],
      });

      // deployViaAPI returns commit sha
      vi.mocked(deployViaAPI).mockResolvedValue("first-commit-sha");

      // Pages status check
      vi.mocked(checkPagesStatus).mockResolvedValue({ status: "built" });
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
