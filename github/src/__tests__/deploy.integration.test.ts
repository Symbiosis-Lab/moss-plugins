/**
 * Integration tests for the on_deploy hook
 *
 * Uses @symbiosis-lab/moss-api/testing to mock Tauri IPC commands
 * and test the full deployment flow with various scenarios.
 *
 * Updated for REST API deployment flow (replaces git CLI worktree+push).
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

// Mock the github-deploy module (REST API functions)
vi.mock("../github-deploy", () => ({
  verifyRepoExists: vi.fn().mockResolvedValue(undefined),
  getGhPagesState: vi.fn(),
  getRemoteTree: vi.fn(),
  diffFiles: vi.fn(),
  deployViaAPI: vi.fn(),
  pushSourceToMain: vi.fn().mockResolvedValue("source-commit-sha"),
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
  getLocalSiteFingerprint: vi.fn(),
  getLocalSourceFingerprint: vi.fn().mockResolvedValue(new Map([["index.md", "hash1"]])),
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

// Mock @symbiosis-lab/moss-api (listSourceFiles, readProjectFileBase64, readSiteFile)
vi.mock("@symbiosis-lab/moss-api", () => ({
  listSourceFiles: vi.fn().mockResolvedValue([]),
  readProjectFileBase64: vi.fn().mockResolvedValue("base64content"),
  readSiteFile: vi.fn().mockResolvedValue("filecontent"),
  readPluginFile: vi.fn(),
  writePluginFile: vi.fn(),
  pluginFileExists: vi.fn(),
  hashSiteFile: vi.fn().mockResolvedValue("mock-hash"),
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
import { verifyRepoExists, getGhPagesState, getRemoteTree, diffFiles, deployViaAPI, pushSourceToMain } from "../github-deploy";
import { promptLogin, validateToken, hasRequiredScopes } from "../auth";
import { getToken, getTokenFromGit, storeToken } from "../token";
import { getLocalSiteFingerprint, getLocalSourceFingerprint, parseGitHubUrl, extractGitHubPagesUrl } from "../git";
import { checkPagesStatus } from "../github-api";
import { validateAll, isSSHRemote } from "../validation";
import { getRepoConfig, saveRepoConfig, clearRepoConfig } from "../config";
import { ensureGitHubRepo } from "../repo-setup";
import { listSourceFiles, readProjectFileBase64 } from "@symbiosis-lab/moss-api";

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
 * Set up common mocks for a successful REST API deployment flow
 */
