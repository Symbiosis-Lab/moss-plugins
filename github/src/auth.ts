/**
 * GitHub OAuth Device Flow Authentication Module
 *
 * Implements the OAuth 2.0 Device Authorization Grant (RFC 8628)
 * for GitHub authentication. This flow is ideal for CLI/desktop apps
 * that can't easily handle redirect callbacks.
 *
 * Flow:
 * 1. Request device code from GitHub
 * 2. Open browser for user to enter code
 * 3. Poll for access token
 * 4. Store token in git credential helper
 */

import { openSystemBrowser, httpPost } from "@symbiosis-lab/moss-api";
import { log, sleep, reportProgress } from "./utils";
import { storeToken, getToken, clearToken, getTokenFromGit } from "./token";
import type {
  DeviceCodeResponse,
  TokenResponse,
  GitHubUser,
  AuthState,
} from "./types";

// ============================================================================
// Configuration
// ============================================================================

/** GitHub OAuth App Client ID for Moss */
const CLIENT_ID = "Ov23li8HTgRH8nuO16oK";

/** Required OAuth scopes for GitHub Pages deployment
 * Note: We only need "repo" scope for gh-pages deployment since we push directly
 * to the gh-pages branch. The "workflow" scope is NOT needed because we don't
 * use GitHub Actions for deployment. (Bug 23 fix)
 */
const REQUIRED_SCOPES = ["repo"];

/** GitHub API endpoints */
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_USER_URL = "https://api.github.com/user";

/** Maximum time to wait for user authorization (5 minutes) */
const MAX_POLL_TIME_MS = 300000;

// ============================================================================
// Device Flow Implementation
// ============================================================================

/**
 * Request a device code from GitHub
 *
 * Uses httpPost to bypass CORS restrictions in Tauri WebView.
 */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  await log("log", "   Requesting device code from GitHub...");

  const response = await httpPost(
    GITHUB_DEVICE_CODE_URL,
    {
      client_id: CLIENT_ID,
      scope: REQUIRED_SCOPES.join(" "),
    },
    {
      headers: {
        Accept: "application/json",
        Origin: "https://github.com",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to request device code: ${response.status} ${response.text()}`);
  }

  const data = JSON.parse(response.text());

  if (data.error) {
    throw new Error(`GitHub error: ${data.error_description || data.error}`);
  }

  await log("log", `   Device code received. User code: ${data.user_code}`);

  return data as DeviceCodeResponse;
}

/**
 * Poll GitHub for access token
 *
 * Uses httpPost to bypass CORS restrictions in Tauri WebView.
 *
 * Returns the token response, which may contain:
 * - access_token: Success!
 * - error: "authorization_pending" - Keep polling
 * - error: "slow_down" - Increase interval
 * - error: "expired_token" - Device code expired
 * - error: "access_denied" - User denied authorization
 */
export async function pollForToken(
  deviceCode: string,
  _interval: number
): Promise<TokenResponse> {
  const response = await httpPost(
    GITHUB_TOKEN_URL,
    {
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    },
    {
      headers: {
        Accept: "application/json",
        Origin: "https://github.com",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to poll for token: ${response.status} ${response.text()}`);
  }

  return JSON.parse(response.text()) as TokenResponse;
}

/**
 * Validate an access token by calling the GitHub API
 */
export async function validateToken(token: string): Promise<{
  valid: boolean;
  user?: GitHubUser;
  scopes?: string[];
}> {
  try {
    const response = await fetch(GITHUB_API_USER_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Moss-GitHub-Deployer",
      },
    });

    if (!response.ok) {
      return { valid: false };
    }

    const user = (await response.json()) as GitHubUser;

    // Get scopes from response headers
    const scopeHeader = response.headers.get("X-OAuth-Scopes") || "";
    const scopes = scopeHeader.split(",").map((s) => s.trim()).filter(Boolean);

    return { valid: true, user, scopes };
  } catch {
    return { valid: false };
  }
}

/**
 * Check if we have required scopes
 */
export function hasRequiredScopes(scopes: string[]): boolean {
  return REQUIRED_SCOPES.every((required) => scopes.includes(required));
}

// ============================================================================
// High-Level Authentication Functions
// ============================================================================

/**
 * Check if user is authenticated with valid GitHub credentials
 *
 * Checks in order:
 * 1. Plugin cookies (fastest - cached from previous auth)
 * 2. Git credential helper (system-stored tokens)
 *
 * Note: Plugin identity and project path are auto-detected from runtime context.
 */
