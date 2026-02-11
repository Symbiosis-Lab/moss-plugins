/**
 * Waline comment provider adapter
 *
 * Builds inline JS for comment submission to Waline servers.
 * Waline API: https://waline.js.org/en/api/
 */

import { buildClientScript } from "../client-js";

/**
 * Build inline JS that POSTs a new comment to the Waline API
 * and handles textarea auto-grow.
 */
export function buildWalineSubmitScript(serverUrl: string, pagePath: string): string {
  return buildClientScript(serverUrl, pagePath);
}
