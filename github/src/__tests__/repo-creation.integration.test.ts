/**
 * Integration tests for the Repository Creation Flow
 *
 * Tests the complete repo creation dialog flow including:
 * - Dialog shown when no remote is configured
 * - Dialog result handling (submit/cancel)
 * - GitHub API calls for repo creation
 * - Git remote add after creation
 *
 * Uses @symbiosis-lab/moss-api/testing to mock Tauri IPC commands
 *
 * NOTE: Tests requiring dialogTracker will be skipped if moss-api < 0.5.4
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setupMockTauri,
  type MockTauriContext,
} from "@symbiosis-lab/moss-api/testing";

// Check if dialogTracker is available (requires moss-api >= 0.5.4)
const testCtx = setupMockTauri();
const hasDialogTracker = !!testCtx.dialogTracker;
testCtx.cleanup();

// Mock the utils module to prevent actual IPC calls for logging
vi.mock("../utils", () => ({
  log: vi.fn().mockResolvedValue(undefined),
  reportProgress: vi.fn().mockResolvedValue(undefined),
  reportError: vi.fn().mockResolvedValue(undefined),
  setCurrentHookName: vi.fn(),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocking
import { promptAndCreateRepo } from "../repo-create";
import { clearTokenCache } from "../token";

// Store original fetch to restore later
const originalFetch = global.fetch;

// Mock fetch for individual tests
let mockFetch: ReturnType<typeof vi.fn>;

// Use describe.skipIf for tests requiring dialogTracker
const describeWithDialog = hasDialogTracker ? describe : describe.skip;

describe("Repository Creation Flow", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri();
    vi.clearAllMocks();
    mockFetch = vi.fn();
    clearTokenCache();
  });

  afterEach(() => {
    ctx.cleanup();
    global.fetch = originalFetch;
  });

  // ==========================================================================
  // Authentication Check Tests
  // ==========================================================================

  describe("Authentication Requirements", () => {
    it("returns null when no token exists", async () => {
      // No token in cookie storage (default empty state)
      const result = await promptAndCreateRepo();

      expect(result).toBeNull();
    });

    it("returns null when token is invalid", async () => {
      // Setup: Token exists but user API call fails
      ctx.cookieStorage.setCookies(ctx.pluginName, ctx.projectPath, [
        { name: "__github_access_token", value: "gho_invalid", domain: "github.com" },
      ]);

      // Mock user API failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ message: "Bad credentials" }),
      });
      global.fetch = mockFetch;

      const result = await promptAndCreateRepo();

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // Dialog Interaction Tests (requires moss-api >= 0.5.4 with dialogTracker)
  // ==========================================================================

  describeWithDialog("Dialog Interaction", () => {
    beforeEach(() => {
      // Setup: Valid token exists
      ctx.cookieStorage.setCookies(ctx.pluginName, ctx.projectPath, [
        { name: "__github_access_token", value: "gho_validtoken", domain: "github.com" },
      ]);
    });

    it("shows dialog with correct title when user is authenticated", async () => {
      // Mock user API success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "testuser", id: 12345 }),
        headers: new Headers({ "X-OAuth-Scopes": "repo, workflow" }),
      });
      global.fetch = mockFetch;

      // Configure dialog to return cancelled (to end flow early)
      ctx.dialogTracker.setNextResult({
        type: "cancelled",
      });

      await promptAndCreateRepo();

      // Should have shown dialog
      expect(ctx.dialogTracker.shownDialogs).toHaveLength(1);
      expect(ctx.dialogTracker.shownDialogs[0].title).toBe("Create GitHub Repository");
    });

    it("returns null when user cancels dialog", async () => {
      // Mock user API success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "testuser", id: 12345 }),
        headers: new Headers({ "X-OAuth-Scopes": "repo, workflow" }),
      });
      global.fetch = mockFetch;

      // Configure dialog to return cancelled
      ctx.dialogTracker.setNextResult({
        type: "cancelled",
      });

      const result = await promptAndCreateRepo();

      expect(result).toBeNull();
    });

    it("returns null when dialog returns empty result", async () => {
      // Mock user API success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "testuser", id: 12345 }),
        headers: new Headers({ "X-OAuth-Scopes": "repo, workflow" }),
      });
      global.fetch = mockFetch;

      // Configure dialog to return submitted but with no name
      ctx.dialogTracker.setNextResult({
        type: "submitted",
        value: {},
      });

      const result = await promptAndCreateRepo();

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // Repository Creation Tests (requires moss-api >= 0.5.4 with dialogTracker)
  // ==========================================================================

  describeWithDialog("Repository Creation", () => {
    beforeEach(() => {
      // Setup: Valid token exists
      ctx.cookieStorage.setCookies(ctx.pluginName, ctx.projectPath, [
        { name: "__github_access_token", value: "gho_validtoken", domain: "github.com" },
      ]);
    });

    it("creates repository via GitHub API when dialog is submitted", async () => {
      // Mock user API success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "testuser", id: 12345 }),
        headers: new Headers({ "X-OAuth-Scopes": "repo, workflow" }),
      });

      // Mock repository creation success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          name: "my-new-repo",
          full_name: "testuser/my-new-repo",
          html_url: "https://github.com/testuser/my-new-repo",
          ssh_url: "git@github.com:testuser/my-new-repo.git",
        }),
      });
      global.fetch = mockFetch;

      // Configure dialog to return submitted
      ctx.dialogTracker.setNextResult({
        type: "submitted",
        value: { name: "my-new-repo" },
      });

      // Configure git remote add to succeed
      ctx.binaryConfig.setResult("git remote add origin", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const result = await promptAndCreateRepo();

      expect(result).not.toBeNull();
      expect(result?.name).toBe("my-new-repo");
      expect(result?.fullName).toBe("testuser/my-new-repo");
      expect(result?.url).toBe("https://github.com/testuser/my-new-repo");
      expect(result?.sshUrl).toBe("git@github.com:testuser/my-new-repo.git");
    });

    it("calls GitHub API with correct parameters", async () => {
      // Mock user API success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "testuser" }),
        headers: new Headers({ "X-OAuth-Scopes": "repo, workflow" }),
      });

      // Mock repository creation success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          name: "test-repo",
          full_name: "testuser/test-repo",
          html_url: "https://github.com/testuser/test-repo",
          ssh_url: "git@github.com:testuser/test-repo.git",
        }),
      });
      global.fetch = mockFetch;

      ctx.dialogTracker.setNextResult({
        type: "submitted",
        value: { name: "test-repo" },
      });

      ctx.binaryConfig.setResult("git remote add origin", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      await promptAndCreateRepo();

      // Check the API call was made correctly
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [url, options] = mockFetch.mock.calls[1];
      expect(url).toBe("https://api.github.com/user/repos");
      expect(options.method).toBe("POST");
      expect(options.headers.Authorization).toBe("Bearer gho_validtoken");

      const body = JSON.parse(options.body);
      expect(body.name).toBe("test-repo");
      expect(body.private).toBe(false); // Public repos for GitHub Pages
    });

    it("returns null when GitHub API returns error", async () => {
      // Mock user API success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "testuser" }),
        headers: new Headers({ "X-OAuth-Scopes": "repo, workflow" }),
      });

      // Mock repository creation failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({
          message: "Repository creation failed.",
          errors: [{ resource: "Repository", code: "custom", field: "name", message: "name already exists" }],
        }),
      });
      global.fetch = mockFetch;

      ctx.dialogTracker.setNextResult({
        type: "submitted",
        value: { name: "existing-repo" },
      });

      const result = await promptAndCreateRepo();

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // Git Remote Setup Tests (requires moss-api >= 0.5.4 with dialogTracker)
  // ==========================================================================

  describeWithDialog("Git Remote Setup", () => {
    beforeEach(() => {
      // Setup: Valid token exists
      ctx.cookieStorage.setCookies(ctx.pluginName, ctx.projectPath, [
        { name: "__github_access_token", value: "gho_validtoken", domain: "github.com" },
      ]);

      // Mock user API success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "testuser" }),
        headers: new Headers({ "X-OAuth-Scopes": "repo, workflow" }),
      });

      // Mock repository creation success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          name: "my-repo",
          full_name: "testuser/my-repo",
          html_url: "https://github.com/testuser/my-repo",
          ssh_url: "git@github.com:testuser/my-repo.git",
        }),
      });
      global.fetch = mockFetch;

      ctx.dialogTracker.setNextResult({
        type: "submitted",
        value: { name: "my-repo" },
      });
    });

    it("adds git remote after successful repo creation", async () => {
      ctx.binaryConfig.setResult("git remote add origin", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const result = await promptAndCreateRepo();

      expect(result).not.toBeNull();
      expect(result?.sshUrl).toBe("git@github.com:testuser/my-repo.git");
    });

    it("succeeds even if git remote add fails", async () => {
      // Git remote add fails (maybe remote already exists)
      ctx.binaryConfig.setResult("git remote add origin", {
        success: false,
        exitCode: 3,
        stdout: "",
        stderr: "error: remote origin already exists.",
      });

      const result = await promptAndCreateRepo();

      // Should still return success since repo was created
      expect(result).not.toBeNull();
      expect(result?.name).toBe("my-repo");
    });
  });

  // ==========================================================================
  // Dialog URL Tests (requires moss-api >= 0.5.4 with dialogTracker)
  // ==========================================================================

  describeWithDialog("Dialog URL Generation", () => {
    beforeEach(() => {
      // Setup: Valid token exists
      ctx.cookieStorage.setCookies(ctx.pluginName, ctx.projectPath, [
        { name: "__github_access_token", value: "gho_validtoken", domain: "github.com" },
      ]);
    });

    it("generates data: URL for dialog", async () => {
      // Mock user API success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "testuser" }),
        headers: new Headers({ "X-OAuth-Scopes": "repo, workflow" }),
      });
      global.fetch = mockFetch;

      ctx.dialogTracker.setNextResult({ type: "cancelled" });

      await promptAndCreateRepo();

      // Dialog URL should be a data: URL containing HTML
      const dialog = ctx.dialogTracker.shownDialogs[0];
      expect(dialog.url).toMatch(/^data:text\/html;base64,/);
    });
  });
});
