/**
 * Comment section HTML renderer
 *
 * Generates static HTML for the comment section:
 * - Existing comments with threading (author name, date, text)
 * - Optional comment submission form (textarea + submit)
 */

import type { NormalizedComment } from "./types";

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
 * Sanitize HTML content: strip dangerous tags and attributes.
 * Preserves safe HTML tags like <p>, <a>, <strong>, <em>, etc.
 */
export function sanitizeHtml(html: string): string {
  return html
    // Strip dangerous tags (with content)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?(<\/iframe>|\/>)/gi, "")
    .replace(/<object[\s\S]*?(<\/object>|\/>)/gi, "")
    .replace(/<embed[\s\S]*?(\/>|>)/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<math[\s\S]*?<\/math>/gi, "")
    // Strip event handler attributes (on*)
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]*/gi, "")
    // Strip javascript: URLs in href/src attributes
    .replace(/(href|src)\s*=\s*"javascript:[^"]*"/gi, '$1=""')
    .replace(/(href|src)\s*=\s*'javascript:[^']*'/gi, "$1=''");
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
// Comment Form
// ============================================================================

/**
 * Render the minimal comment form: just a textarea and submit button.
 * No label (placeholder is enough), no name/email/website fields.
 * Textarea has rows="2" and auto-grows via inline JS.
 */
function renderCommentForm(pagePath: string): string {
  return `<form class="comment-form" id="moss-comment-form">
  <input type="hidden" name="url" value="/${escapeHtml(pagePath)}">
  <textarea id="moss-comment-text" name="comment" required rows="2" placeholder="Write a comment..."></textarea>
  <button type="submit" class="comment-form-submit">Submit</button>
  <div class="comment-form-status" id="moss-comment-status"></div>
</form>`;
}

// ============================================================================
// Main Render Function
// ============================================================================

/**
 * Render the complete comment section HTML.
 *
 * Returns empty string if no comments and no form (nothing to render).
 */
export function renderCommentSection(
  comments: NormalizedComment[],
  pagePath: string,
  serverUrl: string,
  submitScript: string
): string {
  const hasComments = comments.length > 0;
  const hasForm = !!serverUrl;

  if (!hasComments && !hasForm) return "";

  const commentListHtml = hasComments
    ? `<ol class="comment-list">${renderCommentList(comments)}</ol>`
    : "";

  const formHtml = hasForm ? renderCommentForm(pagePath) : "";
  const scriptHtml = hasForm && submitScript
    ? `<script>${submitScript}</script>`
    : "";

  return `<section class="moss-comments" id="moss-comments">
  ${commentListHtml}
  ${formHtml}
  ${scriptHtml}
</section>`;
}
