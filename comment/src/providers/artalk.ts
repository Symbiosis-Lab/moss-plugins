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

/** Minimal comment shape used by sortForInsertion */
export interface HydrationComment {
  id: number;
  rid: number;
  date: string;
  [key: string]: unknown;
}

/**
 * Reorder comments from date_desc (newest-first) to insertion-safe order
 * where parents appear before their children.
 *
 * The Artalk API returns comments sorted by date descending. When hydrating
 * the DOM, we need to insert parent comments before their replies so that
 * `getElementById('comment-' + c.rid)` finds the parent. Simply reversing
 * the array (oldest-first) achieves this because a parent is always older
 * than its replies.
 */
export function sortForInsertion(
  comments: HydrationComment[]
): HydrationComment[] {
  return [...comments].reverse();
}

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
  const safeReplyingTo = escapeForSingleQuotedJs(t.replying_to);
  const safeCancel = escapeForSingleQuotedJs(t.cancel);
  const safeReplyAction = escapeForSingleQuotedJs(t.reply_action);
  const locale = LANG_TO_LOCALE[lang];

  return `(function() {
  var form = document.getElementById('moss-comment-form');
  if (!form) return;

  var textarea = document.getElementById('moss-comment-text');
  var statusEl = document.getElementById('moss-comment-status');
  var commentList = document.querySelector('.moss-comments .comment-list');
  var currentReplyId = null;
  var currentReplyWrapper = null;
  var defaultFormSlot = document.getElementById('default-form-slot');

  function updateCommentCount() {
    var s = document.getElementById('moss-comments');
    if (!s) return;
    var total = s.querySelectorAll('.comment-item').length;
    var d = s.querySelector('details');
    if (!d) return;
    var sp = d.querySelector('summary span');
    if (sp) {
      sp.textContent = total === 1 ? '${safeCountOne}' : '${safeCountMany}'.replace('{n}', total);
    }
  }

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

    var rawLink = (form.elements['link'].value || '').trim();
    if (rawLink && !/^https?:\\/\\//.test(rawLink)) { rawLink = 'https://' + rawLink; }

    var body = {
      content: form.elements['content'].value,
      name: form.elements['name'].value,
      email: form.elements['email'].value,
      link: rawLink,
      rid: currentReplyId ? parseInt(currentReplyId, 10) : 0,
      page_key: '${safePageKey}',
      site_name: '${safeSiteName}',
      ua: navigator.userAgent
    };

    // Prepend quoted passage as blockquote if submitting from float shell
    var quoteText = form.dataset.quoteText || '';
    if (quoteText) {
      body.content = '> ' + quoteText + '\\n\\n' + body.content;
    }

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

      var li = document.createElement('li');
      li.className = 'comment-item';
      li.id = 'comment-' + data.id;
      var now = new Date().toLocaleDateString('${locale}', {year:'numeric',month:'short',day:'numeric'});
      var authorName = body.name || 'Anonymous';
      var safeAuthor = authorName.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      li.innerHTML = '<div class="comment-header">'
        + '<span class="comment-author">' + safeAuthor + '</span>'
        + '<time class="comment-date">' + now + '</time>'
        + '<button type="button" class="comment-reply-btn" data-reply-id="' + data.id + '" data-reply-name="' + safeAuthor + '">\\u21a9 ${safeReplyAction}</button>'
        + '</div>'
        + '<div class="comment-body"><p>' + body.content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') + '</p></div>';

      if (currentReplyId) {
        // Insert as nested reply under the parent comment
        var parentLi = document.getElementById('comment-' + currentReplyId);
        if (parentLi) {
          var repliesOl = parentLi.querySelector('.comment-replies');
          if (!repliesOl) {
            repliesOl = document.createElement('ol');
            repliesOl.className = 'comment-replies';
            parentLi.appendChild(repliesOl);
          }
          repliesOl.insertBefore(li, null);
        }
        cancelReply(false);
      } else {
        if (!commentList) {
          commentList = document.createElement('ol');
          commentList.className = 'comment-list';
          var defaultSlot = document.getElementById('default-form-slot');
          if (defaultSlot) defaultSlot.after(commentList);
          else form.after(commentList);
        }
        // Newest first: prepend so the just-submitted comment appears at the top
        commentList.insertBefore(li, commentList.firstChild);
      }

      updateCommentCount();
      saveIdentity();
      cancelFloat();
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

  /* --- Reply logic: relocating form pattern --- */
  function cancelReply(skipScroll) {
    if (!currentReplyWrapper) return;
    if (defaultFormSlot) {
      defaultFormSlot.appendChild(form);
      defaultFormSlot.classList.remove('comment-form-slot--collapsed');
    }
    currentReplyWrapper.remove();
    currentReplyWrapper = null;
    currentReplyId = null;
    if (!skipScroll && defaultFormSlot) {
      defaultFormSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  var section = document.getElementById('moss-comments');
  if (section) {
    section.addEventListener('click', function(e) {
      var btn = e.target.closest('.comment-reply-btn');
      if (!btn) return;

      var replyId = btn.getAttribute('data-reply-id');
      var replyName = btn.getAttribute('data-reply-name');
      var commentItem = document.getElementById('comment-' + replyId);
      if (!commentItem) return;

      // If already replying to this comment, just focus
      if (currentReplyId === replyId) { textarea.focus(); return; }

      // Cancel any existing reply
      cancelReply(true);

      // Collapse default form slot
      if (defaultFormSlot) defaultFormSlot.classList.add('comment-form-slot--collapsed');

      // Create reply wrapper with thread indent
      var wrapper = document.createElement('div');
      wrapper.className = 'comment-reply-form-wrapper';

      // Reply indicator
      var indicator = document.createElement('div');
      indicator.className = 'comment-reply-indicator';
      indicator.innerHTML = '<span>\\u21a9 ${safeReplyingTo} <strong>' + replyName.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</strong> \\u00b7</span>';
      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'comment-reply-cancel';
      cancelBtn.textContent = '${safeCancel}';
      cancelBtn.addEventListener('click', function() { cancelReply(false); });
      indicator.appendChild(cancelBtn);
      wrapper.appendChild(indicator);

      // Move form into wrapper
      wrapper.appendChild(form);
      commentItem.appendChild(wrapper);

      currentReplyWrapper = wrapper;
      currentReplyId = replyId;

      textarea.focus();
      wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  /* --- Float-with-quote: selection → 评论 flow --- */
  var floatShell = null;
  var floatBackdrop = null;

  function createFloatShell() {
    floatBackdrop = document.createElement('div');
    floatBackdrop.className = 'comment-float-backdrop';
    document.body.appendChild(floatBackdrop);

    floatShell = document.createElement('div');
    floatShell.className = 'comment-float-shell';
    floatShell.innerHTML = '<div class="comment-float-inner"></div>';
    document.body.appendChild(floatShell);

    floatBackdrop.addEventListener('click', cancelFloat);
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && floatShell.classList.contains('open')) cancelFloat();
    });
  }

  function floatWithQuote(quoteText) {
    cancelReply(true);
    if (!floatShell) createFloatShell();
    var inner = floatShell.querySelector('.comment-float-inner');
    var quoteEl = document.createElement('div');
    quoteEl.className = 'comment-float-quote';
    quoteEl.textContent = quoteText;
    inner.innerHTML = '';
    inner.appendChild(quoteEl);
    if (defaultFormSlot) defaultFormSlot.classList.add('comment-form-slot--collapsed');
    inner.appendChild(form);
    form.dataset.quoteText = quoteText;
    floatBackdrop.classList.add('visible');
    floatShell.classList.add('open');
    textarea.focus();
  }

  function cancelFloat() {
    if (!floatShell) return;
    floatShell.classList.remove('open');
    floatBackdrop.classList.remove('visible');
    if (defaultFormSlot) {
      defaultFormSlot.appendChild(form);
      defaultFormSlot.classList.remove('comment-form-slot--collapsed');
    }
    delete form.dataset.quoteText;
  }

  document.addEventListener('moss:quote-comment', function(e) {
    var text = e.detail && e.detail.text;
    if (text) floatWithQuote(text);
  });

  /* --- Identity persistence --- */
  var COMMENTER_KEY = 'moss-commenter';

  function loadIdentity() {
    try {
      var saved = JSON.parse(localStorage.getItem(COMMENTER_KEY));
      if (!saved) return;
      var nameField = form.querySelector('[name="name"]');
      var emailField = form.querySelector('[name="email"]');
      var linkField = form.querySelector('[name="link"]');
      if (nameField && saved.name) nameField.value = saved.name;
      if (emailField && saved.email) emailField.value = saved.email;
      if (linkField && saved.url) linkField.value = saved.url;
    } catch(e) {}
  }

  function saveIdentity() {
    var nameField = form.querySelector('[name="name"]');
    var emailField = form.querySelector('[name="email"]');
    var linkField = form.querySelector('[name="link"]');
    var data = {
      name: nameField ? nameField.value.trim() : '',
      email: emailField ? emailField.value.trim() : '',
      url: linkField ? linkField.value.trim() : ''
    };
    if (data.name) localStorage.setItem(COMMENTER_KEY, JSON.stringify(data));
  }

  loadIdentity();

  /*
   * Eager hydration — fetch new comments on page load, not on toggle.
   *
   * Design decision:
   *   Static HTML contains all comments known at build time (stale-while-
   *   revalidate). Previously, hydration was deferred to the <details> toggle
   *   event, so the summary count stayed stale until the user expanded the
   *   section. Now we fetch eagerly on page load so the count is correct as
   *   soon as possible, while not blocking page render (the fetch is async).
   *
   * How others handle this:
   *   - Disqus, Commento, Utterances: fully client-rendered. No static HTML
   *     at all — the entire comment thread loads via JS. Fast count, but no
   *     content until JS runs.
   *   - Staticman: commits to git repo, rebuilt into static HTML. No client
   *     hydration — count is always stale until next build.
   *   - Artalk's own JS client: fully client-rendered, same as Disqus.
   *   - moss is unique: SSR + client hydration, like Next.js/Remix's approach
   *     to static content. We get the best of both — immediate content without
   *     JS, plus live updates via hydration.
   *
   * Trade-off:
   *   One background fetch per page load (~1 KB JSON response) vs accurate
   *   comment count. Worth it because the fetch is small, non-blocking, and
   *   the count being wrong is a worse UX than a tiny network request.
   *
   * Deduplication (two layers):
   *   1. Date boundary  — stop iterating when we hit a comment older than the
   *      build timestamp (comments are sorted newest-first from the API).
   *   2. ID guard       — skip any comment whose DOM node already exists
   *      (handles edge cases where build-time and fetch overlap).
   *
   * Trust model: Artalk performs server-side HTML sanitization, so we use
   * innerHTML for comment content (same as the static render path).
   */
  var builtAtStr = section && section.getAttribute('data-built-at');
  var builtAtMs = builtAtStr ? new Date(builtAtStr).getTime() : 0;

  if (builtAtMs) {
    fetch('${safeServerUrl}/api/v2/comments?page_key=${safePageKey}&site_name=${safeSiteName}&flat_mode=true&sort_by=date_desc&limit=100')
      .then(function(res) { return res.ok ? res.json() : null; })
      .then(function(json) {
        if (!json) return;
        var list = json.comments || (json.data && json.data.comments) || [];
        var added = 0;
        // Anchor = first build-time comment. Hydrated comments go before it
        // to maintain newest-first order (API returns date_desc).
        var anchor = commentList ? commentList.firstChild : null;

        // Pass 1: collect new comments (API returns newest-first)
        var newComments = [];
        for (var i = 0; i < list.length; i++) {
          var c = list[i];
          if (new Date(c.date).getTime() <= builtAtMs) break;
          if (document.getElementById('comment-' + c.id)) continue;
          newComments.push(c);
        }

        // Reverse to oldest-first so parents are inserted before children.
        // This fixes reply threading: a parent is always older than its
        // replies, so reversing guarantees getElementById finds the parent
        // when we process a reply.
        newComments.reverse();

        // Pass 2: insert into DOM (oldest-first = parents before children)
        for (var i = 0; i < newComments.length; i++) {
          var c = newComments[i];

          var li = document.createElement('li');
          li.className = 'comment-item';
          li.id = 'comment-' + c.id;
          var authorName = (c.nick || 'Anonymous').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
          var dateStr = new Date(c.date).toLocaleDateString('${locale}', {year:'numeric',month:'short',day:'numeric'});
          li.innerHTML = '<div class="comment-header">'
            + '<span class="comment-author">' + authorName + '</span>'
            + '<time class="comment-date">' + dateStr + '</time>'
            + '<button type="button" class="comment-reply-btn" data-reply-id="' + c.id + '" data-reply-name="' + authorName + '">\\u21a9 ${safeReplyAction}</button>'
            + '</div>'
            + '<div class="comment-body">' + c.content + '</div>';

          if (c.rid > 0) {
            var parentLi = document.getElementById('comment-' + c.rid);
            if (parentLi) {
              var repliesOl = parentLi.querySelector('.comment-replies');
              if (!repliesOl) {
                repliesOl = document.createElement('ol');
                repliesOl.className = 'comment-replies';
                parentLi.appendChild(repliesOl);
              }
              repliesOl.insertBefore(li, null);
              added++;
              continue;
            }
          }

          if (!commentList) {
            commentList = document.createElement('ol');
            commentList.className = 'comment-list';
            var formEl = document.getElementById('moss-comment-form');
            if (formEl) formEl.after(commentList);
            anchor = null;
          }
          commentList.insertBefore(li, anchor);
          added++;
        }

        if (added > 0) {
          updateCommentCount();
        }
      })
      .catch(function() { /* silent — static comments still visible */ });
  }
})();`;
}
