/**
 * Integration tests for the on_deploy hook
 *
 * Uses @symbiosis-lab/moss-api/testing to mock Tauri IPC commands
 * and test the full deployment flow with various scenarios.
 *
 * Updated for git-push-only deployment flow (no REST API fingerprinting/diffing).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setupMockTauri,
  type MockTauriContext,
} from "@symbiosis-lab/moss-api/testing";
import type { OnDeployContext } from "../types";

// We need to mock the utils module to prevent actual IPC calls for logging
vi.mock("../utils", () => ({
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

// Mock the github-deploy module
vi.mock("../github-deploy", () => ({
  verifyRepoExists: vi.fn().mockResolvedValue(undefined),
  deployViaGitPush: vi.fn(),
}));

// Mock the auth module
vi.mock("../auth", () => ({
  promptLogin: vi.fn(),
  checkAuthentication: vi.fn(),
  validateToken: vi.fn(),
  hasRequiredScopes: vi.fn(),
}));

// Mock the token module
vi.mock("../token", () => ({
  getToken: vi.fn(),
  getTokenFromGit: vi.fn(),
  storeToken: vi.fn(),
  clearToken: vi.fn(),
}));

// Mock the git module (only functions still imported by main.ts)
vi.mock("../git", () => ({
  extractGitHubPagesUrl: vi.fn().mockImplementation((remoteUrl: string) => {
    // Simple implementation for testing
    const m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (m) return `https://${m[1]}.github.io/${m[2]}`;
    return "https://user.github.io/repo";
  }),
  parseGitHubUrl: vi.fn().mockImplementation((remoteUrl: string) => {
    const m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (m) return { owner: m[1], repo: m[2] };
    return null;
  }),
}));

// Mock the validation module (main.ts imports from this)
vi.mock("../validation", () => ({
  validateAll: vi.fn().mockImplementation(async (existingUrl?: string) => {
    // By default, validateAll returns the existing URL (validation passes)
    return existingUrl || "git@github.com:test-user/test-repo.git";
  }),
  isSSHRemote: vi.fn().mockImplementation((url: string) => {
    return url.startsWith("git@") || url.startsWith("ssh://");
  }),
}));

// Mock the config module
vi.mock("../config", () => ({
  getRepoConfig: vi.fn().mockResolvedValue({ owner: "test-user", repo: "test-repo" }),
  saveRepoConfig: vi.fn().mockResolvedValue(undefined),
  clearRepoConfig: vi.fn().mockResolvedValue(undefined),
}));

// Mock the repo-setup module
vi.mock("../repo-setup", () => ({
  ensureGitHubRepo: vi.fn(),
}));

// Mock @symbiosis-lab/moss-api
vi.mock("@symbiosis-lab/moss-api", () => ({
  readPluginFile: vi.fn(),
  writePluginFile: vi.fn(),
  pluginFileExists: vi.fn(),
  listSiteFilesWithSizes: vi.fn().mockResolvedValue([]),
  httpPostSiteFile: vi.fn().mockResolvedValue({ status: 201, ok: true, body_base64: "", content_type: null }),
}));

// Mock the github-api module (checkPagesStatus used by waitForPagesLive)
vi.mock("../github-api", () => ({
  checkPagesStatus: vi.fn().mockResolvedValue({ status: "built" }),
  getAuthenticatedUser: vi.fn(),
  checkRepoExists: vi.fn(),
  createRepository: vi.fn(),
}));

// Import after mocking
import { on_deploy } from "../main";
import { log, reportProgress, showToast } from "../utils";
import { verifyRepoExists, deployViaGitPush } from "../github-deploy";
import { promptLogin, validateToken, hasRequiredScopes } from "../auth";
import { getToken, getTokenFromGit, storeToken } from "../token";
import { parseGitHubUrl, extractGitHubPagesUrl } from "../git";
import { checkPagesStatus } from "../github-api";
import { validateAll, isSSHRemote } from "../validation";
import { getRepoConfig, saveRepoConfig, clearRepoConfig } from "../config";
import { ensureGitHubRepo } from "../repo-setup";

/**
 * Create a mock OnDeployContext for testing
 */
