/**
 * Integration tests for the on_deploy hook
 *
 * Uses @symbiosis-lab/moss-api/testing to mock Tauri IPC commands
 * and test the full deployment flow with various scenarios.
 *
 * The deploy target is derived from .git origin (via getOriginOwnerRepo),
 * not from a config file. No config.json, no validation.ts.
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
  getOriginOwnerRepo: vi.fn().mockResolvedValue({ owner: "test-user", repo: "test-repo" }),
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

// Mock the git module
vi.mock("../git", () => ({
  buildPagesUrl: vi.fn().mockImplementation((owner: string, repo: string) => {
    if (repo.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
      return `https://${owner}.github.io`;
    }
    return `https://${owner}.github.io/${repo}`;
  }),
  parseGitHubUrl: vi.fn().mockImplementation((remoteUrl: string) => {
    const m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (m) return { owner: m[1], repo: m[2] };
    return null;
  }),
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
  setCustomDomain: vi.fn(),
}));

// Import after mocking
import { on_deploy } from "../main";
import { log, reportProgress, showToast } from "../utils";
import { verifyRepoExists, getOriginOwnerRepo, deployViaGitPush } from "../github-deploy";
import { promptLogin, validateToken, hasRequiredScopes } from "../auth";
import { getToken, getTokenFromGit, storeToken } from "../token";
import { buildPagesUrl, parseGitHubUrl } from "../git";
import { checkPagesStatus } from "../github-api";
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
 * Set up common mocks for a successful deployment flow.
 *
 * The deploy target comes from getOriginOwnerRepo() (reads .git origin).
 * When needsSetup=true, getOriginOwnerRepo returns null and ensureGitHubRepo runs.
 */
