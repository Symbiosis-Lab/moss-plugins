/**
 * Mock GitHub API helpers for integration testing
 *
 * Provides utilities to mock GitHub OAuth Device Flow responses
 * for testing authentication without hitting real APIs.
 */

import type { DeviceCodeResponse, TokenResponse, GitHubUser } from "../src/types";

/**
 * Configuration for mocking GitHub API responses
 */
export interface MockGitHubConfig {
  /** Response for POST /login/device/code */
  deviceCodeResponse?: DeviceCodeResponse;
  /** Response(s) for POST /login/oauth/access_token - can be a single response or array for sequence */
  tokenResponse?: TokenResponse | TokenResponse[];
  /** Response for GET /user (token validation) */
  userResponse?: GitHubUser | null;
  /** OAuth scopes to return in X-OAuth-Scopes header */
  scopes?: string[];
}

/**
 * Default mock responses for successful auth flow
 */
export const defaultDeviceCodeResponse: DeviceCodeResponse = {
  device_code: "test-device-code-123",
  user_code: "ABCD-1234",
  verification_uri: "https://github.com/login/device",
  expires_in: 900,
  interval: 5,
};

export const defaultTokenResponse: TokenResponse = {
  access_token: "gho_test_token_abc123",
  token_type: "bearer",
  scope: "repo,workflow",
};

export const defaultUserResponse: GitHubUser = {
  login: "testuser",
  id: 12345,
  name: "Test User",
  email: "test@example.com",
};

/**
 * Error responses for various failure scenarios
 */
export const authorizationPendingResponse: TokenResponse = {
  error: "authorization_pending",
  error_description: "The authorization request is still pending.",
};

export const expiredTokenResponse: TokenResponse = {
  error: "expired_token",
  error_description: "The device_code has expired.",
};

export const accessDeniedResponse: TokenResponse = {
  error: "access_denied",
  error_description: "The user denied authorization.",
};

export const slowDownResponse: TokenResponse = {
  error: "slow_down",
  error_description: "Too many requests. Please slow down.",
};

/**
 * Create a mock Response object
 */
function createMockResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers(headers),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

/**
 * Create a mock fetch function for testing
 */
export function createMockFetch(config: MockGitHubConfig = {}) {
  let tokenResponseIndex = 0;

  return async (url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const urlString = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

    // Device code endpoint
    if (urlString.includes("/login/device/code")) {
      const response = config.deviceCodeResponse || defaultDeviceCodeResponse;
      return createMockResponse(response);
    }

    // Token endpoint
    if (urlString.includes("/login/oauth/access_token")) {
      let response: TokenResponse;

      if (Array.isArray(config.tokenResponse)) {
        // Return responses in sequence
        response = config.tokenResponse[tokenResponseIndex] || config.tokenResponse[config.tokenResponse.length - 1];
        tokenResponseIndex++;
      } else {
        response = config.tokenResponse || defaultTokenResponse;
      }

      return createMockResponse(response);
    }

    // User endpoint (token validation)
    if (urlString.includes("/user")) {
      if (config.userResponse === null) {
        return createMockResponse({ message: "Bad credentials" }, 401);
      }

      const user = config.userResponse || defaultUserResponse;
      const scopes = config.scopes || ["repo", "workflow"];

      return createMockResponse(user, 200, {
        "X-OAuth-Scopes": scopes.join(", "),
      });
    }

    // Unknown endpoint
    throw new Error(`Unmocked URL: ${urlString}`);
  };
}

/**
 * Mock browser functions for testing
 */
export function createMockBrowser() {
  let isOpen = false;
  let currentUrl = "";

  return {
    openBrowser: async (url: string) => {
      isOpen = true;
      currentUrl = url;
    },
    closeBrowser: async () => {
      isOpen = false;
      currentUrl = "";
    },
    isOpen: () => isOpen,
    getCurrentUrl: () => currentUrl,
  };
}

/**
 * Mock git credential helper for testing
 */
export function createMockCredentialHelper() {
  const store: Map<string, { username: string; password: string }> = new Map();

  return {
    store: (host: string, username: string, password: string) => {
      store.set(host, { username, password });
    },
    get: (host: string) => store.get(host),
    clear: (host: string) => store.delete(host),
    hasCredentials: (host: string) => store.has(host),
    reset: () => store.clear(),
  };
}
