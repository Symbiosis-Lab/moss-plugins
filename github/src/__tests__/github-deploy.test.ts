/**
 * Tests for GitHub Deployment Module
 *
 * Tests verifyRepoExists and deployViaGitPush (single-repo with tree extraction).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock utils (log)
vi.mock("../utils", () => ({
  log: vi.fn().mockResolvedValue(undefined),
  showToast: vi.fn().mockResolvedValue(undefined),
}));

// Mock @symbiosis-lab/moss-api for executeBinary and listSiteFilesWithSizes
vi.mock("@symbiosis-lab/moss-api", () => ({
  executeBinary: vi.fn(),
  listSiteFilesWithSizes: vi.fn().mockResolvedValue([]),
}));

import { executeBinary, listSiteFilesWithSizes } from "@symbiosis-lab/moss-api";
import type { ExecuteResult } from "@symbiosis-lab/moss-api";
import { showToast } from "../utils";

import {
  deployViaGitPush,
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
  // deployViaGitPush (single-repo with tree extraction)
  // ==========================================================================
  describe("deployViaGitPush", () => {
    const mockExecuteBinary = vi.mocked(executeBinary);
    const mockListSiteFilesWithSizes = vi.mocked(listSiteFilesWithSizes);
    const mockShowToast = vi.mocked(showToast);

    /** Helper to create an ExecuteResult */
    function gitResult(success: boolean, stdout = "", stderr = ""): ExecuteResult {
      return { success, exitCode: success ? 0 : 1, stdout, stderr };
    }

    /**
     * Set up mock sequence for a full successful deploy (existing repo).
     * Returns the mock for further customization.
     *
     * Sequence: rev-parse, .gitignore, find(large files), add -v, diff(changes),
     *           commit, push main --progress, rev-parse tree, commit-tree,
     *           push gh-pages --progress
     *
     * listSiteFilesWithSizes is mocked separately (returns [] by default).
     */
    function setupFullDeployMocks(commitOutput = "[main abc1234] Deploy site\n") {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir (repo exists)
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore (sh -c)
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files (none found)
        .mockResolvedValueOnce(gitResult(true))                    // git add --all -v
        .mockResolvedValueOnce(gitResult(false))                   // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, commitOutput))      // git commit
        .mockResolvedValueOnce(gitResult(true))                    // git push --force --progress HEAD:main
        .mockResolvedValueOnce(gitResult(true, "aaa111bbb222\n"))  // git rev-parse HEAD:.moss/site
        .mockResolvedValueOnce(gitResult(true, "ccc333ddd444\n"))  // git commit-tree
        .mockResolvedValueOnce(gitResult(true));                   // git push --force --progress <sha>:gh-pages
    }

    beforeEach(() => {
      mockExecuteBinary.mockReset();
      mockListSiteFilesWithSizes.mockReset();
      mockListSiteFilesWithSizes.mockResolvedValue([]);
      mockShowToast.mockReset();
      mockShowToast.mockResolvedValue(undefined);
    });

    it("initializes git repo on first deploy", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(false))                   // rev-parse fails (no .git)
        .mockResolvedValueOnce(gitResult(true))                    // git init
        .mockResolvedValueOnce(gitResult(true))                    // git config user.email
        .mockResolvedValueOnce(gitResult(true))                    // git config user.name
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files (none)
        .mockResolvedValueOnce(gitResult(true))                    // git add --all -v
        .mockResolvedValueOnce(gitResult(false))                   // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true))                    // git push main --progress
        .mockResolvedValueOnce(gitResult(true, "aaa111\n"))        // rev-parse tree
        .mockResolvedValueOnce(gitResult(true, "bbb222\n"))        // commit-tree
        .mockResolvedValueOnce(gitResult(true));                   // push gh-pages --progress

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      // Verify git init was called
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["init"] })
      );

      // Verify git config
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["config", "user.email", "moss@symbiosis-lab.com"] })
      );
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["config", "user.name", "Moss"] })
      );
    });

    it("reuses existing git repo", async () => {
      setupFullDeployMocks();

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      // Verify git init was NOT called
      const initCalls = mockExecuteBinary.mock.calls.filter(
        (call) => call[0].binaryPath === "git" && call[0].args[0] === "init"
      );
      expect(initCalls).toHaveLength(0);
    });

    it("writes .gitignore excluding .moss/* but including .moss/site/", async () => {
      setupFullDeployMocks();

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      // Verify .gitignore is written via sh -c
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "sh",
          args: ["-c", expect.stringContaining(".moss/*")],
        })
      );
      // Verify it also contains the negation pattern
      const shCall = mockExecuteBinary.mock.calls.find(
        (call) => call[0].binaryPath === "sh"
      );
      expect(shCall![0].args[1]).toContain("!.moss/site/");
      expect(shCall![0].args[1]).toContain("node_modules/");
    });

    it("pushes to both main and gh-pages branches with --progress", async () => {
      setupFullDeployMocks();

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      const pushUrl = `https://x-access-token:${TOKEN}@github.com/${OWNER}/${REPO}.git`;

      // Verify push to main with --progress
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["push", "--force", "--progress", pushUrl, "HEAD:main"],
        })
      );

      // Verify push to gh-pages with orphan commit SHA and --progress
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["push", "--force", "--progress", pushUrl, "ccc333ddd444:gh-pages"],
        })
      );
    });

    it("extracts .moss/site tree and creates orphan commit for gh-pages", async () => {
      setupFullDeployMocks();

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      // Verify tree extraction
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["rev-parse", "HEAD:.moss/site"],
        })
      );

      // Verify orphan commit creation with extracted tree
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["commit-tree", "aaa111bbb222", "-m", "Deploy site\n\nGenerated by Moss"],
        })
      );
    });

    it("returns empty string when no changes", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))     // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true))     // write .gitignore
        .mockResolvedValueOnce(gitResult(true, "")) // find large source files (none)
        .mockResolvedValueOnce(gitResult(true))     // git add --all -v
        .mockResolvedValueOnce(gitResult(true));    // git diff --cached --quiet succeeds (no changes)

      const onProgress = vi.fn();
      const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      expect(result).toBe("");
      // Should not have called commit, push, or tree extraction
      expect(mockExecuteBinary).toHaveBeenCalledTimes(5);
    });

    it("returns commit SHA from git commit output", async () => {
      setupFullDeployMocks("[main abc1234] Deploy site\n");

      const onProgress = vi.fn();
      const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      expect(result).toBe("abc1234");
    });

    it("sanitizes token from error messages on main push failure", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))     // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true))     // write .gitignore
        .mockResolvedValueOnce(gitResult(true, "")) // find large source files (none)
        .mockResolvedValueOnce(gitResult(true))     // git add --all -v
        .mockResolvedValueOnce(gitResult(false))    // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(false, "", `fatal: unable to access 'https://x-access-token:${TOKEN}@github.com/testuser/my-site.git/'`));  // push main fails

      const onProgress = vi.fn();

      await expect(
        deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress })
      ).rejects.toThrow(expect.objectContaining({
        message: expect.not.stringContaining(TOKEN),
      }));
    });

    it("sanitizes token from error messages on gh-pages push failure", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))     // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true))     // write .gitignore
        .mockResolvedValueOnce(gitResult(true, "")) // find large source files (none)
        .mockResolvedValueOnce(gitResult(true))     // git add --all -v
        .mockResolvedValueOnce(gitResult(false))    // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true))     // push main --progress succeeds
        .mockResolvedValueOnce(gitResult(true, "aaa111\n"))  // rev-parse tree
        .mockResolvedValueOnce(gitResult(true, "bbb222\n"))  // commit-tree
        .mockResolvedValueOnce(gitResult(false, "", `fatal: '${TOKEN}' denied`));  // push gh-pages fails

      const onProgress = vi.fn();

      try {
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });
        expect.fail("Expected deployViaGitPush to throw");
      } catch (err: unknown) {
        const error = err as Error;
        expect(error.message).toContain("gh-pages");
        expect(error.message).toContain("***");
        expect(error.message).not.toContain(TOKEN);
      }
    });

    it("reports weighted progress at phase boundaries", async () => {
      setupFullDeployMocks();

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      expect(onProgress).toHaveBeenCalledWith(0, "Preparing deploy...");
      expect(onProgress).toHaveBeenCalledWith(5, "Staging files...");
      expect(onProgress).toHaveBeenCalledWith(15, "Creating commit...");
      expect(onProgress).toHaveBeenCalledWith(20, "Pushing source to main...");
      expect(onProgress).toHaveBeenCalledWith(40, "Pushing site to gh-pages...");
      expect(onProgress).toHaveBeenCalledWith(100, "Deployed!");
    });

    it("uses project root as working directory for all git commands", async () => {
      setupFullDeployMocks();

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

      // All calls should use workingDir "." (project root)
      for (const call of mockExecuteBinary.mock.calls) {
        expect(call[0].workingDir).toBe(".");
      }
    });

    it("throws on tree extraction failure", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))     // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true))     // write .gitignore
        .mockResolvedValueOnce(gitResult(true, "")) // find large source files (none)
        .mockResolvedValueOnce(gitResult(true))     // git add --all -v
        .mockResolvedValueOnce(gitResult(false))    // git diff (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy site\n"))  // commit
        .mockResolvedValueOnce(gitResult(true))     // push main --progress
        .mockResolvedValueOnce(gitResult(false, "", "fatal: not a valid object name"));  // rev-parse tree fails

      const onProgress = vi.fn();

      await expect(
        deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress })
      ).rejects.toThrow("Failed to resolve .moss/site tree");
    });

    it("throws on commit-tree failure", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))     // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true))     // write .gitignore
        .mockResolvedValueOnce(gitResult(true, "")) // find large source files (none)
        .mockResolvedValueOnce(gitResult(true))     // git add --all -v
        .mockResolvedValueOnce(gitResult(false))    // git diff (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy site\n"))  // commit
        .mockResolvedValueOnce(gitResult(true))     // push main --progress
        .mockResolvedValueOnce(gitResult(true, "aaa111\n"))  // rev-parse tree
        .mockResolvedValueOnce(gitResult(false, "", "fatal: not a tree object"));  // commit-tree fails

      const onProgress = vi.fn();

      await expect(
        deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress })
      ).rejects.toThrow("Failed to create gh-pages commit");
    });

    // ========================================================================
    // 100MB site file limit — ABORT if any site file exceeds 100MB
    // ========================================================================
    describe("100MB site file limit", () => {
      it("throws when a site file exceeds 100MB", async () => {
        const HUNDRED_MB = 100 * 1024 * 1024;
        mockListSiteFilesWithSizes.mockResolvedValue([
          { path: "index.html", size: 1024 },
          { path: "assets/huge-video.mp4", size: HUNDRED_MB + 1 },
        ]);

        const onProgress = vi.fn();

        await expect(
          deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress })
        ).rejects.toThrow("assets/huge-video.mp4");
      });

      it("includes file size in the error message", async () => {
        const HUNDRED_MB = 100 * 1024 * 1024;
        mockListSiteFilesWithSizes.mockResolvedValue([
          { path: "assets/huge-video.mp4", size: HUNDRED_MB + 500 },
        ]);

        const onProgress = vi.fn();

        await expect(
          deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress })
        ).rejects.toThrow("100");
      });

      it("lists multiple oversized files in error", async () => {
        const HUNDRED_MB = 100 * 1024 * 1024;
        mockListSiteFilesWithSizes.mockResolvedValue([
          { path: "video1.mp4", size: HUNDRED_MB + 1 },
          { path: "video2.mp4", size: HUNDRED_MB * 2 },
          { path: "small.html", size: 500 },
        ]);

        const onProgress = vi.fn();

        try {
          await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });
          expect.fail("Expected to throw");
        } catch (err: unknown) {
          const error = err as Error;
          expect(error.message).toContain("video1.mp4");
          expect(error.message).toContain("video2.mp4");
          expect(error.message).not.toContain("small.html");
        }
      });

      it("does not abort when all site files are under 100MB", async () => {
        mockListSiteFilesWithSizes.mockResolvedValue([
          { path: "index.html", size: 1024 },
          { path: "style.css", size: 2048 },
        ]);

        // Set up full deploy mocks (file size check passes, then normal flow)
        setupFullDeployMocks();

        const onProgress = vi.fn();
        const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

        expect(result).toBe("abc1234");
      });

      it("aborts before any git operations when site files exceed limit", async () => {
        const HUNDRED_MB = 100 * 1024 * 1024;
        mockListSiteFilesWithSizes.mockResolvedValue([
          { path: "huge.bin", size: HUNDRED_MB + 1 },
        ]);

        const onProgress = vi.fn();

        try {
          await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });
        } catch {
          // Expected
        }

        // No git commands should have been called
        expect(mockExecuteBinary).not.toHaveBeenCalled();
      });
    });

    // ========================================================================
    // 100MB source file limit — SKIP >100MB files with warning
    // ========================================================================
    describe("100MB source file limit", () => {
      it("appends large source files to .gitignore", async () => {
        // Set up mocks: rev-parse, .gitignore write, find returns large files
        mockExecuteBinary
          .mockResolvedValueOnce(gitResult(true))                        // rev-parse --git-dir
          .mockResolvedValueOnce(gitResult(true))                        // write .gitignore (sh -c)
          .mockResolvedValueOnce(gitResult(true, "big-model.bin\ndata/huge.csv\n"))  // find large files
          .mockResolvedValueOnce(gitResult(true))                        // append .gitignore (sh -c)
          .mockResolvedValueOnce(gitResult(true))                        // git add --all -v
          .mockResolvedValueOnce(gitResult(false))                       // git diff (changes)
          .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy\n"))  // commit
          .mockResolvedValueOnce(gitResult(true))                        // push main
          .mockResolvedValueOnce(gitResult(true, "aaa111\n"))            // rev-parse tree
          .mockResolvedValueOnce(gitResult(true, "bbb222\n"))            // commit-tree
          .mockResolvedValueOnce(gitResult(true));                       // push gh-pages

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

        // Verify a second sh -c call was made to append to .gitignore
        const shCalls = mockExecuteBinary.mock.calls.filter(
          (call) => call[0].binaryPath === "sh"
        );
        expect(shCalls.length).toBeGreaterThanOrEqual(2);
        // The append call should contain the large file names
        const appendCall = shCalls[1];
        expect(appendCall[0].args[1]).toContain("big-model.bin");
        expect(appendCall[0].args[1]).toContain("data/huge.csv");
      });

      it("shows warning toast for skipped source files", async () => {
        mockExecuteBinary
          .mockResolvedValueOnce(gitResult(true))                        // rev-parse --git-dir
          .mockResolvedValueOnce(gitResult(true))                        // write .gitignore (sh -c)
          .mockResolvedValueOnce(gitResult(true, "large-file.bin\n"))    // find large files
          .mockResolvedValueOnce(gitResult(true))                        // append .gitignore (sh -c)
          .mockResolvedValueOnce(gitResult(true))                        // git add --all -v
          .mockResolvedValueOnce(gitResult(false))                       // git diff (changes)
          .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy\n"))  // commit
          .mockResolvedValueOnce(gitResult(true))                        // push main
          .mockResolvedValueOnce(gitResult(true, "aaa111\n"))            // rev-parse tree
          .mockResolvedValueOnce(gitResult(true, "bbb222\n"))            // commit-tree
          .mockResolvedValueOnce(gitResult(true));                       // push gh-pages

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

        // showToast should have been called with a warning
        expect(mockShowToast).toHaveBeenCalledWith(
          expect.objectContaining({
            variant: "warning",
            message: expect.stringContaining("large-file.bin"),
          })
        );
      });

      it("does not modify .gitignore when no large source files found", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

        // Should only have one sh -c call (base .gitignore write)
        const shCalls = mockExecuteBinary.mock.calls.filter(
          (call) => call[0].binaryPath === "sh"
        );
        expect(shCalls).toHaveLength(1);

        // showToast should NOT have been called for large files
        expect(mockShowToast).not.toHaveBeenCalled();
      });

      it("uses find command to detect large source files", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

        // Verify find command was called with correct args
        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "find",
            args: expect.arrayContaining(["-size", "+100M"]),
          })
        );
      });
    });

    // ========================================================================
    // Streaming git operations — verbose/progress flags + onStderr
    // ========================================================================
    describe("streaming git operations", () => {
      it("calls git add with -v flag", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "git",
            args: ["add", "--all", "-v"],
          })
        );
      });

      it("calls git push main with --progress flag", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

        const pushUrl = `https://x-access-token:${TOKEN}@github.com/${OWNER}/${REPO}.git`;
        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "git",
            args: ["push", "--force", "--progress", pushUrl, "HEAD:main"],
          })
        );
      });

      it("calls git push gh-pages with --progress flag", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

        const pushUrl = `https://x-access-token:${TOKEN}@github.com/${OWNER}/${REPO}.git`;
        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "git",
            args: ["push", "--force", "--progress", pushUrl, "ccc333ddd444:gh-pages"],
          })
        );
      });

      it("passes onStderr callback to git push main", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

        // Find the push main call
        const pushMainCall = mockExecuteBinary.mock.calls.find(
          (call) => call[0].binaryPath === "git" &&
            call[0].args[0] === "push" &&
            call[0].args.includes("HEAD:main")
        );
        expect(pushMainCall).toBeDefined();
        expect(pushMainCall![0].onStderr).toBeTypeOf("function");
      });

      it("passes onStderr callback to git push gh-pages", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

        // Find the push gh-pages call
        const pushPagesCall = mockExecuteBinary.mock.calls.find(
          (call) => call[0].binaryPath === "git" &&
            call[0].args[0] === "push" &&
            call[0].args.some((a: string) => a.endsWith(":gh-pages"))
        );
        expect(pushPagesCall).toBeDefined();
        expect(pushPagesCall![0].onStderr).toBeTypeOf("function");
      });

      it("passes onStderr callback to git add for staging progress", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

        // Find the git add call
        const addCall = mockExecuteBinary.mock.calls.find(
          (call) => call[0].binaryPath === "git" && call[0].args[0] === "add"
        );
        expect(addCall).toBeDefined();
        expect(addCall![0].onStderr).toBeTypeOf("function");
      });

      it("maps push main stderr progress to 20-40% range", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

        // Find the push main call and invoke its onStderr
        const pushMainCall = mockExecuteBinary.mock.calls.find(
          (call) => call[0].binaryPath === "git" &&
            call[0].args[0] === "push" &&
            call[0].args.includes("HEAD:main")
        );
        const pushMainOnStderr = pushMainCall![0].onStderr;

        // Simulate git push progress output
        pushMainOnStderr("Writing objects:  50% (5/10), 1.00 MiB | 500.00 KiB/s");

        // Should map 50% to range 20-40%, which is 30%
        expect(onProgress).toHaveBeenCalledWith(30, expect.stringContaining("Writing objects"));
      });

      it("maps push gh-pages stderr progress to 50-95% range", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress });

        // Find the push gh-pages call and invoke its onStderr
        const pushPagesCall = mockExecuteBinary.mock.calls.find(
          (call) => call[0].binaryPath === "git" &&
            call[0].args[0] === "push" &&
            call[0].args.some((a: string) => a.endsWith(":gh-pages"))
        );
        const pushPagesOnStderr = pushPagesCall![0].onStderr;

        // Simulate git push progress output at 50%
        pushPagesOnStderr("Writing objects:  50% (125/250)");

        // Should map 50% to range 50-95%, which is 72.5 => ~73
        expect(onProgress).toHaveBeenCalledWith(
          expect.any(Number),
          expect.stringContaining("Writing objects")
        );
        // Get the actual percent
        const lastProgressCall = onProgress.mock.calls.find(
          (call) => typeof call[0] === "number" && call[0] >= 50 && call[0] <= 95
            && call[1].includes("Writing objects")
        );
        expect(lastProgressCall).toBeDefined();
        const mappedPercent = lastProgressCall![0];
        // 50% of (95-50) = 22.5 => 50 + 22.5 = 72.5
        expect(mappedPercent).toBeCloseTo(73, 0);
      });
    });
  });
});
