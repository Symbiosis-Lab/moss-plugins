/**
 * Source detection for review URLs.
 *
 * Auto-detects the review source from the URL hostname. Supported sources:
 * - NeoDB: https://neodb.social/{category}/{id} (any NeoDB instance)
 * - Douban: https://book.douban.com/subject/{id}, https://movie.douban.com/subject/{id}
 * - TMDB: https://www.themoviedb.org/movie/{id}, /tv/{id}
 * - Goodreads: https://www.goodreads.com/book/show/{id}
 *
 * Design: VS Code-style `contributes.frontmatter` in plugin manifest declares
 * the `review_of` field. The plugin auto-detects source from the URL.
 * See docs/architecture/plugin-schema-contributions.md.
 */

export type ReviewSource = 'neodb' | 'douban' | 'tmdb' | 'goodreads';

/**
 * Detect which review source a URL belongs to by hostname matching.
 * Returns null for unrecognized URLs.
 */
export function detectSource(url: string): ReviewSource | null {
  try {
    const host = new URL(url).hostname;
    if (host.includes('neodb.social') || host.includes('neodb.')) return 'neodb';
    if (host.includes('douban.com')) return 'douban';
    if (host.includes('themoviedb.org') || host.includes('tmdb.org')) return 'tmdb';
    if (host.includes('goodreads.com')) return 'goodreads';
    return null;
  } catch {
    return null;
  }
}

/** Human-readable display name for a source. */
export function sourceDisplayName(source: ReviewSource): string {
  switch (source) {
    case 'neodb': return 'NeoDB';
    case 'douban': return 'Douban';
    case 'tmdb': return 'TMDB';
    case 'goodreads': return 'Goodreads';
  }
}
