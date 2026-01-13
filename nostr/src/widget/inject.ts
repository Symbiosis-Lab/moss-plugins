/**
 * SSG-aware widget injection
 *
 * Handles finding the correct insertion point for the comment widget
 * across different static site generators.
 */

/**
 * Supported SSG types
 */
export type SSGType =
  | "hugo"
  | "hexo"
  | "astro"
  | "jekyll"
  | "zola"
  | "11ty"
  | "moss"
  | "unknown";

/**
 * Find the best insertion point for the comment widget
 *
 * Priority:
 * 1. Before </article> (most SSGs use semantic HTML)
 * 2. Before </main>
 * 3. Before </body>
 * 4. End of string
 *
 * @param html - HTML content to search
 * @returns Index where widget should be inserted
 */
export function findInsertionPoint(html: string): number {
  // Priority 1: Look for </article> tag (most reliable)
  const articleEnd = html.lastIndexOf("</article>");
  if (articleEnd !== -1) {
    return articleEnd;
  }

  // Priority 2: Look for </main> tag
  const mainEnd = html.lastIndexOf("</main>");
  if (mainEnd !== -1) {
    return mainEnd;
  }

  // Priority 3: Look for </body> tag
  const bodyEnd = html.lastIndexOf("</body>");
  if (bodyEnd !== -1) {
    return bodyEnd;
  }

  // Priority 4: End of string
  return html.length;
}

/**
 * Inject the comment widget into HTML
 *
 * @param html - Original HTML content
 * @param widgetHtml - Widget HTML to inject
 * @param loaderScript - Loader script to inject before </body>
 * @returns Modified HTML with widget injected
 */
export function injectWidget(
  html: string,
  widgetHtml: string,
  loaderScript: string
): string {
  // Add data-preserve-scroll attribute to widget
  const widgetWithAttr = widgetHtml.replace(
    /(<section[^>]*)(>)/,
    '$1 data-preserve-scroll="true"$2'
  );

  // Find insertion point for widget
  const insertionPoint = findInsertionPoint(html);

  // Insert widget at the insertion point
  let result = html.slice(0, insertionPoint) + widgetWithAttr + html.slice(insertionPoint);

  // Find </body> for loader script
  const bodyEnd = result.lastIndexOf("</body>");
  if (bodyEnd !== -1) {
    result = result.slice(0, bodyEnd) + loaderScript + result.slice(bodyEnd);
  } else {
    // No </body>, append at end
    result += loaderScript;
  }

  return result;
}

/**
 * Detect which SSG generated the HTML
 *
 * Uses heuristics like meta generator tags and HTML patterns.
 *
 * @param html - HTML content to analyze
 * @returns Detected SSG type
 */
export function detectSSG(html: string): SSGType {
  const lowerHtml = html.toLowerCase();

  // Check generator meta tag
  const generatorMatch = lowerHtml.match(
    /<meta\s+name=["']generator["']\s+content=["']([^"']+)["']/i
  );
  if (generatorMatch) {
    const generator = generatorMatch[1].toLowerCase();

    if (generator.includes("hugo")) return "hugo";
    if (generator.includes("hexo")) return "hexo";
    if (generator.includes("zola")) return "zola";
    if (generator.includes("eleventy") || generator.includes("11ty"))
      return "11ty";
    if (generator.includes("jekyll")) return "jekyll";
  }

  // Check for Astro data attributes
  if (lowerHtml.includes("data-astro-")) {
    return "astro";
  }

  // Check for Jekyll comments
  if (lowerHtml.includes("jekyll")) {
    return "jekyll";
  }

  return "unknown";
}
