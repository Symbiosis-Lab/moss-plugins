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
  readFile,
  writeFile,
  listFiles,
  fileExists,
} from "@symbiosis-lab/moss-api";

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
 * Ensures markdown content has proper frontmatter with layout.
 * Eleventy uses layouts specified in frontmatter.
 */
function ensureLayoutInFrontmatter(
  content: string,
  layoutName: string = "base.njk"
): string {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    // Check if layout is already specified
    if (!/^layout:/m.test(frontmatter)) {
      // Add layout to existing frontmatter
      const newFrontmatter = `layout: ${layoutName}\n${frontmatter}`;
      return `---\n${newFrontmatter}\n---${content.substring(frontmatterMatch[0].length)}`;
    }
    return content;
  }

  // No frontmatter exists, add one with layout
  return `---\nlayout: ${layoutName}\n---\n\n${content}`;
}

/**
 * Creates the Eleventy-compatible folder structure.
 */
export async function createEleventyStructure(
  projectPath: string,
  projectInfo: ProjectInfo,
  runtimeDir: string,
  _mossDir?: string
): Promise<void> {
  const runtimeRelative = getRelativePath(projectPath, runtimeDir);

  // 1. Handle homepage
  if (projectInfo.homepage_file) {
    const homepageExists = await fileExists(projectInfo.homepage_file);
    if (homepageExists) {
      const content = await readFile(projectInfo.homepage_file);
      const eleventyContent = ensureLayoutInFrontmatter(content);
      await writeFile(`${runtimeRelative}/src/index.md`, eleventyContent);
    }
  }

  // 2. Get all files
  const allFiles = await listFiles();
  const markdownFiles = allFiles.filter((f: string) => f.endsWith(".md"));

  // 3. Copy content folder files to src/
  for (const folder of projectInfo.content_folders) {
    const folderFiles = markdownFiles.filter((f: string) =>
      f.startsWith(`${folder}/`)
    );

    for (const file of folderFiles) {
      const content = await readFile(file);
      const eleventyContent = ensureLayoutInFrontmatter(content);
      // Keep the folder structure under src/
      await writeFile(`${runtimeRelative}/src/${file}`, eleventyContent);
    }
  }

  // 4. Copy root-level markdown files to src/
  const rootMarkdownFiles = markdownFiles.filter(
    (f: string) => !f.includes("/") && f !== projectInfo.homepage_file
  );

  for (const file of rootMarkdownFiles) {
    const content = await readFile(file);
    const eleventyContent = ensureLayoutInFrontmatter(content);
    await writeFile(`${runtimeRelative}/src/${file}`, eleventyContent);
  }

  // 5. Copy assets to src/assets/
  const assetFiles = allFiles.filter((f: string) => f.startsWith("assets/"));
  for (const file of assetFiles) {
    if (isTextFile(file)) {
      try {
        const content = await readFile(file);
        await writeFile(`${runtimeRelative}/src/${file}`, content);
      } catch {
        // Skip files that can't be read as text
      }
    }
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

function getRelativePath(basePath: string, targetPath: string): string {
  if (targetPath.startsWith(basePath)) {
    return targetPath.substring(basePath.length).replace(/^\//, "");
  }
  if (!targetPath.startsWith("/")) {
    return targetPath;
  }
  return targetPath;
}

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
    ".njk",
    ".liquid",
    ".ts",
  ];
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  return textExtensions.includes(ext);
}
