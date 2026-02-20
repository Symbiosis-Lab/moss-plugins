/**
 * Tests for GitHub Deployment Module
 *
 * Tests verifyRepoExists and deployViaGitPush (single-repo with tree extraction).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock utils
vi.mock("../utils", () => ({
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
  getOriginOwnerRepo,
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
  // getOriginOwnerRepo
  // ==========================================================================
  describe("getOriginOwnerRepo", () => {
    const mockExecuteBinary = vi.mocked(executeBinary);

    function gitResult(success: boolean, stdout = "", stderr = ""): { success: boolean; exitCode: number; stdout: string; stderr: string } {
      return { success, exitCode: success ? 0 : 1, stdout, stderr };
    }

    beforeEach(() => {
      mockExecuteBinary.mockReset();
    });

    it("returns owner/repo from HTTPS origin", async () => {
      mockExecuteBinary.mockResolvedValueOnce(
        gitResult(true, "https://github.com/testuser/my-site.git\n")
      );

      const result = await getOriginOwnerRepo();

      expect(result).toEqual({ owner: "testuser", repo: "my-site" });
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["remote", "get-url", "origin"],
        })
      );
    });

    it("returns owner/repo from SSH origin", async () => {
      mockExecuteBinary.mockResolvedValueOnce(
        gitResult(true, "git@github.com:testuser/my-site.git\n")
      );

      const result = await getOriginOwnerRepo();
      expect(result).toEqual({ owner: "testuser", repo: "my-site" });
    });

    it("handles dotted repo names (username.github.io)", async () => {
      mockExecuteBinary.mockResolvedValueOnce(
        gitResult(true, "https://github.com/guoliu/guoliu.github.io.git\n")
      );

      const result = await getOriginOwnerRepo();
      expect(result).toEqual({ owner: "guoliu", repo: "guoliu.github.io" });
    });

    it("returns null when no .git directory (command fails)", async () => {
      mockExecuteBinary.mockResolvedValueOnce(
        gitResult(false, "", "fatal: not a git repository")
      );

      const result = await getOriginOwnerRepo();
      expect(result).toBeNull();
    });

    it("returns null when origin is not a GitHub URL", async () => {
      mockExecuteBinary.mockResolvedValueOnce(
        gitResult(true, "https://gitlab.com/user/repo.git\n")
      );

      const result = await getOriginOwnerRepo();
      expect(result).toBeNull();
    });

    it("returns null when origin remote does not exist", async () => {
      mockExecuteBinary.mockResolvedValueOnce(
        gitResult(false, "", "fatal: No such remote 'origin'")
      );

      const result = await getOriginOwnerRepo();
      expect(result).toBeNull();
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

    /** Token-free marker URL used for origin identity checks */
    const REPO_MARKER = `https://github.com/${OWNER}/${REPO}.git`;

    /**
     * Set up mock sequence for a full successful deploy (existing repo, matching origin).
     * Returns the mock for further customization.
     *
     * Sequence: rev-parse --git-dir, remote get-url origin, .gitignore,
     *           rm -f index.lock, find(large files), add -v, diff(changes),
     *           commit, rev-parse --short HEAD, rev-parse tree, commit-tree,
     *           push (both refspecs) --progress
     *
     * listSiteFilesWithSizes is mocked separately (returns [] by default).
     */
    function setupFullDeployMocks(commitSha = "abc1234") {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir (repo exists)
        .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin (matches)
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore (sh -c)
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files (none found)
        .mockResolvedValueOnce(gitResult(true))                    // git add --all -v
        .mockResolvedValueOnce(gitResult(false))                   // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true, commitSha + "\n"))  // git rev-parse --short HEAD
        .mockResolvedValueOnce(gitResult(true, "aaa111bbb222\n"))  // git rev-parse HEAD:.moss/site
        .mockResolvedValueOnce(gitResult(true, "ccc333ddd444\n"))  // git commit-tree
        .mockResolvedValueOnce(gitResult(true));                   // git push --force --progress (both refspecs)
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
        .mockResolvedValueOnce(gitResult(true))                    // git remote add origin
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files (none)
        .mockResolvedValueOnce(gitResult(true))                    // git add --all -v
        .mockResolvedValueOnce(gitResult(false))                   // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true, "abc1234\n"))       // rev-parse --short HEAD
        .mockResolvedValueOnce(gitResult(true, "aaa111\n"))        // rev-parse tree
        .mockResolvedValueOnce(gitResult(true, "bbb222\n"))        // commit-tree
        .mockResolvedValueOnce(gitResult(true));                   // push (both refspecs) --progress

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      // Verify git init was called
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["init"] })
      );

      // Verify git config
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["config", "user.email", "moss@symbiosis-lab.com"] })
      );
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["config", "user.name", "moss"] })
      );

      // Verify remote add origin with token-free marker URL
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["remote", "add", "origin", REPO_MARKER],
        })
      );
    });

    it("reuses existing git repo when origin matches", async () => {
      setupFullDeployMocks();

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      // Verify remote get-url origin was checked
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["remote", "get-url", "origin"],
        })
      );

      // Verify git init was NOT called
      const initCalls = mockExecuteBinary.mock.calls.filter(
        (call) => call[0].binaryPath === "git" && call[0].args[0] === "init"
      );
      expect(initCalls).toHaveLength(0);
    });

    it("writes .gitignore excluding .moss/* but including .moss/site/", async () => {
      setupFullDeployMocks();

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

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

    it("pushes to both main and gh-pages in a single push with --progress", async () => {
      setupFullDeployMocks();

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      const pushUrl = `https://x-access-token:${TOKEN}@github.com/${OWNER}/${REPO}.git`;

      // Verify single push with both refspecs
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["push", "--force", "--progress", pushUrl, "HEAD:refs/heads/main", "ccc333ddd444:refs/heads/gh-pages"],
        })
      );

      // Verify only ONE push call total
      const pushCalls = mockExecuteBinary.mock.calls.filter(
        (call) => call[0].binaryPath === "git" && call[0].args[0] === "push"
      );
      expect(pushCalls).toHaveLength(1);
    });

    it("extracts .moss/site tree and creates orphan commit for gh-pages", async () => {
      setupFullDeployMocks();

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

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
          args: ["commit-tree", "aaa111bbb222", "-m", "Deploy site\n\nGenerated by moss"],
        })
      );
    });

    it("returns empty string for truly empty repo (no commits)", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(false))                   // rev-parse --git-dir fails (no .git)
        .mockResolvedValueOnce(gitResult(true))                    // git init
        .mockResolvedValueOnce(gitResult(true))                    // git config user.email
        .mockResolvedValueOnce(gitResult(true))                    // git config user.name
        .mockResolvedValueOnce(gitResult(true))                    // git remote add origin
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files (none)
        .mockResolvedValueOnce(gitResult(true))                    // git add --all -v
        .mockResolvedValueOnce(gitResult(true))                    // git diff --cached --quiet (no changes)
        .mockResolvedValueOnce(gitResult(false));                  // rev-parse HEAD fails (no commits)

      const onProgress = vi.fn();
      const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      expect(result).toBe("");
      // Should NOT have called push (no commits to push)
      const pushCalls = mockExecuteBinary.mock.calls.filter(
        (call) => call[0].binaryPath === "git" && call[0].args[0] === "push"
      );
      expect(pushCalls).toHaveLength(0);
    });

    it("returns commit SHA via rev-parse after commit", async () => {
      setupFullDeployMocks("abc1234");

      const onProgress = vi.fn();
      const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      expect(result).toBe("abc1234");

      // Verify rev-parse --short HEAD was called (not regex on commit output)
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["rev-parse", "--short", "HEAD"],
        })
      );
    });

    it("returns empty SHA when rev-parse fails after commit", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir (repo exists)
        .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin (matches)
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore (sh -c)
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files (none found)
        .mockResolvedValueOnce(gitResult(true))                    // git add --all -v
        .mockResolvedValueOnce(gitResult(false))                   // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(false))                   // rev-parse --short HEAD FAILS
        .mockResolvedValueOnce(gitResult(true, "aaa111bbb222\n"))  // git rev-parse HEAD:.moss/site
        .mockResolvedValueOnce(gitResult(true, "ccc333ddd444\n"))  // git commit-tree
        .mockResolvedValueOnce(gitResult(true));                   // git push --force --progress (both refspecs)

      const onProgress = vi.fn();
      const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      expect(result).toBe("");
    });

    it("sanitizes token from error messages on push failure", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin (matches)
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files (none)
        .mockResolvedValueOnce(gitResult(true))                    // git add --all -v
        .mockResolvedValueOnce(gitResult(false))                   // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true, "abc1234\n"))       // rev-parse --short HEAD
        .mockResolvedValueOnce(gitResult(true, "aaa111\n"))        // rev-parse tree
        .mockResolvedValueOnce(gitResult(true, "bbb222\n"))        // commit-tree
        .mockResolvedValueOnce(gitResult(false, "", `fatal: unable to access 'https://x-access-token:${TOKEN}@github.com/testuser/my-site.git/'`));  // push fails

      const onProgress = vi.fn();

      await expect(
        deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" })
      ).rejects.toThrow(expect.objectContaining({
        message: expect.not.stringContaining(TOKEN),
      }));
    });

    it("reports weighted progress at phase boundaries", async () => {
      setupFullDeployMocks();

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      expect(onProgress).toHaveBeenCalledWith(0, "Preparing deploy...");
      expect(onProgress).toHaveBeenCalledWith(5, "Staging files...");
      expect(onProgress).toHaveBeenCalledWith(15, "Creating commit...");
      expect(onProgress).toHaveBeenCalledWith(20, "Preparing gh-pages...");
      expect(onProgress).toHaveBeenCalledWith(25, "Pushing to GitHub...");
      expect(onProgress).toHaveBeenCalledWith(100, "Deployed!");
    });

    it("uses project root as working directory for all git commands", async () => {
      setupFullDeployMocks();

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      // All calls should use workingDir "." (project root)
      for (const call of mockExecuteBinary.mock.calls) {
        expect(call[0].workingDir).toBe(".");
      }
    });

    it("throws on tree extraction failure", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin (matches)
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files (none)
        .mockResolvedValueOnce(gitResult(true))                    // git add --all -v
        .mockResolvedValueOnce(gitResult(false))                   // git diff (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy site\n"))  // commit
        .mockResolvedValueOnce(gitResult(true, "abc1234\n"))       // rev-parse --short HEAD
        .mockResolvedValueOnce(gitResult(false, "", "fatal: not a valid object name"));  // rev-parse tree fails

      const onProgress = vi.fn();

      await expect(
        deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" })
      ).rejects.toThrow("Failed to resolve .moss/site tree");
    });

    it("throws on commit-tree failure", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse succeeds
        .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin (matches)
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files (none)
        .mockResolvedValueOnce(gitResult(true))                    // git add --all -v
        .mockResolvedValueOnce(gitResult(false))                   // git diff (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy site\n"))  // commit
        .mockResolvedValueOnce(gitResult(true, "abc1234\n"))       // rev-parse --short HEAD
        .mockResolvedValueOnce(gitResult(true, "aaa111\n"))        // rev-parse tree
        .mockResolvedValueOnce(gitResult(false, "", "fatal: not a tree object"));  // commit-tree fails

      const onProgress = vi.fn();

      await expect(
        deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" })
      ).rejects.toThrow("Failed to create gh-pages commit");
    });

    // ========================================================================
    // Idempotency: repo change detection (14a)
    // ========================================================================
    it("reinitializes git when target repo changes", async () => {
      const oldMarker = "https://github.com/oldowner/old-repo.git";
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir (repo exists)
        .mockResolvedValueOnce(gitResult(true, oldMarker + "\n"))  // remote get-url origin (DIFFERENT repo)
        .mockResolvedValueOnce(gitResult(true))                    // rm -rf .git
        .mockResolvedValueOnce(gitResult(true))                    // git init
        .mockResolvedValueOnce(gitResult(true))                    // git config user.email
        .mockResolvedValueOnce(gitResult(true))                    // git config user.name
        .mockResolvedValueOnce(gitResult(true))                    // git remote add origin
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files (none)
        .mockResolvedValueOnce(gitResult(true))                    // git add --all -v
        .mockResolvedValueOnce(gitResult(false))                   // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true, "abc1234\n"))       // rev-parse --short HEAD
        .mockResolvedValueOnce(gitResult(true, "aaa111\n"))        // rev-parse tree
        .mockResolvedValueOnce(gitResult(true, "bbb222\n"))        // commit-tree
        .mockResolvedValueOnce(gitResult(true));                   // push (both refspecs) --progress

      const onProgress = vi.fn();
      const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      expect(result).toBe("abc1234");

      // Verify rm -rf .git was called
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "rm",
          args: ["-rf", ".git"],
        })
      );

      // Verify reinit happened
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["init"] })
      );

      // Verify remote add origin with new marker URL
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["remote", "add", "origin", REPO_MARKER],
        })
      );
    });

    it("reinitializes git when origin is missing", async () => {
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir (repo exists)
        .mockResolvedValueOnce(gitResult(false))                   // remote get-url origin FAILS (no remote)
        .mockResolvedValueOnce(gitResult(true))                    // rm -rf .git
        .mockResolvedValueOnce(gitResult(true))                    // git init
        .mockResolvedValueOnce(gitResult(true))                    // git config user.email
        .mockResolvedValueOnce(gitResult(true))                    // git config user.name
        .mockResolvedValueOnce(gitResult(true))                    // git remote add origin
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files (none)
        .mockResolvedValueOnce(gitResult(true))                    // git add --all -v
        .mockResolvedValueOnce(gitResult(false))                   // git diff --cached --quiet (changes exist)
        .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy site\n"))  // git commit
        .mockResolvedValueOnce(gitResult(true, "abc1234\n"))       // rev-parse --short HEAD
        .mockResolvedValueOnce(gitResult(true, "aaa111\n"))        // rev-parse tree
        .mockResolvedValueOnce(gitResult(true, "bbb222\n"))        // commit-tree
        .mockResolvedValueOnce(gitResult(true));                   // push (both refspecs) --progress

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      // Verify rm -rf .git was called
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "rm",
          args: ["-rf", ".git"],
        })
      );

      // Verify reinit happened
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({ binaryPath: "git", args: ["init"] })
      );
    });

    // ========================================================================
    // Idempotency: stale index.lock removal (14b)
    // ========================================================================
    it("removes stale index.lock before git add", async () => {
      setupFullDeployMocks();

      const onProgress = vi.fn();
      await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      // Verify rm -f .git/index.lock was called
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "rm",
          args: ["-f", ".git/index.lock"],
        })
      );
    });

    // ========================================================================
    // Idempotency: push even when no staged changes (14c — resume after crash)
    // ========================================================================
    it("pushes even when no staged changes (resume after crash)", async () => {
      const pushUrl = `https://x-access-token:${TOKEN}@github.com/${OWNER}/${REPO}.git`;
      mockExecuteBinary
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse --git-dir (repo exists)
        .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))  // remote get-url origin (matches)
        .mockResolvedValueOnce(gitResult(true))                    // write .gitignore
        .mockResolvedValueOnce(gitResult(true))                    // rm -f .git/index.lock
        .mockResolvedValueOnce(gitResult(true, ""))                // find large source files (none)
        .mockResolvedValueOnce(gitResult(true))                    // git add --all -v
        .mockResolvedValueOnce(gitResult(true))                    // git diff --cached --quiet SUCCESS (no changes)
        .mockResolvedValueOnce(gitResult(true))                    // rev-parse HEAD (commits exist from previous deploy)
        .mockResolvedValueOnce(gitResult(true, "aaa111\n"))        // rev-parse tree
        .mockResolvedValueOnce(gitResult(true, "bbb222\n"))        // commit-tree
        .mockResolvedValueOnce(gitResult(true));                   // push (both refspecs) --progress

      const onProgress = vi.fn();
      const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

      // Returns empty string (no new commit SHA) but push still happened
      expect(result).toBe("");

      // Verify commit was NOT called (no changes to commit)
      const commitCalls = mockExecuteBinary.mock.calls.filter(
        (call) => call[0].binaryPath === "git" && call[0].args[0] === "commit"
      );
      expect(commitCalls).toHaveLength(0);

      // Verify single push with both refspecs
      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "git",
          args: ["push", "--force", "--progress", pushUrl, "HEAD:refs/heads/main", "bbb222:refs/heads/gh-pages"],
        })
      );

      // Verify only ONE push call
      const pushCalls = mockExecuteBinary.mock.calls.filter(
        (call) => call[0].binaryPath === "git" && call[0].args[0] === "push"
      );
      expect(pushCalls).toHaveLength(1);
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
          deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" })
        ).rejects.toThrow("assets/huge-video.mp4");
      });

      it("includes file size in the error message", async () => {
        const HUNDRED_MB = 100 * 1024 * 1024;
        mockListSiteFilesWithSizes.mockResolvedValue([
          { path: "assets/huge-video.mp4", size: HUNDRED_MB + 500 },
        ]);

        const onProgress = vi.fn();

        await expect(
          deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" })
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
          await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });
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
        const result = await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        expect(result).toBe("abc1234");
      });

      it("aborts before any git operations when site files exceed limit", async () => {
        const HUNDRED_MB = 100 * 1024 * 1024;
        mockListSiteFilesWithSizes.mockResolvedValue([
          { path: "huge.bin", size: HUNDRED_MB + 1 },
        ]);

        const onProgress = vi.fn();

        try {
          await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });
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
        // Set up mocks: rev-parse, remote get-url, .gitignore write, rm lock, find returns large files
        mockExecuteBinary
          .mockResolvedValueOnce(gitResult(true))                        // rev-parse --git-dir
          .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))    // remote get-url origin (matches)
          .mockResolvedValueOnce(gitResult(true))                        // write .gitignore (sh -c)
          .mockResolvedValueOnce(gitResult(true))                        // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true, "big-model.bin\ndata/huge.csv\n"))  // find large files
          .mockResolvedValueOnce(gitResult(true))                        // append .gitignore (sh -c)
          .mockResolvedValueOnce(gitResult(true))                        // git add --all -v
          .mockResolvedValueOnce(gitResult(false))                       // git diff (changes)
          .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy\n"))  // commit
          .mockResolvedValueOnce(gitResult(true, "abc1234\n"))           // rev-parse --short HEAD
          .mockResolvedValueOnce(gitResult(true, "aaa111\n"))            // rev-parse tree
          .mockResolvedValueOnce(gitResult(true, "bbb222\n"))            // commit-tree
          .mockResolvedValueOnce(gitResult(true));                       // push (both refspecs)

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

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
          .mockResolvedValueOnce(gitResult(true, REPO_MARKER + "\n"))    // remote get-url origin (matches)
          .mockResolvedValueOnce(gitResult(true))                        // write .gitignore (sh -c)
          .mockResolvedValueOnce(gitResult(true))                        // rm -f .git/index.lock
          .mockResolvedValueOnce(gitResult(true, "large-file.bin\n"))    // find large files
          .mockResolvedValueOnce(gitResult(true))                        // append .gitignore (sh -c)
          .mockResolvedValueOnce(gitResult(true))                        // git add --all -v
          .mockResolvedValueOnce(gitResult(false))                       // git diff (changes)
          .mockResolvedValueOnce(gitResult(true, "[main abc1234] Deploy\n"))  // commit
          .mockResolvedValueOnce(gitResult(true, "abc1234\n"))           // rev-parse --short HEAD
          .mockResolvedValueOnce(gitResult(true, "aaa111\n"))            // rev-parse tree
          .mockResolvedValueOnce(gitResult(true, "bbb222\n"))            // commit-tree
          .mockResolvedValueOnce(gitResult(true));                       // push (both refspecs)

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

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
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

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
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

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
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "git",
            args: ["add", "--all", "-v"],
          })
        );
      });

      it("calls git push with --progress flag and both refspecs", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        const pushUrl = `https://x-access-token:${TOKEN}@github.com/${OWNER}/${REPO}.git`;
        expect(mockExecuteBinary).toHaveBeenCalledWith(
          expect.objectContaining({
            binaryPath: "git",
            args: ["push", "--force", "--progress", pushUrl, "HEAD:refs/heads/main", "ccc333ddd444:refs/heads/gh-pages"],
          })
        );
      });

      it("passes onStderr callback to git push", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        // Find the push call
        const pushCall = mockExecuteBinary.mock.calls.find(
          (call) => call[0].binaryPath === "git" &&
            call[0].args[0] === "push" &&
            call[0].args.includes("HEAD:refs/heads/main")
        );
        expect(pushCall).toBeDefined();
        expect(pushCall![0].onStderr).toBeTypeOf("function");
      });

      it("passes onStderr callback to git add for staging progress", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        // Find the git add call
        const addCall = mockExecuteBinary.mock.calls.find(
          (call) => call[0].binaryPath === "git" && call[0].args[0] === "add"
        );
        expect(addCall).toBeDefined();
        expect(addCall![0].onStderr).toBeTypeOf("function");
      });

      it("maps push stderr progress to 25-95% range", async () => {
        setupFullDeployMocks();

        const onProgress = vi.fn();
        await deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress, gitPath: "git" });

        // Find the push call and invoke its onStderr
        const pushCall = mockExecuteBinary.mock.calls.find(
          (call) => call[0].binaryPath === "git" &&
            call[0].args[0] === "push" &&
            call[0].args.includes("HEAD:refs/heads/main")
        );
        const pushOnStderr = pushCall![0].onStderr;

        // Simulate git push progress output at 50%
        pushOnStderr("Writing objects:  50% (5/10), 1.00 MiB | 500.00 KiB/s");

        // Should map 50% to range 25-95%, which is 25 + 35 = 60%
        expect(onProgress).toHaveBeenCalledWith(60, expect.stringContaining("Writing objects"));
      });
    });
  });
});
