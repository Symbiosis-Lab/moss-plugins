/**
 * Douban (豆瓣) Syndicator Plugin
 *
 * Syndicates book and movie ratings/reviews to/from Douban.
 * Pull: scrapes user's public collection pages (no API available)
 * Push: automates review form submission
 *
 * Capabilities: process (pull), syndicate (push)
 * Auth: cookie-based (dbcl2 on .douban.com)
 */

import type { ProcessContext, SyndicateContext, HookResult } from "./types";
import {
  reportProgress,
  reportError,
  getPluginCookie,
  openBrowser,
  closeBrowser,
} from "@symbiosis-lab/moss-api";
import { getConfig } from "./config";
import { pullCollection } from "./pull";

async function isAuthenticated(): Promise<boolean> {
  try {
    const dbcl2 = await getPluginCookie("dbcl2");
    return !!dbcl2;
  } catch {
    return false;
  }
}

async function authenticate(): Promise<boolean> {
  await reportProgress("auth", 0, 100, "Please log in to Douban");
  await openBrowser("https://accounts.douban.com/passport/login");

  const maxWait = 300000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (await isAuthenticated()) {
      await closeBrowser();
      await reportProgress("auth", 100, 100, "Logged in to Douban");
      return true;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  await closeBrowser();
  await reportError("Authentication timed out");
  return false;
}

/**
 * Process hook — pull book/movie ratings from Douban.
 */
export async function process(context: ProcessContext): Promise<HookResult> {
  const config = { ...(await getConfig()), ...context.config };

  if (!config.user_id) {
    return {
      success: false,
      message: "Douban user_id not configured. Set user_id in plugin config.",
    };
  }

  if (!config.sync_on_build) {
    return { success: true, message: "Sync disabled" };
  }

  // Douban public collection pages work without auth
  // Auth is only needed for pushing reviews and accessing private collections

  try {
    let totalSynced = 0;
    const contentDir = "review";

    if (config.sync_books) {
      await reportProgress("pull", 0, 100, "Pulling book ratings...");
      const bookCount = await pullCollection(config.user_id, "book", contentDir);
      totalSynced += bookCount;
    }

    if (config.sync_movies) {
      await reportProgress("pull", 50, 100, "Pulling movie ratings...");
      const movieCount = await pullCollection(config.user_id, "movie", contentDir);
      totalSynced += movieCount;
    }

    await reportProgress("pull", 100, 100, `Synced ${totalSynced} items`);
    return {
      success: true,
      message: totalSynced > 0
        ? `Pulled ${totalSynced} ratings from Douban`
        : "All ratings up to date",
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await reportError(`Pull failed: ${msg}`);
    return { success: false, message: msg };
  }
}

/**
 * Syndicate hook — push reviews to Douban.
 */
export async function syndicate(context: SyndicateContext): Promise<HookResult> {
  const config = { ...(await getConfig()), ...context.config };

  if (!config.user_id) {
    return { success: false, message: "Douban user_id not configured" };
  }

  if (!(await isAuthenticated())) {
    const loggedIn = await authenticate();
    if (!loggedIn) {
      return { success: false, message: "Not authenticated with Douban" };
    }
  }

  // TODO: Implement push — iterate context.articles, find those with
  // type: review + media_type + douban_url, push reviews that don't exist yet

  return { success: true, message: "Push not yet implemented" };
}
