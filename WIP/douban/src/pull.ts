/**
 * Pull book/movie ratings and reviews from Douban.
 *
 * Douban has no public API — pull uses DOM scraping via fetchUrl
 * on the user's public collection pages:
 *   https://book.douban.com/people/{user_id}/collect
 *   https://movie.douban.com/people/{user_id}/collect
 *
 * Each page shows ~15 items. Pagination via ?start=N.
 */

import { fetchUrl, writeFile, reportProgress } from "@symbiosis-lab/moss-api";
import { parseStarRating, parseCollectionDate, itemToMarkdown } from "./converter";
import { loadSyncMap, saveSyncMap, needsSync, markSynced } from "./sync";
import type { DoubanItem } from "./types";

/**
 * Parse a Douban collection page HTML into structured items.
 * Works for both book and movie collection pages.
 */
export function parseCollectionPage(
  html: string,
  mediaType: "book" | "movie"
): DoubanItem[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const items: DoubanItem[] = [];
  const subjectItems = doc.querySelectorAll(".subject-item");

  for (const el of subjectItems) {
    const linkEl = el.querySelector("h2 a, .title a") as HTMLAnchorElement | null;
    if (!linkEl) continue;

    const url = linkEl.href || "";
    const subjectId = url.match(/subject\/(\d+)/)?.[1] || "";
    const title = linkEl.textContent?.replace(/\s+/g, " ").trim() || "";

    // Star rating from class like "allstar40"
    const ratingEl = el.querySelector("[class*='allstar']");
    const rating = ratingEl ? parseStarRating(ratingEl.className) : 0;

    // Date and status
    const dateEl = el.querySelector(".date");
    const dateText = dateEl?.textContent || "";
    const { date, status } = parseCollectionDate(dateText);

    // Short comment
    const commentEl = el.querySelector(".comment");
    const comment = commentEl?.textContent?.trim() || "";

    // Tags
    const tagEls = el.querySelectorAll(".tags a, .tag");
    const tags = Array.from(tagEls).map((t) => t.textContent?.trim() || "").filter(Boolean);

    items.push({
      url,
      subjectId,
      title,
      mediaType,
      rating,
      date,
      status: status as DoubanItem["status"],
      comment,
      tags,
    });
  }

  return items;
}

/**
 * Check if there are more pages in the collection.
 */
export function hasNextPage(html: string): boolean {
  return html.includes('class="next"') && !html.includes('class="next"><span');
}

/**
 * Pull all items from a Douban collection (books or movies).
 */
export async function pullCollection(
  userId: string,
  mediaType: "book" | "movie",
  contentDir: string
): Promise<number> {
  const baseUrl =
    mediaType === "book"
      ? `https://book.douban.com/people/${userId}/collect`
      : `https://movie.douban.com/people/${userId}/collect`;

  const syncMap = await loadSyncMap();
  let synced = 0;
  let start = 0;
  const pageSize = 15;

  while (true) {
    const url = start === 0 ? baseUrl : `${baseUrl}?start=${start}`;
    await reportProgress(
      "pull",
      0,
      100,
      `Fetching ${mediaType} collection page (offset ${start})...`
    );

    const html = await fetchUrl(url);
    const items = parseCollectionPage(html, mediaType);

    if (items.length === 0) break;

    for (const item of items) {
      if (!item.subjectId) continue;
      if (!needsSync(syncMap, item.subjectId, item.date)) continue;

      // Generate markdown and write file
      const slug = item.subjectId;
      const localPath = `${contentDir}/${mediaType}/${slug}.md`;
      const content = itemToMarkdown(item);
      await writeFile(localPath, content);

      markSynced(syncMap, item.subjectId, localPath, item.url);
      synced++;
    }

    if (!hasNextPage(html)) break;
    start += pageSize;
  }

  await saveSyncMap(syncMap);
  return synced;
}