function createMockContext(overrides?: Partial<OnDeployContext>): OnDeployContext {
  return {
    project_path: "/test/project",
    moss_dir: "/test/project/.moss",
    output_dir: "/test/project/.moss/site",
    site_files: ["index.html", "style.css"],
    project_info: {
      project_type: "markdown",
      content_folders: ["posts"],
      total_files: 10,
      homepage_file: "index.md",
    },
    config: {},
    ...overrides,
  };
}

/**
 * Set up common mocks for a successful deployment flow
 */
function setupDeployMocks(
  _ctx: MockTauriContext,
  options?: {
    hasChanges?: boolean;
    commitSha?: string;
    token?: string;
    remoteUrl?: string;
    needsSetup?: boolean;
  }
) {
  const {
    hasChanges = true,
    commitSha = "abc1234def5678",
    token = "test-token",
    remoteUrl = "git@github.com:test-user/test-repo.git",
    needsSetup = false,
  } = options ?? {};

  // Token is available
  vi.mocked(getToken).mockResolvedValue(token);
  vi.mocked(getTokenFromGit).mockResolvedValue(null);

  // Repo config exists (replaces git repo + remote checks)
  const parsed = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (parsed) {
    if (needsSetup) {
      vi.mocked(getRepoConfig).mockResolvedValue(null);
      vi.mocked(ensureGitHubRepo).mockResolvedValue({
        name: parsed[2],
        fullName: `${parsed[1]}/${parsed[2]}`,
        sshUrl: remoteUrl,
      });
    } else {
      vi.mocked(getRepoConfig).mockResolvedValue({ owner: parsed[1], repo: parsed[2] });
    }
  }

  // Validation passes and returns the remote URL
  vi.mocked(validateAll).mockResolvedValue(remoteUrl);

  // Deploy result (git push — handles both source→main and site→gh-pages)
  vi.mocked(deployViaGitPush).mockResolvedValue(hasChanges ? commitSha : "");

  // Pages status check (polling)
  vi.mocked(checkPagesStatus).mockResolvedValue({ status: "built" });
}

