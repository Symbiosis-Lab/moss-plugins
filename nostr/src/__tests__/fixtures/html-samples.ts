/**
 * Test fixtures for HTML samples
 *
 * Sample HTML content used for testing the enhance hook's injection logic.
 */

// Basic article page with standard structure
export const basicArticlePage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hello World</title>
</head>
<body>
  <header>
    <nav>Navigation here</nav>
  </header>
  <main>
    <article>
      <h1>Hello World</h1>
      <p>This is the article content.</p>
      <p>More content here.</p>
    </article>
  </main>
  <footer>Footer content</footer>
</body>
</html>`;

// Article page with existing scripts
export const articleWithScripts = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Article with Scripts</title>
  <script src="/js/analytics.js"></script>
</head>
<body>
  <article>
    <h1>Article with Existing Scripts</h1>
    <p>Content here.</p>
  </article>
  <script src="/js/main.js"></script>
</body>
</html>`;

// Page without article tag (should be skipped)
export const pageWithoutArticle = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>About Page</title>
</head>
<body>
  <main>
    <div class="about">
      <h1>About Us</h1>
      <p>This is the about page content.</p>
    </div>
  </main>
</body>
</html>`;

// Minimal article (edge case)
export const minimalArticle = `<html><body><article><h1>Minimal</h1></article></body></html>`;

// Article with nested article tags
export const nestedArticles = `<!DOCTYPE html>
<html>
<body>
  <article class="main">
    <h1>Main Article</h1>
    <p>Content here.</p>
    <aside>
      <article class="related">
        <h2>Related Post</h2>
        <p>Related content.</p>
      </article>
    </aside>
  </article>
</body>
</html>`;

// Article with complex structure
export const complexArticle = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Complex Article</title>
  <link rel="stylesheet" href="/css/main.css">
  <script type="application/ld+json">{"@context":"https://schema.org"}</script>
</head>
<body class="dark-mode">
  <header>
    <nav aria-label="Main navigation">
      <ul>
        <li><a href="/">Home</a></li>
        <li><a href="/about">About</a></li>
      </ul>
    </nav>
  </header>
  <main id="content">
    <article itemscope itemtype="https://schema.org/BlogPosting">
      <header>
        <h1 itemprop="headline">Complex Article Title</h1>
        <time datetime="2024-01-15" itemprop="datePublished">January 15, 2024</time>
        <address itemprop="author">By Test Author</address>
      </header>
      <div itemprop="articleBody">
        <p>First paragraph of content.</p>
        <figure>
          <img src="/images/example.jpg" alt="Example image">
          <figcaption>An example image</figcaption>
        </figure>
        <p>Second paragraph with <strong>bold</strong> and <em>italic</em> text.</p>
        <blockquote>
          <p>A quoted passage from another source.</p>
        </blockquote>
        <pre><code>console.log('Code example');</code></pre>
      </div>
      <footer>
        <p>Tags: <a href="/tag/test">test</a>, <a href="/tag/example">example</a></p>
      </footer>
    </article>
  </main>
  <aside>
    <h2>Related Posts</h2>
    <ul>
      <li><a href="/post-1">Post 1</a></li>
      <li><a href="/post-2">Post 2</a></li>
    </ul>
  </aside>
  <footer>
    <p>&copy; 2024 Test Site</p>
  </footer>
  <script src="/js/main.js" defer></script>
</body>
</html>`;

// Expected injection markers for assertions
export const expectedInteractionSection = 'id="nostr-interactions"';
export const expectedInteractionClass = 'class="social-interactions"';
export const expectedDataScript = 'id="interactions-data"';
export const expectedNoscript = "<noscript>";
export const expectedLoaderScript = "nostr-social.js";

// Helper to check if HTML contains interaction injection
export function hasInteractionInjection(html: string): boolean {
  return (
    html.includes(expectedInteractionSection) &&
    html.includes(expectedDataScript) &&
    html.includes(expectedNoscript)
  );
}

// Helper to extract interaction data from injected HTML
export function extractInteractionData(
  html: string
): { interactions: unknown[]; config: unknown } | null {
  const match = html.match(
    /<script[^>]*id="interactions-data"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

// Helper to verify loader script placement
export function hasLoaderBeforeBodyEnd(html: string): boolean {
  const loaderIndex = html.indexOf(expectedLoaderScript);
  const bodyEndIndex = html.lastIndexOf("</body>");
  return loaderIndex !== -1 && bodyEndIndex !== -1 && loaderIndex < bodyEndIndex;
}

// Sample interaction for testing XSS escaping
export const xssAttemptContent = '<script>alert("xss")</script>';
export const xssEscapedContent = '&lt;script&gt;alert("xss")&lt;/script&gt;';