function setupDeployMocks(
  _ctx: MockTauriContext,
  options?: {
    hasChanges?: boolean;
    commitSha?: string;
    token?: string;
    owner?: string;
    repo?: string;
    needsSetup?: boolean;
  }
) {
  const {
    hasChanges = true,
    commitSha = "abc1234def5678",
    token = "test-token",
    owner = "test-user",
    repo = "test-repo",
    needsSetup = false,
  } = options ?? {};

  // Token is available
  vi.mocked(getToken).mockResolvedValue(token);
  vi.mocked(getTokenFromGit).mockResolvedValue(null);

  if (needsSetup) {
    // No .git origin — setup flow runs
    vi.mocked(getOriginOwnerRepo).mockResolvedValue(null);
    vi.mocked(ensureGitHubRepo).mockResolvedValue({
      name: repo,
      fullName: `${owner}/${repo}`,
      sshUrl: `git@github.com:${owner}/${repo}.git`,
    });
  } else {
    // .git origin exists — use it directly
    vi.mocked(getOriginOwnerRepo).mockResolvedValue({ owner, repo });
  }

  // Deploy result
  vi.mocked(deployViaGitPush).mockResolvedValue(hasChanges ? commitSha : "");

  // Pages status check
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
    vi.mocked(buildPagesUrl).mockImplementation((owner: string, repo: string) => {
      if (repo.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
        return `https://${owner}.github.io`;
      }
      return `https://${owner}.github.io/${repo}`;
    });
    vi.mocked(getOriginOwnerRepo).mockResolvedValue({ owner: "test-user", repo: "test-repo" });
    vi.mocked(checkPagesStatus).mockResolvedValue({ status: "built" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("Deploy Target Resolution", () => {
    it("reads deploy target from git origin", async () => {
      setupDeployMocks(ctx, { owner: "myuser", repo: "mysite" });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(vi.mocked(getOriginOwnerRepo)).toHaveBeenCalled();
      expect(vi.mocked(deployViaGitPush)).toHaveBeenCalledWith(
        expect.objectContaining({ owner: "myuser", repo: "mysite" })
      );
    });

    it("runs setup when no git origin exists", async () => {
      vi.mocked(getOriginOwnerRepo).mockResolvedValue(null);
      vi.mocked(ensureGitHubRepo).mockResolvedValue(null);

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      expect(result.message).toContain("cancelled");
      expect(vi.mocked(ensureGitHubRepo)).toHaveBeenCalled();
    });

    it("uses setup result for deploy when no git origin", async () => {
      setupDeployMocks(ctx, {
        needsSetup: true,
        owner: "newuser",
        repo: "newsite",
        hasChanges: true,
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.deployment?.metadata?.was_first_setup).toBe("true");
      expect(vi.mocked(deployViaGitPush)).toHaveBeenCalledWith(
        expect.objectContaining({ owner: "newuser", repo: "newsite" })
      );
    });
  });

  describe("Site Compilation Validation", () => {
    it("fails when context.site_files is empty", async () => {
      const result = await on_deploy(
        createMockContext({ site_files: [] })
      );

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/site.*empty|compile.*first/i);
    });

    it("passes validation when context.site_files has files", async () => {
      setupDeployMocks(ctx, { hasChanges: true });

      const result = await on_deploy(
        createMockContext({ site_files: ["index.html", "style.css", "app.js"] })
      );

      expect(result.success).toBe(true);
      expect(result.message).not.toContain("Site directory is empty");
    });
  });

  describe("Successful Deployment", () => {
    it("returns success with deployment info", async () => {
      setupDeployMocks(ctx, {
        owner: "testuser",
        repo: "testrepo",
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
      setupDeployMocks(ctx, {
        needsSetup: true,
        hasChanges: true,
        commitSha: "abc123",
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.message).toContain("deployed");
      expect(result.deployment?.metadata?.was_first_setup).toBe("true");
    });

    it("was_first_setup is false for subsequent deploys", async () => {
      setupDeployMocks(ctx, { hasChanges: true });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.deployment?.metadata?.was_first_setup).toBe("false");
    });
  });

  describe("No Changes Detection", () => {
    it("reports no changes when deployViaGitPush returns empty string", async () => {
      setupDeployMocks(ctx, { hasChanges: false });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.message).toContain("No changes to deploy");
      expect(result.deployment?.metadata?.commit_sha).toBe("");
    });
  });

  describe("Deployment via git push", () => {
    it("calls deployViaGitPush with correct owner/repo", async () => {
      setupDeployMocks(ctx, {
        owner: "user",
        repo: "repo",
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

    it("handles git push errors gracefully", async () => {
      setupDeployMocks(ctx, { hasChanges: true });
      vi.mocked(deployViaGitPush).mockRejectedValue(new Error("git push failed: remote rejected"));

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      expect(result.message).toContain("remote rejected");
    });
  });

  describe("Authentication", () => {
    it("prompts OAuth when no token available", async () => {
      vi.mocked(getOriginOwnerRepo).mockResolvedValue({ owner: "user", repo: "repo" });
      vi.mocked(getToken).mockResolvedValue(null);
      vi.mocked(getTokenFromGit).mockResolvedValue(null);

      vi.mocked(promptLogin).mockResolvedValue(true);
      vi.mocked(getToken)
        .mockResolvedValueOnce(null) // Phase 1 check
        .mockResolvedValueOnce("new-token"); // after promptLogin

      vi.mocked(deployViaGitPush).mockResolvedValue("");

      const result = await on_deploy(createMockContext());

      expect(vi.mocked(promptLogin)).toHaveBeenCalled();
    });

    it("uses git credential token when valid", async () => {
      vi.mocked(getOriginOwnerRepo).mockResolvedValue({ owner: "test-user", repo: "test-repo" });
      vi.mocked(getToken).mockResolvedValue(null);
      vi.mocked(getTokenFromGit).mockResolvedValue("git-credential-token");

      vi.mocked(validateToken).mockResolvedValue({
        valid: true,
        user: { login: "test-user", id: 1, avatar_url: "", html_url: "" },
        scopes: ["repo"],
      });
      vi.mocked(hasRequiredScopes).mockReturnValue(true);

      vi.mocked(deployViaGitPush).mockResolvedValue("commit-sha");
      vi.mocked(checkPagesStatus).mockResolvedValue({ status: "built" });

      const result = await on_deploy(createMockContext());

      expect(vi.mocked(validateToken)).toHaveBeenCalledWith("git-credential-token");
      expect(vi.mocked(storeToken)).toHaveBeenCalledWith("git-credential-token");
      expect(result.success).toBe(true);
    });

    it("falls through to OAuth when git credential token lacks scopes", async () => {
      vi.mocked(getOriginOwnerRepo).mockResolvedValue({ owner: "test-user", repo: "test-repo" });
      vi.mocked(getToken).mockResolvedValue(null);
      vi.mocked(getTokenFromGit).mockResolvedValue("weak-git-token");

      vi.mocked(validateToken).mockResolvedValue({
        valid: true,
        user: { login: "test-user", id: 1, avatar_url: "", html_url: "" },
        scopes: ["gist"],
      });
      vi.mocked(hasRequiredScopes).mockReturnValue(false);

      vi.mocked(promptLogin).mockResolvedValue(false);

      const result = await on_deploy(createMockContext());

      expect(vi.mocked(storeToken)).not.toHaveBeenCalledWith("weak-git-token");
      expect(vi.mocked(promptLogin)).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    it("auth error returns helpful message", async () => {
      setupDeployMocks(ctx, { hasChanges: true });
      vi.mocked(deployViaGitPush).mockRejectedValue(
        new Error("Bad credentials - authentication failed")
      );

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      const toastCalls = vi.mocked(showToast).mock.calls;
      const errorToasts = toastCalls.filter((call) => call[0]?.variant === "error");
      expect(errorToasts.length).toBeGreaterThan(0);
      expect(errorToasts[0][0].message).toContain("Authentication failed");
    });
  });

  describe("Error Categorization", () => {
    it("shows helpful message for timeout errors", async () => {
      setupDeployMocks(ctx, { hasChanges: true });
      vi.mocked(deployViaGitPush).mockRejectedValue(
        new Error("Request timed out after 300000 ms")
      );

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      const toastCalls = vi.mocked(showToast).mock.calls;
      const errorToasts = toastCalls.filter((call) => call[0]?.variant === "error");
      expect(errorToasts.length).toBeGreaterThan(0);
      expect(errorToasts[0][0].message).toContain("may still be running");
    });

    it("shows network error message for connection failures", async () => {
      setupDeployMocks(ctx, { hasChanges: true });
      vi.mocked(deployViaGitPush).mockRejectedValue(
        new Error("Network connection failed")
      );

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      const toastCalls = vi.mocked(showToast).mock.calls;
      const errorToasts = toastCalls.filter((call) => call[0]?.variant === "error");
      expect(errorToasts.length).toBeGreaterThan(0);
      expect(errorToasts[0][0].message).toContain("Network error");
    });
  });

  describe("Progress Visibility", () => {
    it("reports progress during deployment", async () => {
      setupDeployMocks(ctx, { hasChanges: true });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      const progressCalls = vi.mocked(reportProgress).mock.calls;
      expect(progressCalls.length).toBeGreaterThan(0);
      for (const call of progressCalls) {
        expect(call[2]).toBe(10); // total=10
      }
    });

    it("progress is monotonically increasing", async () => {
      setupDeployMocks(ctx, { hasChanges: true });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      const progressCalls = vi.mocked(reportProgress).mock.calls;
      const currentValues = progressCalls.map((call) => call[1]);

      for (let i = 1; i < currentValues.length; i++) {
        expect(currentValues[i]).toBeGreaterThanOrEqual(currentValues[i - 1]);
      }
    });
  });

  describe("Verify Repo Exists", () => {
    it("calls verifyRepoExists before deploying", async () => {
      setupDeployMocks(ctx, { owner: "user", repo: "repo", hasChanges: true });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(vi.mocked(verifyRepoExists)).toHaveBeenCalledWith("user", "repo", "test-token");
    });

    it("fails with clear error when repo does not exist", async () => {
      setupDeployMocks(ctx, { hasChanges: true });
      vi.mocked(verifyRepoExists).mockRejectedValue(
        new Error('Repository "test-user/test-repo" not found on GitHub.')
      );

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      expect(result.message).toContain("not found");
    });
  });
});
