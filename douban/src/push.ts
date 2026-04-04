/**
 * Push reviews to Douban.
 *
 * Douban reviews are submitted via a form at:
 *   https://book.douban.com/subject/{id}/new_review
 *   https://movie.douban.com/subject/{id}/new_review
 *
 * Requires authentication. Uses DOM automation in the action panel webview.
 * Push is simpler than Substack — it's a standard HTML form, not a rich text editor.
 */

import { reportProgress, openBrowser, closeBrowser } from "@symbiosis-lab/moss-api";

/**
 * Push a review to Douban. Currently a placeholder — requires auth and
 * the evaluateInBrowser() API to automate the review form.
 */
export async function pushReview(
  subjectUrl: string,
  rating: number,
  reviewText: string
): Promise<string | null> {
  const reviewUrl = subjectUrl.replace(/\/$/, "") + "/new_review";

  await reportProgress("push", 0, 100, "Opening Douban review form...");
  await openBrowser(reviewUrl);

  // TODO: Implement form automation via webview.eval()
  // The review form has:
  // - Star rating selector (.rating-stars)
  // - Text area for review content
  // - Submit button

  await reportProgress("push", 100, 100, "Review form opened — manual submission required");
  return null;
}

/**
 * JS script for automating the Douban review form.
 * Runs inside the page context.
 */
export function reviewFormScript(rating: number, text: string): string {
  return `
(async () => {
  // Set star rating (1-5)
  const starLink = document.querySelector('a[class*="star${rating}"]');
  if (starLink) starLink.click();

  // Fill review text
  const textarea = document.querySelector('#review_content, textarea[name="content"]');
  if (textarea) {
    textarea.value = ${JSON.stringify(text)};
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  return { success: true };
})()
`;
}
