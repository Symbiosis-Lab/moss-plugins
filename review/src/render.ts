/**
 * HTML rendering for review header and colophon
 */

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
 * Render the book header: cover image + creator + year.
 * Injected after <h1> in the article.
 */
export function renderHeader(entry: ReviewSocialEntry): string {
  const hasCreator = entry.creator.length > 0;
  const hasYear = entry.year !== null;

  // Nothing to show
  if (!hasCreator && !hasYear) return "";

  const parts: string[] = [];

  // Cover image
  if (entry.cover_url) {
    parts.push(
      `<img class="review-cover" src="${escapeAttr(entry.cover_url)}" alt="${escapeAttr(entry.title)}" loading="lazy" width="80">`
    );
  }

  // Meta line
  const metaParts: string[] = [];
  if (hasCreator) {
    metaParts.push(`<span class="review-creator">${escapeHtml(entry.creator.join(", "))}</span>`);
  }
  if (hasYear) {
    metaParts.push(`<span class="review-year">${entry.year}</span>`);
  }

  const metaHtml = metaParts.join('<span class="review-sep"> · </span>');
  parts.push(`<div class="review-meta">${metaHtml}</div>`);

  return `<div class="review-header">\n  ${parts.join("\n  ")}\n</div>`;
}

/**
 * Render the colophon: rating, bibliographic details, outbound links.
 * Injected before </article>.
 */
export function renderColophon(entry: ReviewSocialEntry): string {
  const sections: string[] = [];

  // Writer's rating stars
  const stars = renderStars(entry.writer_rating);
  if (stars) {
    sections.push(`<div class="review-rating">${stars}</div>`);
  }

  // NeoDB community rating (1-10 scale)
  if (entry.community_rating !== null && entry.community_rating_count > 0) {
    sections.push(
      `<div class="review-community-rating">NeoDB ${entry.community_rating.toFixed(1)}/10 · ${entry.community_rating_count} ratings</div>`
    );
  }

  // Bibliographic details
  const biblioParts: string[] = [];
  if (entry.publisher) biblioParts.push(escapeHtml(entry.publisher));
  if (entry.year !== null) biblioParts.push(String(entry.year));
  if (entry.pages !== null) biblioParts.push(`${entry.pages} pages`);

  const hasBiblio = biblioParts.length > 0;
  const hasIsbn = !!entry.isbn;

  if (hasBiblio || hasIsbn) {
    let biblioHtml = "";
    if (hasBiblio) biblioHtml += biblioParts.join(" · ");
    if (hasIsbn) {
      if (hasBiblio) biblioHtml += "<br>";
      biblioHtml += `ISBN ${escapeHtml(entry.isbn!)}`;
    }
    sections.push(`<div class="review-biblio">${biblioHtml}</div>`);
  }

  // Outbound links
  const links: string[] = [];
  const urls = entry.external_urls;

  // Ordered: Douban first (Chinese audience), then NeoDB, then Western sources
  if (urls.douban) links.push(`<a href="${escapeAttr(urls.douban)}" rel="noopener">Douban</a>`);
  links.push(`<a href="${escapeAttr(urls.neodb)}" rel="noopener">NeoDB</a>`);
  if (urls.goodreads) links.push(`<a href="${escapeAttr(urls.goodreads)}" rel="noopener">Goodreads</a>`);
  if (urls.openlibrary) links.push(`<a href="${escapeAttr(urls.openlibrary)}" rel="noopener">Open Library</a>`);
  if (urls.imdb) links.push(`<a href="${escapeAttr(urls.imdb)}" rel="noopener">IMDB</a>`);
  if (urls.tmdb) links.push(`<a href="${escapeAttr(urls.tmdb)}" rel="noopener">TMDB</a>`);

  sections.push(`<nav class="review-links">${links.join('<span class="review-sep"> · </span>')}</nav>`);

  return `<footer class="review-colophon">\n  ${sections.join("\n  ")}\n</footer>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
