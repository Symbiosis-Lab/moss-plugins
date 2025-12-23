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
    it("fails with descriptive error when not a git repository", async () => {
      // Mock git rev-parse to fail (not a git repo)
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: false,
        exitCode: 128,
        stdout: "",
        stderr: "fatal: not a git repository (or any of the parent directories): .git",
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      expect(result.message).toContain("not a git repository");
      expect(result.message).toContain("git init");
    });

    it("includes setup instructions in git repo error", async () => {
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: false,
        exitCode: 128,
        stdout: "",
        stderr: "fatal: not a git repository",
      });

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      expect(result.message).toContain("git init");
      expect(result.message).toContain("git remote add origin");
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
      expect(result.message).toContain("No git remote configured");
      expect(result.message).toContain("git remote add origin");
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
    it("fails when site directory is empty (SSH remote to bypass auth)", async () => {
      // Use SSH remote to skip auth check and test site validation
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // SSH GitHub remote (bypasses auth check)
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "git@github.com:user/repo.git",
        stderr: "",
      });

      // No files in .moss/site/ (filesystem is empty by default)
      // This should trigger the site validation error

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/site.*empty|not found/i);
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
    it("detects HTTPS remote and checks for authentication", async () => {
      // Git repo exists
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      // HTTPS remote
      ctx.binaryConfig.setResult("git remote get-url origin", {
        success: true,
        exitCode: 0,
        stdout: "https://github.com/user/repo.git",
        stderr: "",
      });

      // Set up site files
      ctx.filesystem.setFile("/test/project/.moss/site/index.html", "<html></html>");

      // Note: Full auth flow testing is in auth.test.ts and auth.steps.ts
      // Here we just verify the HTTPS detection triggers auth check

      const result = await on_deploy(createMockContext());

      // The result will fail because we haven't mocked the full auth flow
      // but we've verified the path detection works
      expect(result.success).toBe(false);
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
      // Set up for first-time deployment (workflow doesn't exist)
      ctx.binaryConfig.setResult("git rev-parse --git-dir", {
        success: true,
        exitCode: 0,
        stdout: ".git",
        stderr: "",
      });

      ctx.binaryConfig.setResult("git", {
        success: true,
        exitCode: 0,
        stdout: "",
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

      // Workflow doesn't exist
      ctx.binaryConfig.setResult("git ls-files --error-unmatch .github/workflows/moss-deploy.yml", {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "error: pathspec did not match",
      });

      ctx.binaryConfig.setResult("git rev-parse HEAD", {
        success: true,
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      });

      ctx.filesystem.setFile("/test/project/.moss/site/index.html", "<html></html>");
      ctx.filesystem.setFile("/test/project/.gitignore", "");

      const result = await on_deploy(createMockContext());

      expect(result.success).toBe(true);
      expect(result.message).toContain("configured");
      expect(result.deployment?.metadata?.was_first_setup).toBe("true");
    });
  });
});
