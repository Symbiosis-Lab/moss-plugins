/**
 * Astro Default Templates
 *
 * Creates basic Astro layouts and components.
 */

import { writeFile } from "@symbiosis-lab/moss-api";

/**
 * Creates default Astro layouts.
 */
export async function createDefaultLayouts(
  runtimeDir: string,
  projectPath: string
): Promise<void> {
  const runtimeRelative = getRelativePath(projectPath, runtimeDir);

  // Base Layout
  await writeFile(
    `${runtimeRelative}/src/layouts/Layout.astro`,
    `---
interface Props {
  title: string;
}

const { title } = Astro.props;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{title}</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        line-height: 1.6;
        max-width: 800px;
        margin: 0 auto;
        padding: 2rem;
        color: #333;
      }
      a { color: #0066cc; }
      h1, h2, h3 { margin-top: 2rem; }
      code {
        background: #f4f4f4;
        padding: 0.2rem 0.4rem;
        border-radius: 3px;
      }
      pre code {
        display: block;
        padding: 1rem;
        overflow-x: auto;
      }
    </style>
  </head>
  <body>
    <header>
      <nav>
        <a href="/">Home</a>
      </nav>
    </header>
    <main>
      <slot />
    </main>
    <footer>
      <p>&copy; {new Date().getFullYear()}</p>
    </footer>
  </body>
</html>
`
  );

  // Package.json for the Astro project
  await writeFile(
    `${runtimeRelative}/package.json`,
    `{
  "name": "astro-site",
  "type": "module",
  "version": "0.0.1",
  "scripts": {
    "build": "astro build"
  },
  "dependencies": {
    "astro": "^4.0.0"
  }
}
`
  );
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
