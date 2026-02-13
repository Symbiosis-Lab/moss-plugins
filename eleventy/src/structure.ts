/**
 * Eleventy Structure Translation Module
 *
 * Creates an Eleventy-compatible folder structure from moss's parsed project info.
 * Eleventy uses a simpler structure compared to other SSGs:
 *
 * | moss Structure | Eleventy Structure | Resulting URL |
 * |---------------|-------------------|---------------|
 * | `index.md` (homepage) | `src/index.md` | `/` |
 * | `posts/` (collection) | `src/posts/` | `/posts/*` |
 * | `posts/article.md` | `src/posts/article.md` | `/posts/article/` |
 * | `about.md` (root page) | `src/about.md` | `/about/` |
 * | `assets/` | `src/assets/` | `/assets/*` |
 *
 * Eleventy processes markdown files directly and outputs to _site/ by default.
 */

import {
  writeFile,
  listFiles,
  fileExists,
  createSymlink,
} from "@symbiosis-lab/moss-api";
import type { PageNode } from "@symbiosis-lab/moss-api";

export interface ProjectInfo {
  content_folders: string[];
  total_files: number;
  homepage_file?: string;
}

export interface SourceFiles {
  markdown: string[];
  pages: string[];
  docx: string[];
  other: string[];
}

export interface SiteConfig {
  site_name?: string;
  base_url?: string;
  [key: string]: unknown;
}


/**
 * Creates the Eleventy-compatible folder structure.
 * Uses symlinks for content and asset files to avoid duplication.
 */
export async function createEleventyStructure(
  projectPath: string,
  projectInfo: ProjectInfo,
  runtimeDir: string,
  _mossDir?: string
): Promise<void> {
  const runtimeRelative = getRelativePath(projectPath, runtimeDir);

  // 1. Handle homepage - symlink to src/index.md
  if (projectInfo.homepage_file) {
    const homepageExists = await fileExists(projectInfo.homepage_file);
    if (homepageExists) {
      await createSymlink(projectInfo.homepage_file, `${runtimeRelative}/src/index.md`);
    }
  }

  // 2. Get all files
  const allFiles = await listFiles();
  const markdownFiles = allFiles.filter((f: string) => f.endsWith(".md"));

  // 3. Symlink content folder files to src/
  for (const folder of projectInfo.content_folders) {
    const folderFiles = markdownFiles.filter((f: string) =>
      f.startsWith(`${folder}/`)
    );

    for (const file of folderFiles) {
      // Keep the folder structure under src/
      await createSymlink(file, `${runtimeRelative}/src/${file}`);
    }
  }

  // 4. Symlink root-level markdown files to src/
  const rootMarkdownFiles = markdownFiles.filter(
    (f: string) => !f.includes("/") && f !== projectInfo.homepage_file
  );

  for (const file of rootMarkdownFiles) {
    await createSymlink(file, `${runtimeRelative}/src/${file}`);
  }

  // 5. Symlink assets to src/assets/
  const assetFiles = allFiles.filter((f: string) => f.startsWith("assets/"));
  for (const file of assetFiles) {
    await createSymlink(file, `${runtimeRelative}/src/${file}`);
  }
}

/**
 * Generates Eleventy configuration file (eleventy.config.js).
 */
export async function createEleventyConfig(
  siteConfig: SiteConfig,
  runtimeDir: string,
  projectPath: string
): Promise<void> {
  const siteName = siteConfig.site_name || "Site";
  const baseUrl = siteConfig.base_url || "/";
  const runtimeRelative = getRelativePath(projectPath, runtimeDir);

  const config = `// Auto-generated Eleventy configuration
module.exports = function(eleventyConfig) {
  // Pass through assets
  eleventyConfig.addPassthroughCopy("src/assets");

  // Add global data
  eleventyConfig.addGlobalData("site", {
    name: "${siteName}",
    baseUrl: "${baseUrl}"
  });

  // Configure markdown processing
  eleventyConfig.setFrontMatterParsingOptions({
    excerpt: true,
    excerpt_separator: "<!-- excerpt -->"
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      layouts: "_includes/layouts",
      data: "_data"
    },
    templateFormats: ["md", "njk", "html", "liquid"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk"
  };
};
`;

  await writeFile(`${runtimeRelative}/eleventy.config.js`, config);
}

/**
 * Cleans up the runtime directory.
 */
export async function cleanupRuntime(_runtimeDir: string): Promise<void> {
  // No-op: cleanup handled by moss core
}

/**
 * Translates a PageNode tree into Eleventy-compatible structure.
 * Folder nodes get an index.md with frontmatter; leaf nodes are symlinked.
 * Draft nodes are skipped entirely.
 */
export async function translatePageTree(
  node: PageNode,
  srcDir: string
): Promise<void> {
  if (node.draft) return;

  if (node.is_folder) {
    // Build frontmatter
    const lines = ["---", `title: ${node.title}`];
    if (node.nav_weight != null) {
      lines.push(`order: ${node.nav_weight}`);
    }
    lines.push("---", "");

    const indexPath =
      node.source_path === ""
        ? `${srcDir}/index.md`
        : `${srcDir}/${node.source_path}/index.md`;

    await writeFile(indexPath, lines.join("\n"));

    for (const child of node.children) {
      await translatePageTree(child, srcDir);
    }
  } else {
    await createSymlink(node.source_path, `${srcDir}/${node.source_path}`);
  }
}

function getRelativePath(basePath: string, targetPath: string): string {
  if (targetPath.startsWith(basePath)) {
    return targetPath.substring(basePath.length).replace(/^\//, "");
  }
  if (!targetPath.startsWith("/")) {
    return targetPath;
  }
  return targetPath;
}

