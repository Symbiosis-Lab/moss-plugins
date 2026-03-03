/**
 * Client-side JavaScript generator
 *
 * Generates inline vanilla JS for:
 * 1. Comment form submission (POST to Waline API)
 * 2. Textarea auto-grow (expands as user types)
 *
 * All user-facing strings are localized via the i18n module. Strings are
 * embedded at build time (not runtime) since the JS is generated per-page.
 */

import { translations, type Lang } from "./i18n";

/**
 * Properly escapes a string for use in a single-quoted JavaScript string literal.
 * Must escape backslashes first, then quotes, then newlines.
 *
 * @param str - The string to escape
 * @returns Escaped string safe for single-quoted JS string literals
 */
export function escapeForSingleQuotedJs(str: string): string {
  return str
    .replace(/\\/g, '\\\\')   // Escape backslashes FIRST
    .replace(/'/g, "\\'")      // Then escape single quotes
    .replace(/\r/g, '\\r')     // Escape carriage returns
    .replace(/\n/g, '\\n')     // Escape newlines
    .replace(/</g, '\\u003c'); // Prevent </script> injection in inline script blocks
}

/**
 * Generate inline JS for the comment form.
 *
 * @param serverUrl - Waline server URL (e.g., "https://comments.example.com")
 * @param pagePath - Page path for the comment (e.g., "/posts/foo/")
 * @param uid - Content uid to use as the page key. Falls back to pagePath if empty.
 * @param lang - Language code for i18n strings. Defaults to "en".
 * @returns JavaScript code string
 */
export function buildClientScript(serverUrl: string, pagePath: string, uid?: string, lang: Lang = "en"): string {
  const safeServerUrl = escapeForSingleQuotedJs(serverUrl);
  // Use uid as the page key if available, otherwise fall back to pagePath
  const pageKey = uid || pagePath;
  const safePageKey = escapeForSingleQuotedJs(pageKey);

  const t = translations[lang];
  const safeSubmitting = escapeForSingleQuotedJs(t.submitting);
  const safeReply = escapeForSingleQuotedJs(t.reply);
  const safeCommentSubmitted = escapeForSingleQuotedJs(t.comment_submitted);
  const safeNetworkError = escapeForSingleQuotedJs(t.network_error);

  return `(function() {
  var form = document.getElementById('moss-comment-form');
  if (!form) return;

  var textarea = document.getElementById('moss-comment-text');
  var statusEl = document.getElementById('moss-comment-status');
  var commentList = document.querySelector('.moss-comments .comment-list');

  // Auto-grow textarea
  if (textarea) {
    function autoGrow() {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    }
    textarea.addEventListener('input', autoGrow);
  }

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var btn = form.querySelector('.comment-form-submit');
    btn.disabled = true;
    btn.textContent = '${safeSubmitting}';
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'comment-form-status'; }

    var body = {
      comment: form.elements['comment'].value,
      nick: 'Anonymous',
      mail: '',
      link: '',
      url: '${safePageKey}',
      ua: navigator.userAgent
    };

    fetch('${safeServerUrl}/api/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      btn.disabled = false;
      btn.textContent = '${safeReply}';

      if (data.errno !== 0 && data.errmsg) {
        if (statusEl) {
          statusEl.textContent = 'Error: ' + data.errmsg;
          statusEl.className = 'comment-form-status comment-form-status--error';
        }
        return;
      }

      if (statusEl) {
        statusEl.textContent = '${safeCommentSubmitted}';
        statusEl.className = 'comment-form-status comment-form-status--success';
      }

      if (!commentList) {
        commentList = document.createElement('ol');
        commentList.className = 'comment-list';
        form.after(commentList);
      }

      var li = document.createElement('li');
      li.className = 'comment-item';
      var now = new Date().toLocaleDateString('en-US', {year:'numeric',month:'short',day:'numeric'});
      li.innerHTML = '<div class="comment-header">'
        + '<span class="comment-author">Anonymous</span>'
        + '<time class="comment-date">' + now + '</time>'
        + '</div>'
        + '<div class="comment-body"><p>' + body.comment.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') + '</p></div>';
      commentList.appendChild(li);

      form.elements['comment'].value = '';
      if (textarea) { textarea.style.height = 'auto'; }
    })
    .catch(function() {
      btn.disabled = false;
      btn.textContent = '${safeReply}';
      if (statusEl) {
        statusEl.textContent = '${safeNetworkError}';
        statusEl.className = 'comment-form-status comment-form-status--error';
      }
    });
  });
})();`;
}
