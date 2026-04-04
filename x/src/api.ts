/**
 * X article fetching.
 *
 * X does not have a public API for long-form articles.
 * Pull uses DOM scraping of the profile and article pages.
 * Authentication is via the `auth_token` cookie on `.x.com`.
 */

import { fetchUrl } from "@symbiosis-lab/moss-api";
import type { XArticle } from "./types";

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
 * Fetch the list of articles from an X profile page via DOM scraping.
 * Returns article URLs and basic metadata extracted from the profile.
 *
 * X articles (long-form posts) are listed under the user's "Articles" tab.
 */
export async function fetchArticleList(
  url?: string
): Promise<Array<{ title: string; url: string; date: string }>> {
  const targetUrl = url || `${profileUrl}/articles`;
  if (!targetUrl) throw new Error("Profile URL not configured");

  const html = await fetchUrl(targetUrl);

  // Parse the HTML response to extract article links
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const articles: Array<{ title: string; url: string; date: string }> = [];

  // X article links follow the pattern: /username/status/{id} or /i/article/{id}
  // Look for article-like elements in the page
  const articleLinks = doc.querySelectorAll('a[href*="/status/"], a[href*="/article/"]');
  for (const link of articleLinks) {
    const href = link.getAttribute("href") || "";
    const fullUrl = href.startsWith("http") ? href : `https://x.com${href}`;

    // Extract title from the link text or parent context
    const title = link.textContent?.trim() || "";
    if (!title) continue;

    // Extract date from nearby time element
    const timeEl = link.closest("article")?.querySelector("time");
    const date = timeEl?.getAttribute("datetime") || "";

    articles.push({ title, url: fullUrl, date });
  }

  return articles;
}

/**
 * Fetch a single X article page and extract the article content.
 * Returns the article with body_html extracted from the DOM.
 */
export async function fetchArticle(articleUrl: string): Promise<XArticle> {
  const html = await fetchUrl(articleUrl);

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Extract article content from X's article page structure
  const articleEl =
    doc.querySelector('[data-testid="article-content"]') ||
    doc.querySelector("article") ||
    doc.querySelector('[role="article"]');

  const title =
    doc.querySelector("h1")?.textContent?.trim() ||
    doc.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
    "Untitled";

  const author =
    doc.querySelector('meta[name="author"]')?.getAttribute("content") ||
    doc.querySelector('[data-testid="User-Name"]')?.textContent?.trim() ||
    "";

  const dateStr =
    doc.querySelector("time")?.getAttribute("datetime") ||
    doc.querySelector('meta[property="article:published_time"]')?.getAttribute("content") ||
    "";

  const bodyHtml = articleEl?.innerHTML || "";

  return {
    title,
    url: articleUrl,
    date: dateStr,
    author,
    body_html: bodyHtml,
  };
}

/**
 * Extract the slug from an X article URL.
 */
export function articleSlug(url: string): string {
  // Extract a slug-like identifier from the URL
  const match = url.match(/\/status\/(\d+)/) || url.match(/\/article\/([^/?]+)/);
  return match?.[1] || slugify(url);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
