/**
 * Waline comment provider adapter
 *
 * Builds inline JS for comment submission to Waline servers.
 * Waline API: https://waline.js.org/en/api/
 */

import { buildClientScript } from "../client-js";
import type { Lang } from "../i18n";

/**
 * Build inline JS that POSTs a new comment to the Waline API
 * and handles textarea auto-grow.
 *
 * @param uid - Content uid to use as the page key. Falls back to pagePath if empty.
 * @param _siteName - Unused for Waline (included for provider interface compatibility).
 * @param lang - Language code for i18n strings. Defaults to "en".
 */
export function buildWalineSubmitScript(serverUrl: string, pagePath: string, uid: string = "", _siteName?: string, lang: Lang = "en"): string {
  return buildClientScript(serverUrl, pagePath, uid, lang);
}