export async function checkAuthentication(): Promise<AuthState> {
  await log("log", "   Checking GitHub authentication...");

  // 1. Try to get token from plugin cookies (fastest)
  let token = await getToken();

  if (token) {
    // Validate the cached token
    const validation = await validateToken(token);

    if (validation.valid && hasRequiredScopes(validation.scopes || [])) {
      await log("log", `   Authenticated as ${validation.user?.login} (from plugin cookies)`);
      return {
        isAuthenticated: true,
        username: validation.user?.login,
        scopes: validation.scopes,
      };
    }

    // Token is invalid - clear it and try git credentials
    await log("log", "   Cached token invalid, clearing...");
    await clearToken();
  }

  // 2. Try git credential helper (Bug 8 fix)
  await log("log", "   Checking git credential helper...");
  token = await getTokenFromGit();

  if (token) {
    const validation = await validateToken(token);

    if (validation.valid && hasRequiredScopes(validation.scopes || [])) {
      // Store in plugin cookies for faster future access
      await storeToken(token);
      await log("log", `   Authenticated as ${validation.user?.login} (from git credentials)`);
      return {
        isAuthenticated: true,
        username: validation.user?.login,
        scopes: validation.scopes,
      };
    }

    await log("log", "   Git credential token lacks required scopes or is invalid");
  }

  await log("log", "   No valid credentials found");
  return { isAuthenticated: false };
}

/**
 * Run the full OAuth Device Flow to authenticate the user
 *
 * This will:
 * 1. Request a device code
 * 2. Open the SYSTEM browser for user authorization (Bug 9 fix)
 * 3. Display the user code
 * 4. Poll for the access token
 * 5. Store the token in plugin cookies
 *
 * Note: Plugin identity and project path are auto-detected from runtime context.
 */
export async function promptLogin(): Promise<boolean> {
  try {
    // Step 1: Request device code
    await reportProgress("authentication", 0, 4, "Requesting authorization...");
    const deviceCodeResponse = await requestDeviceCode();

    // Step 2: Open SYSTEM browser (Bug 9 fix - user may already be logged in)
    await reportProgress(
      "authentication",
      1,
      4,
      `Enter code: ${deviceCodeResponse.user_code}`
    );
    await log("log", `   Opening system browser for GitHub authorization...`);
    await log("log", `   Enter code: ${deviceCodeResponse.user_code}`);

    // Use system browser instead of plugin browser (Bug 9 fix)
    await openSystemBrowser(deviceCodeResponse.verification_uri);

    // Step 3: Poll for token
    await reportProgress("authentication", 2, 4, "Waiting for authorization...");
    const token = await waitForToken(
      deviceCodeResponse.device_code,
      deviceCodeResponse.interval,
      deviceCodeResponse.expires_in * 1000
    );

    if (!token) {
      await log("warn", "   Authorization timed out or was denied");
      // System browser manages itself - no need to close
      return false;
    }

    // Step 4: Store token
    await reportProgress("authentication", 3, 4, "Storing credentials...");
    const stored = await storeToken(token);

    if (!stored) {
      await log("warn", "   Failed to store token");
      // Continue anyway - the token is valid, just won't persist
    }

    // System browser manages itself - no need to close

    await reportProgress("authentication", 4, 4, "Authenticated");
    await log("log", "   Successfully authenticated with GitHub");

    return true;
  } catch (error) {
    await log("error", `   Authentication failed: ${error}`);
    // System browser manages itself - no need to close
    return false;
  }
}

/**
 * Poll for access token until authorization is complete or timeout
 */
async function waitForToken(
  deviceCode: string,
  initialInterval: number,
  maxWaitMs: number
): Promise<string | null> {
  const startTime = Date.now();
  let interval = initialInterval;

  while (Date.now() - startTime < Math.min(maxWaitMs, MAX_POLL_TIME_MS)) {
    // Wait for the specified interval
    await sleep(interval * 1000);

    try {
      const response = await pollForToken(deviceCode, interval);

      if (response.access_token) {
        return response.access_token;
      }

      if (response.error === "authorization_pending") {
        // User hasn't authorized yet, keep polling
        continue;
      }

      if (response.error === "slow_down") {
        // GitHub wants us to slow down
        interval += 5;
        await log("log", `   Slowing down, new interval: ${interval}s`);
        continue;
      }

      if (response.error === "expired_token") {
        await log("warn", "   Device code expired");
        return null;
      }

      if (response.error === "access_denied") {
        await log("warn", "   User denied authorization");
        return null;
      }

      // Unknown error
      await log("error", `   Unexpected error: ${response.error}`);
      return null;
    } catch (error) {
      await log("error", `   Poll error: ${error}`);
      // Continue polling on network errors
    }
  }

  await log("warn", "   Authorization timeout");
  return null;
}

// ============================================================================
// Exports for Testing
// ============================================================================

export { CLIENT_ID, REQUIRED_SCOPES };
