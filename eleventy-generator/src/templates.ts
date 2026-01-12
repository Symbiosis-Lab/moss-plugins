/**
 * Eleventy Default Templates
 *
 * Creates basic Eleventy layouts and includes using Nunjucks templating.
 */

import { writeFile } from "@symbiosis-lab/moss-api";

/**
 * Creates default Eleventy layouts.
 */
export async function createDefaultLayouts(
  runtimeDir: string,
  projectPath: string
): Promise<void> {
  const runtimeRelative = getRelativePath(projectPath, runtimeDir);

  // Base Layout (Nunjucks)
  await writeFile(
    `${runtimeRelative}/src/_includes/layouts/base.njk`,
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{ title or site.name }}</title>
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
      nav { margin-bottom: 2rem; }
      nav a { margin-right: 1rem; }
      footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #eee; }
    </style>
  </head>
  <body>
    <header>
      <nav>
        <a href="{{ site.baseUrl }}">Home</a>
      </nav>
    </header>
    <main>
      {{ content | safe }}
    </main>
    <footer>
      <p>&copy; {{ "" | date("Y") }}</p>
    </footer>
  </body>
</html>
`
  );

  // Post Layout (extends base)
  await writeFile(
    `${runtimeRelative}/src/_includes/layouts/post.njk`,
    `---
layout: base.njk
---
<article>
  <header>
    <h1>{{ title }}</h1>
    {% if date %}
    <time datetime="{{ date | date('Y-m-d') }}">{{ date | date("F j, Y") }}</time>
    {% endif %}
  </header>
  <div class="content">
    {{ content | safe }}
  </div>
</article>
`
  );

  // Package.json for the Eleventy project
  await writeFile(
    `${runtimeRelative}/package.json`,
    `{
  "name": "eleventy-site",
  "version": "0.0.1",
  "scripts": {
    "build": "npx @11ty/eleventy"
  },
  "devDependencies": {
    "@11ty/eleventy": "^3.0.0"
  }
}
`
  );
}

/**
 * Creates collection-specific data files for Eleventy.
 */
export async function createCollectionData(
  runtimeDir: string,
  projectPath: string,
  collectionName: string
): Promise<void> {
  const runtimeRelative = getRelativePath(projectPath, runtimeDir);

  // Create a directory data file for the collection
  await writeFile(
    `${runtimeRelative}/src/${collectionName}/${collectionName}.json`,
    `{
  "layout": "post.njk",
  "tags": ["${collectionName}"]
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
