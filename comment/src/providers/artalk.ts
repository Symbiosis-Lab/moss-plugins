/**
 * Artalk comment provider adapter
 *
 * Builds inline JS for comment submission to Artalk servers.
 * Artalk API v2: POST /api/v2/comments
 *
 * All user-facing strings are localized via the i18n module.
 */

import { escapeForSingleQuotedJs } from "../client-js";
import { translations, type Lang } from "../i18n";

/** Map plugin Lang to BCP-47 locale for client-side date formatting */
const LANG_TO_LOCALE: Record<Lang, string> = {
  en: "en-US",
  "zh-hans": "zh-CN",
  "zh-hant": "zh-TW",
};

/**
 * Build inline JS that POSTs a new comment to the Artalk v2 API
 * and handles textarea auto-grow.
 *
 * @param serverUrl - Artalk server URL (e.g., "https://artalk.example.com")
 * @param pagePath - Page path for the comment (e.g., "/posts/foo/")
 * @param uid - Content uid to use as the page key. Falls back to pagePath if empty.
 * @param siteName - Artalk site name (e.g., "MySite")
 * @param lang - Language code for i18n strings. Defaults to "en".
 * @returns JavaScript code string
 */
export function buildArtalkClientScript(
  serverUrl: string,
  pagePath: string,
  uid: string = "",
  siteName: string = "",
  lang: Lang = "en"
): string {
  const safeServerUrl = escapeForSingleQuotedJs(serverUrl);
  // Use uid as the page key if available, otherwise fall back to pagePath
  const pageKey = uid || pagePath;
  const safePageKey = escapeForSingleQuotedJs(pageKey);
  const safeSiteName = escapeForSingleQuotedJs(siteName);

  const t = translations[lang];
  const safeSubmitting = escapeForSingleQuotedJs(t.submitting);
  const safeReply = escapeForSingleQuotedJs(t.reply);
  const safeCommentSubmitted = escapeForSingleQuotedJs(t.comment_submitted);
  const safeNetworkError = escapeForSingleQuotedJs(t.network_error);
  const safeCountOne = escapeForSingleQuotedJs(t.comment_count_one);
  const safeCountMany = escapeForSingleQuotedJs(t.comment_count_many);
  const locale = LANG_TO_LOCALE[lang];

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
      content: form.elements['content'].value,
      name: form.elements['name'].value,
      email: form.elements['email'].value,
      link: form.elements['link'].value || '',
      page_key: '${safePageKey}',
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
        return res.json().catch(function() {
          throw new Error('Server error (' + res.status + ')');
        }).then(function(data) {
          throw new Error(data.msg || 'Server error (' + res.status + ')');
        });
      }
      return res.json();
    })
    .then(function(data) {
      btn.disabled = false;
      btn.textContent = '${safeReply}';

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
      li.id = 'comment-' + data.id;
      var now = new Date().toLocaleDateString('${locale}', {year:'numeric',month:'short',day:'numeric'});
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
      btn.textContent = '${safeReply}';
      if (statusEl) {
        statusEl.textContent = err.message || '${safeNetworkError}';
        statusEl.className = 'comment-form-status comment-form-status--error';
      }
    });
  });

  /*
   * Stale-while-revalidate / progressive enhancement for comments.
   *
   * Static HTML already contains all comments known at build time, so the page
   * is immediately readable without JS. When the user opens the comment section
   * (<details> toggle), we fetch comments from the Artalk server that may have
   * been posted after the last build.
   *
   * Why date-based filtering instead of offset/count:
   *   Comments can be deleted or moderated between builds. A purely offset-based
   *   approach would miss or duplicate entries. By comparing each comment's
   *   created_at against the build timestamp (data-built-at), we robustly find
   *   only the comments that are genuinely new.
   *
   * Three-layer deduplication:
   *   1. Date boundary  — stop iterating when we hit a comment older than the
   *      build timestamp (comments are sorted newest-first).
   *   2. ID guard       — skip any comment whose DOM node already exists
   *      (handles edge cases where build-time and fetch overlap).
   *   3. Fire-once listener — the toggle handler removes itself after the first
   *      invocation so we never fetch twice.
   *
   * Trust model: Artalk performs server-side HTML sanitization, so we use
   * innerHTML for comment content (same as the static render path).
   */
  var section = document.getElementById('moss-comments');
  var builtAtStr = section && section.getAttribute('data-built-at');
  var builtAtMs = builtAtStr ? new Date(builtAtStr).getTime() : 0;
  var details = section && section.querySelector('details');

  if (details && builtAtMs) {
    function onToggle() {
      if (!details.open) return;
      details.removeEventListener('toggle', onToggle);

      fetch('${safeServerUrl}/api/v2/comments?page_key=${safePageKey}&site_name=${safeSiteName}&flat_mode=true&sort_by=date_desc&limit=100')
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(json) {
          if (!json) return;
          var list = (json.data && json.data.comments) || [];
          var added = 0;
          for (var i = 0; i < list.length; i++) {
            var c = list[i];
            if (new Date(c.created_at).getTime() <= builtAtMs) break;
            if (document.getElementById('comment-' + c.id)) continue;

            var li = document.createElement('li');
            li.className = 'comment-item';
            li.id = 'comment-' + c.id;
            var authorName = (c.nick || 'Anonymous').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            var dateStr = new Date(c.created_at).toLocaleDateString('${locale}', {year:'numeric',month:'short',day:'numeric'});
            li.innerHTML = '<div class="comment-header">'
              + '<span class="comment-author">' + authorName + '</span>'
              + '<time class="comment-date">' + dateStr + '</time>'
              + '</div>'
              + '<div class="comment-body">' + c.content + '</div>';

            if (!commentList) {
              commentList = document.createElement('ol');
              commentList.className = 'comment-list';
              var formEl = document.getElementById('moss-comment-form');
              if (formEl) formEl.after(commentList);
            }
            commentList.appendChild(li);
            added++;
          }

          if (added > 0) {
            var total = (commentList ? commentList.children.length : 0);
            var summarySpan = details.querySelector('summary span');
            if (summarySpan) {
              summarySpan.textContent = total === 1 ? '${safeCountOne}' : '${safeCountMany}'.replace('{n}', total);
            }
          }
        })
        .catch(function() { /* silent — static comments still visible */ });
    }
    details.addEventListener('toggle', onToggle);
  }
})();`;
}
