/**
 * Tests for Repository Setup Module
 *
 * Feature 20: Smart Repo Setup
 * - Auto-creates {username}.github.io when available (no UI)
 * - Shows UI only when root is taken
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// Mock moss-api
const mockShowBrowserForm = vi.fn().mockResolvedValue(null);

vi.mock("@symbiosis-lab/moss-api", () => ({
  showBrowserForm: (...args: unknown[]) => mockShowBrowserForm(...args),
  executeBinary: vi.fn().mockResolvedValue({ success: true, stdout: "", stderr: "" }),
}));

// Mock utils
vi.mock("../utils", () => ({
  log: vi.fn().mockResolvedValue(undefined),
}));

// Mock token module
const mockGetToken = vi.fn();
const mockGetTokenFromGit = vi.fn();
const mockStoreToken = vi.fn();

vi.mock("../token", () => ({
  getToken: () => mockGetToken(),
  getTokenFromGit: () => mockGetTokenFromGit(),
  storeToken: (token: string) => mockStoreToken(token),
}));

// Mock auth module
const mockPromptLogin = vi.fn();
const mockValidateToken = vi.fn();
const mockHasRequiredScopes = vi.fn();

vi.mock("../auth", () => ({
  promptLogin: () => mockPromptLogin(),
  validateToken: (token: string) => mockValidateToken(token),
  hasRequiredScopes: (scopes: string[]) => mockHasRequiredScopes(scopes),
}));

// Mock github-api module
const mockGetAuthenticatedUser = vi.fn();
const mockCheckRepoExists = vi.fn();
const mockCreateRepository = vi.fn();

vi.mock("../github-api", () => ({
  getAuthenticatedUser: (token: string) => mockGetAuthenticatedUser(token),
  checkRepoExists: (owner: string, name: string, token: string) => mockCheckRepoExists(owner, name, token),
  createRepository: (name: string, token: string, description?: string) => mockCreateRepository(name, token, description),
}));

describe("ensureGitHubRepo", () => {
  // Import will fail until we implement the function
  let ensureGitHubRepo: () => Promise<{
    name: string;
    sshUrl: string;
    fullName: string;
  } | null>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import to get the function
    const module = await import("../repo-setup");
    ensureGitHubRepo = module.ensureGitHubRepo;
  });

  describe("authentication", () => {
    it("returns null when no token available and login fails", async () => {
      // No cached token
      mockGetToken.mockResolvedValue(null);
      mockGetTokenFromGit.mockResolvedValue(null);
      // Login fails
      mockPromptLogin.mockResolvedValue(false);

      const result = await ensureGitHubRepo();

      expect(result).toBeNull();
      expect(mockPromptLogin).toHaveBeenCalled();
    });

    it("uses cached token when available", async () => {
      // Cached token exists
      mockGetToken.mockResolvedValue("cached-token");
      mockGetAuthenticatedUser.mockResolvedValue({ login: "testuser" });
      // Root is available - auto create
      mockCheckRepoExists.mockResolvedValue(false);
      mockCreateRepository.mockResolvedValue({
        name: "testuser.github.io",
        fullName: "testuser/testuser.github.io",
        sshUrl: "git@github.com:testuser/testuser.github.io.git",
      });

      const result = await ensureGitHubRepo();

      expect(result).not.toBeNull();
      expect(mockPromptLogin).not.toHaveBeenCalled();
    });

    it("tries git credentials when no cached token", async () => {
      // No cached token
      mockGetToken.mockResolvedValue(null);
      // Git credentials available
      mockGetTokenFromGit.mockResolvedValue("git-token");
      mockValidateToken.mockResolvedValue({ valid: true, scopes: ["repo", "workflow"], user: { login: "testuser" } });
      mockHasRequiredScopes.mockReturnValue(true);
      mockGetAuthenticatedUser.mockResolvedValue({ login: "testuser" });
      // Root is available - auto create
      mockCheckRepoExists.mockResolvedValue(false);
      mockCreateRepository.mockResolvedValue({
        name: "testuser.github.io",
        fullName: "testuser/testuser.github.io",
        sshUrl: "git@github.com:testuser/testuser.github.io.git",
      });

      const result = await ensureGitHubRepo();

      expect(result).not.toBeNull();
      expect(mockGetTokenFromGit).toHaveBeenCalled();
      expect(mockStoreToken).toHaveBeenCalledWith("git-token");
    });
  });

  describe("auto-create root repo when available", () => {
    beforeEach(() => {
      // Setup: Authenticated user
      mockGetToken.mockResolvedValue("test-token");
      mockGetAuthenticatedUser.mockResolvedValue({ login: "testuser" });
    });

    it("auto-creates {username}.github.io when available (no UI)", async () => {
      // Root repo doesn't exist
      mockCheckRepoExists.mockResolvedValue(false);
      mockCreateRepository.mockResolvedValue({
        name: "testuser.github.io",
        fullName: "testuser/testuser.github.io",
        htmlUrl: "https://github.com/testuser/testuser.github.io",
        sshUrl: "git@github.com:testuser/testuser.github.io.git",
        cloneUrl: "https://github.com/testuser/testuser.github.io.git",
      });

      const result = await ensureGitHubRepo();

      // Should NOT show any UI
      expect(mockShowBrowserForm).not.toHaveBeenCalled();

      // Should create the root repo
      expect(mockCheckRepoExists).toHaveBeenCalledWith("testuser", "testuser.github.io", "test-token");
      expect(mockCreateRepository).toHaveBeenCalledWith("testuser.github.io", "test-token", expect.any(String));

      // Should return correct result
      expect(result).toEqual({
        name: "testuser.github.io",
        sshUrl: "git@github.com:testuser/testuser.github.io.git",
        fullName: "testuser/testuser.github.io",
      });
    });

    it("returns created repo info for root URL deployment", async () => {
      mockCheckRepoExists.mockResolvedValue(false);
      mockCreateRepository.mockResolvedValue({
        name: "myuser.github.io",
        fullName: "myuser/myuser.github.io",
        sshUrl: "git@github.com:myuser/myuser.github.io.git",
      });
      mockGetAuthenticatedUser.mockResolvedValue({ login: "myuser" });

      const result = await ensureGitHubRepo();

      expect(result?.name).toBe("myuser.github.io");
      expect(result?.fullName).toBe("myuser/myuser.github.io");
    });
  });

  describe("show UI when root is taken", () => {
    beforeEach(() => {
      // Setup: Authenticated user
      mockGetToken.mockResolvedValue("test-token");
      mockGetAuthenticatedUser.mockResolvedValue({ login: "testuser" });
    });

    it("shows UI when {username}.github.io already exists", async () => {
      // Root repo EXISTS
      mockCheckRepoExists.mockResolvedValue(true);

      // User submits custom name via showBrowserForm
      mockShowBrowserForm.mockResolvedValue({ name: "my-website" });

      mockCreateRepository.mockResolvedValue({
        name: "my-website",
        fullName: "testuser/my-website",
        sshUrl: "git@github.com:testuser/my-website.git",
      });

      const result = await ensureGitHubRepo();

      // Should call showBrowserForm with HTML and timeout
      expect(mockShowBrowserForm).toHaveBeenCalledWith(
        expect.any(String),
        { timeoutMs: 300000 }
      );

      // HTML should contain explanation about root being taken
      const html = mockShowBrowserForm.mock.calls[0][0] as string;
      expect(html).toContain("already");

      // HTML should use mossApi.submit/cancel (not __TAURI__)
      expect(html).toContain("mossApi.submit");
      expect(html).toContain("mossApi.cancel");
      expect(html).not.toContain("__TAURI__");

      // Should create custom repo
      expect(mockCreateRepository).toHaveBeenCalledWith("my-website", "test-token", expect.any(String));

      expect(result).toEqual({
        name: "my-website",
        sshUrl: "git@github.com:testuser/my-website.git",
        fullName: "testuser/my-website",
      });
    });

    it("returns null when user cancels UI", async () => {
      // Root repo EXISTS
      mockCheckRepoExists.mockResolvedValue(true);

      // User cancels - showBrowserForm returns null
      mockShowBrowserForm.mockResolvedValue(null);

      const result = await ensureGitHubRepo();

      expect(mockShowBrowserForm).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it("returns null when UI times out", async () => {
      // Root repo EXISTS
      mockCheckRepoExists.mockResolvedValue(true);

      // Timeout - showBrowserForm returns null on timeout
      mockShowBrowserForm.mockResolvedValue(null);

      const result = await ensureGitHubRepo();

      expect(mockShowBrowserForm).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it("includes explanation about URL paths in UI", async () => {
      // Root repo EXISTS
      mockCheckRepoExists.mockResolvedValue(true);

      // Cancel to just inspect HTML
      mockShowBrowserForm.mockResolvedValue(null);

      await ensureGitHubRepo();

      const html = mockShowBrowserForm.mock.calls[0][0] as string;
      // UI should explain the URL difference
      expect(html).toMatch(/github\.io.*\//i);
    });
  });

  describe("error handling", () => {
    beforeEach(() => {
      mockGetToken.mockResolvedValue("test-token");
      mockGetAuthenticatedUser.mockResolvedValue({ login: "testuser" });
    });

    it("returns null when repo creation fails", async () => {
      mockCheckRepoExists.mockResolvedValue(false);
      mockCreateRepository.mockRejectedValue(new Error("API rate limit exceeded"));

      const result = await ensureGitHubRepo();

      expect(result).toBeNull();
    });

    it("returns null when getting user info fails", async () => {
      mockGetAuthenticatedUser.mockRejectedValue(new Error("Token expired"));

      const result = await ensureGitHubRepo();

      expect(result).toBeNull();
    });
  });

  describe("input field attributes", () => {
    beforeEach(() => {
      mockGetToken.mockResolvedValue("test-token");
      mockGetAuthenticatedUser.mockResolvedValue({ login: "testuser" });
    });

    it("includes autocomplete, autocorrect, and spellcheck attributes on repo name input", async () => {
      // Root repo EXISTS - triggers UI
      mockCheckRepoExists.mockResolvedValue(true);
      mockShowBrowserForm.mockResolvedValue(null); // Cancel to just inspect HTML

      await ensureGitHubRepo();

      expect(mockShowBrowserForm).toHaveBeenCalled();

      // Extract the HTML passed to showBrowserForm
      const html = mockShowBrowserForm.mock.calls[0][0] as string;

      // Verify the input has all required attributes
      // The input should have: autocomplete="off" autocorrect="off" spellcheck="false"
      expect(html).toMatch(/<input[^>]*id="repo-name"[^>]*>/);

      // Extract the input tag
      const inputMatch = html.match(/<input[^>]*id="repo-name"[^>]*>/);
      expect(inputMatch).not.toBeNull();

      const inputTag = inputMatch![0];

      // Verify each attribute is present
      expect(inputTag).toContain('autocomplete="off"');
      expect(inputTag).toContain('autocorrect="off"');
      expect(inputTag).toContain('spellcheck="false"');
      expect(inputTag).toContain('autofocus');
    });

    it("disables autocorrect to prevent iOS keyboard corrections", async () => {
      mockCheckRepoExists.mockResolvedValue(true);
      mockShowBrowserForm.mockResolvedValue(null);

      await ensureGitHubRepo();

      const html = mockShowBrowserForm.mock.calls[0][0] as string;
      const inputMatch = html.match(/<input[^>]*id="repo-name"[^>]*>/);

      expect(inputMatch![0]).toContain('autocorrect="off"');
    });

    it("disables spellcheck to avoid underlining valid repo names", async () => {
      mockCheckRepoExists.mockResolvedValue(true);
      mockShowBrowserForm.mockResolvedValue(null);

      await ensureGitHubRepo();

      const html = mockShowBrowserForm.mock.calls[0][0] as string;
      const inputMatch = html.match(/<input[^>]*id="repo-name"[^>]*>/);

      expect(inputMatch![0]).toContain('spellcheck="false"');
    });
  });
});
