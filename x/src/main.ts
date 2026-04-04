/**
 * X Syndicator Plugin
 *
 * Syndicates articles to/from X (Twitter).
 * Uses DOM scraping for pulling and DOM automation for pushing.
 *
 * Capabilities: process (pull), syndicate (push)
 * Auth: cookie-based (auth_token on .x.com)
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
import { pullArticles } from "./pull";
import { pushArticle } from "./push";
import { parseFrontmatter } from "./converter";

/**
 * Check if the user is authenticated with X.
 * The session cookie `auth_token` is set on `.x.com`.
 */
async function isAuthenticated(): Promise<boolean> {
  try {
    const token = await getPluginCookie("auth_token");
    return !!token;
  } catch {
    return false;
  }
}

/**
 * Prompt the user to log in via the action panel browser.
 * X uses username/password or SSO authentication.
 */
async function authenticate(): Promise<boolean> {
  await reportProgress("auth", 0, 100, "Please log in to X");

  const browser = await openBrowser("https://x.com/i/flow/login");

  // Poll for the session cookie
  const maxWait = 300000; // 5 minutes
  const pollInterval = 2000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    if (await isAuthenticated()) {
      await closeBrowser();
      await reportProgress("auth", 100, 100, "Logged in to X");
      return true;
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  await closeBrowser();
  await reportError("Authentication timed out. Please try again.");
  return false;
}

/**
 * Process hook — runs before build.
 * Pulls articles from X to local files.
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
      return { success: false, message: "Not authenticated with X" };
    }
  }

  try {
    // Pull articles to the content directory
    const contentDir = "article";
    const synced = await pullArticles(contentDir);

    return {
      success: true,
      message:
        synced > 0
          ? `Pulled ${synced} articles from X`
          : "All articles up to date",
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await reportError(`Pull failed: ${msg}`);
    return { success: false, message: `Pull failed: ${msg}` };
  }
}

/**
 * Syndicate hook — runs after deployment.
 * Pushes new/updated articles to X.
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
      return { success: false, message: "Not authenticated with X" };
    }
  }

  try {
    let pushed = 0;

    for (const article of context.articles) {
      // Skip articles that already have an X URL in frontmatter
      const { frontmatter } = parseFrontmatter(article.content);
      if (frontmatter.x_url) {
        continue;
      }

      const url = await pushArticle(article.content);
      if (url) {
        pushed++;
      }
    }

    return {
      success: true,
      message:
        pushed > 0
          ? `Pushed ${pushed} articles to X`
          : "No new articles to push",
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await reportError(`Push failed: ${msg}`);
    return { success: false, message: `Push failed: ${msg}` };
  }
}
