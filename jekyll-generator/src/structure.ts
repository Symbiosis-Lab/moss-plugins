/**
 * Jekyll Structure Translation Module
 *
 * Creates a Jekyll-compatible folder structure from moss's parsed project info
 * by copying content files. This enables Jekyll to build any folder structure
 * without requiring the user to reorganize their content.
 *
 * ## Translation Rules
 *
 * | moss Structure | Jekyll Structure | Resulting URL |
 * |---------------|------------------|---------------|
 * | `index.md` (homepage) | `index.md` | `/` |
 * | `posts/` (collection) | `_posts/` | `/posts/*` |
 * | `posts/article.md` | `_posts/article.md` | `/posts/article/` |
 * | `about.md` (root page) | `about.md` | `/about/` |
 * | `assets/` | `assets/` | `/assets/*` |
 *
 * ## Key Conventions
 *
 * - Jekyll expects posts in `_posts/` directory (with optional date prefix)
 * - Other collections stay in their original directories
 * - Assets folder is copied as-is
 * - Runtime directory is ephemeral and cleaned up after build
 */

import {
  readFile,
  writeFile,
  listFiles,
  fileExists,
} from "@symbiosis-lab/moss-api";

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
 * Creates the Jekyll-compatible folder structure by copying content files.
 *
 * This is the core translation function that maps moss's flexible folder
 * structure to Jekyll's expected layout.
 *
 * @param projectPath - Absolute path to the project folder
 * @param projectInfo - Parsed project structure from moss
 * @param runtimeDir - Path to the plugin's .runtime directory
 * @param mossDir - Path to .moss directory (optional)
 */
export async function createJekyllStructure(
  projectPath: string,
  projectInfo: ProjectInfo,
  runtimeDir: string,
  _mossDir?: string
): Promise<void> {
  // Calculate relative paths from project root
  const runtimeRelative = getRelativePath(projectPath, runtimeDir);

  // 1. Handle homepage - Jekyll uses index.md at root
  if (projectInfo.homepage_file) {
    const homepageExists = await fileExists(projectInfo.homepage_file);
    if (homepageExists) {
      const content = await readFile(projectInfo.homepage_file);
      await writeFile(`${runtimeRelative}/index.md`, content);
    }
  }

  // 2. Get all files in the project to copy content
  const allFiles = await listFiles();
  const markdownFiles = allFiles.filter((f: string) => f.endsWith(".md"));

  // 3. Copy content folder files with appropriate transformations
  for (const folder of projectInfo.content_folders) {
    const folderFiles = markdownFiles.filter((f: string) =>
      f.startsWith(`${folder}/`)
    );

    for (const file of folderFiles) {
      const content = await readFile(file);

      // Get the relative path within the folder
      const relativePath = file.substring(folder.length + 1);

      // Determine destination based on folder type
      let destPath: string;
      if (folder === "posts" || folder === "_posts") {
        // Posts go to _posts directory (Jekyll convention)
        destPath = `${runtimeRelative}/_posts/${relativePath}`;
      } else {
        // Other collections stay in their original directories
        destPath = `${runtimeRelative}/${folder}/${relativePath}`;
      }

      await writeFile(destPath, content);
    }
  }

  // 4. Copy root-level markdown files (excluding homepage)
  const rootMarkdownFiles = markdownFiles.filter(
    (f: string) =>
      !f.includes("/") && // No subdirectory
      f !== projectInfo.homepage_file
  );

  for (const file of rootMarkdownFiles) {
    const content = await readFile(file);
    await writeFile(`${runtimeRelative}/${file}`, content);
  }

  // 5. Copy assets folder if it exists
  const assetFiles = allFiles.filter((f: string) => f.startsWith("assets/"));
  for (const file of assetFiles) {
    // For binary files, we need a different approach since readFile returns string
    // For now, we'll skip binary assets and only copy text-based assets
    if (isTextFile(file)) {
      try {
        const content = await readFile(file);
        await writeFile(`${runtimeRelative}/${file}`, content);
      } catch {
        // Skip files that can't be read as text
      }
    }
  }
}

/**
 * Generates Jekyll configuration file (_config.yml).
 *
 * Creates a Jekyll config that:
 * - Sets site title and baseurl
 * - Configures markdown processor (kramdown)
 * - Sets up permalink structure
 *
 * @param siteConfig - Site configuration from .moss/config.toml
 * @param runtimeDir - Path to the plugin's .runtime directory
 * @param projectPath - Absolute path to the project folder
 */
export async function createJekyllConfig(
  siteConfig: SiteConfig,
  runtimeDir: string,
  projectPath: string
): Promise<void> {
  const siteName = siteConfig.site_name || "Site";
  const baseUrl = siteConfig.base_url || "";
  const runtimeRelative = getRelativePath(projectPath, runtimeDir);

  const config = `# Auto-generated Jekyll configuration
# Do not edit - this file is regenerated on each build

title: "${siteName}"
baseurl: "${baseUrl}"
url: ""

# Markdown processor
markdown: kramdown
kramdown:
  input: GFM
  hard_wrap: false
  syntax_highlighter: rouge

# Permalink structure
permalink: /:categories/:title/

# Build settings
exclude:
  - Gemfile
  - Gemfile.lock
  - node_modules
  - vendor

# Allow raw HTML in markdown
kramdown:
  parse_block_html: true
`;

  await writeFile(`${runtimeRelative}/_config.yml`, config);
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
export async function cleanupRuntime(_runtimeDir: string): Promise<void> {
  // No-op: moss-api doesn't provide file deletion
  // Cleanup is handled by moss core after plugin execution
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Gets the relative path from a base path to a target path.
 */
function getRelativePath(basePath: string, targetPath: string): string {
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
 * Checks if a file is likely a text file based on extension.
 */
function isTextFile(filePath: string): boolean {
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
