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
import type { DeviceCodeResponse, TokenResponse, GitHubUser, AuthState } from "./types";
/** GitHub OAuth App Client ID for Moss */
declare const CLIENT_ID = "Ov23li8HTgRH8nuO16oK";
/** Required OAuth scopes for GitHub Pages deployment */
declare const REQUIRED_SCOPES: string[];
/**
 * Request a device code from GitHub
 */
export declare function requestDeviceCode(): Promise<DeviceCodeResponse>;
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
export declare function pollForToken(deviceCode: string, _interval: number): Promise<TokenResponse>;
/**
 * Validate an access token by calling the GitHub API
 */
export declare function validateToken(token: string): Promise<{
    valid: boolean;
    user?: GitHubUser;
    scopes?: string[];
}>;
/**
 * Check if we have required scopes
 */
export declare function hasRequiredScopes(scopes: string[]): boolean;
/**
 * Check if user is authenticated with valid GitHub credentials
 */
export declare function checkAuthentication(projectPath: string): Promise<AuthState>;
/**
 * Run the full OAuth Device Flow to authenticate the user
 *
 * This will:
 * 1. Request a device code
 * 2. Open the browser for user authorization
 * 3. Display the user code
 * 4. Poll for the access token
 * 5. Store the token in git credential helper
 */
export declare function promptLogin(projectPath: string): Promise<boolean>;
export { CLIENT_ID, REQUIRED_SCOPES };
//# sourceMappingURL=auth.d.ts.map