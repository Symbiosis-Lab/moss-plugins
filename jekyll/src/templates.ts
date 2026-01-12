/**
 * Jekyll Default Templates
 *
 * Creates basic Jekyll layouts in the _layouts/ directory.
 * These provide a minimal working setup for sites without custom themes.
 *
 * ## Layout Hierarchy
 *
 * - `default.html` - Base layout with HTML structure
 * - `page.html` - Layout for regular pages
 * - `post.html` - Layout for blog posts
 * - `home.html` - Layout for homepage/index
 */

import { writeFile } from "@symbiosis-lab/moss-api";

/**
 * Creates default Jekyll layouts in the runtime directory.
 *
 * @param runtimeDir - Path to the plugin's .runtime directory
 * @param projectPath - Absolute path to the project folder
 */
export async function createDefaultLayouts(
  runtimeDir: string,
  projectPath: string
): Promise<void> {
  const runtimeRelative = getRelativePath(projectPath, runtimeDir);
  const layoutsDir = `${runtimeRelative}/_layouts`;

  // Default layout - base HTML structure
  await writeFile(
    `${layoutsDir}/default.html`,
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{% if page.title %}{{ page.title }} | {% endif %}{{ site.title }}</title>
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
      <a href="{{ site.baseurl }}/">Home</a>
    </nav>
  </header>
  <main>
    {{ content }}
  </main>
  <footer>
    <p>&copy; {{ site.time | date: '%Y' }} {{ site.title }}</p>
  </footer>
</body>
</html>
`
  );

  // Page layout - for regular pages
  await writeFile(
    `${layoutsDir}/page.html`,
    `---
layout: default
---
<article>
  <h1>{{ page.title }}</h1>
  {{ content }}
</article>
`
  );

  // Post layout - for blog posts
  await writeFile(
    `${layoutsDir}/post.html`,
    `---
layout: default
---
<article>
  <header>
    <h1>{{ page.title }}</h1>
    <time datetime="{{ page.date | date_to_xmlschema }}">
      {{ page.date | date: "%B %d, %Y" }}
    </time>
  </header>
  {{ content }}
</article>
`
  );

  // Home layout - for homepage
  await writeFile(
    `${layoutsDir}/home.html`,
    `---
layout: default
---
{{ content }}

{% if site.posts.size > 0 %}
<section>
  <h2>Recent Posts</h2>
  <ul>
    {% for post in site.posts limit:10 %}
    <li>
      <a href="{{ post.url | relative_url }}">{{ post.title }}</a>
      <time datetime="{{ post.date | date_to_xmlschema }}">
        {{ post.date | date: "%B %d, %Y" }}
      </time>
    </li>
    {% endfor %}
  </ul>
</section>
{% endif %}
`
  );
}

/**
 * Gets the relative path from a base path to a target path.
 */
function getRelativePath(basePath: string, targetPath: string): string {
  if (targetPath.startsWith(basePath)) {
    return targetPath.substring(basePath.length).replace(/^\//, "");
  }
  if (!targetPath.startsWith("/")) {
    return targetPath;
  }
  return targetPath;
}