function setupDeployMocks(
  ctx: MockTauriContext,
  options?: {
    ghPagesExists?: boolean;
    hasChanges?: boolean;
    commitSha?: string;
    token?: string;
    remoteUrl?: string;
  }
) {
  const {
    ghPagesExists = true,
    hasChanges = true,
    commitSha = "abc1234def5678",
    token = "test-token",
    remoteUrl = "git@github.com:test-user/test-repo.git",
  } = options ?? {};

  // Token is available
  vi.mocked(getToken).mockResolvedValue(token);
  vi.mocked(getTokenFromGit).mockResolvedValue(null);

  // Repo config exists (replaces git repo + remote checks)
  const parsed = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (parsed) {
    vi.mocked(getRepoConfig).mockResolvedValue({ owner: parsed[1], repo: parsed[2] });
  }

  // Validation passes and returns the remote URL
  vi.mocked(validateAll).mockResolvedValue(remoteUrl);

  // gh-pages state via REST API
  if (ghPagesExists) {
    vi.mocked(getGhPagesState).mockResolvedValue({
      exists: true,
      commitSha: "existing-commit-sha",
      treeSha: "existing-tree-sha",
    });
  } else {
    vi.mocked(getGhPagesState).mockResolvedValue({ exists: false });
  }

  // Local fingerprint (file hashing)
  vi.mocked(getLocalSiteFingerprint).mockResolvedValue(
    new Map([
      ["index.html", "hash1"],
      ["style.css", "hash2"],
    ])
  );

  // Remote tree (if gh-pages exists)
  if (ghPagesExists) {
    vi.mocked(getRemoteTree).mockResolvedValue(
      new Map([
        [
          "index.html",
          { sha: hasChanges ? "old-hash" : "hash1", mode: "100644" },
        ],
        ...(hasChanges
          ? []
          : [["style.css", { sha: "hash2", mode: "100644" }] as [string, { sha: string; mode: string }]]),
      ])
    );
  }

  // Diff result
  if (hasChanges) {
    vi.mocked(diffFiles).mockReturnValue({
      changed: [
        { path: "index.html", localHash: "hash1" },
        { path: "style.css", localHash: "hash2" },
      ],
      unchanged: [],
      deleted: [],
    });
  } else {
    vi.mocked(diffFiles).mockReturnValue({
      changed: [],
      unchanged: [
        { path: "index.html", sha: "hash1", mode: "100644" },
        { path: "style.css", sha: "hash2", mode: "100644" },
      ],
      deleted: [],
    });
  }

  // Deploy result (REST API upload)
  vi.mocked(deployViaAPI).mockResolvedValue({ commitSha: hasChanges ? commitSha : "", skippedFiles: [] });

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
        ghPagesExists: true,
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
        ghPagesExists: true,
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
        ghPagesExists: true,
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
        ghPagesExists: true,
        hasChanges: true,
      });

      const result = await on_deploy(createMockContext());

      // Should not have opened browser for OAuth
      expect(ctx.browserTracker.systemBrowserUrls).toHaveLength(0);
      // Deployment proceeds (may still fail due to other mocks, but not auth)
    });
  });

  describe("Successful Deployment", () => {
    it("returns success with deployment info for SSH remote", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:testuser/testrepo.git",
        ghPagesExists: true,
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
      // Set up for first-time deployment (gh-pages doesn't exist)
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: false,
        hasChanges: true,
        commitSha: "abc123",
      });

      // First deploy: diffFiles returns all files as changed (no remote tree)
      vi.mocked(diffFiles).mockReturnValue({
        changed: [
          { path: "index.html", localHash: "hash1" },
          { path: "style.css", localHash: "hash2" },
        ],
        unchanged: [],
        deleted: [],
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.message).toContain("deployed");
      expect(result.deployment?.metadata?.was_first_setup).toBe("true");
    });
  });

  // ============================================================================
  // Smart Push tests are no longer needed because we use REST API now,
  // but we keep the test descriptions and adapt them to the new flow.
  // ============================================================================

  describe("Smart Push (Bug 14 Fix) - REST API equivalent", () => {
    it("deploys via REST API regardless of upstream configuration", async () => {
      // REST API deployment doesn't depend on upstream configuration
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: true,
        hasChanges: true,
      });

      const result = await on_deploy(createMockContext());

      // Should succeed - REST API doesn't need upstream
      expect(result.success).toBe(true);
      expect(vi.mocked(deployViaAPI)).toHaveBeenCalled();
    });

    it("deploys via REST API with token auth (no SSH needed)", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: true,
        hasChanges: true,
      });

      const result = await on_deploy(createMockContext());

      // Should succeed with regular REST API deploy
      expect(result.success).toBe(true);
    });

    it("handles first-time setup (gh-pages branch doesn't exist)", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: false,
        hasChanges: true,
        commitSha: "new-commit-sha",
      });

      // First deploy: all files are new
      vi.mocked(diffFiles).mockReturnValue({
        changed: [
          { path: "index.html", localHash: "hash1" },
          { path: "style.css", localHash: "hash2" },
        ],
        unchanged: [],
        deleted: [],
      });

      const result = await on_deploy(createMockContext());

      // Should succeed even with first-time push
      expect(result.success).toBe(true);
      expect(result.deployment?.metadata?.was_first_setup).toBe("true");
    });
  });

  // ============================================================================
  // Subsequent Deploys (now use REST API diff instead of worktree)
  // ============================================================================

  describe("Subsequent Deploys (Bug 15 Fix)", () => {
    it("succeeds when gh-pages already exists (returning user)", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: true,
        hasChanges: true,
      });

      const result = await on_deploy(createMockContext());

      // Deployment should succeed
      expect(result.success).toBe(true);
      expect(result.deployment?.method).toBe("github-pages");
    });

    it("reports no changes when site is up to date", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: true,
        hasChanges: false,
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.message).toContain("No changes to deploy");
      // commit_sha should be empty since nothing was pushed
      expect(result.deployment?.metadata?.commit_sha).toBe("");
    });

    it("uses REST API approach (not worktree) for deployment", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: true,
        hasChanges: true,
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.deployment?.method).toBe("github-pages");
      // Verify REST API functions were called
      expect(vi.mocked(getGhPagesState)).toHaveBeenCalled();
      expect(vi.mocked(getLocalSiteFingerprint)).toHaveBeenCalled();
      expect(vi.mocked(diffFiles)).toHaveBeenCalled();
      expect(vi.mocked(deployViaAPI)).toHaveBeenCalled();
    });

    it("uses existing gh-pages branch (not orphan) when branch already exists", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: true,
        hasChanges: true,
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      // was_first_setup should be false since gh-pages already existed
      expect(result.deployment?.metadata?.was_first_setup).toBe("false");
    });
  });

  // ============================================================================
  // Zero-Config gh-pages Deployment (now via REST API)
  // ============================================================================

  describe("Zero-Config gh-pages Deployment (Bug 16 Fix)", () => {
    it("deploys successfully when gh-pages branch does not exist (first time)", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: false,
        hasChanges: true,
        commitSha: "abc123def",
      });

      // First deploy: all files changed
      vi.mocked(diffFiles).mockReturnValue({
        changed: [
          { path: "index.html", localHash: "hash1" },
          { path: "style.css", localHash: "hash2" },
        ],
        unchanged: [],
        deleted: [],
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      // First time deploy (gh-pages didn't exist before)
      expect(result.deployment?.metadata?.was_first_setup).toBe("true");
    });

    it("deploys successfully when gh-pages branch already exists (returning user)", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: true,
        hasChanges: true,
        commitSha: "def456ghi",
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      // Returning user - not first setup
      expect(result.deployment?.metadata?.was_first_setup).toBe("false");
    });

    it("reports no changes when site content is identical", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: true,
        hasChanges: false,
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.message).toContain("No changes to deploy");
    });
  });

  // ============================================================================
  // Stale Worktree Recovery tests are no longer needed (REST API doesn't use
  // worktrees), but we keep equivalent tests for REST API error recovery.
  // ============================================================================

  describe("REST API Error Recovery (replaces Stale Worktree Recovery)", () => {
    it("succeeds with normal REST API deployment", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: true,
        hasChanges: true,
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.deployment?.method).toBe("github-pages");
    });

    it("handles REST API errors gracefully", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: true,
        hasChanges: true,
      });

      // deployViaAPI throws an error
      vi.mocked(deployViaAPI).mockRejectedValue(new Error("GitHub API error: 500"));

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      expect(result.message).toContain("500");
    });

    it("handles first-time deployment via REST API (orphan branch equivalent)", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: false,
        hasChanges: true,
        commitSha: "abc123def",
      });

      vi.mocked(diffFiles).mockReturnValue({
        changed: [
          { path: "index.html", localHash: "hash1" },
          { path: "style.css", localHash: "hash2" },
        ],
        unchanged: [],
        deleted: [],
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
        ghPagesExists: true,
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

  // ============================================================================
  // Early Change Detection (now built into REST API flow via diffFiles)
  // ============================================================================

  describe("Early Change Detection", () => {
    it("skips deployment when no changes detected", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: true,
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

      // deployViaAPI should NOT have been called
      expect(vi.mocked(deployViaAPI)).not.toHaveBeenCalled();

      // Toast is shown via showToast()
      expect(showToast).toHaveBeenCalled();
    });

    it("proceeds with deployment when changes detected", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: true,
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
      expect(vi.mocked(deployViaAPI)).toHaveBeenCalled();
    });

    it("handles getLocalSiteFingerprint returning null gracefully", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: true,
        hasChanges: true,
      });

      // Override: fingerprint fails
      vi.mocked(getLocalSiteFingerprint).mockResolvedValue(null);

      const result = await on_deploy(
        createMockContext({
          site_files: ["index.html"],
        })
      );

      // Should fail gracefully
      expect(result.success).toBe(false);
    });
  });

  describe("Progress Visibility", () => {
    it("reports progress during REST API deployment", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: true,
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
        ghPagesExists: true,
        hasChanges: true,
      });

      // Make deployViaAPI fail with timeout error
      vi.mocked(deployViaAPI).mockRejectedValue(
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
        ghPagesExists: true,
        hasChanges: true,
      });

      // Make deployViaAPI fail with SSH permission denied
      vi.mocked(deployViaAPI).mockRejectedValue(
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

  // ============================================================================
  // New REST API-specific tests (Tests A-H)
  // ============================================================================

  describe("REST API Deploy - New Tests", () => {
    // Test A: REST API deploy with changes uploads only changed files
    it("Test A: REST API deploy with changes uploads only changed files", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: true,
        hasChanges: true,
        commitSha: "new-commit-sha",
      });

      // Override diffFiles to return specific changed/unchanged/deleted sets
      vi.mocked(diffFiles).mockReturnValue({
        changed: [
          { path: "index.html", localHash: "new-hash-1" },
          { path: "new-page.html", localHash: "new-hash-2" },
        ],
        unchanged: [{ path: "style.css", sha: "unchanged-hash", mode: "100644" }],
        deleted: ["old-page.html"],
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      // Verify deployViaAPI was called with the correct changed/deleted arrays
      expect(vi.mocked(deployViaAPI)).toHaveBeenCalledTimes(1);
      const deployCall = vi.mocked(deployViaAPI).mock.calls[0][0];
      expect(deployCall.changed).toEqual([
        { path: "index.html", localHash: "new-hash-1" },
        { path: "new-page.html", localHash: "new-hash-2" },
      ]);
      expect(deployCall.deleted).toEqual(["old-page.html"]);
    });

    // Test B: REST API deploy first-time creates branch
    it("Test B: REST API deploy first-time creates branch", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: false,
        hasChanges: true,
        commitSha: "first-commit-sha",
      });

      // First deploy: all files are changed (no remote tree)
      vi.mocked(diffFiles).mockReturnValue({
        changed: [
          { path: "index.html", localHash: "hash1" },
          { path: "style.css", localHash: "hash2" },
        ],
        unchanged: [],
        deleted: [],
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      // Verify ghPagesState.exists = false was passed to deployViaAPI
      const deployCall = vi.mocked(deployViaAPI).mock.calls[0][0];
      expect(deployCall.ghPagesState).toEqual({ exists: false });
      // getRemoteTree should NOT have been called (no remote tree for first deploy)
      expect(vi.mocked(getRemoteTree)).not.toHaveBeenCalled();
    });

    // Test C: REST API deploy no changes exits early
    it("Test C: REST API deploy no changes exits early", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: true,
        hasChanges: false,
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.message).toContain("No changes");
      // deployViaAPI should NOT have been called
      expect(vi.mocked(deployViaAPI)).not.toHaveBeenCalled();
    });

    // Test D: Progress is monotonically increasing
    it("Test D: Progress is monotonically increasing", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: true,
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

    // Test E: Auth required before REST API deploy
    it("Test E: Auth required before REST API deploy", async () => {
      // Repo config exists
      vi.mocked(getRepoConfig).mockResolvedValue({ owner: "user", repo: "repo" });

      // No token available from any source
      vi.mocked(getToken).mockResolvedValue(null);
      vi.mocked(getTokenFromGit).mockResolvedValue(null);

      // promptLogin succeeds and then token is available
      vi.mocked(promptLogin).mockResolvedValue(true);
      // After promptLogin, getToken returns a token
      // Note: getToken is called 3 times: preflight, Phase 2, and after promptLogin
      vi.mocked(getToken)
        .mockResolvedValueOnce(null) // preflight check
        .mockResolvedValueOnce(null) // Phase 2 token check
        .mockResolvedValueOnce("new-token"); // after promptLogin

      // Set up rest of the deploy flow
      vi.mocked(getGhPagesState).mockResolvedValue({
        exists: true,
        commitSha: "commit-sha",
        treeSha: "tree-sha",
      });
      vi.mocked(getLocalSiteFingerprint).mockResolvedValue(
        new Map([["index.html", "hash1"]])
      );
      vi.mocked(getRemoteTree).mockResolvedValue(
        new Map([["index.html", { sha: "hash1", mode: "100644" }]])
      );
      vi.mocked(diffFiles).mockReturnValue({
        changed: [],
        unchanged: [{ path: "index.html", sha: "hash1", mode: "100644" }],
        deleted: [],
      });

      const result = await on_deploy(createMockContext());

      // promptLogin should have been called
      expect(vi.mocked(promptLogin)).toHaveBeenCalled();
    });

    // Test F: REST API error returns helpful message
    it("Test F: REST API error returns helpful message", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: true,
        hasChanges: true,
      });

      // deployViaAPI throws error with "Bad credentials"
      vi.mocked(deployViaAPI).mockRejectedValue(
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

    // Test G: Network failure during upload is handled gracefully
    it("Test G: Network failure during upload is handled gracefully", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: true,
        hasChanges: true,
      });

      // deployViaAPI throws "Network error"
      vi.mocked(deployViaAPI).mockRejectedValue(
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

    // Test H: Unicode filenames work correctly
    it("Test H: Unicode filenames work correctly", async () => {
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:user/repo.git",
        ghPagesExists: true,
        hasChanges: true,
        commitSha: "unicode-commit-sha",
      });

      // Override fingerprint with unicode paths
      vi.mocked(getLocalSiteFingerprint).mockResolvedValue(
        new Map([
          ["\u4e2d\u6587\u6587\u7ae0.html", "hash-chinese"],
          ["\u65e5\u672c\u8a9e.html", "hash-japanese"],
          ["caf\u00e9.html", "hash-cafe"],
        ])
      );

      // Remote tree has one matching file
      vi.mocked(getRemoteTree).mockResolvedValue(
        new Map([
          ["\u4e2d\u6587\u6587\u7ae0.html", { sha: "old-hash", mode: "100644" }],
        ])
      );

      // diffFiles returns unicode paths as changed
      vi.mocked(diffFiles).mockReturnValue({
        changed: [
          { path: "\u4e2d\u6587\u6587\u7ae0.html", localHash: "hash-chinese" },
          { path: "\u65e5\u672c\u8a9e.html", localHash: "hash-japanese" },
          { path: "caf\u00e9.html", localHash: "hash-cafe" },
        ],
        unchanged: [],
        deleted: [],
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);

      // Verify diffFiles was called with unicode paths in the local fingerprint
      expect(vi.mocked(diffFiles)).toHaveBeenCalled();
      const diffCall = vi.mocked(diffFiles).mock.calls[0];
      const localFingerprint = diffCall[0] as Map<string, string>;
      expect(localFingerprint.has("\u4e2d\u6587\u6587\u7ae0.html")).toBe(true);
      expect(localFingerprint.has("\u65e5\u672c\u8a9e.html")).toBe(true);
      expect(localFingerprint.has("caf\u00e9.html")).toBe(true);

      // Verify deployViaAPI received the unicode paths
      const deployCall = vi.mocked(deployViaAPI).mock.calls[0][0];
      const changedPaths = deployCall.changed.map(
        (f: { path: string }) => f.path
      );
      expect(changedPaths).toContain("\u4e2d\u6587\u6587\u7ae0.html");
      expect(changedPaths).toContain("\u65e5\u672c\u8a9e.html");
      expect(changedPaths).toContain("caf\u00e9.html");
    });
  });

  // ============================================================================
  // Source Push to Main (first-time deploy backup)
  // ============================================================================

  describe("Source Push to Main", () => {
    /**
     * Helper: set up mocks for a first-time deploy scenario (needsSetup=true).
     * No repo config exists, so ensureGitHubRepo creates it,
     * and the full deploy flow succeeds.
     */
    function setupFirstTimeDeploy(_ctx: MockTauriContext) {
      // No repo config → needsSetup = true
      vi.mocked(getRepoConfig).mockResolvedValue(null);

      // Repo setup succeeds
      vi.mocked(ensureGitHubRepo).mockResolvedValue({
        name: "test-repo",
        fullName: "test-user/test-repo",
        sshUrl: "git@github.com:test-user/test-repo.git",
      });
      vi.mocked(saveRepoConfig).mockResolvedValue(undefined);

      // Token available
      vi.mocked(getToken).mockResolvedValue("test-token");
      vi.mocked(getTokenFromGit).mockResolvedValue(null);

      // gh-pages doesn't exist (first deploy)
      vi.mocked(getGhPagesState).mockResolvedValue({ exists: false });

      // Site fingerprint
      vi.mocked(getLocalSiteFingerprint).mockResolvedValue(
        new Map([
          ["index.html", "site-hash1"],
          ["style.css", "site-hash2"],
        ])
      );

      // All files are new (first deploy, no remote tree)
      vi.mocked(diffFiles).mockReturnValue({
        changed: [
          { path: "index.html", localHash: "site-hash1" },
          { path: "style.css", localHash: "site-hash2" },
        ],
        unchanged: [],
        deleted: [],
      });

      // Deploy succeeds
      vi.mocked(deployViaAPI).mockResolvedValue({ commitSha: "deploy-commit-sha", skippedFiles: [] });

      // Pages status
      vi.mocked(checkPagesStatus).mockResolvedValue({ status: "built" });
    }

    it("pushes source to main on first-time deploy (needsSetup=true)", async () => {
      setupFirstTimeDeploy(ctx);

      // Source fingerprint returns 2 files
      vi.mocked(getLocalSourceFingerprint).mockResolvedValue(
        new Map([
          ["index.md", "source-hash1"],
          ["about.md", "source-hash2"],
        ])
      );

      // pushSourceToMain succeeds
      vi.mocked(pushSourceToMain).mockResolvedValue("source-commit-sha");

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(vi.mocked(pushSourceToMain)).toHaveBeenCalledTimes(1);

      // Verify it was called with correct parameters
      const callArgs = vi.mocked(pushSourceToMain).mock.calls[0][0];
      expect(callArgs.owner).toBe("test-user");
      expect(callArgs.repo).toBe("test-repo");
      expect(callArgs.token).toBe("test-token");
      expect(callArgs.readFn).toBeDefined();
      expect(callArgs.sourceFingerprint.size).toBe(2);

      // Verify source push happens BEFORE gh-pages deploy
      const pushSourceOrder = vi.mocked(pushSourceToMain).mock.invocationCallOrder[0];
      const deployOrder = vi.mocked(deployViaAPI).mock.invocationCallOrder[0];
      expect(pushSourceOrder).toBeLessThan(deployOrder);
    });

    it("does NOT push source on subsequent deploy (needsSetup=false)", async () => {
      // Standard deploy: git repo already exists
      setupDeployMocks(ctx, {
        remoteUrl: "git@github.com:test-user/test-repo.git",
        ghPagesExists: true,
        hasChanges: true,
        commitSha: "subsequent-commit-sha",
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(vi.mocked(pushSourceToMain)).not.toHaveBeenCalled();
      expect(vi.mocked(getLocalSourceFingerprint)).not.toHaveBeenCalled();
    });

    it("source push failure is non-fatal (gh-pages deploy still proceeds)", async () => {
      setupFirstTimeDeploy(ctx);

      // Source fingerprint returns files
      vi.mocked(getLocalSourceFingerprint).mockResolvedValue(
        new Map([["index.md", "source-hash1"]])
      );

      // pushSourceToMain throws an error
      vi.mocked(pushSourceToMain).mockRejectedValue(new Error("GitHub API rate limited"));

      const result = await on_deploy(createMockContext());

      // Deploy should still succeed (source push is non-fatal)
      expect(result.success).toBe(true);

      // Verify the warning was logged
      const logCalls = vi.mocked(log).mock.calls;
      const warnCalls = logCalls.filter((call) => call[0] === "warn");
      expect(warnCalls.length).toBeGreaterThan(0);
      const warnMessages = warnCalls.map((call) => call[1]);
      expect(warnMessages.some((msg) => msg.includes("Source push to main failed"))).toBe(true);

      // Verify deployViaAPI was still called even though source push failed
      expect(vi.mocked(deployViaAPI)).toHaveBeenCalledTimes(1);

      // Verify source push was attempted BEFORE deploy
      const pushSourceOrder = vi.mocked(pushSourceToMain).mock.invocationCallOrder[0];
      const deployOrder = vi.mocked(deployViaAPI).mock.invocationCallOrder[0];
      expect(pushSourceOrder).toBeLessThan(deployOrder);
    });

    it("skips source push when no source files found", async () => {
      setupFirstTimeDeploy(ctx);

      // Source fingerprint returns empty Map
      vi.mocked(getLocalSourceFingerprint).mockResolvedValue(new Map());

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(vi.mocked(pushSourceToMain)).not.toHaveBeenCalled();
    });

    it("skips source push when fingerprint returns null", async () => {
      setupFirstTimeDeploy(ctx);

      // Source fingerprint returns null
      vi.mocked(getLocalSourceFingerprint).mockResolvedValue(null);

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(vi.mocked(pushSourceToMain)).not.toHaveBeenCalled();
    });

    it("filters source files to text extensions only (Step 5a)", async () => {
      setupFirstTimeDeploy(ctx);

      // listSourceFiles returns mixed text + binary files
      vi.mocked(listSourceFiles).mockResolvedValue([
        "index.md",
        "about.md",
        "config.toml",
        "data.json",
        "styles.css",
        "assets/photo.jpg",
        "assets/logo.png",
        "assets/video.mp4",
        "assets/font.woff2",
        "assets/diagram.svg",
      ]);

      // Source fingerprint returns results
      vi.mocked(getLocalSourceFingerprint).mockResolvedValue(
        new Map([
          ["index.md", "hash1"],
          ["about.md", "hash2"],
          ["config.toml", "hash3"],
        ])
      );
      vi.mocked(pushSourceToMain).mockResolvedValue("source-sha");

      const result = await on_deploy(createMockContext());
      expect(result.success).toBe(true);

      // Verify getLocalSourceFingerprint received only text files
      const sourceFilesArg = vi.mocked(getLocalSourceFingerprint).mock.calls[0][0];
      expect(sourceFilesArg).toContain("index.md");
      expect(sourceFilesArg).toContain("about.md");
      expect(sourceFilesArg).toContain("config.toml");
      expect(sourceFilesArg).toContain("data.json");
      expect(sourceFilesArg).toContain("styles.css");
      // Binary files should be filtered out
      expect(sourceFilesArg).not.toContain("assets/photo.jpg");
      expect(sourceFilesArg).not.toContain("assets/logo.png");
      expect(sourceFilesArg).not.toContain("assets/video.mp4");
      expect(sourceFilesArg).not.toContain("assets/font.woff2");
      expect(sourceFilesArg).not.toContain("assets/diagram.svg");
    });

    it("reports progress during source fingerprinting (Step 5b)", async () => {
      setupFirstTimeDeploy(ctx);

      vi.mocked(listSourceFiles).mockResolvedValue(["index.md", "about.md"]);
      vi.mocked(getLocalSourceFingerprint).mockResolvedValue(
        new Map([["index.md", "hash1"], ["about.md", "hash2"]])
      );
      vi.mocked(pushSourceToMain).mockResolvedValue("source-sha");

      const result = await on_deploy(createMockContext());
      expect(result.success).toBe(true);

      // Extract the readFn passed to getLocalSourceFingerprint
      const readFn = vi.mocked(getLocalSourceFingerprint).mock.calls[0][1];
      // Clear progress calls accumulated during deploy
      vi.mocked(reportProgress).mockClear();
      // Call the readFn manually to test it reports progress
      await readFn("index.md");
      expect(vi.mocked(reportProgress)).toHaveBeenCalledWith(
        "deploying", 6, 10, expect.stringContaining("index.md")
      );
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

      // ensureGitHubRepo runs because config was cleared → user cancels
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

      // Preflight fails → config cleared
      vi.mocked(verifyRepoExists).mockRejectedValueOnce(new Error("Not found"));

      // Setup cancelled
      vi.mocked(ensureGitHubRepo).mockResolvedValue(null);

      await on_deploy(createMockContext());

      // Key assertion: getRepoConfig called ONCE (preflight), NOT twice
      // If called twice, the second call could re-trigger .git/config migration
      expect(vi.mocked(getRepoConfig)).toHaveBeenCalledTimes(1);
    });

    it("clears config and succeeds when setup flow completes after stale config", async () => {
      // Stale config on first read — flag prevents second read
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
      vi.mocked(getGhPagesState).mockResolvedValue({ exists: false });
      vi.mocked(getLocalSiteFingerprint).mockResolvedValue(
        new Map([["index.html", "hash1"]])
      );
      vi.mocked(diffFiles).mockReturnValue({
        changed: [{ path: "index.html", localHash: "hash1" }],
        unchanged: [],
        deleted: [],
      });
      vi.mocked(deployViaAPI).mockResolvedValue({ commitSha: "new-commit-sha", skippedFiles: [] });
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
      vi.mocked(getGhPagesState).mockResolvedValue({ exists: false });
      vi.mocked(getLocalSiteFingerprint).mockResolvedValue(new Map([["index.html", "hash1"]]));
      vi.mocked(diffFiles).mockReturnValue({
        changed: [{ path: "index.html", localHash: "hash1" }],
        unchanged: [],
        deleted: [],
      });
      vi.mocked(deployViaAPI).mockResolvedValue({ commitSha: "commit-sha", skippedFiles: [] });
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
