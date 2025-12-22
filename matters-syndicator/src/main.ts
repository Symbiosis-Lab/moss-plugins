/**
 * Matters.town Syndicator Plugin
 *
 * Syndicates articles to Matters.town after deployment.
 * Requires authentication via webview (domain: matters.town)
 */

import type {
  BeforeBuildContext,
  AfterDeployContext,
  HookResult,
  ArticleInfo,
} from "./types";
import {
  log,
  reportProgress,
  reportError,
  setCurrentHookName,
  sleep,
} from "./utils";
import {
  clearTokenCache,
  getAccessToken,
  fetchAllArticles,
  fetchAllDrafts,
  fetchAllCollections,
  fetchUserProfile,
  apiConfig,
} from "./api";
import { syncToLocalFiles } from "./sync";
import { downloadMediaAndUpdate, rewriteAllInternalLinks } from "./downloader";
import { getConfig, saveConfig } from "./config";

// ============================================================================
// Browser Utilities (via SDK)
// ============================================================================

import { openBrowser, closeBrowser } from "@symbiosis-lab/moss-api";

// ============================================================================
// Authentication Helpers
// ============================================================================

/**
 * Check if user is authenticated with Matters.town
 */
async function checkAuthentication(): Promise<boolean> {
  await log("log", "🔍 Checking Matters.town authentication...");

  try {
    const token = await getAccessToken();
    const isAuthenticated = token !== null;
    await log(
      "log",
      `Authentication check result: ${isAuthenticated ? "AUTHENTICATED" : "NOT AUTHENTICATED"}`
    );
    return isAuthenticated;
  } catch (error) {
    await log("error", `Failed to check authentication: ${error}`);
    return false;
  }
}

/**
 * Wait for access token by polling for cookie
 */
async function waitForToken(
  initialDelayMs = 20000,
  pollIntervalMs = 2000,
  maxWaitMs = 300000
): Promise<boolean> {
  await log("log", `⏳ Waiting ${initialDelayMs / 1000}s before checking for token...`);
  await sleep(initialDelayMs);

  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs - initialDelayMs) {
    clearTokenCache();
    const token = await getAccessToken();

    if (token) {
      await log("log", "🔑 Token found!");
      return true;
    }

    await sleep(pollIntervalMs);
  }

  return false;
}

/**
 * Prompt user to login to Matters.town
 */
async function promptLogin(): Promise<boolean> {
  await log("log", "🔐 Opening Matters.town login page...");

  try {
    await openBrowser("https://matters.town/login");

    await log("log", "🌐 Browser opened. Please log in to Matters.town.");
    await log("log", "⏳ Will check for authentication after 20 seconds...");

    const authenticated = await waitForToken(20000, 2000, 300000);

    if (authenticated) {
      await log("log", "✅ Login successful, closing browser...");
      try {
        await closeBrowser();
      } catch {
        // Browser might already be closed
      }
      return true;
    } else {
      await log("warn", "⏱️  Login timeout (5 minutes). Closing browser...");
      try {
        await closeBrowser();
      } catch {
        // Ignore close errors
      }
      return false;
    }
  } catch (error) {
    await log("error", `❌ Login flow failed: ${error}`);
    try {
      await closeBrowser();
    } catch {
      // Ignore close errors
    }
    return false;
  }
}

// ============================================================================
// Hook Implementations
// ============================================================================

/**
 * before_build hook - Check authentication and sync articles from Matters
 */
