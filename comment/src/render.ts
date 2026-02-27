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
import sanitizeHtmlLib from 'sanitize-html';

// ============================================================================
// SVG Icon (Lucide)
// ============================================================================

/** Lucide message-circle icon (24x24, stroke) — used in <summary> toggle */
const ICON_MESSAGE_CIRCLE = `<svg class="comments-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/></svg>`;

// ============================================================================
// HTML Sanitization
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

/**
 * Sanitizes HTML content to prevent XSS attacks.
 * Uses sanitize-html library for robust, battle-tested sanitization.
 */
export function sanitizeHtml(html: string): string {
  return sanitizeHtmlLib(html, {
    allowedTags: [
      'p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li',
      'code', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
    ],
    allowedAttributes: {
      'a': ['href', 'title']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard'
  });
}

// ============================================================================
// Comment Rendering
// ============================================================================

/**
 * Format an ISO date string for display.
 */
function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Render a single comment as an <li> element.
 * Author name is a clickable link when URL is available.
 */
function renderComment(comment: NormalizedComment): string {
  const authorName = escapeHtml(comment.author.name);
  const authorHtml = comment.author.url
    ? `<a href="${escapeHtml(comment.author.url)}" class="comment-author" rel="nofollow noopener" target="_blank">${authorName}</a>`
    : `<span class="comment-author">${authorName}</span>`;

  const dateStr = formatDate(comment.date);
  const contentHtml = sanitizeHtml(comment.content_html);

  return `<li class="comment-item" id="comment-${escapeHtml(comment.id)}">
  <div class="comment-header">
    ${authorHtml}
    <time class="comment-date" datetime="${escapeHtml(comment.date)}">${dateStr}</time>
  </div>
  <div class="comment-body">${contentHtml}</div>`;
}

/**
 * Build a threaded comment tree and render as nested <ol> lists.
 *
 * Top-level comments (no replyToId) go in the root list.
 * Replies are nested inside their parent's <li>.
 */
function renderCommentList(comments: NormalizedComment[]): string {
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
    let html = renderComment(comment);
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
      html += renderComment(comment) + "\n</li>";
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
    <input type="url" name="link" class="comment-field" placeholder="${t.website_optional}">
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
  lang: Lang = "en"
): string {
  const hasComments = comments.length > 0;
  const hasForm = !!serverUrl;

  if (!hasComments && !hasForm) return "";

  const commentListHtml = hasComments
    ? `<ol class="comment-list">${renderCommentList(comments)}</ol>`
    : "";

  const formHtml = hasForm ? renderCommentForm(pagePath, provider, lang) : "";
  const scriptHtml = hasForm && submitScript
    ? `<script>${submitScript}</script>`
    : "";

  const summaryText = renderSummaryText(comments.length, lang);

  return `<section class="moss-comments" id="moss-comments">
  <details>
    <summary class="comments-toggle">${ICON_MESSAGE_CIRCLE}<span>${summaryText}</span></summary>
    ${commentListHtml}
    ${formHtml}
    ${scriptHtml}
  </details>
</section>`;
}
