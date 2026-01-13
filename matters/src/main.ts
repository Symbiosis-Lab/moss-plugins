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
  fetchAllArticlesSince,
  fetchAllDrafts,
  fetchAllCollections,
  fetchUserProfile,
  fetchArticleComments,
  fetchArticleDonations,
  fetchArticleAppreciations,
  createDraft,
  fetchDraft,
  apiConfig,
} from "./api";
import { syncToLocalFiles } from "./sync";
import { downloadMediaAndUpdate, rewriteAllInternalLinks } from "./downloader";
import { getConfig, saveConfig } from "./config";
import { loadSocialData, saveSocialData, mergeSocialData } from "./social";
import { readFile, writeFile, showToast } from "@symbiosis-lab/moss-api";
import { parseFrontmatter, regenerateFrontmatter } from "./converter";

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
 * process hook - Check authentication and sync articles from Matters
 *
 * This capability pre-processes content before generation.
 */
export async function process(context: BeforeBuildContext): Promise<HookResult> {
  setCurrentHookName("process");
  clearTokenCache();

  await log("log", "🔐 Matters: process hook started");

  try {
    // Phase 1: Authentication
    await reportProgress("authentication", 0, 1, "Checking authentication...");
    let isAuthenticated = await checkAuthentication();
    let usingUnauthenticatedMode = false;

    if (!isAuthenticated) {
      // Check if we have a saved userName in config for unauthenticated fallback
      const config = await getConfig();

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

    // Get config for incremental sync
    const pluginConfig = await getConfig();
    const lastSyncedAt = pluginConfig.lastSyncedAt;
    if (lastSyncedAt) {
      await log("log", `📅 Last synced at: ${lastSyncedAt}`);
    } else {
      await log("log", "📅 No previous sync - will fetch all articles");
    }

    // Phase 2: Fetch articles (with incremental sync)
    await reportProgress("fetching_articles", 0, 1, "Fetching articles from Matters.town...");
    const { articles, userName } = await fetchAllArticlesSince(lastSyncedAt);
    await reportProgress("fetching_articles", 1, 1, `Found ${articles.length} article(s) to sync`);
    await log("log", `   Found ${articles.length} article(s) to sync`);

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
        const existingConfig = await getConfig();
        if (existingConfig.userName !== profile.userName || existingConfig.language !== profile.language) {
          await saveConfig({
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
    const mediaResult = await downloadMediaAndUpdate();
    const linkResult = await rewriteAllInternalLinks(articlePathMap, userName);

    const mediaSummary =
      mediaResult.imagesDownloaded > 0 || mediaResult.imagesSkipped > 0
        ? `, ${mediaResult.imagesDownloaded} images downloaded, ${mediaResult.imagesSkipped} failed`
        : "";

    const linkSummary =
      linkResult.linksRewritten > 0
        ? `, ${linkResult.linksRewritten} internal links rewritten`
        : "";

    // Phase 8: Fetch social data (comments, donations, appreciations) for synced articles
    let socialSummary = "";
    if (articles.length > 0) {
      await reportProgress("fetching_social", 0, articles.length, "Fetching social data...");
      await log("log", "📊 Fetching social data (comments, donations, appreciations)...");

      const socialData = await loadSocialData();
      let totalComments = 0;
      let totalDonations = 0;
      let totalAppreciations = 0;

      for (let i = 0; i < articles.length; i++) {
        const article = articles[i];
        await reportProgress(
          "fetching_social",
          i + 1,
          articles.length,
          `Social data: ${article.title}`
        );

        try {
          const [comments, donations, appreciations] = await Promise.all([
            fetchArticleComments(article.shortHash),
            fetchArticleDonations(article.shortHash),
            fetchArticleAppreciations(article.shortHash),
          ]);

          mergeSocialData(socialData, article.shortHash, comments, donations, appreciations);

          totalComments += comments.length;
          totalDonations += donations.length;
          totalAppreciations += appreciations.length;
        } catch (error) {
          await log("warn", `   Failed to fetch social data for ${article.title}: ${error}`);
        }
      }

      await saveSocialData(socialData);
      socialSummary = `, ${totalComments} comments, ${totalDonations} donations, ${totalAppreciations} appreciations`;
      await log("log", `✅ Social data saved: ${totalComments} comments, ${totalDonations} donations, ${totalAppreciations} appreciations`);
    }

    // Phase 9: Update lastSyncedAt timestamp
    const syncEndTime = new Date().toISOString();
    try {
      const currentConfig = await getConfig();
      await saveConfig({
        ...currentConfig,
        lastSyncedAt: syncEndTime,
      });
      await log("log", `📅 Updated lastSyncedAt to ${syncEndTime}`);
    } catch (error) {
      await log("warn", `Failed to save lastSyncedAt: ${error}`);
    }

    await reportProgress("complete", 1, 1, `Complete: ${summary}${mediaSummary}${linkSummary}${socialSummary}`);

    const allErrors = [...syncResult.errors, ...mediaResult.errors, ...linkResult.errors];
    return {
      success: allErrors.length === 0,
      message: `Synced from Matters: ${summary}${mediaSummary}${linkSummary}${socialSummary}`,
    };
  } catch (error) {
    await reportError(`Sync failed: ${error}`, "process", true);
    await log("error", `❌ Matters: Sync failed: ${error}`);
    return {
      success: false,
      message: `Sync failed: ${error}`,
    };
  }
}

/**
 * syndicate hook - Syndicate articles to Matters.town
 *
 * This capability publishes content to external platforms after deployment.
 * Articles are syndicated one at a time (sequentially) to allow user review.
 */
export async function syndicate(context: AfterDeployContext): Promise<HookResult> {
  setCurrentHookName("syndicate");
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

    // Filter to only articles that don't already have a Matters syndication URL
    const articlesToSyndicate = articles.filter((article) => {
      const syndicated = (article.frontmatter.syndicated as string[] | undefined) || [];
      return !syndicated.some((url: string) => url.includes("matters.town"));
    });

    if (articlesToSyndicate.length === 0) {
      console.log("ℹ️  No new articles to syndicate (all already syndicated to Matters)");
      return {
        success: true,
        message: "No new articles to syndicate",
      };
    }

    console.log(`📡 Syndicating ${articlesToSyndicate.length} article(s) to Matters.town`);
    console.log(`🌐 Deployed site: ${siteUrl}`);
    console.log(`📅 Deployed at: ${deployed_at}`);

    // Show starting toast
    await showToast("Starting Matters syndication...", "info", 3000);

    // Check authentication
    const isAuthenticated = await checkAuthentication();
    if (!isAuthenticated) {
      console.log("🔐 Not authenticated, prompting login...");
      await showToast("Matters login required", "info", 5000);
      const loginSuccess = await promptLogin();
      if (!loginSuccess) {
        await showToast("Login cancelled", "warning", 3000);
        return {
          success: false,
          message: "Login required for syndication",
        };
      }
    }

    // Get userName from config or profile
    const pluginConfig = await getConfig();
    let userName = pluginConfig.userName;
    if (!userName) {
      const profile = await fetchUserProfile();
      userName = profile.userName;
    }

    const config = context.config || {};
    const addCanonicalLink = config.add_canonical_link ?? true;

    // Syndicate articles sequentially (one at a time for user review)
    let published = 0;
    let draftsCreated = 0;
    const errors: string[] = [];

    for (const article of articlesToSyndicate) {
      try {
        const result = await syndicateArticle(article, siteUrl, userName, {
          addCanonicalLink: addCanonicalLink as boolean,
        });

        if (result.publishedUrl) {
          published++;
        } else {
          draftsCreated++;
        }
      } catch (error) {
        console.error(`    ✗ Failed to syndicate ${article.title}:`, error);
        errors.push(`${article.title}: ${error}`);
      }
    }

    const parts: string[] = [];
    if (published > 0) parts.push(`${published} published`);
    if (draftsCreated > 0) parts.push(`${draftsCreated} drafts created`);
    if (errors.length > 0) parts.push(`${errors.length} failed`);

    const summary = parts.join(", ");

    if (errors.length > 0) {
      console.warn(`⚠️  Syndication complete: ${summary}`);
      return {
        success: true,
        message: `Syndication: ${summary}`,
      };
    }

    console.log(`✅ Syndication complete: ${summary}`);

    return {
      success: true,
      message: `Syndication: ${summary}`,
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
 *
 * Workflow:
 * 1. Create draft via API
 * 2. Open draft in browser for user to review
 * 3. Poll for publish state change
 * 4. On publish: close browser, update local frontmatter
 * 5. On timeout: close browser, leave draft for later
 */
async function syndicateArticle(
  article: ArticleInfo,
  siteUrl: string,
  userName: string,
  options: { addCanonicalLink: boolean }
): Promise<{ draftId: string; publishedUrl?: string }> {
  console.log(`  → Syndicating: ${article.title}`);

  // Show creating draft toast
  await showToast(`Creating draft: ${article.title}`, "info", 5000);

  const canonicalUrl = `${siteUrl.replace(/\/$/, "")}/${article.url_path.replace(/^\//, "")}`;

  let content = article.content;

  if (options.addCanonicalLink) {
    content = addCanonicalLinkToContent(content, canonicalUrl);
  }

  // Step 1: Create draft via API
  const draft = await createDraft({
    title: article.title,
    content,
    tags: article.tags,
  });

  console.log(`    📝 Draft created with ID: ${draft.id}`);

  // Show draft ready toast
  await showToast("Draft created! Opening for review...", "success", 3000);

  // Step 2: Open draft in browser for user review
  const draftUrl = `https://matters.town/me/drafts/${draft.id}`;
  console.log(`    🌐 Opening draft for review: ${draftUrl}`);
  await openBrowser(draftUrl);

  // Step 3: Poll for publish state change (10 min timeout)
  const publishedArticle = await waitForPublishOrClose(draft.id, 600000);

  if (publishedArticle) {
    // Step 4: Article was published - update local frontmatter
    const publishedUrl = `https://matters.town/@${userName}/${publishedArticle.slug}-${publishedArticle.shortHash}`;
    console.log(`    ✅ Published: ${publishedUrl}`);

    // Show success toast
    await showToast(`Published to Matters!`, "success", 5000);

    // Update the local markdown file's frontmatter
    if (article.source_path) {
      await updateFrontmatterSyndicated(article.source_path, publishedUrl);
      console.log(`    📝 Updated frontmatter with syndicated URL`);
    }

    return { draftId: draft.id, publishedUrl };
  }

  // Step 5: Timeout - draft left for later
  console.log(`    ⏱️ Publish timeout - draft saved for later`);
  await showToast("Draft saved - publish when ready", "info", 5000);
  return { draftId: draft.id };
}

/**
 * Wait for draft to be published or timeout
 *
 * Polls the draft every 5 seconds to check if it has been published.
 * Returns the published article info if published, null on timeout.
 */
async function waitForPublishOrClose(
  draftId: string,
  timeoutMs: number
): Promise<{ shortHash: string; slug: string } | null> {
  const startTime = Date.now();
  const pollInterval = 5000; // 5 seconds

  console.log(`    ⏳ Waiting for publish (timeout: ${timeoutMs / 1000}s)...`);

  while (Date.now() - startTime < timeoutMs) {
    await sleep(pollInterval);

    try {
      const draft = await fetchDraft(draftId);

      if (draft?.article) {
        // Draft was published
        console.log(`    🎉 Publish detected!`);
        try {
          await closeBrowser();
        } catch {
          // Browser might already be closed
        }
        return {
          shortHash: draft.article.shortHash,
          slug: draft.article.slug,
        };
      }
    } catch (error) {
      console.warn(`    ⚠️ Error checking draft status: ${error}`);
    }
  }

  // Timeout - close browser
  console.log(`    ⏱️ Timeout reached, closing browser...`);
  try {
    await closeBrowser();
  } catch {
    // Browser might already be closed
  }

  return null;
}

/**
 * Update the syndicated field in article frontmatter
 */
async function updateFrontmatterSyndicated(
  filePath: string,
  publishedUrl: string
): Promise<void> {
  try {
    const content = await readFile(filePath);
    const parsed = parseFrontmatter(content);

    if (!parsed) {
      console.warn(`    ⚠️ Could not parse frontmatter for ${filePath}`);
      return;
    }

    // Add to syndicated array if not already present
    const syndicated = (parsed.frontmatter.syndicated as string[]) || [];
    if (!syndicated.includes(publishedUrl)) {
      syndicated.push(publishedUrl);
      parsed.frontmatter.syndicated = syndicated;
    }

    // Regenerate file with updated frontmatter
    const newContent = regenerateFrontmatter(parsed.frontmatter) + "\n\n" + parsed.body;
    await writeFile(filePath, newContent);
  } catch (error) {
    console.warn(`    ⚠️ Failed to update frontmatter: ${error}`);
  }
}

/**
 * Add canonical link to article content
 */
function addCanonicalLinkToContent(content: string, canonicalUrl: string): string {
  const canonicalNotice = `\n\n---\n\n*Originally published at [${canonicalUrl}](${canonicalUrl})*\n`;
  return content + canonicalNotice;
}