export async function before_build(context: BeforeBuildContext): Promise<HookResult> {
  setCurrentHookName("before_build");
  clearTokenCache();

  await log("log", "🔐 Matters: before_build hook started");
  await log("log", `   Project: ${context.project_path}`);

  try {
    // Store project path in window for Tauri commands
    (window as unknown as { __MOSS_PROJECT_PATH__: string }).__MOSS_PROJECT_PATH__ = context.project_path;
    await log("log", "   Project path stored in window.__MOSS_PROJECT_PATH__");

    // Phase 1: Authentication
    await reportProgress("authentication", 0, 1, "Checking authentication...");
    let isAuthenticated = await checkAuthentication();
    let usingUnauthenticatedMode = false;

    if (!isAuthenticated) {
      // Check if we have a saved userName in config for unauthenticated fallback
      const config = await getConfig(context.project_path);

      if (config.userName) {
        // Use unauthenticated mode with saved userName
        await log("log", `🔓 Not authenticated, using saved username: @${config.userName}`);
        await log("log", "   Note: Drafts will not be available in unauthenticated mode");

        // Configure API to use public user queries
        apiConfig.queryMode = "user";
        apiConfig.testUserName = config.userName;
        usingUnauthenticatedMode = true;

        await reportProgress("authentication", 1, 1, `Using saved user: @${config.userName}`);
        await log("log", `✅ Matters: Using unauthenticated mode for @${config.userName}`);
      } else {
        // No saved username, prompt for login
        await log("warn", "🔓 Not authenticated, will prompt login...");
        await reportProgress("authentication", 0, 1, "Waiting for login...");

        const loginSuccess = await promptLogin();

        if (!loginSuccess) {
          await reportError("Login failed or timeout", "authentication", true);
          return {
            success: false,
            message: "Login failed or timeout. Please try again.",
          };
        }

        isAuthenticated = true;
        await reportProgress("authentication", 1, 1, "Authenticated");
        await log("log", "✅ Matters: Authenticated");
      }
    } else {
      await log("log", "✅ Already authenticated, skipping browser");
      await reportProgress("authentication", 1, 1, "Authenticated");
      await log("log", "✅ Matters: Authenticated");
    }

    // Check if sync is enabled
    const syncOnBuild = context.config?.sync_on_build ?? true;
    if (!syncOnBuild) {
      await log("log", "ℹ️  Sync on build is disabled, skipping...");
      return {
        success: true,
        message: "Authenticated (sync disabled)",
      };
    }

    // Phase 2: Fetch articles
    await reportProgress("fetching_articles", 0, 1, "Fetching articles from Matters.town...");
    const { articles, userName } = await fetchAllArticles();
    await reportProgress("fetching_articles", 1, 1, `Found ${articles.length} published article(s)`);
    await log("log", `   Found ${articles.length} published article(s)`);

    // Phase 3: Fetch drafts
    await reportProgress("fetching_drafts", 0, 1, "Fetching drafts from Matters.town...");
    const drafts = await fetchAllDrafts();
    await reportProgress("fetching_drafts", 1, 1, `Found ${drafts.length} draft(s)`);
    await log("log", `   Found ${drafts.length} draft(s)`);

    // Phase 4: Fetch collections
    await reportProgress("fetching_collections", 0, 1, "Fetching collections from Matters.town...");
    const collections = await fetchAllCollections();
    await reportProgress("fetching_collections", 1, 1, `Found ${collections.length} collection(s)`);
    await log("log", `   Found ${collections.length} collection(s)`);

    // Phase 5: Fetch user profile (for homepage and language detection)
    await reportProgress("fetching_profile", 0, 1, "Fetching user profile...");
    const profile = await fetchUserProfile();
    await reportProgress("fetching_profile", 1, 1, `Profile: ${profile.displayName}`);
    await log("log", `   Profile: ${profile.displayName} (language: ${profile.language || "default"})`);

    // Save userName to config for future unauthenticated fallback (only when authenticated)
    if (isAuthenticated && !usingUnauthenticatedMode) {
      try {
        const existingConfig = await getConfig(context.project_path);
        if (existingConfig.userName !== profile.userName || existingConfig.language !== profile.language) {
          await saveConfig(context.project_path, {
            ...existingConfig,
            userName: profile.userName,
            language: profile.language,
          });
          await log("log", `   Saved username @${profile.userName} to config for future unauthenticated access`);
        }
      } catch (error) {
        // Non-fatal: just log the error
        await log("warn", `   Failed to save config: ${error}`);
      }
    }

    // Phase 6: Sync to local files
    await reportProgress("syncing", 0, articles.length + drafts.length + collections.length + 1, "Starting sync...");
    const { result: syncResult, articlePathMap } = await syncToLocalFiles(
      articles,
      drafts,
      collections,
      userName,
      context.project_path,
      context.config || {},
      profile
    );

    // Build summary message
    const parts: string[] = [];
    if (syncResult.created > 0) parts.push(`${syncResult.created} created`);
    if (syncResult.updated > 0) parts.push(`${syncResult.updated} updated`);
    if (syncResult.skipped > 0) parts.push(`${syncResult.skipped} unchanged`);
    if (syncResult.errors.length > 0) parts.push(`${syncResult.errors.length} errors`);

    const summary = parts.length > 0 ? parts.join(", ") : "no changes";
    await reportProgress("syncing", 1, 1, `Sync complete: ${summary}`);
    await log("log", `✅ Sync complete: ${summary}`);

    // Phase 7: Post-sync processing (run SEQUENTIALLY to avoid race conditions)
    // Both operations read/write the same markdown files, so they must not run in parallel.
    // Order: Media download first (updates image references), then link rewriting
    const mediaResult = await downloadMediaAndUpdate(context.project_path);
    const linkResult = await rewriteAllInternalLinks(context.project_path, articlePathMap, userName);

    const mediaSummary =
      mediaResult.imagesDownloaded > 0 || mediaResult.imagesSkipped > 0
        ? `, ${mediaResult.imagesDownloaded} images downloaded, ${mediaResult.imagesSkipped} failed`
        : "";

    const linkSummary =
      linkResult.linksRewritten > 0
        ? `, ${linkResult.linksRewritten} internal links rewritten`
        : "";

    await reportProgress("complete", 1, 1, `Complete: ${summary}${mediaSummary}${linkSummary}`);

    const allErrors = [...syncResult.errors, ...mediaResult.errors, ...linkResult.errors];
    return {
      success: allErrors.length === 0,
      message: `Synced from Matters: ${summary}${mediaSummary}${linkSummary}`,
    };
  } catch (error) {
    await reportError(`Sync failed: ${error}`, "before_build", true);
    await log("error", `❌ Matters: Sync failed: ${error}`);
    return {
      success: false,
      message: `Sync failed: ${error}`,
    };
  }
}

