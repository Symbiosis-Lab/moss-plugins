/**
 * Pull notes from Xiaohongshu to local files.
 *
 * Uses DOM scraping of the creator profile and individual note pages
 * since Xiaohongshu has no public API. Notes are image-first, so the
 * converter preserves images prominently in the markdown output.
 */

import { writeFile, fileExists, reportProgress } from "@symbiosis-lab/moss-api";
import { fetchNoteList, fetchNote, noteUrl } from "./api";
import { htmlToMarkdown, generateFrontmatter, extractHashtags } from "./converter";
import { loadSyncMap, saveSyncMap, needsSync, markSynced } from "./sync";
import type { XhsNote } from "./types";

/**
 * Pull all notes from Xiaohongshu and sync to local markdown files.
 * Returns the number of new/updated notes synced.
 */
export async function pullNotes(contentDir: string): Promise<number> {
  await reportProgress("pull", 0, 100, "Fetching note list from Xiaohongshu...");

  // Fetch note list from profile page
  const notes = await fetchNoteList();
  if (notes.length === 0) {
    await reportProgress("pull", 100, 100, "No notes found on Xiaohongshu");
    return 0;
  }

  await reportProgress("pull", 10, 100, `Found ${notes.length} notes`);

  // Load sync state
  const syncMap = await loadSyncMap();
  let synced = 0;

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const progress = 10 + Math.round((i / notes.length) * 80);

    // Check if this note needs syncing
    if (!needsSync(syncMap, note.id, note.publish_date)) {
      continue;
    }

    await reportProgress(
      "pull",
      progress,
      100,
      `Syncing: ${note.title || note.id}`
    );

    // Fetch full note content
    const fullNote = await fetchNote(note.url);

    // Build markdown content
    // Images come first (Xiaohongshu is image-first)
    // Always emit canonical `![alt](src)` markdown, never raw <img>
    // (unified-image-emission Decision #9).
    let markdown = "";
    for (const img of fullNote.images) {
      markdown += `![](${img})\n\n`;
    }
    if (fullNote.text) {
      markdown += fullNote.text + "\n";
    }

    // Build frontmatter
    const frontmatter = generateFrontmatter({
      title: fullNote.title || "Untitled",
      date: fullNote.publish_date?.split("T")[0] || new Date().toISOString().split("T")[0],
      tags: fullNote.tags.length > 0 ? fullNote.tags : undefined,
      images: fullNote.images.length > 0 ? fullNote.images : undefined,
      xiaohongshu_url: fullNote.url,
    });

    // Write to local file
    const slug = slugify(fullNote.title || fullNote.id);
    const localPath = `${contentDir}/${slug}.md`;
    const content = frontmatter + "\n" + markdown;
    await writeFile(localPath, content);

    // Update sync state
    markSynced(syncMap, fullNote.id, localPath, fullNote.url);
    synced++;
  }

  // Save sync state
  await saveSyncMap(syncMap);

  await reportProgress(
    "pull",
    100,
    100,
    synced > 0 ? `Synced ${synced} notes from Xiaohongshu` : "All notes up to date"
  );

  return synced;
}

/**
 * Slugify a title for use as a file name.
 * Handles Chinese characters by keeping them as-is.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
