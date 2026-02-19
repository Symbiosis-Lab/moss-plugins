/**
 * Client-side JavaScript generator
 *
 * Generates inline vanilla JS for:
 * 1. Comment form submission (POST to Waline API)
 * 2. Textarea auto-grow (expands as user types)
 */

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
 * @returns JavaScript code string
 */
export function buildClientScript(serverUrl: string, pagePath: string): string {
  const safeServerUrl = escapeForSingleQuotedJs(serverUrl);
  const safePagePath = escapeForSingleQuotedJs(pagePath);

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
      comment: form.elements['comment'].value,
      nick: 'Anonymous',
      mail: '',
      link: '',
      url: '${safePagePath}',
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
      btn.textContent = 'Submit';

      if (data.errno !== 0 && data.errmsg) {
        if (statusEl) {
          statusEl.textContent = 'Error: ' + data.errmsg;
          statusEl.className = 'comment-form-status comment-form-status--error';
        }
        return;
      }

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
      btn.textContent = 'Submit';
      if (statusEl) {
        statusEl.textContent = 'Network error. Please try again.';
        statusEl.className = 'comment-form-status comment-form-status--error';
      }
    });
  });
})();`;
}
