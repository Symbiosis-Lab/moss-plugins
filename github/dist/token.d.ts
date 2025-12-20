/**
 * Token Storage Module
 *
 * Handles secure storage and retrieval of GitHub access tokens.
 *
 * Storage strategy:
 * 1. Primary: Plugin cookies (via moss-api getPluginCookie/setPluginCookie)
 * 2. Fallback: In-memory cache (for current session)
 *
 * For git push, tokens are used by temporarily rewriting the remote URL
 * to include the token (https://x-access-token:TOKEN@github.com/...)
 */
/**
 * Format credentials for git credential helper input
 * (Used for documentation and potential future stdin support)
 */
export declare function formatCredentialInput(host: string, protocol: string, username?: string, password?: string): string;
/**
 * Parse git credential helper output
 */
export declare function parseCredentialOutput(output: string): {
    username?: string;
    password?: string;
};
/**
 * Store a GitHub access token
 *
 * Uses plugin cookie storage with in-memory fallback.
 */
export declare function storeToken(token: string, projectPath: string): Promise<boolean>;
/**
 * Retrieve GitHub access token
 *
 * Checks plugin cookies first, then falls back to memory cache.
 */
export declare function getToken(projectPath: string): Promise<string | null>;
/**
 * Clear the cached token
 */
export declare function clearTokenCache(): void;
/**
 * Remove GitHub access token
 */
export declare function clearToken(projectPath: string): Promise<boolean>;
/**
 * Inject token into a GitHub HTTPS URL for authenticated operations
 *
 * Transforms: https://github.com/user/repo.git
 * Into: https://x-access-token:TOKEN@github.com/user/repo.git
 */
export declare function injectTokenIntoUrl(url: string, token: string): string;
/**
 * Remove token from a GitHub URL (for logging/display purposes)
 */
export declare function sanitizeUrl(url: string): string;
//# sourceMappingURL=token.d.ts.map