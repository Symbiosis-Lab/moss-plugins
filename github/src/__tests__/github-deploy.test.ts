/**
 * Tests for GitHub Deployment Module
 *
 * Tests verifyRepoExists, deployViaGitPush, and pushSourceViaGitPush.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock utils (log)
vi.mock("../utils", () => ({
  log: vi.fn().mockResolvedValue(undefined),
}));

// Mock @symbiosis-lab/moss-api for executeBinary
vi.mock("@symbiosis-lab/moss-api", () => ({
  executeBinary: vi.fn(),
}));

import { executeBinary } from "@symbiosis-lab/moss-api";
import type { ExecuteResult } from "@symbiosis-lab/moss-api";

import {
  deployViaGitPush,
  pushSourceViaGitPush,
  verifyRepoExists,
  type DeployViaGitPushOptions,
} from "../github-deploy";

// ============================================================================
// Test Constants
// ============================================================================

const TOKEN = "ghp_test-token-123";
const OWNER = "testuser";
const REPO = "my-site";

/**
 * Helper to create a mock Response for fetch
 */
function mockResponse(body: unknown, status = 200, ok = true): Partial<Response> {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function mockErrorResponse(status: number, message: string): Partial<Response> {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ message }),
    text: () => Promise.resolve(JSON.stringify({ message })),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("github-deploy", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // ==========================================================================
  // verifyRepoExists
  // ==========================================================================
  describe("verifyRepoExists", () => {
    it("succeeds silently when repo exists (200)", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ id: 123, name: "my-site" }));

      await expect(verifyRepoExists(OWNER, REPO, TOKEN)).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/testuser/my-site",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer ghp_test-token-123",
          }),
        })
      );
    });

    it("throws repo-not-found error when 404 and owner exists", async () => {
      // First call: GET /repos/{owner}/{repo} → 404
      mockFetch.mockResolvedValueOnce(mockErrorResponse(404, "Not Found"));
      // Second call: GET /users/{owner} → 200 (owner exists)
      mockFetch.mockResolvedValueOnce(mockResponse({ login: OWNER }));

      await expect(verifyRepoExists(OWNER, REPO, TOKEN)).rejects.toThrow(
        `Repository "${OWNER}/${REPO}" not found`
      );
      // Should have made the disambiguation call
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        `https://api.github.com/users/${OWNER}`,
        expect.objectContaining({
          headers: expect.not.objectContaining({ Authorization: expect.anything() }),
        })
      );
    });

    it("throws owner-not-found error when 404 and owner does not exist", async () => {
      // First call: GET /repos/{owner}/{repo} → 404
      mockFetch.mockResolvedValueOnce(mockErrorResponse(404, "Not Found"));
      // Second call: GET /users/{owner} → 404 (owner doesn't exist)
      mockFetch.mockResolvedValueOnce(mockErrorResponse(404, "Not Found"));

      await expect(verifyRepoExists(OWNER, REPO, TOKEN)).rejects.toThrow(
        `GitHub user or organization "${OWNER}" not found`
      );
    });

    it("throws invalid token error on 401", async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(401, "Unauthorized"));

      await expect(verifyRepoExists(OWNER, REPO, TOKEN)).rejects.toThrow(
        "GitHub token is invalid or expired"
      );
    });

    it("throws access denied error on 403", async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(403, "Forbidden"));

      await expect(verifyRepoExists(OWNER, REPO, TOKEN)).rejects.toThrow(
        `Access denied to "${OWNER}/${REPO}"`
      );
    });
  });

  // ==========================================================================
  // deployViaGitPush
  // ==========================================================================
  describe("deployViaGitPush", () => {
    const mockExecuteBinary = vi.mocked(executeBinary);

    /** Helper to create an ExecuteResult */
    function gitResult(success: boolean, stdout = "", stderr = ""): ExecuteResult {
      return { success, exitCode: success ? 0 : 1, stdout, stderr };
    }

    beforeEach(() => {
      mockExecuteBinary.mockReset();
    });

    it("initializes git repo on first deploy", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(false))   // rev-parse fails (no .git)
        .mockResolvedValueOnce(gitResult(true))     // git init
        .mockResolvedValueOnce(gitResult(true))     // git config user.email
        .mockResolvedValueOnce(gitResult(true))     // git config user.name
        .mockResolvedValueOnce(gitResult(true))     // git add --all
        .mockResolvedValueOnce(gitResult(false))    // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[gh-pages abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true));    // git push

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      // Verify git init was called
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["init"] })
      );

      // Verify git config user.email was called
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["config", "user.email", "moss@symbiosis-lab.com"] })
      );

      // Verify git config user.name was called
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["config", "user.name", "Moss"] })
      );
    });

    it("reuses existing git repo", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))     // rev-parse succeeds (repo exists)
        .mockResolvedValueOnce(gitResult(true))     // git add --all
        .mockResolvedValueOnce(gitResult(false))    // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[gh-pages def5678] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true));    // git push

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      // Verify git init was NOT called
      const allCalls = mockExecuteBinary.mock.calls;
      const initCalls = allCalls.filter(
        (call) => call[0].args[0] === "init"
      );
      expect(initCalls).toHaveLength(0);

      // Total calls: rev-parse, add, diff, commit, push = 5
      expect(mockExecuteBinary).toHaveBeenCalledTimes(5);
    });

    it("stages, commits, and pushes", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))     // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true))     // git add --all
        .mockResolvedValueOnce(gitResult(false))    // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[gh-pages abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true));    // git push

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      // Verify git add --all
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["add", "--all"] })
      );

      // Verify git commit
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["commit", "-m", "Deploy site\n\nGenerated by Moss"],
        })
      );

      // Verify git push --force with token in URL
      const pushUrl = `https://x-access-token:${TOKEN}@github.com/${OWNER}/${REPO}.git`;
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["push", "--force", pushUrl, "HEAD:gh-pages"],
        })
      );
    });

    it("returns empty string when no changes", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))     // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true))     // git add --all
        .mockResolvedValueOnce(gitResult(true));    // git diff --cached --quiet succeeds (no changes)

      const onProgress = vi.fn();
      const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      expect(result).toBe("");
      // Should not have called commit or push
      expect(mockExecuteBinary).toHaveBeenCalledTimes(3);
    });

    it("returns commit SHA from git commit output", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))     // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true))     // git add --all
        .mockResolvedValueOnce(gitResult(false))    // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[gh-pages abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true));    // git push

      const onProgress = vi.fn();
      const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      expect(result).toBe("abc1234");
    });

    it("sanitizes token from error messages", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))     // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true))     // git add --all
        .mockResolvedValueOnce(gitResult(false))    // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[gh-pages abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(false, "", `fatal: unable to access 'https://x-access-token:${TOKEN}@github.com/testuser/my-site.git/': The requested URL returned error: 403`));  // git push fails

      const onProgress = vi.fn();

      await expect(
        deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress })
      ).rejects.toThrow(expect.objectContaining({
        message: expect.not.stringContaining(TOKEN),
      }));
    });

    it("propagates push errors with sanitized message", async () => {
      const errorMsg = `remote: Repository not found.\nfatal: '${TOKEN}' denied`;
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))     // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true))     // git add --all
        .mockResolvedValueOnce(gitResult(false))    // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[gh-pages abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(false, "", errorMsg));  // git push fails

      const onProgress = vi.fn();

      try {
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });
        // Should not reach here
        expect.fail("Expected deployViaGitPush to throw");
      } catch (err: unknown) {
        const error = err as Error;
        expect(error.message).toContain("git push failed");
        expect(error.message).toContain("***");
        expect(error.message).not.toContain(TOKEN);
      }
    });

    it("reports progress at each step", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))     // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true))     // git add --all
        .mockResolvedValueOnce(gitResult(false))    // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[gh-pages abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true));    // git push

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      // Should report progress at: prepare, staging, commit, push, deployed
      expect(onProgress).toHaveBeenCalledWith(0, 5, "Preparing deploy...");
      expect(onProgress).toHaveBeenCalledWith(1, 5, "Staging files...");
      expect(onProgress).toHaveBeenCalledWith(2, 5, "Creating commit...");
      expect(onProgress).toHaveBeenCalledWith(3, 5, "Pushing to GitHub...");
      expect(onProgress).toHaveBeenCalledWith(5, 5, "Deployed!");
    });

    it("passes correct options to executeBinary", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))     // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true))     // git add --all
        .mockResolvedValueOnce(gitResult(false))    // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[gh-pages abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true));    // git push

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      // All calls should use workingDir ".moss/site" and GIT_TERMINAL_PROMPT=0
      for (const call of mockExecuteBinary.mock.calls) {
        const opts = call[0];
        expect(opts.workingDir).toBe(".moss/site");
        expect(opts.env).toEqual({ GIT_TERMINAL_PROMPT: "0" });
        expect(opts.timeoutMs).toBe(300_000);
      }
    });
  });

  // ==========================================================================
  // pushSourceViaGitPush
  // ==========================================================================
  describe("pushSourceViaGitPush", () => {
    const mockExecuteBinary = vi.mocked(executeBinary);

    /** Helper to create an ExecuteResult */
    function gitResult(success: boolean, stdout = "", stderr = ""): ExecuteResult {
      return { success, exitCode: success ? 0 : 1, stdout, stderr };
    }

    beforeEach(() => {
      mockExecuteBinary.mockReset();
    });

    it("initializes git repo on first source push", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(false))   // rev-parse fails (no .git)
        .mockResolvedValueOnce(gitResult(true))     // git init
        .mockResolvedValueOnce(gitResult(true))     // git config user.email
        .mockResolvedValueOnce(gitResult(true))     // git config user.name
        .mockResolvedValueOnce(gitResult(true))     // write .gitignore
        .mockResolvedValueOnce(gitResult(true))     // git add --all
        .mockResolvedValueOnce(gitResult(false))    // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Add source files\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true));    // git push

      const onProgress = vi.fn();
      await pushSourceViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      // Verify git init was called
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["init"] })
      );

      // Verify git config was called
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["config", "user.email", "moss@symbiosis-lab.com"] })
      );
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["config", "user.name", "Moss"] })
      );
    });

    it("reuses existing git repo", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))     // rev-parse succeeds (repo exists)
        .mockResolvedValueOnce(gitResult(true))     // write .gitignore
        .mockResolvedValueOnce(gitResult(true))     // git add --all
        .mockResolvedValueOnce(gitResult(false))    // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main def5678] Add source files\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true));    // git push

      const onProgress = vi.fn();
      await pushSourceViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      // Verify git init was NOT called
      const allCalls = mockExecuteBinary.mock.calls;
      const initCalls = allCalls.filter(
        (call) => call[0].args[0] === "init"
      );
      expect(initCalls).toHaveLength(0);

      // Total calls: rev-parse, .gitignore, add, diff, commit, push = 6
      expect(mockExecuteBinary).toHaveBeenCalledTimes(6);
    });

    it("stages, commits, and pushes to main", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))     // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true))     // write .gitignore
        .mockResolvedValueOnce(gitResult(true))     // git add --all
        .mockResolvedValueOnce(gitResult(false))    // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Add source files\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true));    // git push

      const onProgress = vi.fn();
      await pushSourceViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      // Verify git add --all
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["add", "--all"] })
      );

      // Verify git commit with source message
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["commit", "-m", "Add source files\n\nUploaded by Moss"],
        })
      );

      // Verify git push --force to main (not gh-pages)
      const pushUrl = `https://x-access-token:${TOKEN}@github.com/${OWNER}/${REPO}.git`;
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["push", "--force", pushUrl, "HEAD:main"],
        })
      );
    });

    it("returns empty string when no changes", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))     // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true))     // write .gitignore
        .mockResolvedValueOnce(gitResult(true))     // git add --all
        .mockResolvedValueOnce(gitResult(true));    // git diff --cached --quiet succeeds (no changes)

      const onProgress = vi.fn();
      const result = await pushSourceViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      expect(result).toBe("");
      // Should not have called commit or push
      expect(mockExecuteBinary).toHaveBeenCalledTimes(4);
    });

    it("sanitizes token from error messages", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))     // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true))     // write .gitignore
        .mockResolvedValueOnce(gitResult(true))     // git add --all
        .mockResolvedValueOnce(gitResult(false))    // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Add source files\n"))  // git commit
        .mockResolvedValueOnce(gitResult(false, "", `fatal: unable to access 'https://x-access-token:${TOKEN}@github.com/testuser/my-site.git/': The requested URL returned error: 403`));  // git push fails

      const onProgress = vi.fn();

      await expect(
        pushSourceViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress })
      ).rejects.toThrow(expect.objectContaining({
        message: expect.not.stringContaining(TOKEN),
      }));
    });

    it("reports progress with 4 steps", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))     // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true))     // write .gitignore
        .mockResolvedValueOnce(gitResult(true))     // git add --all
        .mockResolvedValueOnce(gitResult(false))    // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Add source files\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true));    // git push

      const onProgress = vi.fn();
      await pushSourceViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      // Should report progress with total=4
      expect(onProgress).toHaveBeenCalledWith(0, 4, "Preparing source push...");
      expect(onProgress).toHaveBeenCalledWith(1, 4, "Staging source files...");
      expect(onProgress).toHaveBeenCalledWith(2, 4, "Creating source commit...");
      expect(onProgress).toHaveBeenCalledWith(3, 4, "Pushing source to GitHub...");
      expect(onProgress).toHaveBeenCalledWith(4, 4, "Source pushed!");
    });

    it("uses project root as working directory", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))     // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true))     // write .gitignore
        .mockResolvedValueOnce(gitResult(true))     // git add --all
        .mockResolvedValueOnce(gitResult(false))    // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Add source files\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true));    // git push

      const onProgress = vi.fn();
      await pushSourceViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      // All calls should use workingDir "." (project root, not .moss/site)
      for (const call of mockExecuteBinary.mock.calls) {
        const opts = call[0];
        expect(opts.workingDir).toBe(".");
      }
    });
  });
});
