/**
 * Matters.town Syndicator Plugin
 *
 * Syndicates articles to Matters.town after deployment.
 * Requires authentication via webview (domain: matters.town)
 */

import type {
  ProcessContext,
  SyndicateContext,
  HookResult,
  ArticleInfo,
} from "./types";
import {
  reportProgress,
  reportError,
  setCurrentHookName,
  sleep,
} from "./utils";
import {
  clearTokenCache,
  getAccessToken,
  fetchAllArticlesSince,
  fetchAllDraftsSince,
  fetchAllCollections,
  fetchUserProfile,
  fetchArticleComments,
  createDraft,
  fetchDraft,
  uploadCoverByUrl,
  uploadEmbedByUrl,
  apiConfig,
} from "./api";
import { syncToLocalFiles, scanLocalArticles, detectBoundUser } from "./sync";
import { downloadMediaAndUpdate, rewriteAllInternalLinks } from "./downloader";
import { getConfig, saveConfig } from "./config";
import { overallProgress } from "./progress";
import { loadSocialData, saveSocialData, mergeSocialData } from "./social";
import {
  readFile,
  writeFile,
  showToast,
  readPluginFile,
  writePluginFile,
  pluginFileExists,
} from "@symbiosis-lab/moss-api";
import { parseFrontmatter, regenerateFrontmatter } from "./converter";
import {
  initializeDomain,
  loginUrl,
  draftUrl,
  articleUrl,
  isMattersUrl,
} from "./domain";

// ============================================================================
// Draft Tracking
// ============================================================================

/**
 * Draft entry stored in drafts.json
 */
export interface DraftEntry {
  draftId: string;
  createdAt: string;
}

/**
 * Map of source_path -> draft entry
 */
export type DraftMap = Record<string, DraftEntry>;

const DRAFTS_FILE = "drafts.json";

/**
 * Read the draft tracking map from plugin storage.
 * Returns empty object if file not found or invalid.
 */
export async function getDraftMap(): Promise<DraftMap> {
  try {
    const exists = await pluginFileExists(DRAFTS_FILE);
    if (!exists) return {};
    const content = await readPluginFile(DRAFTS_FILE);
    return JSON.parse(content) as DraftMap;
  } catch {
    return {};
  }
}

/**
 * Write the draft tracking map to plugin storage.
 */
export async function saveDraftMap(map: DraftMap): Promise<void> {
  const content = JSON.stringify(map, null, 2);
  await writePluginFile(DRAFTS_FILE, content);
}

/**
 * Look up a tracked draft ID for a source path.
 * Returns undefined if no draft is tracked.
 */
export async function getDraftId(sourcePath: string): Promise<string | undefined> {
  const map = await getDraftMap();
  return map[sourcePath]?.draftId;
}

/**
 * Persist a draft ID for a source path.
 */
export async function saveDraftId(sourcePath: string, draftId: string): Promise<void> {
  const map = await getDraftMap();
  map[sourcePath] = {
    draftId,
    createdAt: new Date().toISOString(),
  };
  await saveDraftMap(map);
}

/**
 * Remove a tracked draft for a source path (e.g., after publish).
 */
export async function removeDraftId(sourcePath: string): Promise<void> {
  const map = await getDraftMap();
  delete map[sourcePath];
  await saveDraftMap(map);
}

// ============================================================================
// Browser Utilities (via SDK)
// ============================================================================

import {
  openBrowser,
  closeBrowser,
  type BrowserHandle,
} from "@symbiosis-lab/moss-api";

// ============================================================================
// Authentication Helpers
// ============================================================================

/**
 * Check if user is authenticated with Matters.town
 */
async function checkAuthentication(): Promise<boolean> {
  console.log("🔍 Checking Matters.town authentication...");

  try {
    const token = await getAccessToken();
    // undefined = no context, null = no token, string = token found
    const isAuthenticated = typeof token === "string";
    console.log(
      `Authentication check result: ${isAuthenticated ? "AUTHENTICATED" : "NOT AUTHENTICATED"}`
    );
    return isAuthenticated;
  } catch (error) {
    console.error(`Failed to check authentication: ${error}`);
    return false;
  }
}

