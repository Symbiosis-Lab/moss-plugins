/**
 * Comment section HTML renderer
 *
 * Generates static HTML for the comment section including:
 * - Existing comments with threading
 * - Comment submission form
 * - Inline CSS
 */

import type { NormalizedComment, CommentProvider } from "./types";

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
 * Sanitize HTML content: strip <script>, <iframe>, and on* event attributes.
 * Preserves safe HTML tags like <p>, <a>, <strong>, <em>, etc.
 */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<iframe[\s\S]*?\/>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]*/gi, "");
}

// ============================================================================
// Comment Rendering
// ============================================================================

/**
 * Format an ISO date string for display.
 */
function formatDate(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return isoDate;
  }
}

/**
 * Render a single comment as an <li> element.
 */
function renderComment(comment: NormalizedComment): string {
  const avatarHtml = comment.author.avatar
    ? `<img class="comment-avatar" src="${escapeHtml(comment.author.avatar)}" alt="" width="40" height="40" loading="lazy">`
    : `<span class="comment-avatar comment-avatar--default"></span>`;

  const authorName = escapeHtml(comment.author.name);
  const authorLink = comment.author.url
    ? `<a href="${escapeHtml(comment.author.url)}" class="comment-author-name" rel="nofollow noopener" target="_blank">${authorName}</a>`
    : `<span class="comment-author-name">${authorName}</span>`;

  const dateStr = formatDate(comment.date);
  const contentHtml = sanitizeHtml(comment.content_html);

  return `<li class="comment-item" id="comment-${escapeHtml(comment.id)}" data-comment-id="${escapeHtml(comment.id)}">
  <div class="comment-header">
    ${avatarHtml}
    <div class="comment-meta">
      ${authorLink}
      <time class="comment-date" datetime="${escapeHtml(comment.date)}">${dateStr}</time>
      <span class="comment-source">${escapeHtml(comment.source)}</span>
    </div>
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
 * Render the comment submission form.
 */
function renderCommentForm(pagePath: string): string {
  return `<form class="comment-form" id="moss-comment-form">
  <input type="hidden" name="url" value="/${escapeHtml(pagePath)}">
  <div class="comment-form-field">
    <label for="moss-comment-text">Comment</label>
    <textarea id="moss-comment-text" name="comment" required rows="4" placeholder="Write a comment..."></textarea>
  </div>
  <div class="comment-form-row">
    <div class="comment-form-field">
      <label for="moss-comment-nick">Name</label>
      <input type="text" id="moss-comment-nick" name="nick" placeholder="Name (optional)">
    </div>
    <div class="comment-form-field">
      <label for="moss-comment-mail">Email</label>
      <input type="email" id="moss-comment-mail" name="mail" placeholder="Email (optional)">
    </div>
    <div class="comment-form-field">
      <label for="moss-comment-link">Website</label>
      <input type="url" id="moss-comment-link" name="link" placeholder="https:// (optional)">
    </div>
  </div>
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
 * @param comments - Normalized comments for this page
 * @param pagePath - Relative path of the page (e.g., "posts/foo.html")
 * @param provider - Comment provider for form submission
 * @param serverUrl - Server URL for the provider
 * @returns Complete comment section HTML string
 */
export function renderCommentSection(
  comments: NormalizedComment[],
  pagePath: string,
  provider: CommentProvider | null,
  serverUrl: string
): string {
  const count = comments.length;
  const heading = count > 0
    ? `Comments (${count})`
    : "Comments";

  const commentListHtml = count > 0
    ? `<ol class="comment-list">${renderCommentList(comments)}</ol>`
    : `<p class="comment-empty">No comments yet.</p>`;

  const formHtml = provider && serverUrl
    ? renderCommentForm(pagePath)
    : "";

  const clientScript = provider && serverUrl
    ? `<script>${provider.buildSubmitScript(serverUrl, "/" + pagePath)}</script>`
    : "";

  return `<section class="moss-comments" id="moss-comments">
  <h3 class="moss-comments-heading">${heading}</h3>
  ${commentListHtml}
  ${formHtml}
  ${clientScript}
</section>`;
}
