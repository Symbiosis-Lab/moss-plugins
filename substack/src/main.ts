/**
 * Substack Syndicator Plugin
 *
 * Syndicates articles to/from Substack.
 * Uses Substack's REST API for pulling and DOM automation for pushing.
 *
 * Capabilities: process (pull), syndicate (push)
 * Auth: cookie-based (substack.sid on .substack.com, ~90 day session)
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
import { initApi, getPublicationUrl } from "./api";
import { getConfig, saveConfig } from "./config";
import { pullArticles } from "./pull";
import { pushArticle } from "./push";
import { parseFrontmatter } from "./converter";

/**
 * Check if the user is authenticated with Substack.
 * The session cookie `substack.sid` is set on `.substack.com`.
 */
async function isAuthenticated(): Promise<boolean> {
  try {
    const sid = await getPluginCookie("substack.sid");
    return !!sid;
  } catch {
    return false;
  }
}

/**
 * Prompt the user to log in via the action panel browser.
 * Substack uses magic-link auth — user enters email, clicks link in inbox.
 */
async function authenticate(): Promise<boolean> {
  await reportProgress("auth", 0, 100, "Please log in to Substack");

  const browser = await openBrowser("https://substack.com/sign-in");

  // Poll for the session cookie
  const maxWait = 300000; // 5 minutes
  const pollInterval = 2000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    if (await isAuthenticated()) {
      await closeBrowser();
      await reportProgress("auth", 100, 100, "Logged in to Substack");
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
 * Pulls articles from Substack to local files.
 */
export async function process(context: ProcessContext): Promise<HookResult> {
  const config = {
    ...(await getConfig()),
    ...context.config,
  };

  // Check configuration
  if (!config.publication_url) {
    return {
      success: false,
      message: "Publication URL not configured. Set publication_url in plugin config.",
    };
  }

  if (!config.sync_on_build) {
    return { success: true, message: "Sync disabled (sync_on_build = false)" };
  }

  initApi(config.publication_url);

  // Check authentication
  if (!(await isAuthenticated())) {
    const loggedIn = await authenticate();
    if (!loggedIn) {
      return { success: false, message: "Not authenticated with Substack" };
    }
  }

  try {
    // Pull articles to the content directory
    // Default content dir: "article/" (matching Matters plugin pattern)
    const contentDir = "article";
    const synced = await pullArticles(contentDir);

    return {
      success: true,
      message:
        synced > 0
          ? `Pulled ${synced} articles from Substack`
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
 * Pushes new/updated articles to Substack.
 */
export async function syndicate(
  context: SyndicateContext
): Promise<HookResult> {
  const config = {
    ...(await getConfig()),
    ...context.config,
  };

  if (!config.publication_url) {
    return {
      success: false,
      message: "Publication URL not configured",
    };
  }

  initApi(config.publication_url);

  if (!(await isAuthenticated())) {
    const loggedIn = await authenticate();
    if (!loggedIn) {
      return { success: false, message: "Not authenticated with Substack" };
    }
  }

  try {
    let pushed = 0;

    for (const article of context.articles) {
      // Skip articles that already have a Substack URL in frontmatter
      const { frontmatter } = parseFrontmatter(article.content);
      if (frontmatter.substack_url) {
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
          ? `Pushed ${pushed} articles to Substack`
          : "No new articles to push",
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await reportError(`Push failed: ${msg}`);
    return { success: false, message: `Push failed: ${msg}` };
  }
}
