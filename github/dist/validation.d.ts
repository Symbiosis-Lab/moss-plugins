/**
 * Requirement validation for GitHub Pages deployment
 */
/**
 * Validate that the project is a git repository
 */
export declare function validateGitRepository(): Promise<void>;
/**
 * Validate that the site has been compiled
 * @param outputDir - Relative path to the output directory (e.g., ".moss/site")
 */
export declare function validateSiteCompiled(outputDir: string): Promise<void>;
/**
 * Validate that a GitHub remote is configured
 */
export declare function validateGitHubRemote(): Promise<string>;
/**
 * Run all validations and return the remote URL
 * @param outputDir - Relative path to the output directory (e.g., ".moss/site")
 */
export declare function validateAll(outputDir: string): Promise<string>;
//# sourceMappingURL=validation.d.ts.map