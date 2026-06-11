/**
 * Xiaohongshu API client.
 *
 * Xiaohongshu has no public API. Data is fetched by scraping the creator
 * dashboard and individual note pages via DOM parsing.
 *
 * Authentication is via cookies set on .xiaohongshu.com (session-based).
 */

import { fetchUrl } from "@symbiosis-lab/moss-api";
import type { XhsNote } from "./types";

let profileUrl = "";

/**
 * Initialize the API with a profile URL.
 */
export function initApi(url: string): void {
  profileUrl = url.replace(/\/$/, "");
}

/**
 * Get the configured profile URL.
 */
export function getProfileUrl(): string {
  return profileUrl;
}

/**
 * Extract the user ID from the profile URL.
 * Profile URLs look like: https://www.xiaohongshu.com/user/profile/5a1234567890abcdef
 */
export function getUserId(): string {
  const match = profileUrl.match(/\/user\/profile\/([a-f0-9]+)/);
  if (!match) throw new Error(`Invalid profile URL: ${profileUrl}`);
  return match[1];
}

/**
 * Fetch the note list from a user's profile page.
 * Scrapes the profile page HTML and extracts note metadata.
 *
 * Returns basic note info (id, title, cover). Full content requires fetchNote().
 */
export async function fetchNoteList(url?: string): Promise<XhsNote[]> {
  const targetUrl = url || profileUrl;
  if (!targetUrl) throw new Error("Profile URL not configured");

  const html = await fetchUrl(targetUrl);
  return parseNoteList(html);
}

/**
 * Parse a profile page HTML to extract note metadata.
 */
function parseNoteList(html: string): XhsNote[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const notes: XhsNote[] = [];

  // Xiaohongshu profile pages embed note data in a script tag as JSON
  // Look for window.__INITIAL_STATE__ or similar data injection
  const scripts = doc.querySelectorAll("script");
  for (const script of scripts) {
    const text = script.textContent || "";
    const stateMatch = text.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*(?:<\/script>|$)/);
    if (stateMatch) {
      try {
        const state = JSON.parse(stateMatch[1]);
        const noteList = state?.user?.notes || state?.note?.noteList || [];
        for (const item of noteList) {
          notes.push({
            id: item.id || item.noteId || "",
            title: item.title || item.displayTitle || "",
            text: "",
            images: [],
            tags: [],
            url: `https://www.xiaohongshu.com/explore/${item.id || item.noteId}`,
            publish_date: item.time || item.publishTime || "",
            likes: item.likes || item.likedCount || 0,
            collects: item.collects || item.collectedCount || 0,
            cover_image: item.cover?.url || item.coverUrl || "",
          });
        }
      } catch {
        // JSON parse failed, continue to next script
      }
    }
  }

  // Fallback: scrape note cards from DOM
  if (notes.length === 0) {
    doc.querySelectorAll('section.note-item, [data-note-id], a[href*="/explore/"]').forEach((el) => {
      const link = el.closest("a") || el.querySelector("a");
      const href = link?.getAttribute("href") || "";
      const noteIdMatch = href.match(/\/explore\/([a-f0-9]+)/);
      if (!noteIdMatch) return;

      const title = el.querySelector(".title, .note-title, h3")?.textContent?.trim() || "";
      const cover = el.querySelector("img")?.getAttribute("src") || "";

      notes.push({
        id: noteIdMatch[1],
        title,
        text: "",
        images: cover ? [cover] : [],
        tags: [],
        url: `https://www.xiaohongshu.com/explore/${noteIdMatch[1]}`,
        publish_date: "",
        cover_image: cover,
      });
    });
  }

  return notes;
}

/**
 * Fetch a single note's full content by URL.
 * Scrapes the note page and extracts text, images, and tags.
 */
export async function fetchNote(noteUrl: string): Promise<XhsNote> {
  const html = await fetchUrl(noteUrl);
  return parseNote(html, noteUrl);
}

/**
 * Parse a note page HTML to extract full content.
 */
function parseNote(html: string, noteUrl: string): XhsNote {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Extract note ID from URL
  const noteIdMatch = noteUrl.match(/\/explore\/([a-f0-9]+)/);
  const noteId = noteIdMatch?.[1] || "";

  // Try to extract from embedded state first
  let note: Partial<XhsNote> = {};
  const scripts = doc.querySelectorAll("script");
  for (const script of scripts) {
    const text = script.textContent || "";
    const stateMatch = text.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*(?:<\/script>|$)/);
    if (stateMatch) {
      try {
        const state = JSON.parse(stateMatch[1]);
        const noteData = state?.note?.noteDetailMap?.[noteId]?.note || state?.note?.note || {};
        note = {
          title: noteData.title || "",
          text: noteData.desc || "",
          images: (noteData.imageList || []).map((img: { url: string }) => img.url),
          tags: (noteData.tagList || []).map((t: { name: string }) => t.name),
          publish_date: noteData.time || "",
          likes: noteData.likedCount || 0,
          collects: noteData.collectedCount || 0,
          comments: noteData.commentsCount || 0,
        };
      } catch {
        // Continue to DOM scraping
      }
    }
  }

  // Fallback: scrape from DOM
  if (!note.title) {
    note.title = doc.querySelector("#detail-title, .title, .note-title")?.textContent?.trim() || "";
  }

  if (!note.text) {
    const descEl = doc.querySelector("#detail-desc, .desc, .note-text, .content");
    note.text = descEl?.textContent?.trim() || "";
  }

  if (!note.images || note.images.length === 0) {
    const imgs: string[] = [];
    doc.querySelectorAll(".note-image img, .carousel img, .slider img, .swiper-slide img").forEach((img) => {
      const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
      if (src && !imgs.includes(src)) {
        imgs.push(src);
      }
    });
    note.images = imgs;
  }

  if (!note.tags || note.tags.length === 0) {
    const tags: string[] = [];
    doc.querySelectorAll('a[href*="/page/topics/"], .tag, [data-type="hashtag"]').forEach((el) => {
      const text = el.textContent?.replace(/^#\s*/, "").trim();
      if (text && !tags.includes(text)) {
        tags.push(text);
      }
    });
    note.tags = tags;
  }

  return {
    id: noteId,
    title: note.title || "",
    text: note.text || "",
    images: note.images || [],
    tags: note.tags || [],
    url: noteUrl,
    publish_date: note.publish_date || "",
    likes: note.likes,
    collects: note.collects,
    comments: note.comments,
    cover_image: note.images?.[0] || "",
  };
}

/**
 * Build the public URL for a note.
 */
export function noteUrl(noteId: string): string {
  return `https://www.xiaohongshu.com/explore/${noteId}`;
}
