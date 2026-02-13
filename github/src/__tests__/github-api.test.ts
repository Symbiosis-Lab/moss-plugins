/**
 * Tests for GitHub API Module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getAuthenticatedUser,
  checkRepoNameAvailable,
  createRepository,
  isValidRepoName,
  type GitHubUser,
  type CreatedRepository,
} from "../github-api";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock log function
vi.mock("../utils", () => ({
  log: vi.fn(),
}));

describe("GitHub API", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("isValidRepoName", () => {
    it("accepts valid repo names", () => {
      expect(isValidRepoName("my-repo")).toBe(true);
      expect(isValidRepoName("my_repo")).toBe(true);
      expect(isValidRepoName("my.repo")).toBe(true);
      expect(isValidRepoName("MyRepo123")).toBe(true);
      expect(isValidRepoName("a")).toBe(true);
      expect(isValidRepoName("123")).toBe(true);
    });

    it("rejects empty names", () => {
      expect(isValidRepoName("")).toBe(false);
    });

    it("rejects names starting with a period", () => {
      expect(isValidRepoName(".hidden")).toBe(false);
    });

    it("rejects names with invalid characters", () => {
      expect(isValidRepoName("my repo")).toBe(false);
      expect(isValidRepoName("my/repo")).toBe(false);
      expect(isValidRepoName("my@repo")).toBe(false);
      expect(isValidRepoName("my#repo")).toBe(false);
    });

    it("rejects names longer than 100 characters", () => {
      expect(isValidRepoName("a".repeat(101))).toBe(false);
      expect(isValidRepoName("a".repeat(100))).toBe(true);
    });
  });

  describe("getAuthenticatedUser", () => {
    it("returns user information on success", async () => {
      const mockUser: GitHubUser = {
        login: "testuser",
        id: 12345,
        avatar_url: "https://github.com/testuser.png",
        html_url: "https://github.com/testuser",
        name: "Test User",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockUser),
      });

      const user = await getAuthenticatedUser("test-token");

      expect(user).toEqual(mockUser);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/user",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        })
      );
    });

    it("throws error on invalid token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect(getAuthenticatedUser("bad-token")).rejects.toThrow(
        "Invalid or expired token"
      );
    });

    it("throws error on other failures", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(getAuthenticatedUser("test-token")).rejects.toThrow(
        "Failed to get user: 500"
      );
    });
  });

  describe("checkRepoNameAvailable", () => {
    beforeEach(() => {
      // Mock getAuthenticatedUser response for all tests
      mockFetch.mockImplementation((url: string) => {
        if (url === "https://api.github.com/user") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                login: "testuser",
                id: 12345,
                avatar_url: "",
                html_url: "",
              }),
          });
        }
        return Promise.resolve({ ok: false, status: 500 });
      });
    });

    it("returns available=true when repo doesn't exist", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === "https://api.github.com/user") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ login: "testuser" }),
          });
        }
        if (url === "https://api.github.com/repos/testuser/new-repo") {
          return Promise.resolve({ ok: false, status: 404 });
        }
        return Promise.resolve({ ok: false, status: 500 });
      });

      const result = await checkRepoNameAvailable("new-repo", "test-token");

      expect(result.available).toBe(true);
    });

    it("returns available=false when repo exists", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === "https://api.github.com/user") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ login: "testuser" }),
          });
        }
        if (url === "https://api.github.com/repos/testuser/existing-repo") {
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({ ok: false, status: 500 });
      });

      const result = await checkRepoNameAvailable("existing-repo", "test-token");

      expect(result.available).toBe(false);
      expect(result.reason).toBe("exists");
    });

    it("returns available=false for invalid name without API call", async () => {
      const result = await checkRepoNameAvailable("invalid name", "test-token");

      expect(result.available).toBe(false);
      expect(result.reason).toBe("invalid");
      // Should not have made any API calls for invalid name
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("handles API errors gracefully", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === "https://api.github.com/user") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ login: "testuser" }),
          });
        }
        return Promise.resolve({ ok: false, status: 500 });
      });

      const result = await checkRepoNameAvailable("some-repo", "test-token");

      expect(result.available).toBe(false);
      expect(result.reason).toBe("error");
    });
  });

  describe("createRepository", () => {
    it("creates a repository successfully", async () => {
      const mockRepo = {
        name: "my-new-repo",
        full_name: "testuser/my-new-repo",
        html_url: "https://github.com/testuser/my-new-repo",
        ssh_url: "git@github.com:testuser/my-new-repo.git",
        clone_url: "https://github.com/testuser/my-new-repo.git",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockRepo),
      });

      const result = await createRepository("my-new-repo", "test-token");

      expect(result).toEqual({
        name: "my-new-repo",
        fullName: "testuser/my-new-repo",
        htmlUrl: "https://github.com/testuser/my-new-repo",
        sshUrl: "git@github.com:testuser/my-new-repo.git",
        cloneUrl: "https://github.com/testuser/my-new-repo.git",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/user/repos",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"name":"my-new-repo"'),
        })
      );
    });

    it("includes description when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            name: "my-repo",
            full_name: "user/my-repo",
            html_url: "",
            ssh_url: "",
            clone_url: "",
          }),
      });

      await createRepository("my-repo", "test-token", "My description");

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.description).toBe("My description");
    });

    it("creates public repositories", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            name: "my-repo",
            full_name: "user/my-repo",
            html_url: "",
            ssh_url: "",
            clone_url: "",
          }),
      });

      await createRepository("my-repo", "test-token");

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.private).toBe(false);
    });

    it("throws error on failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: () =>
          Promise.resolve({
            message: "Repository creation failed: Name already exists",
          }),
      });

      await expect(
        createRepository("existing-repo", "test-token")
      ).rejects.toThrow("Repository creation failed: Name already exists");
    });
  });

  // ============================================================================
  // Feature 21: checkPagesStatus() tests
  // ============================================================================
  describe("checkPagesStatus", () => {
    // Import will fail until we implement the function
    let checkPagesStatus: (
      owner: string,
      repo: string,
      token: string
    ) => Promise<{ status: string; url: string }>;

    beforeEach(async () => {
      const module = await import("../github-api");
      checkPagesStatus = module.checkPagesStatus;
      mockFetch.mockReset();
    });

    it("returns 'built' when site is live", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "built" }),
      });

      const result = await checkPagesStatus("testuser", "testuser.github.io", "test-token");

      expect(result.status).toBe("built");
      expect(result.url).toBe("https://testuser.github.io/");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/testuser/testuser.github.io/pages/builds/latest",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        })
      );
    });

    it("returns 'building' when deployment in progress", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "building" }),
      });

      const result = await checkPagesStatus("testuser", "my-repo", "test-token");

      expect(result.status).toBe("building");
      expect(result.url).toBe("https://testuser.github.io/my-repo");
    });

    it("returns 'errored' when deployment failed", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "errored" }),
      });

      const result = await checkPagesStatus("testuser", "my-repo", "test-token");

      expect(result.status).toBe("errored");
    });

    it("returns 'unknown' on 404 (no Pages configured)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await checkPagesStatus("testuser", "my-repo", "test-token");

      expect(result.status).toBe("unknown");
      expect(result.url).toBe("");
    });

    it("returns 'unknown' on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await checkPagesStatus("testuser", "my-repo", "test-token");

      expect(result.status).toBe("unknown");
      expect(result.url).toBe("");
    });

    it("generates correct URL for root repo (username.github.io)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "built" }),
      });

      const result = await checkPagesStatus("testuser", "testuser.github.io", "test-token");

      // Root repo URL should have trailing slash, no repo path
      expect(result.url).toBe("https://testuser.github.io/");
    });

    it("generates correct URL for project repo", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "built" }),
      });

      const result = await checkPagesStatus("testuser", "my-project", "test-token");

      // Project repo URL should include repo name as path
      expect(result.url).toBe("https://testuser.github.io/my-project");
    });
  });

  // ============================================================================
  // Feature 20: checkRepoExists() tests
  // ============================================================================
  describe("checkRepoExists", () => {
    // Import will fail until we implement the function
    let checkRepoExists: (owner: string, name: string, token: string) => Promise<boolean>;

    beforeEach(async () => {
      // Dynamic import to get the function
      const module = await import("../github-api");
      checkRepoExists = module.checkRepoExists;
      mockFetch.mockReset();
    });

    it("returns true when repo exists (200 response)", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const exists = await checkRepoExists("testuser", "testuser.github.io", "test-token");

      expect(exists).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/testuser/testuser.github.io",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        })
      );
    });

    it("returns false when repo doesn't exist (404 response)", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const exists = await checkRepoExists("testuser", "testuser.github.io", "test-token");

      expect(exists).toBe(false);
    });

    it("returns false on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const exists = await checkRepoExists("testuser", "testuser.github.io", "test-token");

      expect(exists).toBe(false);
    });

    it("returns false on other HTTP errors", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const exists = await checkRepoExists("testuser", "testuser.github.io", "test-token");

      expect(exists).toBe(false);
    });
  });
});
