/**
 * Pull articles from Substack to local files.
 *
 * Uses the Substack REST API (/api/v1/posts) rather than DOM scraping.
 * This is much more reliable and gives us structured data including body_html.
 */

import { writeFile, fileExists, reportProgress } from "@symbiosis-lab/moss-api";
import { fetchAllPosts, fetchPost, postUrl } from "./api";
import { htmlToMarkdown, generateFrontmatter } from "./converter";
import { loadSyncMap, saveSyncMap, needsSync, markSynced } from "./sync";
import type { SubstackPost } from "./types";

/**
 * Pull all published articles from Substack and sync to local markdown files.
 * Returns the number of new/updated articles synced.
 */
export async function pullArticles(contentDir: string): Promise<number> {
  await reportProgress("pull", 0, 100, "Fetching article list from Substack...");

  // Fetch all published posts
  const posts = await fetchAllPosts(100);
  if (posts.length === 0) {
    await reportProgress("pull", 100, 100, "No articles found on Substack");
    return 0;
  }

  await reportProgress("pull", 10, 100, `Found ${posts.length} articles`);

  // Load sync state
  const syncMap = await loadSyncMap();
  let synced = 0;

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const progress = 10 + Math.round((i / posts.length) * 80);

    // Check if this post needs syncing
    if (!needsSync(syncMap, post.id, post.post_date)) {
      continue;
    }

    await reportProgress(
      "pull",
      progress,
      100,
      `Syncing: ${post.title}`
    );

    // Fetch full post with body_html
    const fullPost = await fetchPost(post.id);

    if (!fullPost.body_html) {
      continue;
    }

    // Convert HTML to markdown
    const markdown = htmlToMarkdown(fullPost.body_html);

    // Build frontmatter
    const frontmatter = generateFrontmatter({
      title: fullPost.title,
      ...(fullPost.subtitle ? { subtitle: fullPost.subtitle } : {}),
      date: fullPost.post_date?.split("T")[0],
      substack_id: fullPost.id,
      substack_url: postUrl(fullPost.slug),
      audience: fullPost.audience,
    });

    // Write to local file
    const localPath = `${contentDir}/${fullPost.slug}.md`;
    const content = frontmatter + "\n" + markdown;
    await writeFile(localPath, content);

    // Update sync state
    markSynced(
      syncMap,
      fullPost.id,
      fullPost.slug,
      localPath,
      postUrl(fullPost.slug)
    );
    synced++;
  }

  // Save sync state
  await saveSyncMap(syncMap);

  await reportProgress(
    "pull",
    100,
    100,
    synced > 0 ? `Synced ${synced} articles from Substack` : "All articles up to date"
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
