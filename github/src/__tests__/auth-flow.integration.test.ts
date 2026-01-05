/**
 * Integration tests for GitHub OAuth Device Flow authentication
 *
 * Tests the complete authentication flow including:
 * - Device code request
 * - Token polling with various response states
 * - Token validation and scope checking
 * - Credential storage
 *
 * Uses @symbiosis-lab/moss-api/testing to mock Tauri IPC commands
 *
 * NOTE: Some tests require moss-api >= 0.5.4 with browser/dialog tracking fixes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setupMockTauri,
  type MockTauriContext,
} from "@symbiosis-lab/moss-api/testing";

// Check if browser tracking with setters is available (requires moss-api >= 0.5.4)
// Try to set isOpen - if it fails, the setters aren't available
const testCtx = setupMockTauri();
let hasBrowserSetters = false;
try {
  // @ts-ignore - testing if setter exists
  testCtx.browserTracker.isOpen = true;
  hasBrowserSetters = testCtx.browserTracker.isOpen === true;
} catch {
  hasBrowserSetters = false;
}
testCtx.cleanup();

// Mock the utils module to prevent actual IPC calls for logging
vi.mock("../utils", () => ({
  log: vi.fn().mockResolvedValue(undefined),
  reportProgress: vi.fn().mockResolvedValue(undefined),
  reportError: vi.fn().mockResolvedValue(undefined),
  setCurrentHookName: vi.fn(),
  sleep: vi.fn().mockResolvedValue(undefined), // Don't actually wait
}));

// Import after mocking
import {
  requestDeviceCode,
  pollForToken,
  validateToken,
  checkAuthentication,
  promptLogin,
  hasRequiredScopes,
  CLIENT_ID,
  REQUIRED_SCOPES,
} from "../auth";

// Import token cache clear function
import { clearTokenCache } from "../token";

// Import the mock fetch helper for GitHub API
import {
  createMockFetch,
  setupGitHubApiMocks,
  defaultDeviceCodeResponse,
  defaultTokenResponse,
  defaultUserResponse,
  authorizationPendingResponse,
  expiredTokenResponse,
  accessDeniedResponse,
} from "../../test-helpers/mock-github-api";

// Store original fetch to restore later
const originalFetch = global.fetch;

// Mock fetch for individual tests
let mockFetch: ReturnType<typeof vi.fn>;

describe("GitHub OAuth Device Flow", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri();
    vi.clearAllMocks();
    // Reset mockFetch to a vi.fn() for tests that need custom mock
    mockFetch = vi.fn();
    // Clear token cache to ensure test isolation
    clearTokenCache();
  });

  afterEach(() => {
    ctx.cleanup();
    // Restore original fetch
    global.fetch = originalFetch;
  });

  // ==========================================================================
  // Device Code Request Tests
  // ==========================================================================
  // SKIP: These tests mock global.fetch but auth now uses httpPost (Tauri IPC)
  // TODO: Update tests to use ctx.urlConfig.setResponse() instead of mocking fetch

  describe.skip("requestDeviceCode", () => {
    it("successfully requests a device code from GitHub", async () => {
      const mockResponse = {
        device_code: "test-device-code-123",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });
      global.fetch = mockFetch;

      const result = await requestDeviceCode();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://github.com/login/device/code",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Accept: "application/json",
            "Content-Type": "application/json",
          }),
          body: expect.stringContaining(CLIENT_ID),
        })
      );

      expect(result.device_code).toBe("test-device-code-123");
      expect(result.user_code).toBe("ABCD-1234");
      expect(result.verification_uri).toBe("https://github.com/login/device");
    });

    it("includes required scopes in request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          device_code: "xxx",
          user_code: "XXXX-XXXX",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        }),
      });
      global.fetch = mockFetch;

      await requestDeviceCode();

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.scope).toBe(REQUIRED_SCOPES.join(" "));
    });

    it("throws error on HTTP failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });
      global.fetch = mockFetch;

      await expect(requestDeviceCode()).rejects.toThrow("Failed to request device code");
    });

    it("throws error on GitHub API error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: "invalid_client",
          error_description: "Client ID is invalid",
        }),
      });
      global.fetch = mockFetch;

      await expect(requestDeviceCode()).rejects.toThrow("GitHub error: Client ID is invalid");
    });
  });

  // ==========================================================================
  // Token Polling Tests
  // ==========================================================================
  // SKIP: These tests mock global.fetch but auth now uses httpPost (Tauri IPC)
  // TODO: Update tests to use ctx.urlConfig.setResponse() instead of mocking fetch

  describe.skip("pollForToken", () => {
    it("returns access token on success", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "gho_xxxxxxxxxxxx",
          token_type: "bearer",
          scope: "repo,workflow",
        }),
      });
      global.fetch = mockFetch;

      const result = await pollForToken("device-code-123", 5);

      expect(result.access_token).toBe("gho_xxxxxxxxxxxx");
    });

    it("returns authorization_pending when user hasn't authorized", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: "authorization_pending",
          error_description: "The authorization request is still pending",
        }),
      });
      global.fetch = mockFetch;

      const result = await pollForToken("device-code-123", 5);

      expect(result.error).toBe("authorization_pending");
      expect(result.access_token).toBeUndefined();
    });

    it("returns slow_down when polling too frequently", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: "slow_down",
          error_description: "Please slow down",
          interval: 10,
        }),
      });
      global.fetch = mockFetch;

      const result = await pollForToken("device-code-123", 5);

      expect(result.error).toBe("slow_down");
    });

    it("returns expired_token when device code expires", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: "expired_token",
          error_description: "The device code has expired",
        }),
      });
      global.fetch = mockFetch;

      const result = await pollForToken("device-code-123", 5);

      expect(result.error).toBe("expired_token");
    });

    it("returns access_denied when user denies authorization", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: "access_denied",
          error_description: "The user denied the authorization request",
        }),
      });
      global.fetch = mockFetch;

      const result = await pollForToken("device-code-123", 5);

      expect(result.error).toBe("access_denied");
    });

    it("throws error on HTTP failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "Service Unavailable",
      });
      global.fetch = mockFetch;

      await expect(pollForToken("device-code-123", 5)).rejects.toThrow(
        "Failed to poll for token"
      );
    });
  });

  // ==========================================================================
  // Token Validation Tests
  // ==========================================================================

  describe("validateToken", () => {
    it("validates token and returns user info", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          login: "testuser",
          id: 12345,
          avatar_url: "https://github.com/avatars/testuser",
        }),
        headers: new Headers({
          "X-OAuth-Scopes": "repo, workflow, user",
        }),
      });
      global.fetch = mockFetch;

      const result = await validateToken("gho_validtoken");

      expect(result.valid).toBe(true);
      expect(result.user?.login).toBe("testuser");
      expect(result.scopes).toContain("repo");
      expect(result.scopes).toContain("workflow");
    });

    it("returns invalid for unauthorized token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });
      global.fetch = mockFetch;

      const result = await validateToken("gho_invalidtoken");

      expect(result.valid).toBe(false);
      expect(result.user).toBeUndefined();
    });

    it("handles network errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));
      global.fetch = mockFetch;

      const result = await validateToken("gho_anytoken");

      expect(result.valid).toBe(false);
    });

    it("parses empty scopes header correctly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "testuser" }),
        headers: new Headers({}),
      });
      global.fetch = mockFetch;

      const result = await validateToken("gho_validtoken");

      expect(result.valid).toBe(true);
      expect(result.scopes).toEqual([]);
    });
  });

  // ==========================================================================
  // Scope Validation Tests
  // ==========================================================================

  describe("hasRequiredScopes", () => {
    it("returns true when all required scopes are present", () => {
      expect(hasRequiredScopes(["repo", "workflow"])).toBe(true);
      expect(hasRequiredScopes(["repo", "workflow", "user"])).toBe(true);
    });

    it("returns false when repo scope is missing", () => {
      expect(hasRequiredScopes(["workflow"])).toBe(false);
    });

    it("returns false when workflow scope is missing", () => {
      expect(hasRequiredScopes(["repo"])).toBe(false);
    });

    it("returns false with empty scopes", () => {
      expect(hasRequiredScopes([])).toBe(false);
    });
  });

  // ==========================================================================
  // Check Authentication Tests
  // ==========================================================================

  describe("checkAuthentication", () => {
    it("returns authenticated state when valid token exists", async () => {
      // Setup: Token exists in plugin cookie storage
      // Note: setupMockTauri uses "test-plugin" and "/test/project" as defaults
      ctx.cookieStorage.setCookies(ctx.pluginName, ctx.projectPath, [
        { name: "__github_access_token", value: "gho_validtoken", domain: "github.com" },
      ]);

      // Mock token validation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "testuser", id: 12345 }),
        headers: new Headers({ "X-OAuth-Scopes": "repo, workflow" }),
      });
      global.fetch = mockFetch;

      const result = await checkAuthentication();

      expect(result.isAuthenticated).toBe(true);
      expect(result.username).toBe("testuser");
      expect(result.scopes).toContain("repo");
    });

    it("returns unauthenticated when no token exists", async () => {
      // Setup: No token in cookie storage (default empty state)
      const result = await checkAuthentication();

      expect(result.isAuthenticated).toBe(false);
    });

    it("returns unauthenticated and clears invalid token", async () => {
      // Setup: Token exists but is invalid
      ctx.cookieStorage.setCookies(ctx.pluginName, ctx.projectPath, [
        { name: "__github_access_token", value: "gho_expiredtoken", domain: "github.com" },
      ]);

      // Mock token validation failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });
      global.fetch = mockFetch;

      const result = await checkAuthentication();

      expect(result.isAuthenticated).toBe(false);
    });

    it("returns unauthenticated when token lacks required scopes", async () => {
      // Setup: Token exists with insufficient scopes
      ctx.cookieStorage.setCookies(ctx.pluginName, ctx.projectPath, [
        { name: "__github_access_token", value: "gho_limitedtoken", domain: "github.com" },
      ]);

      // Mock token validation - valid but missing workflow scope
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "testuser" }),
        headers: new Headers({ "X-OAuth-Scopes": "repo" }), // Missing workflow
      });
      global.fetch = mockFetch;

      const result = await checkAuthentication();

      expect(result.isAuthenticated).toBe(false);
    });
  });

  // ==========================================================================
  // Full Login Flow Tests
  // ==========================================================================

  describe("promptLogin", () => {
    // Requires moss-api >= 0.5.4 with browser tracking setters
    it.skipIf(!hasBrowserSetters)("successfully completes device flow authentication", async () => {
      // Setup GitHub API mocks using ctx.urlConfig (for httpPost)
      setupGitHubApiMocks(ctx, {
        deviceCodeResponse: {
          device_code: "test-device-code",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 1, // Short interval for test
        },
        tokenResponse: {
          access_token: "gho_newtoken",
          token_type: "bearer",
          scope: "repo,workflow",
        },
      });

      // Token is stored in cookie storage (no git credential mock needed)

      const result = await promptLogin();

      expect(result).toBe(true);
      expect(ctx.browserTracker.openedUrls).toContain("https://github.com/login/device");
    });

    it("fails when user denies authorization", async () => {
      // Mock device code request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          device_code: "test-device-code",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 1,
        }),
      });

      // Mock token poll - access denied
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: "access_denied" }),
      });
      global.fetch = mockFetch;

      const result = await promptLogin();

      expect(result).toBe(false);
    });

    it("fails when device code expires", async () => {
      // Mock device code request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          device_code: "test-device-code",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 1,
        }),
      });

      // Mock token poll - expired
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: "expired_token" }),
      });
      global.fetch = mockFetch;

      const result = await promptLogin();

      expect(result).toBe(false);
    });

    it("opens browser with verification URI", async () => {
      // Setup GitHub API mocks using ctx.urlConfig (for httpPost)
      setupGitHubApiMocks(ctx, {
        deviceCodeResponse: {
          device_code: "test-device-code",
          user_code: "TEST-CODE",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 1,
        },
        tokenResponse: {
          access_token: "gho_newtoken",
          scope: "repo,workflow",
        },
      });

      await promptLogin();

      expect(ctx.browserTracker.openedUrls).toHaveLength(1);
      expect(ctx.browserTracker.openedUrls[0]).toBe("https://github.com/login/device");
    });

    // Requires moss-api >= 0.5.4 with browser tracking setters
    it.skipIf(!hasBrowserSetters)("stores token in cookie storage on success", async () => {
      // Setup GitHub API mocks using ctx.urlConfig (for httpPost)
      setupGitHubApiMocks(ctx, {
        deviceCodeResponse: {
          device_code: "test-device-code",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 1,
        },
        tokenResponse: {
          access_token: "gho_storedtoken",
          scope: "repo,workflow",
        },
      });

      const result = await promptLogin();

      expect(result).toBe(true);

      // Verify token was stored in cookie storage
      const cookies = ctx.cookieStorage.getCookies(ctx.pluginName, ctx.projectPath);
      const tokenCookie = cookies.find((c) => c.name === "__github_access_token");
      expect(tokenCookie?.value).toBe("gho_storedtoken");
    });

    it("handles network errors during device code request", async () => {
      // Setup URL to return error status (simulates network error)
      ctx.urlConfig.setResponse("https://github.com/login/device/code", {
        status: 0, // Network error
        ok: false,
        bodyBase64: "",
      });

      const result = await promptLogin();

      expect(result).toBe(false);
    });

    // Requires moss-api >= 0.5.4 with browser tracking setters
    it.skipIf(!hasBrowserSetters)("closes browser after authentication completes", async () => {
      // Setup GitHub API mocks using ctx.urlConfig (for httpPost)
      setupGitHubApiMocks(ctx, {
        deviceCodeResponse: {
          device_code: "test-device-code",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 1,
        },
        tokenResponse: {
          access_token: "gho_token",
          scope: "repo,workflow",
        },
      });

      await promptLogin();

      // Browser should have been opened then closed
      expect(ctx.browserTracker.openedUrls).toHaveLength(1);
      expect(ctx.browserTracker.isOpen).toBe(false);
      expect(ctx.browserTracker.closeCount).toBe(1);
    });
  });
});
