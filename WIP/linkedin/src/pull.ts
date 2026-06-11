/**
 * Pull articles from LinkedIn to local files.
 *
 * Uses DOM scraping via fetchUrl since LinkedIn has no public article API.
 * Fetches the article list from the profile page, then scrapes each article.
 */

import { writeFile, fileExists, reportProgress } from "@symbiosis-lab/moss-api";
import { fetchArticleList, fetchArticle } from "./api";
import { htmlToMarkdown, generateFrontmatter } from "./converter";
import { loadSyncMap, saveSyncMap, needsSync, markSynced } from "./sync";
import type { LinkedInArticle } from "./types";

/**
 * Pull all published articles from LinkedIn and sync to local markdown files.
 * Returns the number of new/updated articles synced.
 */
export async function pullArticles(contentDir: string): Promise<number> {
  await reportProgress("pull", 0, 100, "Fetching article list from LinkedIn...");

  // Fetch article list from profile
  const articles = await fetchArticleList();
  if (articles.length === 0) {
    await reportProgress("pull", 100, 100, "No articles found on LinkedIn");
    return 0;
  }

  await reportProgress("pull", 10, 100, `Found ${articles.length} articles`);

  // Load sync state
  const syncMap = await loadSyncMap();
  let synced = 0;

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    const slug = slugify(article.title);
    const progress = 10 + Math.round((i / articles.length) * 80);

    // Check if this article needs syncing
    if (!needsSync(syncMap, slug, article.date)) {
      continue;
    }

    await reportProgress(
      "pull",
      progress,
      100,
      `Syncing: ${article.title}`
    );

    // Fetch full article with body HTML
    const fullArticle = await fetchArticle(article.url);

    if (!fullArticle.body_html) {
      continue;
    }

    // Convert HTML to markdown
    const markdown = htmlToMarkdown(fullArticle.body_html);

    // Build frontmatter
    const frontmatter = generateFrontmatter({
      title: fullArticle.title,
      date: fullArticle.date?.split("T")[0] || "",
      linkedin_url: fullArticle.url,
      author: fullArticle.author,
    });

    // Write to local file
    const localPath = `${contentDir}/${slug}.md`;
    const content = frontmatter + "\n" + markdown;
    await writeFile(localPath, content);

    // Update sync state
    markSynced(syncMap, slug, localPath, fullArticle.url);
    synced++;
  }

  // Save sync state
  await saveSyncMap(syncMap);

  await reportProgress(
    "pull",
    100,
    100,
    synced > 0 ? `Synced ${synced} articles from LinkedIn` : "All articles up to date"
  );

  return synced;
}

/**
 * Slugify a title for use as a file name.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
