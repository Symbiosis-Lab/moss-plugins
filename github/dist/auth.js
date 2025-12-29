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
import { openBrowser, closeBrowser } from "@symbiosis-lab/moss-api";
import { log, sleep, reportProgress } from "./utils";
import { storeToken, getToken, clearToken } from "./token";
// ============================================================================
// Configuration
// ============================================================================
/** GitHub OAuth App Client ID for Moss */
const CLIENT_ID = "Ov23li8HTgRH8nuO16oK";
/** Required OAuth scopes for GitHub Pages deployment */
const REQUIRED_SCOPES = ["repo", "workflow"];
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
 */
export async function requestDeviceCode() {
    await log("log", "   Requesting device code from GitHub...");
    const response = await fetch(GITHUB_DEVICE_CODE_URL, {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            client_id: CLIENT_ID,
            scope: REQUIRED_SCOPES.join(" "),
        }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to request device code: ${response.status} ${errorText}`);
    }
    const data = await response.json();
    if (data.error) {
        throw new Error(`GitHub error: ${data.error_description || data.error}`);
    }
    await log("log", `   Device code received. User code: ${data.user_code}`);
    return data;
}
/**
 * Poll GitHub for access token
 *
 * Returns the token response, which may contain:
 * - access_token: Success!
 * - error: "authorization_pending" - Keep polling
 * - error: "slow_down" - Increase interval
 * - error: "expired_token" - Device code expired
 * - error: "access_denied" - User denied authorization
 */
export async function pollForToken(deviceCode, _interval) {
    const response = await fetch(GITHUB_TOKEN_URL, {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            client_id: CLIENT_ID,
            device_code: deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to poll for token: ${response.status} ${errorText}`);
    }
    return (await response.json());
}
/**
 * Validate an access token by calling the GitHub API
 */
export async function validateToken(token) {
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
        const user = (await response.json());
        // Get scopes from response headers
        const scopeHeader = response.headers.get("X-OAuth-Scopes") || "";
        const scopes = scopeHeader.split(",").map((s) => s.trim()).filter(Boolean);
        return { valid: true, user, scopes };
    }
    catch {
        return { valid: false };
    }
}
/**
 * Check if we have required scopes
 */
export function hasRequiredScopes(scopes) {
    return REQUIRED_SCOPES.every((required) => scopes.includes(required));
}
// ============================================================================
// High-Level Authentication Functions
// ============================================================================
/**
 * Check if user is authenticated with valid GitHub credentials
 * Note: Plugin identity and project path are auto-detected from runtime context.
 */
export async function checkAuthentication() {
    await log("log", "   Checking GitHub authentication...");
    // Try to get token from credential helper
    const token = await getToken();
    if (!token) {
        await log("log", "   No token found in credential helper");
        return { isAuthenticated: false };
    }
    // Validate the token
    const validation = await validateToken(token);
    if (!validation.valid) {
        await log("log", "   Token is invalid or expired");
        // Clear the invalid token
        await clearToken();
        return { isAuthenticated: false };
    }
    // Check for required scopes
    if (!hasRequiredScopes(validation.scopes || [])) {
        await log("warn", `   Token missing required scopes. Has: ${validation.scopes?.join(", ")}, needs: ${REQUIRED_SCOPES.join(", ")}`);
        return { isAuthenticated: false };
    }
    await log("log", `   Authenticated as ${validation.user?.login}`);
    return {
        isAuthenticated: true,
        username: validation.user?.login,
        scopes: validation.scopes,
    };
}
/**
 * Run the full OAuth Device Flow to authenticate the user
 *
 * This will:
 * 1. Request a device code
 * 2. Open the browser for user authorization
 * 3. Display the user code
 * 4. Poll for the access token
 * 5. Store the token in git credential helper
 *
 * Note: Plugin identity and project path are auto-detected from runtime context.
 */
export async function promptLogin() {
    try {
        // Step 1: Request device code
        await reportProgress("authentication", 0, 4, "Requesting authorization...");
        const deviceCodeResponse = await requestDeviceCode();
        // Step 2: Open browser
        await reportProgress("authentication", 1, 4, `Enter code: ${deviceCodeResponse.user_code}`);
        await log("log", `   Opening browser for GitHub authorization...`);
        await log("log", `   Enter code: ${deviceCodeResponse.user_code}`);
        await openBrowser(deviceCodeResponse.verification_uri);
        // Step 3: Poll for token
        await reportProgress("authentication", 2, 4, "Waiting for authorization...");
        const token = await waitForToken(deviceCodeResponse.device_code, deviceCodeResponse.interval, deviceCodeResponse.expires_in * 1000);
        if (!token) {
            await log("warn", "   Authorization timed out or was denied");
            try {
                await closeBrowser();
            }
            catch {
                // Browser might already be closed
            }
            return false;
        }
        // Step 4: Store token
        await reportProgress("authentication", 3, 4, "Storing credentials...");
        const stored = await storeToken(token);
        if (!stored) {
            await log("warn", "   Failed to store token in credential helper");
            // Continue anyway - the token is valid, just won't persist
        }
        // Close browser
        try {
            await closeBrowser();
        }
        catch {
            // Browser might already be closed
        }
        await reportProgress("authentication", 4, 4, "Authenticated");
        await log("log", "   Successfully authenticated with GitHub");
        return true;
    }
    catch (error) {
        await log("error", `   Authentication failed: ${error}`);
        try {
            await closeBrowser();
        }
        catch {
            // Ignore close errors
        }
        return false;
    }
}
/**
 * Poll for access token until authorization is complete or timeout
 */
async function waitForToken(deviceCode, initialInterval, maxWaitMs) {
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
        }
        catch (error) {
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