/**
 * Wait for access token by polling for cookie
 *
 * @param browserHandle - Handle from openBrowser() to detect window closure
 * @param initialDelayMs - Wait before first check (default: 20s)
 * @param pollIntervalMs - Time between checks (default: 2s)
 * @param maxWaitMs - Maximum total wait time (default: 5 minutes)
 * @returns true if token found, false if window closed or timeout
 */
async function waitForToken(
  browserHandle: BrowserHandle,
  initialDelayMs = 20000,
  pollIntervalMs = 2000,
  maxWaitMs = 300000
): Promise<boolean> {
  console.log(`⏳ Waiting ${initialDelayMs / 1000}s before checking for token...`);
  await sleep(initialDelayMs);

  const startTime = Date.now();
  let windowClosed = false;

  // Listen for window close
  browserHandle.closed.then(() => {
    windowClosed = true;
  });

  while (Date.now() - startTime < maxWaitMs - initialDelayMs) {
    // Exit immediately if window was closed
    if (windowClosed) {
      console.log("🚪 Browser window closed by user");
      return false;
    }

    clearTokenCache();
    const token = await getAccessToken();

    // Exit if context was lost (SDK returns undefined)
    if (token === undefined) {
      console.log("⚠️ Plugin context lost, stopping auth check");
      return false;
    }

    if (token) {
      console.log("🔑 Token found!");
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
  console.log("🔐 Opening Matters.town login page...");

  try {
    const browser = await openBrowser(loginUrl());

    console.log("🌐 Browser opened. Please log in to Matters.town.");
    console.log("⏳ Will check for authentication after 20 seconds...");

    const authenticated = await waitForToken(browser, 20000, 2000, 300000);

    if (authenticated) {
      console.log("✅ Login successful, closing browser...");
      try {
        await closeBrowser();
      } catch {
        // Browser might already be closed
      }
      return true;
    } else {
      console.warn("⏱️  Login timeout or window closed. Closing browser...");
      try {
        await closeBrowser();
      } catch {
        // Ignore close errors
      }
      return false;
    }
  } catch (error) {
    console.error(`❌ Login flow failed: ${error}`);
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
export async function process(context: ProcessContext): Promise<HookResult> {
  setCurrentHookName("process");
  clearTokenCache();
  await initializeDomain();

  console.log("🔐 Matters: process hook started");

  try {
    // Binding guard: only sync if project is bound to a Matters account
    {
      const bindingConfig = await getConfig();
      if (!bindingConfig.boundUserName) {
        const detectedUser = await detectBoundUser();
        if (detectedUser) {
          // Auto-bind from existing articles
          await saveConfig({ ...bindingConfig, boundUserName: detectedUser, userName: detectedUser });
          console.log(`🔗 Auto-bound to @${detectedUser} from existing articles`);
        } else {
          // Fresh project — require login to bind
          const loginSuccess = await promptLogin();
          if (!loginSuccess) {
            return {
              success: true,
              message: "No Matters account bound. Skipping sync.",
            };
          }
          // Fetch profile to get username for binding
          const profile = await fetchUserProfile();
          await saveConfig({
            ...bindingConfig,
            boundUserName: profile.userName,
            userName: profile.userName,
          });
          console.log(`🔗 Bound to @${profile.userName} via login`);
        }
      }
    }

    // Phase 1: Authentication
    await reportProgress("authentication", overallProgress("authentication", 0, 1), 100, "Checking authentication...");
    let isAuthenticated = await checkAuthentication();
    let usingUnauthenticatedMode = false;

    if (!isAuthenticated) {
      // Check if we have a saved userName in config for unauthenticated fallback
      const config = await getConfig();

      if (config.userName) {
        // Use unauthenticated mode with saved userName
        console.log(`🔓 Not authenticated, using saved username: @${config.userName}`);
        console.log("   Note: Drafts will not be available in unauthenticated mode");

        // Configure API to use public user queries
        apiConfig.queryMode = "user";
        apiConfig.testUserName = config.userName;
        usingUnauthenticatedMode = true;

        await reportProgress("authentication", overallProgress("authentication", 1, 1), 100, `Using saved user: @${config.userName}`);
        console.log(`✅ Matters: Using unauthenticated mode for @${config.userName}`);
      } else {
        // No saved username, prompt for login
        console.warn("🔓 Not authenticated, will prompt login...");
        await reportProgress("authentication", overallProgress("authentication", 0, 1), 100, "Waiting for login...");

        const loginSuccess = await promptLogin();

        if (!loginSuccess) {
          await reportError("Login failed or timeout", "authentication", true);
          return {
            success: false,
            message: "Login failed or timeout. Please try again.",
          };
        }

        isAuthenticated = true;
        await reportProgress("authentication", overallProgress("authentication", 1, 1), 100, "Authenticated");
        console.log("✅ Matters: Authenticated");
      }
    } else {
      console.log("✅ Already authenticated, skipping browser");
      await reportProgress("authentication", overallProgress("authentication", 1, 1), 100, "Authenticated");
      console.log("✅ Matters: Authenticated");
    }

    // Check if sync is enabled
    const syncOnBuild = context.config?.sync_on_build ?? true;
    if (!syncOnBuild) {
      console.log("ℹ️  Sync on build is disabled, skipping...");
      return {
        success: true,
        message: "Authenticated (sync disabled)",
      };
    }

    // Get config for incremental sync
    const pluginConfig = await getConfig();
    const lastSyncedAt = pluginConfig.lastSyncedAt;
    if (lastSyncedAt) {
      console.log(`📅 Last synced at: ${lastSyncedAt}`);
    } else {
      console.log("📅 No previous sync - will fetch all articles");
    }

    // Phase 2: Fetch articles (with incremental sync)
    await reportProgress("fetching_articles", overallProgress("fetching_articles", 0, 1), 100, "Fetching articles from Matters.town...");
    const { articles, userName } = await fetchAllArticlesSince(lastSyncedAt);
    await reportProgress("fetching_articles", overallProgress("fetching_articles", 1, 1), 100, `Found ${articles.length} article(s) to sync`);
    console.log(`   Found ${articles.length} article(s) to sync`);

    // Phase 3: Fetch drafts
    await reportProgress("fetching_drafts", overallProgress("fetching_drafts", 0, 1), 100, "Fetching drafts from Matters.town...");
    const drafts = await fetchAllDraftsSince(lastSyncedAt);
    await reportProgress("fetching_drafts", overallProgress("fetching_drafts", 1, 1), 100, `Found ${drafts.length} draft(s)`);
    console.log(`   Found ${drafts.length} draft(s)`);

    // Phase 4: Fetch collections
    await reportProgress("fetching_collections", overallProgress("fetching_collections", 0, 1), 100, "Fetching collections from Matters.town...");
    const allCollections = await fetchAllCollections();
    const knownCollectionIds = new Set(pluginConfig.knownCollectionIds || []);
    const newCollections = allCollections.filter(c => !knownCollectionIds.has(c.id));
    const allCollectionIds = allCollections.map(c => c.id);
    await reportProgress("fetching_collections", overallProgress("fetching_collections", 1, 1), 100, `Found ${newCollections.length} new collection(s) (${allCollections.length} total)`);
    console.log(`   Found ${newCollections.length} new collection(s) (${allCollections.length} total)`);

    // Phase 5: Fetch user profile (for homepage and language detection)
    await reportProgress("fetching_profile", overallProgress("fetching_profile", 0, 1), 100, "Fetching user profile...");
    const profile = await fetchUserProfile();
    await reportProgress("fetching_profile", overallProgress("fetching_profile", 1, 1), 100, `Profile: ${profile.displayName}`);
    console.log(`   Profile: ${profile.displayName} (language: ${profile.language || "default"})`);

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
          console.log(`   Saved username @${profile.userName} to config for future unauthenticated access`);
        }
      } catch (error) {
        // Non-fatal: just log the error
        console.warn(`   Failed to save config: ${error}`);
      }
    }

    // Phase 6: Sync to local files
    const syncTotal = articles.length + drafts.length + allCollections.length + 1;
    await reportProgress("syncing", overallProgress("syncing", 0, syncTotal), 100, "Starting sync...");
    const { result: syncResult, articlePathMap } = await syncToLocalFiles(
      articles,
      drafts,
      allCollections,
      userName,
      context.config || {},
      profile,
      context.project_info.homepage_file,
    );

    // Build summary message
    const parts: string[] = [];
    if (syncResult.created > 0) parts.push(`${syncResult.created} created`);
    if (syncResult.updated > 0) parts.push(`${syncResult.updated} updated`);
    if (syncResult.skipped > 0) parts.push(`${syncResult.skipped} unchanged`);
    if (syncResult.errors.length > 0) parts.push(`${syncResult.errors.length} errors`);

    const summary = parts.length > 0 ? parts.join(", ") : "no changes";
    await reportProgress("syncing", overallProgress("syncing", syncTotal, syncTotal), 100, `Sync complete: ${summary}`);
    console.log(`✅ Sync complete: ${summary}`);

    // Phase 7: Post-sync processing (run SEQUENTIALLY to avoid race conditions)
    // Both operations read/write the same markdown files, so they must not run in parallel.
    // Order: Media download first (updates image references), then link rewriting
    const mediaResult = await downloadMediaAndUpdate();
    await reportProgress("rewriting_links", overallProgress("rewriting_links", 0, 1), 100, "Rewriting internal links...");
    const linkResult = await rewriteAllInternalLinks(articlePathMap, userName);
    await reportProgress("rewriting_links", overallProgress("rewriting_links", 1, 1), 100, `Rewrote ${linkResult.linksRewritten} internal links`);

    // Build media summary with correct labels:
    // - imagesDownloaded: successfully downloaded
    // - imagesSkipped: already existed locally (not failures!)
    // - errors.length: actual failures
    const mediaParts: string[] = [];
    if (mediaResult.imagesDownloaded > 0) {
      mediaParts.push(`${mediaResult.imagesDownloaded} downloaded`);
    }
    if (mediaResult.imagesSkipped > 0) {
      mediaParts.push(`${mediaResult.imagesSkipped} skipped`);
    }
    if (mediaResult.errors.length > 0) {
      mediaParts.push(`${mediaResult.errors.length} failed`);
    }
    const mediaSummary = mediaParts.length > 0 ? `, images: ${mediaParts.join(", ")}` : "";

    const linkSummary =
      linkResult.linksRewritten > 0
        ? `, ${linkResult.linksRewritten} internal links rewritten`
        : "";

    // Phase 8: Fetch social data (comments only)
    // Always fetch for all local articles. Uses early-exit pagination to skip
    // re-fetching comments we already have (sort: newest + known ID check).
    // Save incrementally after each article to avoid losing data if a fetch hangs.
    let socialSummary = "";
    const articlesForSocialFetch = await scanLocalArticles();
    console.log(`📊 Fetching social data for all ${articlesForSocialFetch.length} local articles`);

    if (articlesForSocialFetch.length > 0) {
      await reportProgress("fetching_social", overallProgress("fetching_social", 0, articlesForSocialFetch.length), 100, "Fetching social data...");

      const socialData = await loadSocialData();
      let totalComments = 0;

      for (let i = 0; i < articlesForSocialFetch.length; i++) {
        const article = articlesForSocialFetch[i];
        await reportProgress(
          "fetching_social",
          overallProgress("fetching_social", i + 1, articlesForSocialFetch.length),
          100,
          `Social data: ${article.title}`
        );

        try {
          // Compute social key: uid when available, fall back to path
          const socialKey = article.uid || article.path;
          if (!article.uid) {
            console.warn(`   Article "${article.title}" has no uid, falling back to path as social data key`);
          }

          // Pass known comment IDs for early-exit pagination optimization
          const existingComments = socialData.articles[socialKey]?.comments || [];
          const knownIds = new Set(existingComments.map(c => c.id));
          const comments = await fetchArticleComments(article.shortHash, knownIds, lastSyncedAt);

          mergeSocialData(socialData, socialKey, comments, [], []);

          totalComments += comments.length;

          // Save after each article to avoid losing data if later fetches hang
          await saveSocialData(socialData);
        } catch (error) {
          console.warn(`   Failed to fetch social data for ${article.title}: ${error}`);
        }
      }

      socialSummary = `, ${totalComments} comments`;
      console.log(`✅ Social data saved: ${totalComments} comments`);
    }

    // Phase 9: Update lastSyncedAt timestamp
    const syncEndTime = new Date().toISOString();
    try {
      const currentConfig = await getConfig();
      await saveConfig({
        ...currentConfig,
        lastSyncedAt: syncEndTime,
        knownCollectionIds: allCollectionIds,
      });
      console.log(`📅 Updated lastSyncedAt to ${syncEndTime}`);
    } catch (error) {
      console.warn(`Failed to save lastSyncedAt: ${error}`);
    }

    await reportProgress("complete", overallProgress("complete", 1, 1), 100, `Complete: ${summary}${mediaSummary}${linkSummary}${socialSummary}`);

    // Only core sync errors are critical; media/link errors are non-critical (nice-to-have)
    // This allows partial success (e.g., all articles synced but some images failed to download)
    const criticalErrors = syncResult.errors;
    return {
      success: criticalErrors.length === 0,
      message: `Synced from Matters: ${summary}${mediaSummary}${linkSummary}${socialSummary}`,
    };
  } catch (error) {
    await reportError(`Sync failed: ${error}`, "process", true);
    console.error(`❌ Matters: Sync failed: ${error}`);
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
export async function syndicate(context: SyndicateContext): Promise<HookResult> {
  setCurrentHookName("syndicate");
  clearTokenCache();
  await initializeDomain();

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
      return !syndicated.some((url: string) => isMattersUrl(url));
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
    await showToast({ message: "Starting Matters syndication...", variant: "info", duration: 3000 });

    // Check authentication
    const isAuthenticated = await checkAuthentication();
    if (!isAuthenticated) {
      console.log("🔐 Not authenticated, prompting login...");
      await showToast({ message: "Matters login required", variant: "info", duration: 5000 });
      const loginSuccess = await promptLogin();
      if (!loginSuccess) {
        await showToast({ message: "Login cancelled", variant: "warning", duration: 3000 });
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
    const lang = context.project_info.lang ?? "en";

    // Syndicate articles sequentially (one at a time for user review)
    let published = 0;
    let draftsCreated = 0;
    const errors: string[] = [];

    for (const article of articlesToSyndicate) {
      try {
        // Verify article is actually live at its deployed URL before syndicating.
        // Prevents publishing broken links (e.g., new article not yet deployed,
        // or GitHub Pages build failed).
        const live = await isArticleLive(siteUrl, article.url_path);
        if (!live) {
          console.log(`    ⏭ Skipping ${article.title} — not yet live at ${siteUrl}/${article.url_path}`);
          continue;
        }

        const result = await syndicateArticle(article, siteUrl, userName, {
          addCanonicalLink: addCanonicalLink as boolean,
          lang,
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

/**
 * Check if an article is live at its deployed URL.
 *
 * Sends a HEAD request to the derived URL. Returns true if the server
 * responds with a 2xx status, false otherwise (404, network error, etc.).
 *
 * Used before syndication to avoid publishing links to articles that
 * haven't been deployed yet (e.g., new articles during concurrent syndication).
 */
export async function isArticleLive(siteUrl: string, articleUrlPath: string): Promise<boolean> {
  const base = siteUrl.replace(/\/$/, "");
  const path = articleUrlPath.replace(/^\//, "");
  const fullUrl = `${base}/${path}`;
  try {
    const response = await fetch(fullUrl, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// Syndication Helpers
// ============================================================================

/**
 * Syndicate a single article to Matters.town
 *
 * Workflow:
 * 1. Upload cover image if present in frontmatter
 * 2. Create draft via API
 * 3. Open draft in browser for user to review
 * 4. Poll for publish state change
 * 5. On publish: close browser, update local frontmatter
 * 6. On timeout: close browser, leave draft for later
 *
 * Exported for unit testing.
 */
export async function syndicateArticle(
  article: ArticleInfo,
  siteUrl: string,
  userName: string,
  options: { addCanonicalLink: boolean; lang: string }
): Promise<{ draftId: string; publishedUrl?: string }> {
  console.log(`  → Syndicating: ${article.title}`);

  // Show creating draft toast
  await showToast({ message: `Creating draft: ${article.title}`, variant: "info", duration: 5000 });

  const canonicalUrl = `${siteUrl.replace(/\/$/, "")}/${article.url_path.replace(/^\//, "")}`;

  // Step 1: Get content
  const { content: articleContent, isHtml } = getArticleContent(article);
  let content = articleContent;

  // Step 2: Normalize HTML (headings + image wrapping) — only for HTML content
  if (isHtml) {
    content = normalizeHtmlForMatters(content);
  }

  // Step 3: Add canonical link with lang
  if (options.addCanonicalLink) {
    content = addCanonicalLinkToContent(content, canonicalUrl, isHtml, options.lang);
  }

  // Step 4: Upload local images to Matters CDN — only for HTML content
  if (isHtml) {
    content = await uploadAndReplaceLocalImages(content, siteUrl);
  }

  // Step 5: Check for existing tracked draft
  const existingDraftId = article.source_path ? await getDraftId(article.source_path) : undefined;
  if (existingDraftId) {
    console.log(`    📋 Found existing draft ID: ${existingDraftId}`);
  }

  // Step 6: Create/update draft via API (with optional summary from description)
  const summary = article.frontmatter.description as string | undefined;
  const draftInput = {
    title: article.title,
    content,
    tags: article.tags,
    ...(existingDraftId ? { id: existingDraftId } : {}),
    ...(summary ? { summary } : {}),
  };

  let draft;
  try {
    draft = await createDraft(draftInput);
  } catch (error) {
    if (existingDraftId) {
      // Stale draft ID — fall back to creating a new draft without id
      console.warn(`    ⚠️ Existing draft ${existingDraftId} failed, creating new draft: ${error}`);
      const { id: _removed, ...inputWithoutId } = draftInput;
      draft = await createDraft(inputWithoutId);
    } else {
      throw error;
    }
  }

  console.log(`    📝 Draft ${existingDraftId ? "updated" : "created"} with ID: ${draft.id}`);

  // Step 7: Upload cover if present in frontmatter (requires draft ID as entityId)
  const coverPath = article.frontmatter.cover as string | undefined;
  if (coverPath) {
    const coverUrl = new URL(coverPath.replace(/^\//, ""), siteUrl.replace(/\/$/, "") + "/").href;
    try {
      const coverAssetId = await uploadCoverByUrl(coverUrl, draft.id);
      console.log(`    🖼️ Cover uploaded: ${coverAssetId}`);
      // Update draft with cover
      await createDraft({ id: draft.id, title: draft.title, cover: coverAssetId });
      console.log(`    🖼️ Draft updated with cover`);
    } catch (error) {
      console.warn(`    ⚠️ Cover upload failed, continuing without cover: ${error}`);
    }
  }

  // Show draft ready toast
  await showToast({ message: "Draft created! Opening for review...", variant: "success", duration: 3000 });

  // Step 8: Open draft in browser for user review
  const draftPageUrl = draftUrl(draft.id);
  console.log(`    🌐 Opening draft for review: ${draftPageUrl}`);
  const browserHandle = await openBrowser(draftPageUrl);

  // Step 9: Poll for publish state change (10 min timeout)
  const publishedArticle = await waitForPublishOrClose(draft.id, 600000, browserHandle);

  if (publishedArticle) {
    // Step 10: Article was published - update local frontmatter
    const publishedUrl = articleUrl(userName, publishedArticle.slug, publishedArticle.shortHash);
    console.log(`    ✅ Published: ${publishedUrl}`);

    // Show success toast
    await showToast({ message: "Published to Matters!", variant: "success", duration: 5000 });

    // Update the local markdown file's frontmatter
    if (article.source_path) {
      await updateFrontmatterSyndicated(article.source_path, publishedUrl);
      console.log(`    📝 Updated frontmatter with syndicated URL`);
    }

    // Remove draft from tracking (published successfully)
    if (article.source_path) {
      try {
        await removeDraftId(article.source_path);
      } catch (err) {
        console.warn(`    ⚠️ Failed to remove draft tracking: ${err}`);
      }
    }

    return { draftId: draft.id, publishedUrl };
  }

  // Step 11: Timeout - save draft ID for reuse next time
  if (article.source_path) {
    try {
      await saveDraftId(article.source_path, draft.id);
      console.log(`    💾 Draft ID saved for reuse`);
    } catch (err) {
      console.warn(`    ⚠️ Failed to save draft tracking: ${err}`);
    }
  }
  console.log(`    ⏱️ Publish timeout - draft saved for later`);
  await showToast({ message: "Draft saved - publish when ready", variant: "info", duration: 5000 });
  return { draftId: draft.id };
}

/**
 * Wait for draft to be published, browser to close, or timeout
 *
 * Polls the draft every 5 seconds to check if it has been published.
 * Also listens for browser close events to exit immediately when
 * the user closes the action panel.
 *
 * Returns the published article info if published, null on close/timeout.
 */
async function waitForPublishOrClose(
  draftId: string,
  timeoutMs: number,
  browserHandle?: BrowserHandle
): Promise<{ shortHash: string; slug: string } | null> {
  const startTime = Date.now();
  const pollInterval = 5000; // 5 seconds
  let browserClosed = false;

  // Listen for browser close
  if (browserHandle) {
    browserHandle.closed.then(() => {
      browserClosed = true;
    });
  }

  console.log(`    ⏳ Waiting for publish (timeout: ${timeoutMs / 1000}s)...`);

  while (Date.now() - startTime < timeoutMs) {
    await sleep(pollInterval);

    // Exit immediately if browser was closed
    if (browserClosed) {
      console.log(`    🚪 Browser closed by user`);
      return null;
    }

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
 * Get the best content from an article for syndication.
 * Prefers rendered HTML (for platforms like Matters that expect HTML),
 * falls back to markdown content.
 */
export function getArticleContent(article: ArticleInfo): { content: string; isHtml: boolean } {
  if (article.html_content) {
    return { content: article.html_content, isHtml: true };
  }
  return { content: article.content, isHtml: false };
}

/**
 * Normalize HTML content for Matters.town compatibility.
 *
 * Matters only accepts h2 and h3 headings. This function:
 * - Downgrades h1 → h2
 * - Keeps h2 and h3 unchanged
 * - Collapses h4, h5, h6 → h3 (to prevent removal by Matters)
 *
 * Also wraps standalone <img> tags (not already inside a <figure>)
 * in <figure class="image"><img ...><figcaption></figcaption></figure>
 * as required by Matters' content format.
 */
export function normalizeHtmlForMatters(html: string): string {
  let result = html;

  // Step 1: Collapse h4, h5, h6 → h3 (process these BEFORE h1 to avoid double-shifting)
  result = result.replace(/<(\/?)h[456](\s[^>]*)?>/gi, (_match, slash, attrs) => {
    return `<${slash}h3${attrs || ""}>`;
  });

  // Step 2: Downgrade h1 → h2
  result = result.replace(/<(\/?)h1(\s[^>]*)?>/gi, (_match, slash, attrs) => {
    return `<${slash}h2${attrs || ""}>`;
  });

  // Step 3: Wrap standalone <img> tags in <figure class="image">
  // Match <img ...> tags that are NOT preceded by <figure (with possible attributes)
  result = result.replace(/<img\s[^>]*>/gi, (imgTag, offset) => {
    // Look backwards from the img tag to check if it's inside a <figure>
    const preceding = result.substring(Math.max(0, offset - 200), offset);
    // Check if there's an unclosed <figure before this img
    const lastFigureOpen = preceding.lastIndexOf("<figure");
    const lastFigureClose = preceding.lastIndexOf("</figure");
    if (lastFigureOpen > lastFigureClose) {
      // Inside a <figure> — don't wrap
      return imgTag;
    }
    return `<figure class="image">${imgTag}<figcaption></figcaption></figure>`;
  });

  return result;
}

/**
 * Add canonical link to article content
 *
 * @param lang - Language code; when starting with "zh", uses Chinese text
 */
export function addCanonicalLinkToContent(
  content: string,
  canonicalUrl: string,
  isHtml: boolean = false,
  lang?: string
): string {
  const isZh = lang?.startsWith("zh") ?? false;
  const linkText = isZh ? "原文链接" : "Original link";

  if (isHtml) {
    return content + `<hr><p><a href="${canonicalUrl}">${linkText}</a></p>`;
  }
  const canonicalNotice = `\n\n---\n\n[${linkText}](${canonicalUrl})\n`;
  return content + canonicalNotice;
}

/**
 * Upload all local/relative images in HTML content to Matters CDN
 * and replace their src attributes with CDN URLs.
 *
 * - Skips absolute URLs (http://, https://, data:)
 * - Deduplicates: same src used multiple times is only uploaded once
 * - Graceful failure: warns on upload error, leaves original src unchanged
 *
 * @param content - HTML content containing img tags
 * @param siteUrl - Base URL of the published site (e.g., "https://example.com")
 * @returns HTML content with local image srcs replaced by CDN URLs
 */
export async function uploadAndReplaceLocalImages(content: string, siteUrl: string): Promise<string> {
  // Collect all img src values
  const imgSrcRegex = /<img\s[^>]*src="([^"]+)"[^>]*>/gi;
  const localSrcs = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = imgSrcRegex.exec(content)) !== null) {
    const src = match[1];
    // Skip absolute URLs and data URIs
    if (/^https?:\/\//i.test(src) || /^data:/i.test(src)) {
      continue;
    }
    localSrcs.add(src);
  }

  if (localSrcs.size === 0) {
    return content;
  }

  // Upload each unique local src and build a replacement map
  const replacements = new Map<string, string>();

  for (const src of localSrcs) {
    const absoluteUrl = new URL(src.replace(/^\//, ""), siteUrl.replace(/\/$/, "") + "/").href;
    try {
      const cdnUrl = await uploadEmbedByUrl(absoluteUrl);
      replacements.set(src, cdnUrl);
      console.log(`    🖼️ Image uploaded: ${src} → ${cdnUrl}`);
    } catch (error) {
      console.warn(`    ⚠️ Image upload failed for ${src}, leaving unchanged: ${error}`);
    }
  }

  // Replace all occurrences of each local src with its CDN URL
  let result = content;
  for (const [originalSrc, cdnUrl] of replacements) {
    // Escape special regex characters in the src
    const escaped = originalSrc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`src="${escaped}"`, "g"), `src="${cdnUrl}"`);
  }

  return result;
}
