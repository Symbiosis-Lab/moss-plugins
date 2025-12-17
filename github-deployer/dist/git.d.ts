/**
 * Git command helpers for the GitHub Pages Publisher Plugin
 *
 * Executes git commands via Tauri's execute_binary command.
 */
/**
 * Check if a path exists using git status (works without direct filesystem access)
 */
export declare function checkPathExists(projectPath: string, relativePath: string): Promise<boolean>;
/**
 * Get the origin remote URL
 */
export declare function getRemoteUrl(projectPath: string): Promise<string>;
/**
 * Detect the default branch (main or master)
 */
export declare function detectBranch(projectPath: string): Promise<string>;
/**
 * Check if directory is a git repository
 */
export declare function isGitRepository(projectPath: string): Promise<boolean>;
/**
 * Check if remote exists and get its URL
 */
export declare function hasGitRemote(projectPath: string): Promise<boolean>;
/**
 * Stage files for commit
 */
export declare function stageFiles(projectPath: string, files: string[]): Promise<void>;
/**
 * Create a commit with a message
 */
export declare function commit(projectPath: string, message: string): Promise<string>;
/**
 * Push to remote
 */
export declare function push(projectPath: string): Promise<void>;
/**
 * Stage, commit, and push workflow files
 */
export declare function commitAndPushWorkflow(projectPath: string): Promise<string>;
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