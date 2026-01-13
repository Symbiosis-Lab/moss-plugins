/**
 * Tests for SSG-aware widget injection
 *
 * Following TDD: Write test first, watch it fail, implement minimal code.
 */

import { describe, test, expect } from "vitest";
import { findInsertionPoint, injectWidget, detectSSG } from "../inject";

// Sample HTML from different SSGs
const hugoHtml = `
<!DOCTYPE html>
<html>
<head><title>Hugo Blog</title></head>
<body>
<main>
  <article class="post">
    <h1>My Post</h1>
    <div class="post-content">
      <p>Content here...</p>
    </div>
  </article>
</main>
</body>
</html>
`;

const hexoHtml = `
<!DOCTYPE html>
<html>
<head><title>Hexo Blog</title></head>
<body>
<div id="container">
  <article id="post">
    <div class="post-body">
      <p>Content here...</p>
    </div>
  </article>
</div>
</body>
</html>
`;

const astroHtml = `
<!DOCTYPE html>
<html>
<head><title>Astro Blog</title></head>
<body>
<main>
  <article>
    <h1>My Post</h1>
    <p>Content here...</p>
  </article>
</main>
</body>
</html>
`;

const noArticleHtml = `
<!DOCTYPE html>
<html>
<head><title>Custom Blog</title></head>
<body>
<main>
  <div class="post-content">
    <p>Content here...</p>
  </div>
</main>
</body>
</html>
`;

const minimalHtml = `
<!DOCTYPE html>
<html>
<body>
<p>Just some content</p>
</body>
</html>
`;

describe("findInsertionPoint", () => {
  test("finds </article> tag in Hugo HTML", () => {
    const point = findInsertionPoint(hugoHtml);
    const before = hugoHtml.slice(point - 20, point);
    expect(before).toContain("</div>");
    expect(hugoHtml.slice(point, point + 10)).toBe("</article>");
  });

  test("finds </article> tag in Hexo HTML", () => {
    const point = findInsertionPoint(hexoHtml);
    expect(hexoHtml.slice(point, point + 10)).toBe("</article>");
  });

  test("finds </article> tag in Astro HTML", () => {
    const point = findInsertionPoint(astroHtml);
    expect(astroHtml.slice(point, point + 10)).toBe("</article>");
  });

  test("falls back to </main> when no </article>", () => {
    const point = findInsertionPoint(noArticleHtml);
    expect(noArticleHtml.slice(point, point + 7)).toBe("</main>");
  });

  test("falls back to </body> as last resort", () => {
    const point = findInsertionPoint(minimalHtml);
    expect(minimalHtml.slice(point, point + 7)).toBe("</body>");
  });

  test("returns end of string if no tags found", () => {
    const html = "<p>No closing tags</p>";
    const point = findInsertionPoint(html);
    expect(point).toBe(html.length);
  });
});

describe("injectWidget", () => {
  const widgetHtml = '<section id="moss-comments">Comments</section>';
  const loaderScript = '<script src="/js/moss-comments.js"></script>';

  test("injects widget before </article>", () => {
    const result = injectWidget(astroHtml, widgetHtml, loaderScript);

    // Widget should be before </article> (may have data-preserve-scroll added)
    const widgetIndex = result.indexOf('id="moss-comments"');
    const articleEndIndex = result.indexOf("</article>");
    expect(widgetIndex).toBeLessThan(articleEndIndex);
    expect(widgetIndex).toBeGreaterThan(0);
  });

  test("injects loader script before </body>", () => {
    const result = injectWidget(astroHtml, widgetHtml, loaderScript);

    // Loader should be before </body>
    const loaderIndex = result.indexOf(loaderScript);
    const bodyEndIndex = result.indexOf("</body>");
    expect(loaderIndex).toBeLessThan(bodyEndIndex);
    expect(loaderIndex).toBeGreaterThan(0);
  });

  test("preserves original HTML structure", () => {
    const result = injectWidget(astroHtml, widgetHtml, loaderScript);

    // Original content should still be there
    expect(result).toContain("<h1>My Post</h1>");
    expect(result).toContain("<p>Content here...</p>");
    expect(result).toContain("</html>");
  });

  test("handles HTML without </body>", () => {
    const htmlNoBody = "<article><p>Content</p></article>";
    const result = injectWidget(htmlNoBody, widgetHtml, loaderScript);

    // Widget should be injected (with data-preserve-scroll added), loader appended at end
    expect(result).toContain('id="moss-comments"');
    expect(result).toContain("Comments</section>");
    expect(result).toContain(loaderScript);
  });

  test("adds data-preserve-scroll attribute", () => {
    const result = injectWidget(astroHtml, widgetHtml, loaderScript);
    expect(result).toContain('data-preserve-scroll="true"');
  });
});

describe("detectSSG", () => {
  test("detects Hugo from generator meta tag", () => {
    const html = '<meta name="generator" content="Hugo 0.123.0">';
    expect(detectSSG(html)).toBe("hugo");
  });

  test("detects Hexo from generator meta tag", () => {
    const html = '<meta name="generator" content="Hexo">';
    expect(detectSSG(html)).toBe("hexo");
  });

  test("detects Astro from data-astro attributes", () => {
    const html = '<html data-astro-cid-123="true">';
    expect(detectSSG(html)).toBe("astro");
  });

  test("detects Jekyll from comments", () => {
    const html = '<!-- Built with Jekyll -->';
    expect(detectSSG(html)).toBe("jekyll");
  });

  test("detects Zola from generator", () => {
    const html = '<meta name="generator" content="Zola">';
    expect(detectSSG(html)).toBe("zola");
  });

  test("detects 11ty from generator", () => {
    const html = '<meta name="generator" content="Eleventy">';
    expect(detectSSG(html)).toBe("11ty");
  });

  test("returns unknown for unrecognized HTML", () => {
    const html = "<html><body>Generic</body></html>";
    expect(detectSSG(html)).toBe("unknown");
  });

  test("is case insensitive", () => {
    const html = '<meta name="generator" content="HUGO">';
    expect(detectSSG(html)).toBe("hugo");
  });
});
