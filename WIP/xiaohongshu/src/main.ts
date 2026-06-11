/**
 * Xiaohongshu Syndicator Plugin
 *
 * Syndicates notes to/from Xiaohongshu (Little Red Book).
 * Uses DOM scraping for pulling (no public API) and creator center automation for pushing.
 *
 * Capabilities: process (pull), syndicate (push)
 * Auth: cookie-based (session cookies on .xiaohongshu.com)
 */

import type {
  ProcessContext,
  SyndicateContext,
  HookResult,
} from "./types";
import {
  reportProgress,
  reportError,
  getPluginCookie,
  openBrowser,
  closeBrowser,
} from "@symbiosis-lab/moss-api";
import { initApi, getProfileUrl } from "./api";
import { getConfig, saveConfig } from "./config";
import { pullNotes } from "./pull";
import { pushNote } from "./push";
import { parseFrontmatter } from "./converter";

/**
 * Check if the user is authenticated with Xiaohongshu.
 * Xiaohongshu uses session cookies on .xiaohongshu.com.
 */
async function isAuthenticated(): Promise<boolean> {
  try {
    // Xiaohongshu uses various session cookies; check for the main one
    const session = await getPluginCookie("web_session");
    return !!session;
  } catch {
    return false;
  }
}

/**
 * Prompt the user to log in via the action panel browser.
 * Xiaohongshu supports QR code login, phone/SMS, and password auth.
 */
async function authenticate(): Promise<boolean> {
  await reportProgress("auth", 0, 100, "Please log in to Xiaohongshu");

  const browser = await openBrowser("https://www.xiaohongshu.com/login");

  // Poll for the session cookie
  const maxWait = 300000; // 5 minutes
  const pollInterval = 2000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    if (await isAuthenticated()) {
      await closeBrowser();
      await reportProgress("auth", 100, 100, "Logged in to Xiaohongshu");
      return true;
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  await closeBrowser();
  await reportError("Authentication timed out. Please try again.");
  return false;
}

/**
 * Process hook -- runs before build.
 * Pulls notes from Xiaohongshu to local files.
 */
export async function process(context: ProcessContext): Promise<HookResult> {
  const config = {
    ...(await getConfig()),
    ...context.config,
  };

  // Check configuration
  if (!config.profile_url) {
    return {
      success: false,
      message: "Profile URL not configured. Set profile_url in plugin config.",
    };
  }

  if (!config.sync_on_build) {
    return { success: true, message: "Sync disabled (sync_on_build = false)" };
  }

  initApi(config.profile_url);

  // Check authentication
  if (!(await isAuthenticated())) {
    const loggedIn = await authenticate();
    if (!loggedIn) {
      return { success: false, message: "Not authenticated with Xiaohongshu" };
    }
  }

  try {
    // Pull notes to the content directory
    const contentDir = "article";
    const synced = await pullNotes(contentDir);

    return {
      success: true,
      message:
        synced > 0
          ? `Pulled ${synced} notes from Xiaohongshu`
          : "All notes up to date",
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await reportError(`Pull failed: ${msg}`);
    return { success: false, message: `Pull failed: ${msg}` };
  }
}

/**
 * Syndicate hook -- runs after deployment.
 * Pushes new/updated notes to Xiaohongshu.
 */
export async function syndicate(
  context: SyndicateContext
): Promise<HookResult> {
  const config = {
    ...(await getConfig()),
    ...context.config,
  };

  if (!config.profile_url) {
    return {
      success: false,
      message: "Profile URL not configured",
    };
  }

  initApi(config.profile_url);

  if (!(await isAuthenticated())) {
    const loggedIn = await authenticate();
    if (!loggedIn) {
      return { success: false, message: "Not authenticated with Xiaohongshu" };
    }
  }

  try {
    let pushed = 0;

    for (const article of context.articles) {
      // Skip articles that already have a Xiaohongshu URL in frontmatter
      const { frontmatter } = parseFrontmatter(article.content);
      if (frontmatter.xiaohongshu_url) {
        continue;
      }

      const url = await pushNote(article.content);
      if (url) {
        pushed++;
      }
    }

    return {
      success: true,
      message:
        pushed > 0
          ? `Pushed ${pushed} notes to Xiaohongshu`
          : "No new notes to push",
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await reportError(`Push failed: ${msg}`);
    return { success: false, message: `Push failed: ${msg}` };
  }
}
