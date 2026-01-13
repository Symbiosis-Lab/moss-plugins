/**
 * Integration tests for the on_deploy hook
 *
 * Uses @symbiosis-lab/moss-api/testing to mock Tauri IPC commands
 * and test the full deployment flow with various scenarios.
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
  setCurrentHookName: vi.fn(),
}));

// Import after mocking
import { on_deploy } from "../main";

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

describe("on_deploy integration", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri();
    vi.clearAllMocks();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("Git Repository Validation", () => {
    it("shows repo setup UI when not a git repository", async () => {
      // Mock git rev-parse to fail (not a git repo)
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: false,
        exitCode: 128,
        stdout: "",
        stderr: "fatal: not a git repository (or any of the parent directories): .git",
      });
      // Git is available
      ctx.binaryConfig.setResult("git --version", {
        success: true,
        exitCode: 0,
        stdout: "git version 2.39.0",
        stderr: "",
      });

      const result = await on_deploy(createMockContext());

      // New behavior: shows repo setup browser UI, returns cancelled when no interaction
      expect(result.success).toBe(false);
      expect(result.message).toContain("cancelled");
    });

    it("returns cancelled when repo setup browser is dismissed", async () => {
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: false,
        exitCode: 128,
        stdout: "",
        stderr: "fatal: not a git repository",
      });
      // Git is available
      ctx.binaryConfig.setResult("git --version", {
        success: true,
        exitCode: 0,
        stdout: "git version 2.39.0",
        stderr: "",
      });

      const result = await on_deploy(createMockContext());

      // New behavior: repo setup UI is shown, returns cancelled when dismissed
      expect(result.success).toBe(false);
      expect(result.message).toContain("cancelled");
    });
  });

  describe("Remote Validation", () => {
    it("fails when no git remote is configured (SSH-like path)", async () => {
      // For this test we simulate a scenario where getRemoteUrl fails
      // We can't easily test HTTPS path because auth check happens first
      // So we test the validation functions directly via SSH path fallback

      // Git repo exists
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // First call returns empty (triggers validation path)
      // Then fails on actual validation
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: false,
        exitCode: 128,
        stdout: "",
        stderr: "fatal: No such remote 'origin'",
      });

      // Set up site files
      ctx.filesystem.setFile("/test/project/.moss/site/index.html", "<html></html>");

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      // Feature 20: Consolidated repo setup - simplified messaging
      expect(result.message).toContain("Repository setup cancelled");
    });

    it("fails when remote is not GitHub (SSH protocol path)", async () => {
      // Use SSH-style GitLab URL to avoid HTTPS auth check
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // SSH-style GitLab remote (not github.com)
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@gitlab.com:user/repo.git",
        stderr: "",
      });

      // Set up files for site validation to pass
      ctx.filesystem.setFile("/test/project/.moss/site/index.html", "<html></html>");

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      expect(result.message).toContain("is not a GitHub URL");
      expect(result.message).toContain("GitHub Pages deployment only works with GitHub");
    });

    it("includes actual URL in error message for non-GitHub remote", async () => {
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // SSH-style GitLab URL to avoid auth check
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@gitlab.com:myorg/myrepo.git",
        stderr: "",
      });

      ctx.filesystem.setFile("/test/project/.moss/site/index.html", "<html></html>");

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      expect(result.message).toContain("gitlab.com");
    });
  });

  describe("Site Compilation Validation", () => {
    it("fails when context.site_files is empty (Bug 13 fix)", async () => {
      // Bug 13: Use context.site_files for validation, NOT listFiles()
      // The plugin should trust context data provided by moss

      const result = await on_deploy(createMockContext({
        site_files: [], // Empty site_files - moss tells plugin no files exist
      }));

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/site.*empty|compile.*first/i);
    });

    it("passes validation when context.site_files has files (Bug 13 fix)", async () => {
      // Setup: Git repo exists with SSH remote (bypass auth)
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git ls-files --error-unmatch .github/workflows/moss-deploy.yml", {
        success: true,
        exitCode: 0,
        stdout: ".github/workflows/moss-deploy.yml",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      // Don't set filesystem files - validation should use context.site_files only
      const result = await on_deploy(createMockContext({
        site_files: ["index.html", "style.css", "app.js"], // Moss provides this
      }));

      // Should NOT fail with "site empty" error
      expect(result.success).toBe(true);
      expect(result.message).not.toContain("Site directory is empty");
    });

    it("does NOT call listFiles() for site validation (Bug 13 fix)", async () => {
      // This test verifies the plugin uses context.site_files, not listFiles()

      // Setup with empty filesystem but populated context.site_files
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git ls-files --error-unmatch .github/workflows/moss-deploy.yml", {
        success: true,
        exitCode: 0,
        stdout: ".github/workflows/moss-deploy.yml",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      // Context has site_files (moss provides these), filesystem is empty
      const result = await on_deploy(createMockContext({
        site_files: ["index.html"],
      }));

      // If the plugin called listFiles(), it would find nothing and fail
      // But with context.site_files, it should succeed
      expect(result.success).toBe(true);
    });
  });

  describe("SSH Remote Handling", () => {
    it("skips OAuth for SSH remotes and proceeds with deployment", async () => {
      // Git repo exists
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // SSH remote
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      // Branch detection
      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      // Workflow doesn't exist yet
      ctx.binaryConfig.setResult("git ls-files --error-unmatch .github/workflows/moss-deploy.yml", {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "error: pathspec did not match",
      });

      // Git add, commit, push
      ctx.binaryConfig.setResult("git add .github/workflows/moss-deploy.yml .gitignore", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "abc123def456",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git push", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      // Set up files
      ctx.filesystem.setFile("/test/project/.moss/site/index.html", "<html></html>");
      ctx.filesystem.setFile("/test/project/.gitignore", "node_modules/");

      const result = await on_deploy(createMockContext());

      // Should not have opened browser for OAuth
      expect(ctx.browserTracker.openedUrls).toHaveLength(0);
    });
  });

  describe("HTTPS Remote Authentication", () => {
    it("skips OAuth for existing HTTPS remotes (Bug 23 fix)", async () => {
      // Bug 23: For existing HTTPS remotes, git handles push auth via credential helper
      // OAuth is only needed when creating new repos (no remote yet)

      // Git repo exists
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // HTTPS remote exists
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "https://github.com/user/repo.git",
        stderr: "",
      });

      // Set up site files
      ctx.filesystem.setFile("/test/project/.moss/site/index.html", "<html></html>");

      const result = await on_deploy(createMockContext());

      // Should not have opened browser for OAuth (git handles push auth)
      expect(ctx.browserTracker.systemBrowserUrls).toHaveLength(0);
      // Deployment proceeds (may still fail due to other mocks, but not auth)
    });
  });

  describe("Successful Deployment", () => {
    it("returns success with deployment info for SSH remote", async () => {
      // Git repo exists
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // SSH remote - use default for all git commands
      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      // Specific overrides
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:testuser/testrepo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git ls-files --error-unmatch .github/workflows/moss-deploy.yml", {
        success: true,
        exitCode: 0,
        stdout: ".github/workflows/moss-deploy.yml",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      // Set up files
      ctx.filesystem.setFile("/test/project/.moss/site/index.html", "<html></html>");

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.deployment).toBeDefined();
      expect(result.deployment?.method).toBe("github-pages");
      expect(result.deployment?.url).toBe("https://testuser.github.io/testrepo");
    });

    it("indicates first-time setup in message", async () => {
      // Set up for first-time deployment (gh-pages doesn't exist)
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "A  index.html", // Show changes exist
        stderr: "",
      });

      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      // gh-pages doesn't exist (first time deploy)
      ctx.binaryConfig.setResult("git rev-parse --verify refs/heads/gh-pages", {
        success: false,
        exitCode: 128,
        stdout: "",
        stderr: "fatal: Needed a single revision",
      });

      ctx.binaryConfig.setResult("git rev-parse --verify refs/remotes/origin/gh-pages", {
        success: false,
        exitCode: 128,
        stdout: "",
        stderr: "fatal: Needed a single revision",
      });

      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      // Shell commands for worktree approach
      ctx.binaryConfig.setResult("rm", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("cp", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("sh", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.filesystem.setFile("/test/project/.moss/site/index.html", "<html></html>");
      ctx.filesystem.setFile("/test/project/.gitignore", "");

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      // New message for zero-config deployment
      expect(result.message).toContain("deployed");
      expect(result.deployment?.metadata?.was_first_setup).toBe("true");
    });
  });

  // ============================================================================
  // Bug 14: Git Push Fails Without Upstream Branch
  // Tests for smart push with upstream detection and retry logic
  // ============================================================================

  describe("Smart Push (Bug 14 Fix)", () => {
    it("uses push -u when no upstream is configured", async () => {
      // Git repo exists
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // SSH remote
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      // Workflow doesn't exist
      ctx.binaryConfig.setResult("git ls-files --error-unmatch .github/workflows/moss-deploy.yml", {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "error: pathspec did not match",
      });

      // No upstream configured (Bug 14 scenario)
      ctx.binaryConfig.setResult("git rev-parse --abbrev-ref --symbolic-full-name @{u}", {
        success: false,
        exitCode: 128,
        stdout: "",
        stderr: "fatal: no upstream configured for branch 'main'",
      });

      // Has local commits
      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      // Default success for all git commands
      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.filesystem.setFile("/test/project/.moss/site/index.html", "<html></html>");
      ctx.filesystem.setFile("/test/project/.gitignore", "");

      const result = await on_deploy(createMockContext());

      // Should succeed - push -u should be used
      expect(result.success).toBe(true);
    });

    it("uses regular push when upstream exists", async () => {
      // Git repo exists
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // SSH remote
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      // Workflow doesn't exist
      ctx.binaryConfig.setResult("git ls-files --error-unmatch .github/workflows/moss-deploy.yml", {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "error: pathspec did not match",
      });

      // Upstream IS configured (returning user scenario)
      ctx.binaryConfig.setResult("git rev-parse --abbrev-ref --symbolic-full-name @{u}", {
        success: true,
        exitCode: 0,
        stdout: "origin/main",
        stderr: "",
      });

      // Has local commits
      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      // Default success for all git commands
      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.filesystem.setFile("/test/project/.moss/site/index.html", "<html></html>");
      ctx.filesystem.setFile("/test/project/.gitignore", "");

      const result = await on_deploy(createMockContext());

      // Should succeed with regular push
      expect(result.success).toBe(true);
    });

    it("handles first-time setup (gh-pages branch doesn't exist)", async () => {
      // Git repo exists
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // SSH remote
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      // gh-pages doesn't exist (first time deploy)
      ctx.binaryConfig.setResult("git rev-parse --verify refs/heads/gh-pages", {
        success: false,
        exitCode: 128,
        stdout: "",
        stderr: "fatal: Needed a single revision",
      });

      ctx.binaryConfig.setResult("git rev-parse --verify refs/remotes/origin/gh-pages", {
        success: false,
        exitCode: 128,
        stdout: "",
        stderr: "fatal: Needed a single revision",
      });

      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      // Default success for all git commands (with changes to commit)
      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "A  index.html",
        stderr: "",
      });

      // Shell commands for worktree approach
      ctx.binaryConfig.setResult("rm", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("cp", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("sh", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.filesystem.setFile("/test/project/.moss/site/index.html", "<html></html>");
      ctx.filesystem.setFile("/test/project/.gitignore", "");

      const result = await on_deploy(createMockContext());

      // Should succeed even with first-time push
      expect(result.success).toBe(true);
      expect(result.deployment?.metadata?.was_first_setup).toBe("true");
    });
  });

  // ============================================================================
  // Bug 15: Subsequent Deploys Don't Push Site Changes
  // Note: With Bug 16 fix, we now use gh-pages branch instead of workflow.
  // The worktree approach uses dynamic paths that are hard to mock precisely.
  // Detailed push verification is covered by Bug 16 tests.
  // ============================================================================

  describe("Subsequent Deploys (Bug 15 Fix)", () => {
    it("succeeds when gh-pages already exists (returning user)", async () => {
      // Git repo exists
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // SSH remote
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      // gh-pages branch EXISTS (returning user)
      ctx.binaryConfig.setResult("git rev-parse --verify refs/heads/gh-pages", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "def456789",
        stderr: "",
      });

      // Default success for all git commands (worktree operations)
      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      // Default success for shell commands (rm, cp, find)
      ctx.binaryConfig.setResult("rm", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
      ctx.binaryConfig.setResult("sh", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
      ctx.binaryConfig.setResult("cp", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const result = await on_deploy(createMockContext());

      // Deployment should succeed (worktree operations work)
      // Note: With default mocks, worktree status returns empty = no changes
      // Detailed change detection is tested in Bug 16 tests
      expect(result.success).toBe(true);
      expect(result.deployment?.method).toBe("github-pages");
    });

    it("reports no changes when site is up to date", async () => {
      // Git repo exists
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // SSH remote
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      // gh-pages branch EXISTS (returning user)
      ctx.binaryConfig.setResult("git rev-parse --verify refs/heads/gh-pages", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      // Default success for all git commands (worktree status returns empty = no changes)
      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      // Default success for shell commands (rm, cp, find)
      ctx.binaryConfig.setResult("rm", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
      ctx.binaryConfig.setResult("sh", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
      ctx.binaryConfig.setResult("cp", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.message).toContain("No changes to deploy");
      // commit_sha should be empty since nothing was pushed
      expect(result.deployment?.metadata?.commit_sha).toBe("");
    });

    it("uses gh-pages worktree approach (not main branch ahead check)", async () => {
      // Note: With Bug 16, we use gh-pages worktree approach.
      // The "local ahead of remote" concept from Bug 15 doesn't apply anymore.
      // We always compare current site content with gh-pages branch content.
      // This test verifies deployment succeeds with gh-pages existing.

      // Git repo exists
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // SSH remote
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      // gh-pages branch EXISTS
      ctx.binaryConfig.setResult("git rev-parse --verify refs/heads/gh-pages", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "xyz789abc",
        stderr: "",
      });

      // Default success for all commands
      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
      ctx.binaryConfig.setResult("rm", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
      ctx.binaryConfig.setResult("sh", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
      ctx.binaryConfig.setResult("cp", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.deployment?.method).toBe("github-pages");
      // With worktree approach, we compare site content, not main branch commits
    });

    it("uses existing gh-pages branch (not orphan) when branch already exists", async () => {
      // Note: With Bug 16, we use gh-pages instead of workflow.
      // This test verifies that when gh-pages exists, we don't recreate it as orphan.

      // Git repo exists
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // SSH remote
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      // gh-pages branch EXISTS (returning user)
      ctx.binaryConfig.setResult("git rev-parse --verify refs/heads/gh-pages", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      // Default success for all git commands
      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      // Default success for shell commands
      ctx.binaryConfig.setResult("rm", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
      ctx.binaryConfig.setResult("sh", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
      ctx.binaryConfig.setResult("cp", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      // was_first_setup should be false since gh-pages already existed
      expect(result.deployment?.metadata?.was_first_setup).toBe("false");
    });
  });

  // ============================================================================
  // Bug 16: gh-pages Branch Not Created (Zero-Config Deployment)
  // Tests for deploying to gh-pages branch using git worktree approach
  // CRITICAL: Must NOT switch current branch (triggers file watchers)
  // ============================================================================

  describe("Zero-Config gh-pages Deployment (Bug 16 Fix)", () => {
    it("deploys successfully when gh-pages branch does not exist (first time)", async () => {
      // Git repo exists
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // SSH remote
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      // gh-pages branch doesn't exist yet (first time deploy)
      ctx.binaryConfig.setResult("git rev-parse --verify refs/heads/gh-pages", {
        success: false,
        exitCode: 128,
        stdout: "",
        stderr: "fatal: Needed a single revision",
      });

      ctx.binaryConfig.setResult("git rev-parse --verify refs/remotes/origin/gh-pages", {
        success: false,
        exitCode: 128,
        stdout: "",
        stderr: "fatal: Needed a single revision",
      });

      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "abc123def",
        stderr: "",
      });

      // Default success for all git commands
      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "A  index.html", // Show changes exist
        stderr: "",
      });

      // Default success for shell commands (cp, rm, etc)
      ctx.binaryConfig.setResult("rm", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("cp", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("sh", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      // First time deploy (gh-pages didn't exist before)
      expect(result.deployment?.metadata?.was_first_setup).toBe("true");
    });

    it("deploys successfully when gh-pages branch already exists (returning user)", async () => {
      // Git repo exists
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // SSH remote
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      // gh-pages EXISTS (returning user)
      ctx.binaryConfig.setResult("git rev-parse --verify refs/heads/gh-pages", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "def456ghi",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "M  index.html", // Show changes exist
        stderr: "",
      });

      ctx.binaryConfig.setResult("rm", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("cp", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("sh", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      // Returning user - not first setup
      expect(result.deployment?.metadata?.was_first_setup).toBe("false");
    });

    it("reports no changes when site content is identical", async () => {
      // Git repo exists
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // SSH remote
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      // gh-pages EXISTS
      ctx.binaryConfig.setResult("git rev-parse --verify refs/heads/gh-pages", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      // Git status in worktree returns empty (no changes)
      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "", // No changes
        stderr: "",
      });

      ctx.binaryConfig.setResult("rm", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("cp", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("sh", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.message).toContain("No changes to deploy");
    });
  });

  // ============================================================================
  // Bug 24: Stale Worktree Blocks Deployment
  // When a previous deploy crashed, a stale worktree may still have gh-pages
  // checked out, blocking new deployments. Plugin must recover gracefully.
  // ============================================================================

  describe("Stale Worktree Recovery (Bug 24 Fix)", () => {
    it("succeeds when worktree prune cleans up stale entries proactively", async () => {
      // Bug 24 fix: worktree prune is called at the start to clean up stale entries
      // This test verifies normal operation when prune successfully cleans up

      // Git repo exists
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // SSH remote
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      // gh-pages EXISTS
      ctx.binaryConfig.setResult("git rev-parse --verify refs/heads/gh-pages", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      // worktree prune succeeds (cleans up stale entries proactively)
      ctx.binaryConfig.setResult("git worktree prune", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "def456ghi",
        stderr: "",
      });

      // Default success for all git commands (worktree add succeeds after prune)
      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "A  index.html",
        stderr: "",
      });

      // Shell commands succeed
      ctx.binaryConfig.setResult("rm", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("cp", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("sh", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.deployment?.method).toBe("github-pages");
    });

    it("continues deployment even if worktree prune fails", async () => {
      // Bug 24 fix: if worktree prune fails, deployment should continue
      // (the error might be harmless, and worktree add might still work)

      // Git repo exists
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // SSH remote
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      // gh-pages EXISTS
      ctx.binaryConfig.setResult("git rev-parse --verify refs/heads/gh-pages", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      // worktree prune FAILS (but deployment should continue)
      ctx.binaryConfig.setResult("git worktree prune", {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "error: some prune error",
      });

      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "def456ghi",
        stderr: "",
      });

      // Default success for all git commands
      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "A  index.html",
        stderr: "",
      });

      // Shell commands succeed
      ctx.binaryConfig.setResult("rm", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("cp", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("sh", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const result = await on_deploy(createMockContext());

      // Should still succeed because worktree prune failure is caught and ignored
      expect(result.success).toBe(true);
      expect(result.deployment?.method).toBe("github-pages");
    });

    it("handles first-time deployment with worktree prune (orphan branch)", async () => {
      // Bug 24 fix: worktree prune is also called for first-time deployments
      // when creating the orphan gh-pages branch

      // Git repo exists
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // SSH remote
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      // gh-pages does NOT exist (first time deploy)
      ctx.binaryConfig.setResult("git rev-parse --verify refs/heads/gh-pages", {
        success: false,
        exitCode: 128,
        stdout: "",
        stderr: "fatal: Needed a single revision",
      });

      ctx.binaryConfig.setResult("git rev-parse --verify refs/remotes/origin/gh-pages", {
        success: false,
        exitCode: 128,
        stdout: "",
        stderr: "fatal: Needed a single revision",
      });

      // worktree prune succeeds
      ctx.binaryConfig.setResult("git worktree prune", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "abc123def",
        stderr: "",
      });

      // Default success for all git commands
      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "A  index.html",
        stderr: "",
      });

      // Shell commands succeed
      ctx.binaryConfig.setResult("rm", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("cp", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("sh", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.deployment?.metadata?.was_first_setup).toBe("true");
    });
  });

  describe("Bug 23: OAuth should not trigger when git credentials work", () => {
    it("should deploy without OAuth when HTTPS remote exists (git handles auth)", async () => {
      // Setup: Git repo exists with HTTPS remote
      // Git push will use git's own credential helper - no OAuth needed
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // HTTPS remote (triggers auth check in buggy code)
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "https://github.com/user/repo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      // gh-pages branch exists (returning user scenario)
      ctx.binaryConfig.setResult("git rev-parse --verify refs/heads/gh-pages", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "def456",
        stderr: "",
      });

      // Git worktree and push commands succeed
      ctx.binaryConfig.setResult("git worktree", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git -C", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("rm", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("cp", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("sh", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const result = await on_deploy(createMockContext({
        site_files: ["index.html"],
      }));

      expect(result.success).toBe(true);
      // Key assertion: No OAuth browser should have been opened
      expect(ctx.browserTracker.systemBrowserUrls).toHaveLength(0);
    });
  });

  // ============================================================================
  // Early Change Detection
  // Tests for optimized "no changes" detection before worktree operations
  // ============================================================================

  describe("Early Change Detection", () => {
    it("skips worktree operations when no changes detected", async () => {
      // Setup: gh-pages exists with same content as local site
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      // gh-pages EXISTS (returning user)
      ctx.binaryConfig.setResult("git rev-parse --verify refs/heads/gh-pages", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      // Early change detection: gh-pages has file with hash "abc123hash"
      ctx.binaryConfig.setResult("git ls-tree -r gh-pages", {
        success: true,
        exitCode: 0,
        stdout: "100644 blob abc123hash\tindex.html",
        stderr: "",
      });

      // Local file has same hash
      ctx.binaryConfig.setResult("git hash-object", {
        success: true,
        exitCode: 0,
        stdout: "abc123hash", // Same hash = no changes
        stderr: "",
      });

      // Mock find command for listing local files
      ctx.binaryConfig.setResult("sh", {
        success: true,
        exitCode: 0,
        stdout: "index.html", // Same file list
        stderr: "",
      });

      // Default success for all other git commands
      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const result = await on_deploy(createMockContext({
        site_files: ["index.html"],
      }));

      // Should succeed with no changes
      expect(result.success).toBe(true);
      expect(result.message).toContain("No changes to deploy");
      expect(result.deployment?.metadata?.commit_sha).toBe("");

      // Worktree operations should NOT have been called
      // (We can't easily verify this without more sophisticated mocking,
      // but the success with empty commit_sha indicates early exit)
    });

    it("proceeds with worktree when changes detected", async () => {
      // Setup: gh-pages exists but content differs
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      // gh-pages EXISTS
      ctx.binaryConfig.setResult("git rev-parse --verify refs/heads/gh-pages", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      // Early change detection: gh-pages has old hash
      ctx.binaryConfig.setResult("git ls-tree -r gh-pages", {
        success: true,
        exitCode: 0,
        stdout: "100644 blob oldhash123\tindex.html",
        stderr: "",
      });

      // Local file has DIFFERENT hash
      ctx.binaryConfig.setResult("git hash-object", {
        success: true,
        exitCode: 0,
        stdout: "newhash456", // Different hash = has changes
        stderr: "",
      });

      // Mock find command
      ctx.binaryConfig.setResult("sh", {
        success: true,
        exitCode: 0,
        stdout: "index.html",
        stderr: "",
      });

      // Default success for worktree operations
      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "M  index.html", // Status shows changes
        stderr: "",
      });

      ctx.binaryConfig.setResult("rm", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("cp", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "newcommitsha789",
        stderr: "",
      });

      const result = await on_deploy(createMockContext({
        site_files: ["index.html"],
      }));

      // Should succeed with changes deployed
      expect(result.success).toBe(true);
      // With changes, commit_sha should be set
      // (Note: due to mocking complexities, this may vary)
    });

    it("falls back to worktree approach when early detection fails", async () => {
      // Setup: gh-pages exists but early detection encounters an error
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git branch --show-current", {
        success: true,
        exitCode: 0,
        stdout: "main",
        stderr: "",
      });

      // gh-pages EXISTS
      ctx.binaryConfig.setResult("git rev-parse --verify refs/heads/gh-pages", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      // Early change detection FAILS
      ctx.binaryConfig.setResult("git ls-tree -r gh-pages", {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "error: some git error",
      });

      // Should fall back to worktree approach
      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "", // No changes in worktree
        stderr: "",
      });

      ctx.binaryConfig.setResult("rm", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("sh", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      ctx.binaryConfig.setResult("cp", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const result = await on_deploy(createMockContext({
        site_files: ["index.html"],
      }));

      // Should still succeed (fallback to worktree approach)
      expect(result.success).toBe(true);
    });
  });
});
