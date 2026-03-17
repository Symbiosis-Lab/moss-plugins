/**
 * HTML rendering for review colophon
 */

import { sourceDisplayName } from "./sources";
import type { ReviewSocialEntry } from "./types";

/**
 * Convert a 1-5 rating to star characters.
 * Full star: ★, Half star: ✦, Empty star: ☆
 */
export function renderStars(rating: number | null): string {
  if (rating === null) return "";

  const stars: string[] = [];
  for (let i = 1; i <= 5; i++) {
    if (rating >= i) stars.push("★");
    else if (rating >= i - 0.5) stars.push("✦");
    else stars.push("☆");
  }
  return stars.join("");
}

/**
 * Resolve a cover path to a root-relative src attribute.
 * Local paths get "/" prepended (matching PathResolver.resolve_url() pattern).
 * External URLs pass through unchanged.
 */
function resolveCoverSrc(coverUrl: string): string {
  if (coverUrl.startsWith("http://") || coverUrl.startsWith("https://")) {
    return coverUrl;
  }
  return "/" + coverUrl.replace(/^\//, "");
}

/**
 * Render the colophon: card with cover, title, subtitle, metadata, rating, and links.
 * Injected after the article title.
 *
 * @param coverUrl - Cover image path from article-map frontmatter (source of truth)
 */
export function renderColophon(entry: ReviewSocialEntry, coverUrl: string | null): string {
  // Details column
  const details: string[] = [];

  // Title
  details.push(`<div class="review-colophon-title">${escapeHtml(entry.title)}</div>`);

  // Subtitle
  if (entry.subtitle) {
    details.push(`<div class="review-colophon-subtitle">${escapeHtml(entry.subtitle)}</div>`);
  }

  // Creator + year line
  const identityParts: string[] = [];
  if (entry.creator.length > 0) identityParts.push(escapeHtml(entry.creator.join(", ")));
  if (entry.year !== null) identityParts.push(String(entry.year));
  if (identityParts.length > 0) {
    details.push(`<div class="review-colophon-identity">${identityParts.join(" · ")}</div>`);
  }

  // Bibliographic details (publisher, pages, ISBN)
  const biblioParts: string[] = [];
  if (entry.publisher) biblioParts.push(escapeHtml(entry.publisher));
  if (entry.pages !== null) biblioParts.push(`${entry.pages} pages`);

  const hasBiblio = biblioParts.length > 0;
  const hasIsbn = !!entry.isbn;

  if (hasBiblio || hasIsbn) {
    let biblioHtml = "";
    if (hasBiblio) biblioHtml += biblioParts.join(" · ");
    if (hasIsbn) {
      if (hasBiblio) biblioHtml += " · ";
      biblioHtml += `ISBN ${escapeHtml(entry.isbn!)}`;
    }
    details.push(`<div class="review-biblio">${biblioHtml}</div>`);
  }

  // Writer's rating stars
  const stars = renderStars(entry.writer_rating);
  if (stars) {
    details.push(`<div class="review-rating">${stars}</div>`);
  }

  // Community rating (1-10 scale)
  if (entry.community_rating !== null && entry.community_rating_count > 0) {
    const sourceName = entry.source ? sourceDisplayName(entry.source) : "NeoDB";
    details.push(
      `<div class="review-community-rating">${sourceName} ${entry.community_rating.toFixed(1)}/10 · ${entry.community_rating_count} ratings</div>`
    );
  }

  // Outbound links
  const links: string[] = [];
  const urls = entry.external_urls;

  if (urls.douban) links.push(`<a href="${escapeAttr(urls.douban)}" target="_blank" rel="noopener">Douban</a>`);
  if (urls.neodb) links.push(`<a href="${escapeAttr(urls.neodb)}" target="_blank" rel="noopener">NeoDB</a>`);
  if (urls.goodreads) links.push(`<a href="${escapeAttr(urls.goodreads)}" target="_blank" rel="noopener">Goodreads</a>`);
  if (urls.openlibrary) links.push(`<a href="${escapeAttr(urls.openlibrary)}" target="_blank" rel="noopener">Open Library</a>`);
  if (urls.imdb) links.push(`<a href="${escapeAttr(urls.imdb)}" target="_blank" rel="noopener">IMDB</a>`);
  if (urls.tmdb) links.push(`<a href="${escapeAttr(urls.tmdb)}" target="_blank" rel="noopener">TMDB</a>`);

  if (links.length > 0) {
    details.push(`<nav class="review-links">${links.join('<span class="review-sep"> · </span>')}</nav>`);
  }

  // Assemble card
  const cardParts: string[] = [];

  if (coverUrl) {
    const coverSrc = resolveCoverSrc(coverUrl);
    cardParts.push(
      `<img class="review-colophon-cover" src="${escapeAttr(coverSrc)}" alt="${escapeAttr(entry.title)}" loading="lazy">`
    );
  }

  cardParts.push(`<div class="review-colophon-details">\n    ${details.join("\n    ")}\n  </div>`);

  return `<footer class="review-colophon">\n  ${cardParts.join("\n  ")}\n</footer>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
