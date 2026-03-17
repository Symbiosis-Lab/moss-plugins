/**
 * Comment section HTML renderer
 *
 * Generates static HTML for the comment section:
 * - Collapsible details/summary with comment count
 * - Existing comments with threading (author name, date, text)
 * - Optional comment submission form (textarea + submit)
 */

import type { NormalizedComment } from "./types";
import { translations, type Lang } from "./i18n";
// ============================================================================
// SVG Icon (Lucide)
// ============================================================================

/** Lucide message-circle icon (24x24, stroke) — used in <summary> toggle */
const ICON_MESSAGE_CIRCLE = `<svg class="comments-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/></svg>`;

/** Lucide chevron-right icon (16x16, stroke) — rotates to point down when expanded */
const ICON_CHEVRON = `<svg class="comments-chevron" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`;

// ============================================================================
// HTML Escaping
// ============================================================================

/**
 * Escape HTML special characters in text content.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================================================
// Comment Rendering
// ============================================================================

/** Map plugin Lang to BCP-47 locale for date formatting */
const LANG_TO_LOCALE: Record<Lang, string> = {
  "en": "en-US",
  "zh-hans": "zh-CN",
  "zh-hant": "zh-TW",
};

/**
 * Format an ISO date string for display using the page language.
 */
function formatDate(isoDate: string, lang: Lang = "en"): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(LANG_TO_LOCALE[lang], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Render a single comment as an <li> element.
 * Author name is a clickable link when URL is available.
 */
function renderComment(comment: NormalizedComment, lang: Lang = "en", serverConfigured: boolean = false): string {
  const t = translations[lang];
  const authorName = escapeHtml(comment.author.name);
  const authorHtml = comment.author.url
    ? `<a href="${escapeHtml(comment.author.url)}" class="comment-author" rel="nofollow noopener" target="_blank">${authorName}</a>`
    : `<span class="comment-author">${authorName}</span>`;

  const dateStr = formatDate(comment.date, lang);
  const contentHtml = comment.content_html;

  const showReply = serverConfigured && comment.source === "comment";
  const replyBtn = showReply
    ? `<button type="button" class="comment-reply-btn" data-reply-id="${escapeHtml(comment.id)}" data-reply-name="${escapeHtml(comment.author.name)}">↩ ${t.reply_action}</button>`
    : "";

  return `<li class="comment-item" id="comment-${escapeHtml(comment.id)}">
  <div class="comment-header">
    ${authorHtml}
    <time class="comment-date" datetime="${escapeHtml(comment.date)}">${dateStr}</time>
    ${replyBtn}
  </div>
  <div class="comment-body">${contentHtml}</div>`;
}

/**
 * Build a threaded comment tree and render as nested <ol> lists.
 *
 * Top-level comments (no replyToId) go in the root list.
 * Replies are nested inside their parent's <li>.
 */
function renderCommentList(comments: NormalizedComment[], lang: Lang = "en", serverConfigured: boolean = false): string {
  // Separate top-level and replies
  const topLevel: NormalizedComment[] = [];
  const repliesByParent = new Map<string, NormalizedComment[]>();

  for (const comment of comments) {
    if (comment.replyToId) {
      const replies = repliesByParent.get(comment.replyToId) || [];
      replies.push(comment);
      repliesByParent.set(comment.replyToId, replies);
    } else {
      topLevel.push(comment);
    }
  }

  function renderWithReplies(comment: NormalizedComment): string {
    let html = renderComment(comment, lang, serverConfigured);
    const replies = repliesByParent.get(comment.id);
    if (replies && replies.length > 0) {
      html += `\n  <ol class="comment-replies">`;
      for (const reply of replies) {
        html += renderWithReplies(reply);
      }
      html += `\n  </ol>`;
    }
    html += `\n</li>`;
    return html;
  }

  if (topLevel.length === 0 && comments.length > 0) {
    // All comments are replies to something not in our set — render flat
    let html = "";
    for (const comment of comments) {
      html += renderComment(comment, lang, serverConfigured) + "\n</li>";
    }
    return html;
  }

  let html = "";
  for (const comment of topLevel) {
    html += renderWithReplies(comment);
  }
  return html;
}

// ============================================================================
// Summary Text
// ============================================================================

/**
 * Generate the summary text for the collapsible comment section.
 */
function renderSummaryText(commentCount: number, lang: Lang = "en"): string {
  const t = translations[lang];
  if (commentCount === 0) {
    return t.comment_count_zero;
  }
  if (commentCount === 1) {
    return t.comment_count_one;
  }
  return t.comment_count_many.replace("{n}", String(commentCount));
}

// ============================================================================
// Comment Form
// ============================================================================

/**
 * Render the comment form.
 *
 * For "waline" (default): minimal form with just a textarea and submit button.
 * For "artalk": includes name, email, and website fields in a single row.
 *
 * Submit button shows localized text ("Reply" / "回复" / "回覆").
 * Field labels and placeholder text are localized via the i18n module.
 */
function renderCommentForm(pagePath: string, provider: string = "waline", lang: Lang = "en"): string {
  const t = translations[lang];
  const submitButton = `<button type="submit" class="comment-form-submit">${t.reply}</button>`;
  const statusDiv = `<div class="comment-form-status" id="moss-comment-status"></div>`;

  if (provider === "artalk") {
    return `<form class="comment-form" id="moss-comment-form">
  <textarea id="moss-comment-text" name="content" required rows="2" placeholder="${t.placeholder}"></textarea>
  <div class="comment-form-meta">
    <input type="text" name="name" class="comment-field" placeholder="${t.name}" required>
    <input type="email" name="email" class="comment-field" placeholder="${t.email_optional}">
    <input type="text" name="link" class="comment-field" placeholder="${t.website_optional}">
    ${submitButton}
  </div>
  ${statusDiv}
</form>`;
  }

  // Default: Waline form
  return `<form class="comment-form" id="moss-comment-form">
  <textarea id="moss-comment-text" name="comment" required rows="2" placeholder="${t.placeholder}"></textarea>
  ${submitButton}
  ${statusDiv}
</form>`;
}

// ============================================================================
// Main Render Function
// ============================================================================

/**
 * Render the complete comment section HTML.
 *
 * Wraps content in a collapsible <details>/<summary> element (collapsed by default).
 * Returns empty string if no comments and no form (nothing to render).
 */
export function renderCommentSection(
  comments: NormalizedComment[],
  pagePath: string,
  serverUrl: string,
  submitScript: string,
  provider: string = "waline",
  lang: Lang = "en",
  fetchedAt: string = ""
): string {
  const hasComments = comments.length > 0;
  const hasForm = !!serverUrl;

  const commentListHtml = hasComments
    ? `<ol class="comment-list">${renderCommentList(comments, lang, !!serverUrl)}</ol>`
    : "";

  const formHtml = hasForm ? renderCommentForm(pagePath, provider, lang) : "";
  const wrappedFormHtml = `<div class="comment-form-slot" id="default-form-slot">${formHtml}</div>`;
  const scriptHtml = hasForm && submitScript
    ? `<script>${submitScript}</script>`
    : "";

  const summaryText = renderSummaryText(comments.length, lang);

  // data-built-at records when this HTML was generated (ISO 8601).
  // Client-side JS uses this as the boundary for "stale-while-revalidate"
  // comment loading: on page open, it fetches comments from the Artalk server
  // sorted by date descending and stops when it hits a comment older than
  // this timestamp. Comments newer than data-built-at were posted after the
  // last static build and need to be injected into the DOM dynamically.
  const builtAt = fetchedAt || new Date().toISOString();

  return `<section class="moss-comments" id="moss-comments" data-built-at="${builtAt}">
  <details>
    <summary class="comments-toggle">${ICON_MESSAGE_CIRCLE}<span>${summaryText}</span>${ICON_CHEVRON}</summary>
    ${wrappedFormHtml}
    ${commentListHtml}
    ${scriptHtml}
  </details>
</section>`;
}
