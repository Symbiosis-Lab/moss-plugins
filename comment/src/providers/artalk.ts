/**
 * Artalk comment provider adapter
 *
 * Builds inline JS for comment submission to Artalk servers.
 * Artalk API v2: POST /api/v2/comments
 */

import { escapeForSingleQuotedJs } from "../client-js";

/**
 * Build inline JS that POSTs a new comment to the Artalk v2 API
 * and handles textarea auto-grow.
 *
 * @param serverUrl - Artalk server URL (e.g., "https://artalk.example.com")
 * @param pagePath - Page path for the comment (e.g., "/posts/foo/")
 * @param siteName - Artalk site name (e.g., "MySite")
 * @returns JavaScript code string
 */
export function buildArtalkClientScript(
  serverUrl: string,
  pagePath: string,
  siteName: string
): string {
  const safeServerUrl = escapeForSingleQuotedJs(serverUrl);
  const safePagePath = escapeForSingleQuotedJs(pagePath);
  const safeSiteName = escapeForSingleQuotedJs(siteName);

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
    btn.textContent = 'Submitting...';
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'comment-form-status'; }

    var body = {
      content: form.elements['content'].value,
      name: form.elements['name'].value,
      email: form.elements['email'].value,
      page_key: '${safePagePath}',
      site_name: '${safeSiteName}',
      ua: navigator.userAgent
    };

    fetch('${safeServerUrl}/api/v2/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    .then(function(res) {
      if (!res.ok) {
        return res.json().then(function(data) {
          throw new Error(data.msg || 'Server error (' + res.status + ')');
        });
      }
      return res.json();
    })
    .then(function(data) {
      btn.disabled = false;
      btn.textContent = 'Submit';

      if (statusEl) {
        statusEl.textContent = 'Comment submitted!';
        statusEl.className = 'comment-form-status comment-form-status--success';
      }

      if (!commentList) {
        commentList = document.createElement('ol');
        commentList.className = 'comment-list';
        form.before(commentList);
      }

      var li = document.createElement('li');
      li.className = 'comment-item';
      var now = new Date().toLocaleDateString('en-US', {year:'numeric',month:'short',day:'numeric'});
      var authorName = body.name || 'Anonymous';
      li.innerHTML = '<div class="comment-header">'
        + '<span class="comment-author">' + authorName.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') + '</span>'
        + '<time class="comment-date">' + now + '</time>'
        + '</div>'
        + '<div class="comment-body"><p>' + body.content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') + '</p></div>';
      commentList.appendChild(li);

      form.elements['content'].value = '';
      if (textarea) { textarea.style.height = 'auto'; }
    })
    .catch(function(err) {
      btn.disabled = false;
      btn.textContent = 'Submit';
      if (statusEl) {
        statusEl.textContent = err.message || 'Network error. Please try again.';
        statusEl.className = 'comment-form-status comment-form-status--error';
      }
    });
  });
})();`;
}
