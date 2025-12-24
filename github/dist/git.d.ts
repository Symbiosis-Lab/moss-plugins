/**
 * Git command helpers for the GitHub Pages Publisher Plugin
 *
 * Executes git commands via moss-api's executeBinary.
 */
/**
 * Check if a path exists using git status (works without direct filesystem access)
 */
export declare function checkPathExists(relativePath: string): Promise<boolean>;
/**
 * Get the origin remote URL
 */
export declare function getRemoteUrl(): Promise<string>;
/**
 * Detect the default branch (main or master)
 */
export declare function detectBranch(): Promise<string>;
/**
 * Check if directory is a git repository
 */
export declare function isGitRepository(): Promise<boolean>;
/**
 * Check if remote exists and get its URL
 */
export declare function hasGitRemote(): Promise<boolean>;
/**
 * Stage files for commit
 */
export declare function stageFiles(files: string[]): Promise<void>;
/**
 * Create a commit with a message
 */
export declare function commit(message: string): Promise<string>;
/**
 * Push to remote
 */
export declare function push(): Promise<void>;
/**
 * Stage, commit, and push workflow files
 */
export declare function commitAndPushWorkflow(): Promise<string>;
/**
 * Extract GitHub owner and repo from remote URL
 */
export declare function parseGitHubUrl(remoteUrl: string): {
    owner: string;
    repo: string;
} | null;
/**
 * Extract GitHub Pages URL from remote URL
 */
export declare function extractGitHubPagesUrl(remoteUrl: string): string;
//# sourceMappingURL=git.d.ts.map