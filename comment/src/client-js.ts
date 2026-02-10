/**
 * Client-side JavaScript generator
 *
 * Generates inline vanilla JS for the comment form submission.
 * The generated JS intercepts form submit, POSTs to the Waline API,
 * and dynamically appends new comments on success.
 */

/**
 * Generate inline JS for the comment form.
 *
 * @param serverUrl - Waline server URL (e.g., "https://comments.example.com")
 * @param pagePath - Page path for the comment (e.g., "/posts/foo.html")
 * @returns JavaScript code string
 */
export function buildClientScript(serverUrl: string, pagePath: string): string {
  // We embed serverUrl and pagePath as string literals in the generated JS
  const safeServerUrl = serverUrl.replace(/'/g, "\\'");
  const safePagePath = pagePath.replace(/'/g, "\\'");

  return `(function() {
  var form = document.getElementById('moss-comment-form');
  if (!form) return;

  var statusEl = document.getElementById('moss-comment-status');
  var commentList = document.querySelector('.moss-comments .comment-list');
  var emptyMsg = document.querySelector('.moss-comments .comment-empty');

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var btn = form.querySelector('.comment-form-submit');
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    if (statusEl) statusEl.textContent = '';

    var body = {
      comment: form.elements['comment'].value,
      nick: form.elements['nick'].value || 'Anonymous',
      mail: form.elements['mail'].value || '',
      link: form.elements['link'].value || '',
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

      // Success: append new comment to the list
      if (statusEl) {
        statusEl.textContent = 'Comment submitted! It may need approval.';
        statusEl.className = 'comment-form-status comment-form-status--success';
      }

      if (emptyMsg) emptyMsg.remove();
      if (!commentList) {
        commentList = document.createElement('ol');
        commentList.className = 'comment-list';
        var heading = document.querySelector('.moss-comments-heading');
        if (heading) heading.after(commentList);
      }

      var li = document.createElement('li');
      li.className = 'comment-item comment-item--new';
      var nick = body.nick || 'Anonymous';
      var now = new Date().toLocaleDateString('en-US', {year:'numeric',month:'short',day:'numeric'});
      li.innerHTML = '<div class="comment-header">'
        + '<span class="comment-avatar comment-avatar--default"></span>'
        + '<div class="comment-meta">'
        + '<span class="comment-author-name">' + nick.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</span>'
        + '<time class="comment-date">' + now + '</time>'
        + '</div></div>'
        + '<div class="comment-body"><p>' + body.comment.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</p></div>';
      commentList.appendChild(li);

      // Update heading count
      var heading = document.querySelector('.moss-comments-heading');
      if (heading) {
        var items = commentList.querySelectorAll('.comment-item');
        heading.textContent = 'Comments (' + items.length + ')';
      }

      form.elements['comment'].value = '';
    })
    .catch(function(err) {
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
