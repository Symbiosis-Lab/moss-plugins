/**
 * Gatsby Structure Translation Module
 *
 * Creates a Gatsby-compatible folder structure from moss's parsed project info.
 * Gatsby uses a different structure than Hugo/Jekyll:
 *
 * | moss Structure | Gatsby Structure | Resulting URL |
 * |---------------|------------------|---------------|
 * | `index.md` (homepage) | `src/pages/index.js` | `/` |
 * | `posts/` (collection) | `src/content/posts/` | `/posts/*` |
 * | `posts/article.md` | `src/content/posts/article.md` | `/posts/article/` |
 * | `about.md` (root page) | `src/pages/about.js` | `/about/` |
 * | `assets/` | `static/assets/` | `/assets/*` |
 *
 * Note: Gatsby uses React components for pages and requires gatsby-transformer-remark
 * plugin to process markdown files from src/content/.
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
 * Extracts title and body content from markdown.
 */
function parseMarkdownContent(content: string): { title: string; body: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  let bodyContent = content;
  let extractedTitle = "Page";

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    const titleMatch = frontmatter.match(/title:\s*["']?([^"'\n]+)["']?/);
    if (titleMatch) {
      extractedTitle = titleMatch[1];
    }
    bodyContent = content.substring(frontmatterMatch[0].length).trim();
  }

  return { title: extractedTitle, body: bodyContent };
}

/**
 * Wraps markdown content in a Gatsby page component.
 */
function wrapInGatsbyPage(content: string, title?: string): string {
  const parsed = parseMarkdownContent(content);
  const pageTitle = title || parsed.title;

  // Escape backticks and special characters for template literal
  const escapedBody = parsed.body
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");

  return `import * as React from "react"
import Layout from "../components/Layout"

const Page = () => {
  return (
    <Layout title="${pageTitle}">
      <article>
        <div dangerouslySetInnerHTML={{ __html: \`${escapedBody.split('\n').map(line => line).join('\n')}\` }} />
      </article>
    </Layout>
  )
}

export default Page

export const Head = () => <title>${pageTitle}</title>
`;
}

/**
 * Creates the Gatsby-compatible folder structure.
 */
export async function createGatsbyStructure(
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
      const gatsbyContent = wrapInGatsbyPage(content, "Home");
      await writeFile(`${runtimeRelative}/src/pages/index.js`, gatsbyContent);
    }
  }

  // 2. Get all files
  const allFiles = await listFiles();
  const markdownFiles = allFiles.filter((f: string) => f.endsWith(".md"));

  // 3. Copy content folder files to src/content/
  for (const folder of projectInfo.content_folders) {
    const folderFiles = markdownFiles.filter((f: string) =>
      f.startsWith(`${folder}/`)
    );

    for (const file of folderFiles) {
      const content = await readFile(file);
      const relativePath = file.substring(folder.length + 1);
      // Content collections go to src/content/
      await writeFile(`${runtimeRelative}/src/content/${folder}/${relativePath}`, content);
    }
  }

  // 4. Copy root-level markdown files as Gatsby pages
  const rootMarkdownFiles = markdownFiles.filter(
    (f: string) =>
      !f.includes("/") &&
      f !== projectInfo.homepage_file
  );

  for (const file of rootMarkdownFiles) {
    const content = await readFile(file);
    const baseName = file.replace(/\.md$/, "");
    const gatsbyContent = wrapInGatsbyPage(content, baseName);
    await writeFile(`${runtimeRelative}/src/pages/${baseName}.js`, gatsbyContent);
  }

  // 5. Copy assets to static/
  const assetFiles = allFiles.filter((f: string) => f.startsWith("assets/"));
  for (const file of assetFiles) {
    if (isTextFile(file)) {
      try {
        const content = await readFile(file);
        await writeFile(`${runtimeRelative}/static/${file}`, content);
      } catch {
        // Skip files that can't be read as text
      }
    }
  }
}

/**
 * Generates Gatsby configuration file (gatsby-config.js).
 */
export async function createGatsbyConfig(
  siteConfig: SiteConfig,
  runtimeDir: string,
  projectPath: string
): Promise<void> {
  const siteName = siteConfig.site_name || "Site";
  const baseUrl = siteConfig.base_url || "/";
  const runtimeRelative = getRelativePath(projectPath, runtimeDir);

  const config = `// Auto-generated Gatsby configuration
module.exports = {
  siteMetadata: {
    title: \`${siteName}\`,
    siteUrl: \`${baseUrl === "/" ? "https://example.com" : baseUrl}\`,
  },
  pathPrefix: \`${baseUrl === "/" ? "" : baseUrl}\`,
  plugins: [
    \`gatsby-transformer-remark\`,
    {
      resolve: \`gatsby-source-filesystem\`,
      options: {
        name: \`content\`,
        path: \`\${__dirname}/src/content\`,
      },
    },
    {
      resolve: \`gatsby-source-filesystem\`,
      options: {
        name: \`pages\`,
        path: \`\${__dirname}/src/pages\`,
      },
    },
  ],
}
`;

  await writeFile(`${runtimeRelative}/gatsby-config.js`, config);
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
    ".md", ".txt", ".css", ".js", ".json", ".html",
    ".xml", ".svg", ".yaml", ".yml", ".toml", ".mjs", ".ts",
  ];
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  return textExtensions.includes(ext);
}
