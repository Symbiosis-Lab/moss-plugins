/**
 * Waline comment provider adapter
 *
 * Implements the CommentProvider interface for Waline servers.
 * Waline API: https://waline.js.org/en/api/
 */

import type { CommentProvider } from "../types";
import { buildClientScript } from "../client-js";

export const walineProvider: CommentProvider = {
  name: "waline",

  /**
   * Get the form action URL for comment submission.
   */
  getFormAction(serverUrl: string): string {
    return `${serverUrl}/api/comment`;
  },

  /**
   * Build inline JS that POSTs a new comment to the Waline API.
   *
   * POST /api/comment
   * Body: { comment, nick, mail, link, url, ua }
   */
  buildSubmitScript(serverUrl: string, pagePath: string): string {
    return buildClientScript(serverUrl, pagePath);
  },

  /**
   * Build inline JS that fetches existing comments from the Waline API.
   *
   * GET /api/comment?path=/posts/foo.html&pageSize=50
   * Response: { errno: 0, data: { data: [...comments] } }
   */
  buildFetchScript(serverUrl: string, pagePath: string): string {
    const safeServerUrl = serverUrl.replace(/'/g, "\\'");
    const safePagePath = pagePath.replace(/'/g, "\\'");

    return `(function() {
  fetch('${safeServerUrl}/api/comment?path=${safePagePath}&pageSize=50')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.errno !== 0 || !data.data || !data.data.data) return;
      var comments = data.data.data;
      if (comments.length === 0) return;

      var list = document.querySelector('.moss-comments .comment-list');
      if (!list) {
        list = document.createElement('ol');
        list.className = 'comment-list';
        var heading = document.querySelector('.moss-comments-heading');
        if (heading) heading.after(list);
        var emptyMsg = document.querySelector('.moss-comments .comment-empty');
        if (emptyMsg) emptyMsg.remove();
      }

      comments.forEach(function(c) {
        if (document.getElementById('comment-' + c.objectId)) return;
        var li = document.createElement('li');
        li.className = 'comment-item';
        li.id = 'comment-' + c.objectId;
        var nick = (c.nick || 'Anonymous').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        var date = new Date(c.createdAt).toLocaleDateString('en-US', {year:'numeric',month:'short',day:'numeric'});
        li.innerHTML = '<div class="comment-header">'
          + '<span class="comment-avatar comment-avatar--default"></span>'
          + '<div class="comment-meta">'
          + '<span class="comment-author-name">' + nick + '</span>'
          + '<time class="comment-date">' + date + '</time>'
          + '<span class="comment-source">waline</span>'
          + '</div></div>'
          + '<div class="comment-body">' + c.comment + '</div>';
        list.appendChild(li);
      });

      var heading = document.querySelector('.moss-comments-heading');
      if (heading) {
        var items = list.querySelectorAll('.comment-item');
        heading.textContent = 'Comments (' + items.length + ')';
      }
    })
    .catch(function() {});
})();`;
  },
};
