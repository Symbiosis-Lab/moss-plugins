/**
 * Tests for GitHub REST API Deployment Module
 *
 * Tests the full deployment lifecycle using GitHub's Git Data API:
 * checking gh-pages state, comparing files, uploading blobs,
 * creating trees/commits, and updating refs.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock executeBinary from moss-api
const mockExecuteBinary = vi.fn();
vi.mock("@symbiosis-lab/moss-api", () => ({
  executeBinary: (...args: unknown[]) => mockExecuteBinary(...args),
}));

// Mock utils (log)
vi.mock("../utils", () => ({
  log: vi.fn().mockResolvedValue(undefined),
}));

import {
  getBranchState,
  getGhPagesState,
  getRemoteTree,
  diffFiles,
  readFileForUpload,
  uploadBlob,
  uploadChangedFiles,
  createTree,
  createCommit,
  updateRef,
  deployViaAPI,
  uploadWithConcurrency,
  type BranchState,
  type GhPagesState,
  type DiffResult,
  type DeployViaAPIOptions,
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
    mockExecuteBinary.mockReset();
  });

  // ==========================================================================
  // getGhPagesState
  // ==========================================================================
  describe("getGhPagesState", () => {
    it("returns exists: true with commit and tree SHA when gh-pages exists", async () => {
      // First call: GET refs/heads/gh-pages
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ref: "refs/heads/gh-pages",
          object: { sha: "abc123commit", type: "commit" },
        })
      );
      // Second call: GET commits/{sha} to get tree
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          sha: "abc123commit",
          tree: { sha: "def456tree" },
        })
      );

      const result = await getGhPagesState(OWNER, REPO, TOKEN);

      expect(result).toEqual({
        exists: true,
        commitSha: "abc123commit",
        treeSha: "def456tree",
      });

      // Verify correct API calls
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "https://api.github.com/repos/testuser/my-site/git/refs/heads/gh-pages",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer ghp_test-token-123",
          }),
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "https://api.github.com/repos/testuser/my-site/git/commits/abc123commit",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer ghp_test-token-123",
          }),
        })
      );
    });

    it("returns exists: false when gh-pages does not exist (404)", async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(404, "Not Found"));

      const result = await getGhPagesState(OWNER, REPO, TOKEN);

      expect(result).toEqual({ exists: false });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("throws on non-404 error from refs endpoint", async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(500, "Internal Server Error"));

      await expect(getGhPagesState(OWNER, REPO, TOKEN)).rejects.toThrow();
    });

    it("throws when commit fetch fails", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ref: "refs/heads/gh-pages",
          object: { sha: "abc123commit", type: "commit" },
        })
      );
      mockFetch.mockResolvedValueOnce(mockErrorResponse(500, "Server Error"));

      await expect(getGhPagesState(OWNER, REPO, TOKEN)).rejects.toThrow();
    });
  });

  // ==========================================================================
  // getBranchState
  // ==========================================================================
  describe("getBranchState", () => {
    it("returns exists: true with commit and tree SHA when branch exists", async () => {
      // First call: GET refs/heads/main
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ref: "refs/heads/main",
          object: { sha: "abc123commit", type: "commit" },
        })
      );
      // Second call: GET commits/{sha} to get tree
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          sha: "abc123commit",
          tree: { sha: "def456tree" },
        })
      );

      const result = await getBranchState(OWNER, REPO, "main", TOKEN);

      expect(result).toEqual({
        exists: true,
        commitSha: "abc123commit",
        treeSha: "def456tree",
      });

      // Verify correct API calls with "main" branch
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "https://api.github.com/repos/testuser/my-site/git/refs/heads/main",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer ghp_test-token-123",
          }),
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "https://api.github.com/repos/testuser/my-site/git/commits/abc123commit",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer ghp_test-token-123",
          }),
        })
      );
    });

    it("returns exists: false when branch returns 404", async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(404, "Not Found"));

      const result = await getBranchState(OWNER, REPO, "nonexistent-branch", TOKEN);

      expect(result).toEqual({ exists: false });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("throws error on API failure (non-404 error)", async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(500, "Internal Server Error"));

      await expect(
        getBranchState(OWNER, REPO, "main", TOKEN)
      ).rejects.toThrow("Internal Server Error");
    });

    it("works with different branch names", async () => {
      const branches = ["main", "gh-pages", "feature/test"];

      for (const branch of branches) {
        mockFetch.mockReset();

        // Mock refs call
        mockFetch.mockResolvedValueOnce(
          mockResponse({
            ref: `refs/heads/${branch}`,
            object: { sha: "commit-sha", type: "commit" },
          })
        );
        // Mock commit call
        mockFetch.mockResolvedValueOnce(
          mockResponse({
            sha: "commit-sha",
            tree: { sha: "tree-sha" },
          })
        );

        const result = await getBranchState(OWNER, REPO, branch, TOKEN);

        expect(result).toEqual({
          exists: true,
          commitSha: "commit-sha",
          treeSha: "tree-sha",
        });

        // Verify the branch name appears in the URL
        expect(mockFetch).toHaveBeenNthCalledWith(
          1,
          `https://api.github.com/repos/testuser/my-site/git/refs/heads/${branch}`,
          expect.any(Object)
        );
      }
    });

    it("getGhPagesState delegates to getBranchState with 'gh-pages'", async () => {
      // Mock refs call for gh-pages
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ref: "refs/heads/gh-pages",
          object: { sha: "ghp-commit", type: "commit" },
        })
      );
      // Mock commit call
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          sha: "ghp-commit",
          tree: { sha: "ghp-tree" },
        })
      );

      const result = await getGhPagesState(OWNER, REPO, TOKEN);

      expect(result).toEqual({
        exists: true,
        commitSha: "ghp-commit",
        treeSha: "ghp-tree",
      });

      // Verify it called the gh-pages URL (same as getBranchState("gh-pages"))
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "https://api.github.com/repos/testuser/my-site/git/refs/heads/gh-pages",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer ghp_test-token-123",
          }),
        })
      );
    });
  });

  // ==========================================================================
  // getRemoteTree
  // ==========================================================================
  describe("getRemoteTree", () => {
    it("returns a Map of path to {sha, mode} for a normal tree", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          sha: "tree-sha-123",
          tree: [
            { path: "index.html", mode: "100644", type: "blob", sha: "blob1" },
            { path: "css/style.css", mode: "100644", type: "blob", sha: "blob2" },
            { path: "images/logo.png", mode: "100644", type: "blob", sha: "blob3" },
          ],
          truncated: false,
        })
      );

      const result = await getRemoteTree(OWNER, REPO, "tree-sha-123", TOKEN);

      expect(result.size).toBe(3);
      expect(result.get("index.html")).toEqual({ sha: "blob1", mode: "100644" });
      expect(result.get("css/style.css")).toEqual({ sha: "blob2", mode: "100644" });
      expect(result.get("images/logo.png")).toEqual({ sha: "blob3", mode: "100644" });
    });

    it("handles truncated tree response (logs warning, returns what we have)", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      mockFetch.mockResolvedValueOnce(
        mockResponse({
          sha: "tree-sha-123",
          tree: [
            { path: "index.html", mode: "100644", type: "blob", sha: "blob1" },
          ],
          truncated: true,
        })
      );

      const result = await getRemoteTree(OWNER, REPO, "tree-sha-123", TOKEN);

      expect(result.size).toBe(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("truncated")
      );

      consoleSpy.mockRestore();
    });

    it("filters out non-blob entries (trees/subdirectories)", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          sha: "tree-sha-123",
          tree: [
            { path: "index.html", mode: "100644", type: "blob", sha: "blob1" },
            { path: "css", mode: "040000", type: "tree", sha: "tree1" },
            { path: "css/style.css", mode: "100644", type: "blob", sha: "blob2" },
          ],
          truncated: false,
        })
      );

      const result = await getRemoteTree(OWNER, REPO, "tree-sha-123", TOKEN);

      expect(result.size).toBe(2);
      expect(result.has("css")).toBe(false);
      expect(result.has("css/style.css")).toBe(true);
    });

    it("handles nested paths correctly", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          sha: "tree-sha-123",
          tree: [
            { path: "a/b/c/d.txt", mode: "100644", type: "blob", sha: "blob1" },
            { path: "x/y/z.html", mode: "100644", type: "blob", sha: "blob2" },
          ],
          truncated: false,
        })
      );

      const result = await getRemoteTree(OWNER, REPO, "tree-sha-123", TOKEN);

      expect(result.get("a/b/c/d.txt")).toEqual({ sha: "blob1", mode: "100644" });
      expect(result.get("x/y/z.html")).toEqual({ sha: "blob2", mode: "100644" });
    });

    it("throws on API error", async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(403, "Forbidden"));

      await expect(
        getRemoteTree(OWNER, REPO, "tree-sha-123", TOKEN)
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // diffFiles (pure function)
  // ==========================================================================
  describe("diffFiles", () => {
    it("marks all files as changed when remote is null (first deploy)", () => {
      const local = new Map([
        ["index.html", "hash1"],
        ["style.css", "hash2"],
      ]);

      const result = diffFiles(local, null);

      expect(result.changed.length).toBe(2);
      expect(result.unchanged.length).toBe(0);
      expect(result.deleted.length).toBe(0);
      expect(result.changed).toContainEqual({ path: "index.html", localHash: "hash1" });
      expect(result.changed).toContainEqual({ path: "style.css", localHash: "hash2" });
    });

    it("detects all files as unchanged when local matches remote", () => {
      const local = new Map([
        ["index.html", "hash1"],
        ["style.css", "hash2"],
      ]);
      const remote = new Map([
        ["index.html", { sha: "hash1", mode: "100644" }],
        ["style.css", { sha: "hash2", mode: "100644" }],
      ]);

      const result = diffFiles(local, remote);

      expect(result.changed.length).toBe(0);
      expect(result.unchanged.length).toBe(2);
      expect(result.deleted.length).toBe(0);
    });

    it("detects mixed changes (added, modified, unchanged, deleted)", () => {
      const local = new Map([
        ["index.html", "hash1"],       // unchanged
        ["style.css", "hash2-new"],     // modified (different hash)
        ["new-page.html", "hash3"],     // added (not in remote)
      ]);
      const remote = new Map([
        ["index.html", { sha: "hash1", mode: "100644" }],
        ["style.css", { sha: "hash2-old", mode: "100644" }],
        ["old-page.html", { sha: "hash4", mode: "100644" }], // deleted (not in local)
      ]);

      const result = diffFiles(local, remote);

      expect(result.changed.length).toBe(2); // modified + added
      expect(result.changed).toContainEqual({ path: "style.css", localHash: "hash2-new" });
      expect(result.changed).toContainEqual({ path: "new-page.html", localHash: "hash3" });
      expect(result.unchanged.length).toBe(1);
      expect(result.unchanged[0].path).toBe("index.html");
      expect(result.deleted.length).toBe(1);
      expect(result.deleted).toContain("old-page.html");
    });

    it("handles deletions only (all remote files removed)", () => {
      const local = new Map<string, string>();
      const remote = new Map([
        ["old1.html", { sha: "hash1", mode: "100644" }],
        ["old2.html", { sha: "hash2", mode: "100644" }],
      ]);

      const result = diffFiles(local, remote);

      expect(result.changed.length).toBe(0);
      expect(result.unchanged.length).toBe(0);
      expect(result.deleted.length).toBe(2);
    });

    it("handles unicode file paths", () => {
      const local = new Map([
        ["\u4e2d\u6587/\u6587\u7ae0.html", "hash1"],
        ["\u00e9t\u00e9.html", "hash2"],
      ]);
      const remote = new Map([
        ["\u4e2d\u6587/\u6587\u7ae0.html", { sha: "hash1-old", mode: "100644" }],
      ]);

      const result = diffFiles(local, remote);

      // Chinese article is modified, ete.html is new
      expect(result.changed.length).toBe(2);
      expect(result.deleted.length).toBe(0);
    });

    it("handles empty local and empty remote", () => {
      const result = diffFiles(new Map(), new Map());

      expect(result.changed.length).toBe(0);
      expect(result.unchanged.length).toBe(0);
      expect(result.deleted.length).toBe(0);
    });

    it("handles empty local and null remote", () => {
      const result = diffFiles(new Map(), null);

      expect(result.changed.length).toBe(0);
      expect(result.unchanged.length).toBe(0);
      expect(result.deleted.length).toBe(0);
    });

    it("preserves mode from remote in unchanged entries", () => {
      const local = new Map([["script.sh", "hash1"]]);
      const remote = new Map([
        ["script.sh", { sha: "hash1", mode: "100755" }],
      ]);

      const result = diffFiles(local, remote);

      expect(result.unchanged.length).toBe(1);
      expect(result.unchanged[0]).toEqual({ path: "script.sh", sha: "hash1", mode: "100755" });
    });
  });

  // ==========================================================================
  // readFileForUpload
  // ==========================================================================
  describe("readFileForUpload", () => {
    it("returns base64 encoded content on success", async () => {
      mockExecuteBinary.mockResolvedValueOnce({
        success: true,
        exitCode: 0,
        stdout: "SGVsbG8gV29ybGQ=\n", // "Hello World" in base64
        stderr: "",
      });

      const result = await readFileForUpload("/path/to/file.txt");

      expect(result).toEqual({
        content: "SGVsbG8gV29ybGQ=",
        encoding: "base64",
      });

      expect(mockExecuteBinary).toHaveBeenCalledWith(
        expect.objectContaining({
          binaryPath: "base64",
          args: expect.arrayContaining(["/path/to/file.txt"]),
        })
      );
    });

    it("throws on file not found (executeBinary fails)", async () => {
      mockExecuteBinary.mockResolvedValueOnce({
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "No such file or directory",
      });

      await expect(readFileForUpload("/nonexistent/file.txt")).rejects.toThrow();
    });
  });

  // ==========================================================================
  // uploadBlob
  // ==========================================================================
  describe("uploadBlob", () => {
    it("uploads blob and returns SHA on success", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ sha: "new-blob-sha-123" }, 201)
      );

      const sha = await uploadBlob(OWNER, REPO, "SGVsbG8=", "base64", TOKEN);

      expect(sha).toBe("new-blob-sha-123");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/testuser/my-site/git/blobs",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer ghp_test-token-123",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ content: "SGVsbG8=", encoding: "base64" }),
        })
      );
    });

    it("throws on 401 Unauthorized", async () => {
      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(401, "Bad credentials")
      );

      await expect(
        uploadBlob(OWNER, REPO, "content", "base64", TOKEN)
      ).rejects.toThrow("Bad credentials");
    });

    it("throws on 403 Forbidden", async () => {
      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(403, "Repository access blocked")
      );

      await expect(
        uploadBlob(OWNER, REPO, "content", "base64", TOKEN)
      ).rejects.toThrow("Repository access blocked");
    });

    it("throws on 422 Unprocessable Entity", async () => {
      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(422, "Validation Failed")
      );

      await expect(
        uploadBlob(OWNER, REPO, "content", "base64", TOKEN)
      ).rejects.toThrow("Validation Failed");
    });
  });

  // ==========================================================================
  // uploadChangedFiles
  // ==========================================================================
  describe("uploadChangedFiles", () => {
    it("uploads files and returns Map of path to blob SHA", async () => {
      const files = [
        { path: "index.html", localHash: "localhash1" },
        { path: "style.css", localHash: "localhash2" },
      ];

      // Mock readFileForUpload (executeBinary for base64)
      mockExecuteBinary
        .mockResolvedValueOnce({
          success: true, exitCode: 0,
          stdout: "PCFET0NUWVBFPg==\n", stderr: "",
        })
        .mockResolvedValueOnce({
          success: true, exitCode: 0,
          stdout: "Ym9keXt9\n", stderr: "",
        });

      // Mock uploadBlob (fetch for POST /git/blobs)
      mockFetch
        .mockResolvedValueOnce(mockResponse({ sha: "blob-sha-1" }, 201))
        .mockResolvedValueOnce(mockResponse({ sha: "blob-sha-2" }, 201));

      const onProgress = vi.fn();
      const result = await uploadChangedFiles(
        files, "/site/dir", OWNER, REPO, TOKEN, onProgress
      );

      expect(result.size).toBe(2);
      expect(result.get("index.html")).toBe("blob-sha-1");
      expect(result.get("style.css")).toBe("blob-sha-2");
    });

    it("calls onProgress callback for each file", async () => {
      const files = [
        { path: "a.html", localHash: "h1" },
        { path: "b.html", localHash: "h2" },
        { path: "c.html", localHash: "h3" },
      ];

      // Mock readFileForUpload
      mockExecuteBinary
        .mockResolvedValue({
          success: true, exitCode: 0,
          stdout: "Y29udGVudA==\n", stderr: "",
        });

      // Mock uploadBlob
      mockFetch
        .mockResolvedValue(mockResponse({ sha: "blob-sha" }, 201));

      const onProgress = vi.fn();
      await uploadChangedFiles(files, "/site", OWNER, REPO, TOKEN, onProgress);

      expect(onProgress).toHaveBeenCalledTimes(3);
      // Verify progress increments
      expect(onProgress).toHaveBeenNthCalledWith(1, 1, 3, expect.any(String));
      expect(onProgress).toHaveBeenNthCalledWith(2, 2, 3, expect.any(String));
      expect(onProgress).toHaveBeenNthCalledWith(3, 3, 3, expect.any(String));
    });

    it("handles empty file list", async () => {
      const onProgress = vi.fn();
      const result = await uploadChangedFiles(
        [], "/site", OWNER, REPO, TOKEN, onProgress
      );

      expect(result.size).toBe(0);
      expect(onProgress).not.toHaveBeenCalled();
    });

    it("propagates upload errors", async () => {
      const files = [{ path: "fail.html", localHash: "h1" }];

      mockExecuteBinary.mockResolvedValueOnce({
        success: true, exitCode: 0,
        stdout: "Y29udGVudA==\n", stderr: "",
      });

      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(401, "Bad credentials")
      );

      const onProgress = vi.fn();
      await expect(
        uploadChangedFiles(files, "/site", OWNER, REPO, TOKEN, onProgress)
      ).rejects.toThrow("Bad credentials");
    });
  });

  // ==========================================================================
  // createTree
  // ==========================================================================
  describe("createTree", () => {
    it("creates tree with base_tree for update deploy", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ sha: "new-tree-sha" }, 201)
      );

      const entries = [
        { path: "index.html", mode: "100644" as const, type: "blob" as const, sha: "blob-sha-1" },
        { path: "style.css", mode: "100644" as const, type: "blob" as const, sha: "blob-sha-2" },
      ];

      const sha = await createTree(OWNER, REPO, entries, "base-tree-sha", TOKEN);

      expect(sha).toBe("new-tree-sha");

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.base_tree).toBe("base-tree-sha");
      expect(body.tree).toEqual(entries);
    });

    it("creates tree without base_tree for first deploy", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ sha: "new-tree-sha" }, 201)
      );

      const entries = [
        { path: "index.html", mode: "100644" as const, type: "blob" as const, sha: "blob-sha-1" },
      ];

      const sha = await createTree(OWNER, REPO, entries, null, TOKEN);

      expect(sha).toBe("new-tree-sha");

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.base_tree).toBeUndefined();
    });

    it("includes deleted files with sha: null", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ sha: "new-tree-sha" }, 201)
      );

      const entries = [
        { path: "index.html", mode: "100644" as const, type: "blob" as const, sha: "blob-sha-1" },
        { path: "deleted.html", mode: "100644" as const, type: "blob" as const, sha: null as unknown as string },
      ];

      const sha = await createTree(OWNER, REPO, entries, "base-tree-sha", TOKEN);

      expect(sha).toBe("new-tree-sha");
      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.tree[1].sha).toBeNull();
    });

    it("throws on API error", async () => {
      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(422, "Validation Failed")
      );

      await expect(
        createTree(OWNER, REPO, [], null, TOKEN)
      ).rejects.toThrow("Validation Failed");
    });
  });

  // ==========================================================================
  // createCommit
  // ==========================================================================
  describe("createCommit", () => {
    it("creates commit with parent", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ sha: "new-commit-sha" }, 201)
      );

      const sha = await createCommit(
        OWNER, REPO, "Deploy site", "tree-sha-123", ["parent-sha-456"], TOKEN
      );

      expect(sha).toBe("new-commit-sha");

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.github.com/repos/testuser/my-site/git/commits");
      const body = JSON.parse(options.body);
      expect(body.message).toBe("Deploy site");
      expect(body.tree).toBe("tree-sha-123");
      expect(body.parents).toEqual(["parent-sha-456"]);
    });

    it("creates commit without parents (orphan/initial)", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ sha: "orphan-commit-sha" }, 201)
      );

      const sha = await createCommit(
        OWNER, REPO, "Initial deploy", "tree-sha-123", [], TOKEN
      );

      expect(sha).toBe("orphan-commit-sha");

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.parents).toEqual([]);
    });

    it("throws on API error", async () => {
      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(422, "Validation Failed")
      );

      await expect(
        createCommit(OWNER, REPO, "msg", "tree", [], TOKEN)
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // updateRef
  // ==========================================================================
  describe("updateRef", () => {
    it("updates existing branch ref with force:true", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ref: "refs/heads/gh-pages", object: { sha: "new-sha" } })
      );

      await updateRef(OWNER, REPO, "gh-pages", "new-sha", true, TOKEN);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(
        "https://api.github.com/repos/testuser/my-site/git/refs/heads/gh-pages"
      );
      expect(options.method).toBe("PATCH");
      const body = JSON.parse(options.body);
      expect(body.sha).toBe("new-sha");
      expect(body.force).toBe(true);
    });

    it("creates new branch ref when exists=false", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ref: "refs/heads/gh-pages", object: { sha: "new-sha" } }, 201)
      );

      await updateRef(OWNER, REPO, "gh-pages", "new-sha", false, TOKEN);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(
        "https://api.github.com/repos/testuser/my-site/git/refs"
      );
      expect(options.method).toBe("POST");
      const body = JSON.parse(options.body);
      expect(body.ref).toBe("refs/heads/gh-pages");
      expect(body.sha).toBe("new-sha");
    });

    it("throws on API error", async () => {
      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(422, "Reference update failed")
      );

      await expect(
        updateRef(OWNER, REPO, "gh-pages", "bad-sha", true, TOKEN)
      ).rejects.toThrow("Reference update failed");
    });
  });

  // ==========================================================================
  // uploadWithConcurrency
  // ==========================================================================
  describe("uploadWithConcurrency", () => {
    it("processes all items and returns results", async () => {
      const items = [1, 2, 3, 4, 5];
      const fn = async (n: number) => n * 2;

      const results = await uploadWithConcurrency(items, fn, 3);

      expect(results).toEqual([2, 4, 6, 8, 10]);
    });

    it("respects concurrency limit", async () => {
      let activeTasks = 0;
      let maxActiveTasks = 0;

      const items = [1, 2, 3, 4, 5, 6, 7, 8];
      const fn = async (n: number) => {
        activeTasks++;
        maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
        // Simulate async work
        await new Promise(resolve => setTimeout(resolve, 10));
        activeTasks--;
        return n;
      };

      await uploadWithConcurrency(items, fn, 3);

      expect(maxActiveTasks).toBeLessThanOrEqual(3);
    });

    it("handles empty items list", async () => {
      const fn = async (n: number) => n;
      const results = await uploadWithConcurrency([], fn, 5);

      expect(results).toEqual([]);
    });

    it("propagates errors from the task function", async () => {
      const items = [1, 2, 3];
      const fn = async (n: number) => {
        if (n === 2) throw new Error("Task 2 failed");
        return n;
      };

      await expect(
        uploadWithConcurrency(items, fn, 2)
      ).rejects.toThrow("Task 2 failed");
    });
  });

  // ==========================================================================
  // deployViaAPI (end-to-end orchestration)
  // ==========================================================================
  describe("deployViaAPI", () => {
    it("performs first deploy (no existing gh-pages)", async () => {
      const changed = [
        { path: "index.html", localHash: "local-hash-1" },
        { path: "style.css", localHash: "local-hash-2" },
      ];

      const ghPagesState: GhPagesState = { exists: false };
      const onProgress = vi.fn();

      // Mock readFileForUpload (executeBinary) - one per file
      mockExecuteBinary
        .mockResolvedValueOnce({
          success: true, exitCode: 0,
          stdout: "aW5kZXg=\n", stderr: "",
        })
        .mockResolvedValueOnce({
          success: true, exitCode: 0,
          stdout: "c3R5bGU=\n", stderr: "",
        });

      // Mock uploadBlob - one per file
      mockFetch
        .mockResolvedValueOnce(mockResponse({ sha: "blob-sha-1" }, 201))
        .mockResolvedValueOnce(mockResponse({ sha: "blob-sha-2" }, 201));

      // Mock createTree
      mockFetch.mockResolvedValueOnce(
        mockResponse({ sha: "new-tree-sha" }, 201)
      );

      // Mock createCommit
      mockFetch.mockResolvedValueOnce(
        mockResponse({ sha: "new-commit-sha" }, 201)
      );

      // Mock updateRef (create new ref)
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ref: "refs/heads/gh-pages" }, 201)
      );

      const commitSha = await deployViaAPI({
        owner: OWNER,
        repo: REPO,
        token: TOKEN,
        siteDir: "/path/to/site",
        changed,
        deleted: [],
        ghPagesState,
        onProgress,
      });

      expect(commitSha).toBe("new-commit-sha");

      // Verify createTree was called without base_tree
      const createTreeCall = mockFetch.mock.calls[2];
      const createTreeBody = JSON.parse(createTreeCall[1].body);
      expect(createTreeBody.base_tree).toBeUndefined();

      // Verify createCommit was called with empty parents
      const createCommitCall = mockFetch.mock.calls[3];
      const createCommitBody = JSON.parse(createCommitCall[1].body);
      expect(createCommitBody.parents).toEqual([]);

      // Verify updateRef created a new ref (POST)
      const updateRefCall = mockFetch.mock.calls[4];
      expect(updateRefCall[1].method).toBe("POST");
    });

    it("performs update deploy (existing gh-pages)", async () => {
      const changed = [
        { path: "index.html", localHash: "local-hash-1" },
      ];

      const ghPagesState: GhPagesState = {
        exists: true,
        commitSha: "existing-commit-sha",
        treeSha: "existing-tree-sha",
      };
      const onProgress = vi.fn();

      // Mock readFileForUpload for the one changed file
      mockExecuteBinary.mockResolvedValueOnce({
        success: true, exitCode: 0,
        stdout: "aW5kZXg=\n", stderr: "",
      });

      // Mock uploadBlob for the one changed file
      mockFetch.mockResolvedValueOnce(
        mockResponse({ sha: "new-blob-sha" }, 201)
      );

      // Mock createTree (with base_tree)
      mockFetch.mockResolvedValueOnce(
        mockResponse({ sha: "updated-tree-sha" }, 201)
      );

      // Mock createCommit (with parent)
      mockFetch.mockResolvedValueOnce(
        mockResponse({ sha: "updated-commit-sha" }, 201)
      );

      // Mock updateRef (PATCH existing)
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ref: "refs/heads/gh-pages" })
      );

      const commitSha = await deployViaAPI({
        owner: OWNER,
        repo: REPO,
        token: TOKEN,
        siteDir: "/path/to/site",
        changed,
        deleted: [],
        ghPagesState,
        onProgress,
      });

      expect(commitSha).toBe("updated-commit-sha");

      // Verify createTree used base_tree
      const createTreeCall = mockFetch.mock.calls[1]; // after 1 blob upload
      const createTreeBody = JSON.parse(createTreeCall[1].body);
      expect(createTreeBody.base_tree).toBe("existing-tree-sha");

      // Verify createCommit used parent
      const createCommitCall = mockFetch.mock.calls[2];
      const createCommitBody = JSON.parse(createCommitCall[1].body);
      expect(createCommitBody.parents).toEqual(["existing-commit-sha"]);

      // Verify updateRef used PATCH
      const updateRefCall = mockFetch.mock.calls[3];
      expect(updateRefCall[1].method).toBe("PATCH");
    });

    it("handles deleted files in update deploy", async () => {
      const changed = [{ path: "index.html", localHash: "hash1" }];
      const deleted = ["old-page.html", "old-style.css"];

      const ghPagesState: GhPagesState = {
        exists: true,
        commitSha: "existing-commit",
        treeSha: "existing-tree",
      };
      const onProgress = vi.fn();

      // readFileForUpload
      mockExecuteBinary.mockResolvedValueOnce({
        success: true, exitCode: 0,
        stdout: "Y29udGVudA==\n", stderr: "",
      });

      // uploadBlob
      mockFetch.mockResolvedValueOnce(
        mockResponse({ sha: "blob1" }, 201)
      );

      // createTree
      mockFetch.mockResolvedValueOnce(
        mockResponse({ sha: "tree-with-deletes" }, 201)
      );

      // createCommit
      mockFetch.mockResolvedValueOnce(
        mockResponse({ sha: "commit-sha" }, 201)
      );

      // updateRef
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ref: "refs/heads/gh-pages" })
      );

      await deployViaAPI({
        owner: OWNER,
        repo: REPO,
        token: TOKEN,
        siteDir: "/path/to/site",
        changed,
        deleted,
        ghPagesState,
        onProgress,
      });

      // Verify createTree includes delete entries (sha: null)
      const createTreeCall = mockFetch.mock.calls[1]; // after 1 blob upload
      const createTreeBody = JSON.parse(createTreeCall[1].body);
      const deleteEntries = createTreeBody.tree.filter(
        (e: { sha: string | null }) => e.sha === null
      );
      expect(deleteEntries.length).toBe(2);
      expect(deleteEntries.map((e: { path: string }) => e.path)).toContain("old-page.html");
      expect(deleteEntries.map((e: { path: string }) => e.path)).toContain("old-style.css");
    });

    it("returns empty string when there are no changed or deleted files", async () => {
      const onProgress = vi.fn();

      const commitSha = await deployViaAPI({
        owner: OWNER,
        repo: REPO,
        token: TOKEN,
        siteDir: "/path/to/site",
        changed: [],
        deleted: [],
        ghPagesState: { exists: true, commitSha: "c", treeSha: "t" },
        onProgress,
      });

      expect(commitSha).toBe("");
      // No API calls should be made
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("propagates error during file upload", async () => {
      const changed = [{ path: "fail.html", localHash: "h1" }];

      // readFileForUpload succeeds
      mockExecuteBinary.mockResolvedValueOnce({
        success: true, exitCode: 0,
        stdout: "Y29udGVudA==\n", stderr: "",
      });

      // uploadBlob fails
      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(401, "Bad credentials")
      );

      const onProgress = vi.fn();

      await expect(
        deployViaAPI({
          owner: OWNER,
          repo: REPO,
          token: TOKEN,
          siteDir: "/site",
          changed,
          deleted: [],
          ghPagesState: { exists: false },
          onProgress,
        })
      ).rejects.toThrow("Bad credentials");
    });
  });
});
