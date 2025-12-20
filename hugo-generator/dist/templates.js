/**
 * Default Hugo Templates
 *
 * Provides minimal, semantic HTML templates for Hugo builds.
 * These templates are used when the user hasn't provided custom layouts.
 *
 * ## Template Hierarchy
 *
 * - `baseof.html` - Base template with HTML structure
 * - `single.html` - Individual content pages
 * - `list.html` - Section/collection list pages
 * - `index.html` - Homepage
 */
import { writeFile } from "@symbiosis-lab/moss-api";
/**
 * Base template - provides the HTML shell for all pages.
 *
 * Features:
 * - Responsive viewport meta tag
 * - UTF-8 encoding
 * - Dynamic title from page context
 * - Main block for content injection
 */
const BASEOF_HTML = `<!DOCTYPE html>
<html lang="{{ site.Language.Lang | default "en" }}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ .Title }}{{ with site.Title }} | {{ . }}{{ end }}</title>
  {{ with .Description }}<meta name="description" content="{{ . }}">{{ end }}
  {{ $styles := resources.Get "css/style.css" }}
  {{ with $styles }}<link rel="stylesheet" href="{{ .RelPermalink }}">{{ end }}
</head>
<body>
  {{ block "main" . }}{{ end }}
</body>
</html>
`;
/**
 * Single page template - for individual content items (posts, articles).
 *
 * Displays:
 * - Page title as h1
 * - Full content
 */
const SINGLE_HTML = `{{ define "main" }}
<article>
  <header>
    <h1>{{ .Title }}</h1>
    {{ with .Date }}<time datetime="{{ .Format "2006-01-02" }}">{{ .Format "January 2, 2006" }}</time>{{ end }}
  </header>
  <div class="content">
    {{ .Content }}
  </div>
</article>
{{ end }}
`;
/**
 * List page template - for section/collection pages.
 *
 * Displays:
 * - Section title
 * - Section content (from _index.md)
 * - List of child pages with links
 */
const LIST_HTML = `{{ define "main" }}
<section>
  <h1>{{ .Title }}</h1>
  {{ .Content }}
  {{ if .Pages }}
  <ul class="page-list">
    {{ range .Pages }}
    <li>
      <a href="{{ .RelPermalink }}">{{ .Title }}</a>
      {{ with .Summary }}<p>{{ . }}</p>{{ end }}
    </li>
    {{ end }}
  </ul>
  {{ end }}
</section>
{{ end }}
`;
/**
 * Homepage template - for the site root.
 *
 * Displays:
 * - Homepage content (from _index.md or index.md)
 */
const INDEX_HTML = `{{ define "main" }}
<main class="homepage">
  {{ .Content }}
</main>
{{ end }}
`;
/**
 * Creates default Hugo layouts in the runtime directory.
 *
 * These layouts provide a minimal but functional template set that works
 * with any content structure. Users can override by providing their own
 * layouts in the project.
 *
 * @param runtimeDir - Path to the plugin's .runtime directory
 * @param projectPath - Absolute path to the project folder
 */
export async function createDefaultLayouts(runtimeDir, projectPath) {
    // Calculate relative path from project root
    const runtimeRelative = getRelativePath(projectPath, runtimeDir);
    const layoutsDir = `${runtimeRelative}/layouts`;
    const defaultDir = `${layoutsDir}/_default`;
    // Write template files using moss-api
    await Promise.all([
        writeFile(projectPath, `${defaultDir}/baseof.html`, BASEOF_HTML),
        writeFile(projectPath, `${defaultDir}/single.html`, SINGLE_HTML),
        writeFile(projectPath, `${defaultDir}/list.html`, LIST_HTML),
        writeFile(projectPath, `${layoutsDir}/index.html`, INDEX_HTML),
    ]);
}
/**
 * Gets the relative path from a base path to a target path.
 */
function getRelativePath(basePath, targetPath) {
    if (targetPath.startsWith(basePath)) {
        return targetPath.substring(basePath.length).replace(/^\//, "");
    }
    if (!targetPath.startsWith("/")) {
        return targetPath;
    }
    return targetPath;
}
/**
 * Template content exports for testing.
 */
export const templates = {
    baseof: BASEOF_HTML,
    single: SINGLE_HTML,
    list: LIST_HTML,
    index: INDEX_HTML,
};
//# sourceMappingURL=templates.js.map