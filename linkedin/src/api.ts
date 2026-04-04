/**
 * LinkedIn article fetching.
 *
 * LinkedIn has no public API for articles. We use DOM scraping via fetchUrl
 * to pull article content from public LinkedIn article pages.
 *
 * Authentication is via the `li_at` cookie on `.linkedin.com`.
 */

import { fetchUrl } from "@symbiosis-lab/moss-api";
import type { LinkedInArticle } from "./types";

let profileUrl = "";

/**
 * Initialize the API with a profile URL.
 */
export function initApi(url: string): void {
  // Normalize: remove trailing slash
  profileUrl = url.replace(/\/$/, "");
}

/**
 * Get the configured profile URL.
 */
export function getProfileUrl(): string {
  return profileUrl;
}

/**
 * Fetch the list of articles from a LinkedIn profile's "recent activity" page.
 * Scrapes the profile's articles section for article links.
 *
 * @param url - The LinkedIn profile URL (e.g., "https://www.linkedin.com/in/username")
 * @returns Array of article metadata (without full body HTML)
 */
export async function fetchArticleList(
  url?: string
): Promise<LinkedInArticle[]> {
  const targetUrl = url || profileUrl;
  if (!targetUrl) throw new Error("Profile URL not configured");

  // LinkedIn articles are listed at /in/username/recent-activity/articles/
  const articlesPageUrl = `${targetUrl}/recent-activity/articles/`;
  const html = await fetchUrl(articlesPageUrl);

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const articles: LinkedInArticle[] = [];

  // LinkedIn renders article cards with links to the full article
  // The selector targets article link elements in the activity feed
  const articleLinks = doc.querySelectorAll(
    'a[href*="/pulse/"], a[href*="/articles/"]'
  );

  const seen = new Set<string>();
  for (const link of articleLinks) {
    const href = link.getAttribute("href");
    if (!href || seen.has(href)) continue;
    seen.add(href);

    const title =
      link.textContent?.trim() ||
      link.getAttribute("aria-label") ||
      "Untitled";

    articles.push({
      title,
      url: href.startsWith("http")
        ? href
        : `https://www.linkedin.com${href}`,
      author: "",
      date: "",
    });
  }

  return articles;
}

/**
 * Fetch a single LinkedIn article's full content by scraping the article page.
 *
 * @param articleUrl - The full URL to the LinkedIn article
 * @returns Article with body_html populated
 */
export async function fetchArticle(
  articleUrl: string
): Promise<LinkedInArticle> {
  const html = await fetchUrl(articleUrl);

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Extract article title
  const titleEl =
    doc.querySelector("h1") ||
    doc.querySelector('[data-test-id="article-title"]');
  const title = titleEl?.textContent?.trim() || "Untitled";

  // Extract author name
  const authorEl =
    doc.querySelector('[data-test-id="author-name"]') ||
    doc.querySelector(".author-info__name") ||
    doc.querySelector(".article-author__name");
  const author = authorEl?.textContent?.trim() || "";

  // Extract publication date
  const dateEl =
    doc.querySelector("time") ||
    doc.querySelector('[data-test-id="published-date"]') ||
    doc.querySelector(".article-date");
  const date =
    dateEl?.getAttribute("datetime") || dateEl?.textContent?.trim() || "";

  // Extract cover image
  const coverImg = doc.querySelector(
    ".article-cover-image img, .article-hero img"
  );
  const cover_image = coverImg?.getAttribute("src") || undefined;

  // Extract article body HTML
  // LinkedIn articles wrap content in a section or div with article body class
  const bodyEl =
    doc.querySelector(".article-body") ||
    doc.querySelector('[data-test-id="article-content"]') ||
    doc.querySelector("article .body") ||
    doc.querySelector("article");
  const body_html = bodyEl?.innerHTML || "";

  return {
    title,
    url: articleUrl,
    author,
    date,
    body_html,
    cover_image,
  };
}
