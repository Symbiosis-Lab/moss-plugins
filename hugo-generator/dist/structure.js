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
import { readFile, writeFile, listFiles, fileExists, } from "@symbiosis-lab/moss-api";
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
export async function createHugoStructure(projectPath, projectInfo, runtimeDir, _mossDir) {
    // Calculate relative paths from project root
    const runtimeRelative = getRelativePath(projectPath, runtimeDir);
    const contentDir = `${runtimeRelative}/content`;
    const staticDir = `${runtimeRelative}/static`;
    // 1. Handle homepage - Hugo expects _index.md at content root
    if (projectInfo.homepage_file) {
        const homepageExists = await fileExists(projectPath, projectInfo.homepage_file);
        if (homepageExists) {
            const content = await readFile(projectPath, projectInfo.homepage_file);
            await writeFile(projectPath, `${contentDir}/_index.md`, content);
        }
    }
    // 2. Get all files in the project to copy content
    const allFiles = await listFiles(projectPath);
    const markdownFiles = allFiles.filter((f) => f.endsWith(".md"));
    // 3. Copy content folder files with index.md → _index.md renaming
    for (const folder of projectInfo.content_folders) {
        const folderFiles = markdownFiles.filter((f) => f.startsWith(`${folder}/`));
        for (const file of folderFiles) {
            const content = await readFile(projectPath, file);
            // Get the relative path within the folder
            const relativePath = file.substring(folder.length + 1);
            const fileName = getFileName(relativePath);
            // Rename index.md to _index.md (Hugo's section index convention)
            let destPath;
            if (fileName.toLowerCase() === "index.md") {
                const dirPart = getDirName(relativePath);
                destPath = dirPart
                    ? `${contentDir}/${folder}/${dirPart}/_index.md`
                    : `${contentDir}/${folder}/_index.md`;
            }
            else {
                destPath = `${contentDir}/${folder}/${relativePath}`;
            }
            await writeFile(projectPath, destPath, content);
        }
    }
    // 4. Copy root-level markdown files (excluding homepage)
    const rootMarkdownFiles = markdownFiles.filter((f) => !f.includes("/") && // No subdirectory
        f !== projectInfo.homepage_file);
    for (const file of rootMarkdownFiles) {
        const content = await readFile(projectPath, file);
        await writeFile(projectPath, `${contentDir}/${file}`, content);
    }
    // 5. Copy assets folder if it exists
    const assetFiles = allFiles.filter((f) => f.startsWith("assets/"));
    for (const file of assetFiles) {
        // For binary files, we need a different approach since readFile returns string
        // For now, we'll skip binary assets and only copy text-based assets
        if (isTextFile(file)) {
            try {
                const content = await readFile(projectPath, file);
                await writeFile(projectPath, `${staticDir}/${file}`, content);
            }
            catch {
                // Skip files that can't be read as text
            }
        }
    }
}
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
export async function createHugoConfig(siteConfig, runtimeDir, projectPath) {
    const siteName = siteConfig.site_name || "Site";
    const baseUrl = siteConfig.base_url || "/";
    const runtimeRelative = getRelativePath(projectPath, runtimeDir);
    const config = `# Auto-generated Hugo configuration
# Do not edit - this file is regenerated on each build

baseURL = "${baseUrl}"
title = "${siteName}"

# Preserve folder structure in URLs
[permalinks]
  [permalinks.page]
    '*' = '/:sections/:filename/'
  [permalinks.section]
    '*' = '/:sections/'

# Disable features we don't need
disableKinds = ["taxonomy", "term", "RSS", "sitemap"]

# Enable goldmark for markdown
[markup]
  [markup.goldmark]
    [markup.goldmark.renderer]
      unsafe = true
`;
    await writeFile(projectPath, `${runtimeRelative}/hugo.toml`, config);
}
/**
 * Cleans up the runtime directory.
 *
 * Note: This is a no-op in the moss-api context since we don't have
 * a delete file/directory API. The cleanup should be handled by moss core
 * or the build orchestration layer.
 *
 * @param runtimeDir - Path to the plugin's .runtime directory
 */
export async function cleanupRuntime(_runtimeDir) {
    // No-op: moss-api doesn't provide file deletion
    // Cleanup is handled by moss core after plugin execution
}
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Gets the relative path from a base path to a target path.
 */
function getRelativePath(basePath, targetPath) {
    // Simple implementation for paths that share a common prefix
    if (targetPath.startsWith(basePath)) {
        return targetPath.substring(basePath.length).replace(/^\//, "");
    }
    // If target is relative, return as-is
    if (!targetPath.startsWith("/")) {
        return targetPath;
    }
    // Fallback: return the target path
    return targetPath;
}
/**
 * Gets the file name from a path.
 */
function getFileName(filePath) {
    const parts = filePath.split("/");
    return parts[parts.length - 1];
}
/**
 * Gets the directory name from a path.
 */
function getDirName(filePath) {
    const parts = filePath.split("/");
    if (parts.length <= 1) {
        return "";
    }
    return parts.slice(0, -1).join("/");
}
/**
 * Checks if a file is likely a text file based on extension.
 */
function isTextFile(filePath) {
    const textExtensions = [
        ".md",
        ".txt",
        ".css",
        ".js",
        ".json",
        ".html",
        ".xml",
        ".svg",
        ".yaml",
        ".yml",
        ".toml",
    ];
    const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
    return textExtensions.includes(ext);
}
//# sourceMappingURL=structure.js.map