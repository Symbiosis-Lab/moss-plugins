/**
 * Hugo Structure Translation Module
 *
 * Creates a Hugo-compatible folder structure from moss's parsed project info
 * using symbolic links where possible. This enables Hugo to build any folder
 * structure without requiring the user to reorganize their content.
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
 * - Assets folder is symlinked to `static/assets` for Hugo's static file handling
 * - Uses symlinks for efficiency; copies only when renaming is required
 * - Runtime directory is ephemeral and cleaned up after build
 */

import {
  readFile,
  writeFile,
  listFiles,
  fileExists,
  createSymlink,
} from "@symbiosis-lab/moss-api";
import type { PageNode } from "@symbiosis-lab/moss-api";

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
 * Creates the Hugo-compatible folder structure using symlinks.
 *
 * This is the core translation function that maps moss's flexible folder
 * structure to Hugo's expected layout. Uses symlinks for efficiency,
 * only copying when file renaming is required.
 *
 * @param projectPath - Absolute path to the project folder
 * @param projectInfo - Parsed project structure from moss
 * @param runtimeDir - Path to the plugin's .runtime directory (relative to moss_dir)
 * @param mossDir - Path to .moss directory
 */
export async function createHugoStructure(
  projectPath: string,
  projectInfo: ProjectInfo,
  runtimeDir: string,
  _mossDir?: string
): Promise<void> {
  // Calculate relative paths from project root
  const runtimeRelative = getRelativePath(projectPath, runtimeDir);
  const contentDir = `${runtimeRelative}/content`;
  const staticDir = `${runtimeRelative}/static`;

  // 1. Handle homepage - Hugo expects _index.md at content root
  // Must copy because we need to rename index.md to _index.md
  if (projectInfo.homepage_file) {
    const homepageExists = await fileExists(projectInfo.homepage_file);
    if (homepageExists) {
      const content = await readFile(projectInfo.homepage_file);
      await writeFile(`${contentDir}/_index.md`, content);
    }
  }

  // 2. Get all files in the project
  const allFiles = await listFiles();
  const markdownFiles = allFiles.filter((f: string) => f.endsWith(".md"));

  // 3. Process content folder files with symlinks (copy only for index.md → _index.md)
  for (const folder of projectInfo.content_folders) {
    const folderFiles = markdownFiles.filter((f: string) => f.startsWith(`${folder}/`));

    for (const file of folderFiles) {
      // Get the relative path within the folder
      const relativePath = file.substring(folder.length + 1);
      const fileName = getFileName(relativePath);

      // Determine destination path
      let destPath: string;
      const needsRename = fileName.toLowerCase() === "index.md";

      if (needsRename) {
        // Rename index.md to _index.md (Hugo's section index convention)
        // Must copy because symlinks can't rename
        const dirPart = getDirName(relativePath);
        destPath = dirPart
          ? `${contentDir}/${folder}/${dirPart}/_index.md`
          : `${contentDir}/${folder}/_index.md`;
        const content = await readFile(file);
        await writeFile(destPath, content);
      } else {
        // Use symlink for non-index files
        destPath = `${contentDir}/${folder}/${relativePath}`;
        await createSymlink(file, destPath);
      }
    }
  }

  // 4. Process root-level markdown files (excluding homepage)
  const rootMarkdownFiles = markdownFiles.filter(
    (f: string) =>
      !f.includes("/") && // No subdirectory
      f !== projectInfo.homepage_file
  );

  for (const file of rootMarkdownFiles) {
    // Use symlink for root-level files
    await createSymlink(file, `${contentDir}/${file}`);
  }

  // 5. Symlink assets folder if it exists
  const assetFiles = allFiles.filter((f: string) => f.startsWith("assets/"));
  for (const file of assetFiles) {
    // Use symlink for all asset files (preserves binary files correctly)
    await createSymlink(file, `${staticDir}/${file}`);
  }
}

/**
 * Translates a PageNode tree into Hugo's content directory structure.
 *
 * - Folder nodes get `_index.md` (Hugo's section index convention)
 * - Leaf nodes get symlinked
 * - Draft nodes are skipped entirely
 *
 * @param node - Root PageNode of the tree
 * @param contentDir - Path to Hugo's content directory (e.g., "runtime/content")
 */
export async function translatePageTree(
  node: PageNode,
  contentDir: string
): Promise<void> {
  if (node.draft) return;

  if (node.is_folder) {
    // Determine the _index.md path
    const folderPath = node.source_path
      ? `${contentDir}/${node.source_path}`
      : contentDir;
    const indexPath = `${folderPath}/_index.md`;

    // Build frontmatter
    const frontmatterLines: string[] = [`title: "${node.title}"`];
    if (node.nav_weight !== undefined) {
      frontmatterLines.push(`weight: ${node.nav_weight}`);
    }
    if (node.nav) {
      frontmatterLines.push(`nav: true`);
    }
    if (node.list_style && node.list_style !== "list") {
      frontmatterLines.push(`list_style: "${node.list_style}"`);
    }

    const frontmatter = `---\n${frontmatterLines.join("\n")}\n---\n`;
    const body = node.content_html || "";
    await writeFile(indexPath, frontmatter + body);

    for (const child of node.children) {
      await translatePageTree(child, contentDir);
    }
  } else {
    // Leaf node — symlink the source file
    await createSymlink(node.source_path, `${contentDir}/${node.source_path}`);
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
export async function createHugoConfig(
  siteConfig: SiteConfig,
  runtimeDir: string,
  projectPath: string
): Promise<void> {
  const siteName = siteConfig.site_name || "Site";
  const baseUrl = siteConfig.base_url || "/";
  const runtimeRelative = getRelativePath(projectPath, runtimeDir);

  const config = `# Auto-generated Hugo configuration
# Do not edit - this file is regenerated on each build

baseURL = "${baseUrl}"
title = "${siteName}"

# Disable features we don't need (must be before section headers)
disableKinds = ["taxonomy", "term", "RSS", "sitemap"]

# Preserve folder structure in URLs
[permalinks]
  [permalinks.page]
    '*' = '/:sections/:filename/'
  [permalinks.section]
    '*' = '/:sections/'

# Enable goldmark for markdown
[markup]
  [markup.goldmark]
    [markup.goldmark.renderer]
      unsafe = true
`;

  await writeFile(`${runtimeRelative}/hugo.toml`, config);
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
 * Gets the file name from a path.
 */
function getFileName(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1];
}

/**
 * Gets the directory name from a path.
 */
function getDirName(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 1) {
    return "";
  }
  return parts.slice(0, -1).join("/");
}