describe("on_deploy integration", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri();
    vi.clearAllMocks();

    // Restore default implementations after clearAllMocks
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
    vi.mocked(getRepoConfig).mockResolvedValue({ owner: "test-user", repo: "test-repo" });
    vi.mocked(checkPagesStatus).mockResolvedValue({ status: "built" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("Repository Config Validation", () => {
    it("shows repo setup UI when no config exists", async () => {
      // No repo config (first-time user)
      vi.mocked(getRepoConfig).mockResolvedValue(null);
      // ensureGitHubRepo returns null (user cancelled)
      vi.mocked(ensureGitHubRepo).mockResolvedValue(null);

      const result = await on_deploy(createMockContext());

      // Shows repo setup browser UI, returns cancelled when no interaction
      expect(result.success).toBe(false);
      expect(result.message).toContain("cancelled");
    });

    it("returns cancelled when repo setup browser is dismissed", async () => {
      // No repo config
      vi.mocked(getRepoConfig).mockResolvedValue(null);
      // ensureGitHubRepo returns null (user cancelled)
      vi.mocked(ensureGitHubRepo).mockResolvedValue(null);

      const result = await on_deploy(createMockContext());

      // Repo setup UI is shown, returns cancelled when dismissed
      expect(result.success).toBe(false);
      expect(result.message).toContain("cancelled");
    });
  });

  describe("Remote Validation", () => {
    it("fails when no repo config exists and setup is cancelled", async () => {
      // No repo config
      vi.mocked(getRepoConfig).mockResolvedValue(null);
      // ensureGitHubRepo returns null (user cancelled)
      vi.mocked(ensureGitHubRepo).mockResolvedValue(null);

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      expect(result.message).toContain("Repository setup cancelled");
    });

    it("fails when validation rejects non-GitHub URL", async () => {
      // Config has a non-GitHub URL pattern (edge case)
      vi.mocked(getRepoConfig).mockResolvedValue({ owner: "user", repo: "repo" });
      // Token is available
      vi.mocked(getToken).mockResolvedValue("test-token");
      // validateAll throws for non-GitHub URL
      vi.mocked(validateAll).mockRejectedValue(
        new Error(
          "Remote 'git@gitlab.com:user/repo.git' is not a GitHub URL.\n\n" +
          "GitHub Pages deployment only works with GitHub repositories.\n" +
          "Please add a GitHub remote or use a different deployment method."
        )
      );

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      expect(result.message).toContain("is not a GitHub URL");
      expect(result.message).toContain("GitHub Pages deployment only works with GitHub");
    });

    it("includes actual URL in error message for non-GitHub remote", async () => {
      // Config exists
      vi.mocked(getRepoConfig).mockResolvedValue({ owner: "myorg", repo: "myrepo" });
      // Token is available
      vi.mocked(getToken).mockResolvedValue("test-token");
      // validateAll throws with URL in message
      vi.mocked(validateAll).mockRejectedValue(
        new Error(
          "Remote 'git@gitlab.com:myorg/myrepo.git' is not a GitHub URL.\n\n" +
          "GitHub Pages deployment only works with GitHub repositories.\n" +
          "Please add a GitHub remote or use a different deployment method."
        )
      );

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      expect(result.message).toContain("gitlab.com");
    });
  });

  describe("Site Compilation Validation", () => {
    it("fails when context.site_files is empty (Bug 13 fix)", async () => {
      // Bug 13: Use context.site_files for validation, NOT listFiles()
      const result = await on_deploy(
        createMockContext({
          site_files: [], // Empty site_files - moss tells plugin no files exist
        })
      );

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/site.*empty|compile.*first/i);
    });

    it("passes validation when context.site_files has files (Bug 13 fix)", async () => {
      // Setup full deploy mocks
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: true,
      });

      // Context has site_files (moss provides these)
      const result = await on_deploy(
        createMockContext({
          site_files: ["index.html", "style.css", "app.js"],
        })
      );

      // Should NOT fail with "site empty" error
      expect(result.success).toBe(true);
      expect(result.message).not.toContain("Site directory is empty");
    });

    it("does NOT call listFiles() for site validation (Bug 13 fix)", async () => {
      // Setup full deploy mocks
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: true,
      });

      // Context has site_files (moss provides these), filesystem is empty
      const result = await on_deploy(
        createMockContext({
          site_files: ["index.html"],
        })
      );

      // If the plugin called listFiles(), it would find nothing and fail
      // But with context.site_files, it should succeed
      expect(result.success).toBe(true);
    });
  });

  describe("SSH Remote Handling", () => {
    it("skips OAuth for SSH remotes and proceeds with deployment", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: true,
      });

      const result = await on_deploy(createMockContext());

      // Should not have opened browser for OAuth
      expect(ctx.browserTracker.openedUrls).toHaveLength(0);
    });
  });

  describe("HTTPS Remote Authentication", () => {
    it("skips OAuth for existing HTTPS remotes when token available (Bug 23 fix)", async () => {
      // Bug 23: For existing HTTPS remotes, token from cookie/git-credential is used
      setupDeployMocks(ctx, {
        remoteUrl: "https://github.com/user/repo.git",
        hasChanges: true,
      });

      const result = await on_deploy(createMockContext());

      // Should not have opened browser for OAuth
      expect(ctx.browserTracker.systemBrowserUrls).toHaveLength(0);
    });
  });

  describe("Successful Deployment", () => {
    it("returns success with deployment info for SSH remote", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:testuser/testrepo.git",
        hasChanges: true,
        commitSha: "abc123def",
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.deployment).toBeDefined();
      expect(result.deployment?.method).toBe("github-pages");
      expect(result.deployment?.url).toBe("https://testuser.github.io/testrepo");
    });

    it("indicates first-time setup in message", async () => {
      // Set up for first-time deployment (needsSetup = true)
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        needsSetup: true,
        hasChanges: true,
        commitSha: "abc123",
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.message).toContain("deployed");
      expect(result.deployment?.metadata?.was_first_setup).toBe("true");
    });
  });

  describe("Deployment via git push", () => {
    it("deploys via git push", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: true,
      });

      const result = await on_deploy(createMockContext());

      // Should succeed
      expect(result.success).toBe(true);
      expect(vi.mocked(deployViaGitPush)).toHaveBeenCalled();
    });

    it("handles first-time setup (needsSetup)", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        needsSetup: true,
        hasChanges: true,
        commitSha: "new-commit-sha",
      });

      const result = await on_deploy(createMockContext());

      // Should succeed even with first-time push
      expect(result.success).toBe(true);
      expect(result.deployment?.metadata?.was_first_setup).toBe("true");
    });
  });

  describe("Subsequent Deploys", () => {
    it("succeeds when repo already exists (returning user)", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: true,
      });

      const result = await on_deploy(createMockContext());

      // Deployment should succeed
      expect(result.success).toBe(true);
      expect(result.deployment?.method).toBe("github-pages");
    });

    it("reports no changes when deployViaGitPush returns empty string", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: false,
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.message).toContain("No changes to deploy");
      // commit_sha should be empty since nothing was pushed
      expect(result.deployment?.metadata?.commit_sha).toBe("");
    });

    it("calls deployViaGitPush for deployment", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: true,
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.deployment?.method).toBe("github-pages");
      expect(vi.mocked(deployViaGitPush)).toHaveBeenCalled();
    });

    it("was_first_setup is false for subsequent deploys", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: true,
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      // was_first_setup should be false since needsSetup is false
      expect(result.deployment?.metadata?.was_first_setup).toBe("false");
    });
  });

  describe("First-time Deployment", () => {
    it("deploys successfully on first time (needsSetup=true)", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        needsSetup: true,
        hasChanges: true,
        commitSha: "abc123def",
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      // First time deploy
      expect(result.deployment?.metadata?.was_first_setup).toBe("true");
    });

    it("subsequent deploys succeed normally", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: true,
        commitSha: "def456ghi",
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      // Returning user - not first setup
      expect(result.deployment?.metadata?.was_first_setup).toBe("false");
    });

    it("reports no changes when deployViaGitPush returns empty", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: false,
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.message).toContain("No changes to deploy");
    });
  });

  describe("Error Recovery", () => {
    it("succeeds with normal deployment", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: true,
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.deployment?.method).toBe("github-pages");
    });

    it("handles git push errors gracefully", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: true,
      });

      // deployViaGitPush throws an error
      vi.mocked(deployViaGitPush).mockRejectedValue(new Error("git push failed: remote rejected"));

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      expect(result.message).toContain("remote rejected");
    });

    it("handles first-time deployment (needsSetup)", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        needsSetup: true,
        hasChanges: true,
        commitSha: "abc123def",
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.deployment?.metadata?.was_first_setup).toBe("true");
    });
  });

  describe("Bug 23: OAuth should not trigger when git credentials work", () => {
    it("should deploy without OAuth when token is available (git handles auth)", async () => {
      // Setup: token available from plugin cookies
      setupDeployMocks(ctx, {
        remoteUrl: "https://github.com/user/repo.git",
        hasChanges: true,
        token: "test-token",
      });

      const result = await on_deploy(
        createMockContext({
          site_files: ["index.html"],
        })
      );

      expect(result.success).toBe(true);
      // Key assertion: No OAuth browser should have been opened
      expect(ctx.browserTracker.systemBrowserUrls).toHaveLength(0);
    });
  });

  describe("No Changes Detection", () => {
    it("reports no changes when deployViaGitPush returns empty string", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: false,
      });

      const result = await on_deploy(
        createMockContext({
          site_files: ["index.html"],
        })
      );

      // Should succeed with no changes
      expect(result.success).toBe(true);
      expect(result.message).toContain("No changes to deploy");
      expect(result.deployment?.metadata?.commit_sha).toBe("");

      // Toast is shown via showToast()
      expect(showToast).toHaveBeenCalled();
    });

    it("proceeds with deployment when changes exist", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: true,
        commitSha: "newcommitsha789",
      });

      const result = await on_deploy(
        createMockContext({
          site_files: ["index.html"],
        })
      );

      // Should succeed with changes deployed
      expect(result.success).toBe(true);
      expect(vi.mocked(deployViaGitPush)).toHaveBeenCalled();
    });
  });

  describe("Progress Visibility", () => {
    it("reports progress during deployment", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: true,
      });

      const result = await on_deploy(
        createMockContext({
          site_files: ["index.html"],
        })
      );

      expect(result.success).toBe(true);

      // Verify progress was reported during deployment
      const progressCalls = vi.mocked(reportProgress).mock.calls;

      // Should have progress calls with total=10
      expect(progressCalls.length).toBeGreaterThan(0);
      const progressTotals = progressCalls.map((call) => call[2]); // 3rd arg is total
      // All progress calls should use total=10
      for (const total of progressTotals) {
        expect(total).toBe(10);
      }
    });
  });

  describe("Error Categorization", () => {
    it("shows helpful message for timeout errors", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: true,
      });

      // Make deployViaGitPush fail with timeout error
      vi.mocked(deployViaGitPush).mockRejectedValue(
        new Error("Request timed out after 300000 ms")
      );

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      // Verify showToast was called with timeout-specific message
      const toastCalls = vi.mocked(showToast).mock.calls;
      const errorToasts = toastCalls.filter(
        (call) => call[0]?.variant === "error"
      );
      expect(errorToasts.length).toBeGreaterThan(0);
      const toastMsg = errorToasts[0][0].message;
      expect(toastMsg).toContain("may still be running");
    });

    it("shows SSH auth message for permission denied errors", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: true,
      });

      // Make deployViaGitPush fail with SSH permission denied
      vi.mocked(deployViaGitPush).mockRejectedValue(
        new Error("Permission denied (publickey).")
      );

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      const toastCalls = vi.mocked(showToast).mock.calls;
      const errorToasts = toastCalls.filter(
        (call) => call[0]?.variant === "error"
      );
      expect(errorToasts.length).toBeGreaterThan(0);
      const toastMsg = errorToasts[0][0].message;
      expect(toastMsg).toContain("ssh-add");
    });
  });

  describe("Git Push Deploy Tests", () => {
    it("Test A: deployViaGitPush is called with correct owner/repo", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: true,
        commitSha: "new-commit-sha",
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(vi.mocked(deployViaGitPush)).toHaveBeenCalledTimes(1);
      const deployCall = vi.mocked(deployViaGitPush).mock.calls[0][0];
      expect(deployCall.owner).toBe("user");
      expect(deployCall.repo).toBe("repo");
    });

    it("Test B: first-time deploy calls deployViaGitPush", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        needsSetup: true,
        hasChanges: true,
        commitSha: "first-commit-sha",
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(vi.mocked(deployViaGitPush)).toHaveBeenCalledTimes(1);
    });

    it("Test C: no changes exits with appropriate message", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: false,
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.message).toContain("No changes");
    });

    it("Test D: Progress is monotonically increasing", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: true,
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);

      // Capture all reportProgress calls
      const progressCalls = vi.mocked(reportProgress).mock.calls;
      const currentValues = progressCalls.map((call) => call[1]); // 2nd arg is current

      // Assert current values are non-decreasing
      for (let i = 1; i < currentValues.length; i++) {
        expect(currentValues[i]).toBeGreaterThanOrEqual(currentValues[i - 1]);
      }

      // All calls should use total=10
      for (const call of progressCalls) {
        expect(call[2]).toBe(10);
      }
    });

    it("Test E: Auth required before deploy", async () => {
      // Repo config exists
      vi.mocked(getRepoConfig).mockResolvedValue({ owner: "user", repo: "repo" });

      // No token available from any source
      vi.mocked(getToken).mockResolvedValue(null);
      vi.mocked(getTokenFromGit).mockResolvedValue(null);

      // promptLogin succeeds and then token is available
      vi.mocked(promptLogin).mockResolvedValue(true);
      vi.mocked(getToken)
        .mockResolvedValueOnce(null) // preflight check
        .mockResolvedValueOnce(null) // Phase 2 token check
        .mockResolvedValueOnce("new-token"); // after promptLogin

      // Set up rest of the deploy flow
      vi.mocked(deployViaGitPush).mockResolvedValue("");

      const result = await on_deploy(createMockContext());

      // promptLogin should have been called
      expect(vi.mocked(promptLogin)).toHaveBeenCalled();
    });

    it("Test F: auth error returns helpful message", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: true,
      });

      // deployViaGitPush throws error with "Bad credentials"
      vi.mocked(deployViaGitPush).mockRejectedValue(
        new Error("Bad credentials - authentication failed")
      );

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      // Error toast should contain helpful message
      const toastCalls = vi.mocked(showToast).mock.calls;
      const errorToasts = toastCalls.filter(
        (call) => call[0]?.variant === "error"
      );
      expect(errorToasts.length).toBeGreaterThan(0);
      expect(errorToasts[0][0].message).toContain("Authentication failed");
    });

    it("Test G: Network failure during push is handled gracefully", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        hasChanges: true,
      });

      // deployViaGitPush throws "Network error"
      vi.mocked(deployViaGitPush).mockRejectedValue(
        new Error("Network connection failed")
      );

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      // Error message should mention failure
      const toastCalls = vi.mocked(showToast).mock.calls;
      const errorToasts = toastCalls.filter(
        (call) => call[0]?.variant === "error"
      );
      expect(errorToasts.length).toBeGreaterThan(0);
      expect(errorToasts[0][0].message).toContain("Network error");
    });
  });

  describe("Preflight Config Validation", () => {
    it("clears stale config and re-runs setup when verifyRepoExists fails", async () => {
      // Config exists but points to an inaccessible repo
      vi.mocked(getRepoConfig)
        .mockResolvedValueOnce({ owner: "stale-user", repo: "deleted-repo" });

      vi.mocked(getToken).mockResolvedValue("valid-token");

      // verifyRepoExists fails for stale config (preflight check)
      vi.mocked(verifyRepoExists).mockRejectedValueOnce(
        new Error('Repository "stale-user/deleted-repo" not found')
      );

      // ensureGitHubRepo runs because config was cleared -> user cancels
      vi.mocked(ensureGitHubRepo).mockResolvedValue(null);

      const result = await on_deploy(createMockContext());

      // Should have cleared the stale config
      expect(vi.mocked(clearRepoConfig)).toHaveBeenCalled();
      // Should have attempted setup since config was cleared
      expect(vi.mocked(ensureGitHubRepo)).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    it("proceeds normally when preflight verification succeeds", async () => {
      setupDeployMocks(ctx);

      // verifyRepoExists succeeds (default mock is already set to resolve)
      vi.mocked(verifyRepoExists).mockResolvedValue(undefined);

      const result = await on_deploy(createMockContext());

      // Should NOT have cleared config
      expect(vi.mocked(clearRepoConfig)).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("calls getRepoConfig only once when preflight clears config (no migration loop)", async () => {
      // Config exists but is stale
      vi.mocked(getRepoConfig)
        .mockResolvedValueOnce({ owner: "stale", repo: "gone" });

      vi.mocked(getToken).mockResolvedValue("valid-token");

      // Preflight fails -> config cleared
      vi.mocked(verifyRepoExists).mockRejectedValueOnce(new Error("Not found"));

      // Setup cancelled
      vi.mocked(ensureGitHubRepo).mockResolvedValue(null);

      await on_deploy(createMockContext());

      // Key assertion: getRepoConfig called ONCE (preflight), NOT twice
      expect(vi.mocked(getRepoConfig)).toHaveBeenCalledTimes(1);
    });

    it("clears config and succeeds when setup flow completes after stale config", async () => {
      // Stale config on first read
      vi.mocked(getRepoConfig)
        .mockResolvedValueOnce({ owner: "stale", repo: "gone" });

      vi.mocked(getToken).mockResolvedValue("valid-token");

      // Preflight fails
      vi.mocked(verifyRepoExists)
        .mockRejectedValueOnce(new Error("Not found")) // preflight
        .mockResolvedValueOnce(undefined); // after new setup

      // Setup creates new repo
      vi.mocked(ensureGitHubRepo).mockResolvedValue({
        name: "new-repo",
        sshUrl: "git@github.com:stale/new-repo.git",
        fullName: "stale/new-repo",
      });

      // Rest of deploy succeeds
      vi.mocked(deployViaGitPush).mockResolvedValue("new-commit-sha");
      vi.mocked(checkPagesStatus).mockResolvedValue({ status: "built" });

      const result = await on_deploy(createMockContext());

      expect(vi.mocked(clearRepoConfig)).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe("Git Credential Token Validation", () => {
    it("validates git credential token before using it", async () => {
      // No cached token, git credential returns one
      vi.mocked(getToken).mockResolvedValue(null);
      vi.mocked(getTokenFromGit).mockResolvedValue("git-credential-token");

      // Token validation succeeds
      vi.mocked(validateToken).mockResolvedValue({
        valid: true,
        user: { login: "test-user", id: 1, avatar_url: "", html_url: "" },
        scopes: ["repo"],
      });
      vi.mocked(hasRequiredScopes).mockReturnValue(true);

      // Config exists so preflight runs and flow reaches Phase 2
      vi.mocked(getRepoConfig).mockResolvedValue({ owner: "test-user", repo: "test-repo" });
      vi.mocked(verifyRepoExists).mockResolvedValue(undefined);
      vi.mocked(validateAll).mockResolvedValue("git@github.com:test-user/test-repo.git");

      // Set up remaining mocks for a successful deploy
      vi.mocked(deployViaGitPush).mockResolvedValue("commit-sha");
      vi.mocked(checkPagesStatus).mockResolvedValue({ status: "built" });

      const result = await on_deploy(createMockContext());

      // Should have validated the git token
      expect(vi.mocked(validateToken)).toHaveBeenCalledWith("git-credential-token");
      expect(vi.mocked(hasRequiredScopes)).toHaveBeenCalledWith(["repo"]);
      // Should have stored the validated token
      expect(vi.mocked(storeToken)).toHaveBeenCalledWith("git-credential-token");
      expect(result.success).toBe(true);
    });

    it("falls through to OAuth when git credential token lacks scopes", async () => {
      // No cached token, git credential returns one
      vi.mocked(getToken).mockResolvedValue(null);
      vi.mocked(getTokenFromGit).mockResolvedValue("weak-git-token");

      // Token is valid but lacks scopes
      vi.mocked(validateToken).mockResolvedValue({
        valid: true,
        user: { login: "test-user", id: 1, avatar_url: "", html_url: "" },
        scopes: ["gist"], // Missing "repo"
      });
      vi.mocked(hasRequiredScopes).mockReturnValue(false);

      // Config exists for normal flow
      vi.mocked(getRepoConfig).mockResolvedValue({ owner: "test-user", repo: "test-repo" });
      vi.mocked(verifyRepoExists).mockResolvedValue(undefined);
      vi.mocked(validateAll).mockResolvedValue("git@github.com:test-user/test-repo.git");

      // OAuth login also fails
      vi.mocked(promptLogin).mockResolvedValue(false);

      const result = await on_deploy(createMockContext());

      // Should NOT have stored the weak token
      expect(vi.mocked(storeToken)).not.toHaveBeenCalledWith("weak-git-token");
      // Should have prompted OAuth login
      expect(vi.mocked(promptLogin)).toHaveBeenCalled();
      // Deploy fails because OAuth failed
      expect(result.success).toBe(false);
    });

    it("falls through to OAuth when git credential token is invalid", async () => {
      // No cached token, git returns expired one
      vi.mocked(getToken).mockResolvedValue(null);
      vi.mocked(getTokenFromGit).mockResolvedValue("expired-token");

      // Token validation fails
      vi.mocked(validateToken).mockResolvedValue({ valid: false });

      // Config exists
      vi.mocked(getRepoConfig).mockResolvedValue({ owner: "test-user", repo: "test-repo" });
      vi.mocked(verifyRepoExists).mockResolvedValue(undefined);
      vi.mocked(validateAll).mockResolvedValue("git@github.com:test-user/test-repo.git");

      // OAuth fails too
      vi.mocked(promptLogin).mockResolvedValue(false);

      const result = await on_deploy(createMockContext());

      // Should NOT have stored the invalid token
      expect(vi.mocked(storeToken)).not.toHaveBeenCalledWith("expired-token");
      // Should have attempted OAuth
      expect(vi.mocked(promptLogin)).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });
  });
});
