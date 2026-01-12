/**
 * Astro Structure Translation Module
 *
 * Creates an Astro-compatible folder structure from moss's parsed project info.
 * Astro uses a different structure than Hugo/Jekyll:
 *
 * | moss Structure | Astro Structure | Resulting URL |
 * |---------------|-----------------|---------------|
 * | `index.md` (homepage) | `src/pages/index.astro` | `/` |
 * | `posts/` (collection) | `src/content/posts/` | `/posts/*` |
 * | `posts/article.md` | `src/content/posts/article.md` | `/posts/article/` |
 * | `about.md` (root page) | `src/pages/about.astro` | `/about/` |
 * | `assets/` | `public/assets/` | `/assets/*` |
 */

import {
  readFile,
  writeFile,
  listFiles,
  fileExists,
  createSymlink,
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
 * Wraps markdown content in an Astro page component.
 */
function wrapInAstroPage(content: string, title?: string): string {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  let bodyContent = content;
  let extractedTitle = title || "Page";

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    const titleMatch = frontmatter.match(/title:\s*["']?([^"'\n]+)["']?/);
    if (titleMatch) {
      extractedTitle = titleMatch[1];
    }
    bodyContent = content.substring(frontmatterMatch[0].length).trim();
  }

  return `---
import Layout from '../layouts/Layout.astro';
---

<Layout title="${extractedTitle}">
  <article>
${bodyContent.split('\n').map(line => '    ' + line).join('\n')}
  </article>
</Layout>
`;
}

/**
 * Creates the Astro-compatible folder structure.
 */
export async function createAstroStructure(
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
      const astroContent = wrapInAstroPage(content, "Home");
      await writeFile(`${runtimeRelative}/src/pages/index.astro`, astroContent);
    }
  }

  // 2. Get all files
  const allFiles = await listFiles();
  const markdownFiles = allFiles.filter((f: string) => f.endsWith(".md"));

  // 3. Symlink content folder files to src/content/
  // Content collection files stay as markdown, so we can use symlinks
  for (const folder of projectInfo.content_folders) {
    const folderFiles = markdownFiles.filter((f: string) =>
      f.startsWith(`${folder}/`)
    );

    for (const file of folderFiles) {
      const relativePath = file.substring(folder.length + 1);
      // Content collections go to src/content/
      await createSymlink(file, `${runtimeRelative}/src/content/${folder}/${relativePath}`);
    }
  }

  // 4. Copy root-level markdown files as Astro pages
  const rootMarkdownFiles = markdownFiles.filter(
    (f: string) =>
      !f.includes("/") &&
      f !== projectInfo.homepage_file
  );

  for (const file of rootMarkdownFiles) {
    const content = await readFile(file);
    const baseName = file.replace(/\.md$/, "");
    const astroContent = wrapInAstroPage(content, baseName);
    await writeFile(`${runtimeRelative}/src/pages/${baseName}.astro`, astroContent);
  }

  // 5. Symlink assets to public/
  // Use symlinks for all asset files (preserves binary files correctly)
  const assetFiles = allFiles.filter((f: string) => f.startsWith("assets/"));
  for (const file of assetFiles) {
    await createSymlink(file, `${runtimeRelative}/public/${file}`);
  }
}

/**
 * Generates Astro configuration file (astro.config.mjs).
 */
export async function createAstroConfig(
  siteConfig: SiteConfig,
  runtimeDir: string,
  projectPath: string
): Promise<void> {
  const siteName = siteConfig.site_name || "Site";
  const baseUrl = siteConfig.base_url || "/";
  const runtimeRelative = getRelativePath(projectPath, runtimeDir);

  const config = `// Auto-generated Astro configuration
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: '${baseUrl === "/" ? "" : baseUrl}',
  output: 'static',
  build: {
    format: 'directory',
  },
  markdown: {
    shikiConfig: {
      theme: 'github-light',
    },
  },
});

// Site name: ${siteName}
`;

  await writeFile(`${runtimeRelative}/astro.config.mjs`, config);
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

