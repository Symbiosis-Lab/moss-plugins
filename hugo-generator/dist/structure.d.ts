/**
 * Hugo Structure Translation Module
 *
 * Creates a Hugo-compatible folder structure from moss's parsed project info
 * by copying content files. This enables Hugo to build any folder structure
 * without requiring the user to reorganize their content.
 *
 * ## Translation Rules
 *
 * | moss Structure | Hugo Structure | Resulting URL |
 * |---------------|----------------|---------------|
 * | `index.md` (homepage) | `content/_index.md` | `/` |
 * | `posts/` (collection) | `content/posts/` | `/posts/*` |
 * | `posts/article.md` | `content/posts/article.md` | `/posts/article/` |
 * | `about.md` (root page) | `content/about.md` | `/about/` |
 *
 * ## Key Conventions
 *
 * - Hugo expects section indices to be `_index.md`, not `index.md`
 * - Assets folder is copied to `static/assets` for Hugo's static file handling
 * - Runtime directory is ephemeral and cleaned up after build
 */
/**
 * Project information from moss's folder scan.
 */
export interface ProjectInfo {
    /** Content folder names (e.g., ["posts", "projects"]). Empty for flat sites. */
    content_folders: string[];
    /** Total number of content files detected */
    total_files: number;
    /** Homepage file path relative to project root (e.g., "index.md") */
    homepage_file?: string;
}
/**
 * Source files categorized by type.
 */
export interface SourceFiles {
    markdown: string[];
    pages: string[];
    docx: string[];
    other: string[];
}
/**
 * Site configuration from .moss/config.toml.
 */
export interface SiteConfig {
    site_name?: string;
    base_url?: string;
    [key: string]: unknown;
}
/**
 * Creates the Hugo-compatible folder structure by copying content files.
 *
 * This is the core translation function that maps moss's flexible folder
 * structure to Hugo's expected layout.
 *
 * @param projectPath - Absolute path to the project folder
 * @param projectInfo - Parsed project structure from moss
 * @param runtimeDir - Path to the plugin's .runtime directory (relative to moss_dir)
 * @param mossDir - Path to .moss directory
 */
export declare function createHugoStructure(projectPath: string, projectInfo: ProjectInfo, runtimeDir: string, _mossDir?: string): Promise<void>;
/**
 * Generates Hugo configuration file (hugo.toml).
 *
 * Creates a minimal Hugo config that:
 * - Preserves folder structure in URLs
 * - Disables unused features (taxonomy, RSS, sitemap)
 * - Enables unsafe HTML in markdown
 *
 * @param siteConfig - Site configuration from .moss/config.toml
 * @param runtimeDir - Path to the plugin's .runtime directory
 * @param projectPath - Absolute path to the project folder
 */
export declare function createHugoConfig(siteConfig: SiteConfig, runtimeDir: string, projectPath: string): Promise<void>;
/**
 * Cleans up the runtime directory.
 *
 * Note: This is a no-op in the moss-api context since we don't have
 * a delete file/directory API. The cleanup should be handled by moss core
 * or the build orchestration layer.
 *
 * @param runtimeDir - Path to the plugin's .runtime directory
 */
export declare function cleanupRuntime(_runtimeDir: string): Promise<void>;
//# sourceMappingURL=structure.d.ts.map