/**
 * after_deploy hook - Syndicate articles to Matters.town
 */
export async function after_deploy(context: AfterDeployContext): Promise<HookResult> {
  setCurrentHookName("after_deploy");
  clearTokenCache();

  console.log("📡 Matters: Starting syndication...");

  try {
    if (!context.deployment) {
      return {
        success: false,
        message: "No deployment information available",
      };
    }

    const { url: siteUrl, deployed_at } = context.deployment;
    const { articles } = context;

    if (articles.length === 0) {
      console.log("ℹ️  No articles to syndicate");
      return {
        success: true,
        message: "No articles to syndicate",
      };
    }

    console.log(`📡 Syndicating ${articles.length} article(s) to Matters.town`);
    console.log(`🌐 Deployed site: ${siteUrl}`);
    console.log(`📅 Deployed at: ${deployed_at}`);

    const config = context.config || {};
    const autoPublish = config.auto_publish ?? false;
    const addCanonicalLink = config.add_canonical_link ?? true;

    const results = await Promise.allSettled(
      articles.map((article) =>
        syndicateArticle(article, siteUrl, { autoPublish: autoPublish as boolean, addCanonicalLink: addCanonicalLink as boolean })
      )
    );

    const successes = results.filter((r) => r.status === "fulfilled").length;
    const failures = results.filter((r) => r.status === "rejected").length;

    if (failures > 0) {
      console.warn(`⚠️  Syndicated ${successes}/${articles.length} articles (${failures} failed)`);
      return {
        success: true,
        message: `Partially syndicated: ${successes}/${articles.length} articles`,
      };
    }

    console.log(`✅ Successfully syndicated ${successes} article(s) to Matters.town`);

    return {
      success: true,
      message: `Syndicated ${successes} articles to Matters.town`,
    };
  } catch (error) {
    console.error("❌ Matters: Syndication failed:", error);
    return {
      success: false,
      message: `Syndication failed: ${error}`,
    };
  }
}

// ============================================================================
// Syndication Helpers
// ============================================================================

/**
 * Syndicate a single article to Matters.town
 */
async function syndicateArticle(
  article: ArticleInfo,
  siteUrl: string,
  options: { autoPublish: boolean; addCanonicalLink: boolean }
): Promise<void> {
  console.log(`  → Syndicating: ${article.title}`);

  try {
    const canonicalUrl = `${siteUrl.replace(/\/$/, "")}/${article.url_path.replace(/^\//, "")}`;

    let content = article.content;

    if (options.addCanonicalLink) {
      content = addCanonicalLinkToContent(content, canonicalUrl);
    }

    await createMattersDraft({
      title: article.title,
      content,
      tags: article.tags,
      canonicalUrl,
      publish: options.autoPublish,
    });

    console.log(`    ✓ Syndicated: ${article.title}`);
  } catch (error) {
    console.error(`    ✗ Failed to syndicate ${article.title}:`, error);
    throw error;
  }
}

/**
 * Add canonical link to article content
 */
function addCanonicalLinkToContent(content: string, canonicalUrl: string): string {
  const canonicalNotice = `\n\n---\n\n*Originally published at [${canonicalUrl}](${canonicalUrl})*\n`;
  return content + canonicalNotice;
}

/**
 * Create a draft on Matters.town (placeholder)
 */
async function createMattersDraft(params: {
  title: string;
  content: string;
  tags: string[];
  canonicalUrl: string;
  publish: boolean;
}): Promise<void> {
  console.log(`    📝 Creating draft on Matters: ${params.title}`);
  console.log(`       Tags: ${params.tags.join(", ")}`);
  console.log(`       Canonical: ${params.canonicalUrl}`);
  console.log(`       Auto-publish: ${params.publish}`);

  await sleep(200);

  console.log(`    ✓ Draft created (placeholder)`);
}
