/**
 * Requirement validation for GitHub Pages deployment
 */
/**
 * Validate that the project is a git repository
 */
export declare function validateGitRepository(projectPath: string): Promise<void>;
/**
 * Validate that the site has been compiled
 */
export declare function validateSiteCompiled(outputDir: string): Promise<void>;
/**
 * Validate that a GitHub remote is configured
 */
export declare function validateGitHubRemote(projectPath: string): Promise<string>;
/**
 * Run all validations and return the remote URL
 */
export declare function validateAll(projectPath: string, outputDir: string): Promise<string>;
//# sourceMappingURL=validation.d.ts.map