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
  reportError,
  setCurrentHookName,
  sleep,
} from "./utils";
import { startTask } from "@symbiosis-lab/moss-api";
import type { TaskHandle } from "@symbiosis-lab/moss-api";
import {
  clearTokenCache,
  getAccessToken,
  fetchAllArticlesSince,
  fetchAllDraftsSince,
  fetchAllCollections,
  fetchUserProfile,
  fetchArticleComments,
  fetchAllArticleCommentCounts,
  createDraft,
  fetchDraft,
  uploadCoverByUrl,
  uploadEmbedByUrl,
  apiConfig,
  getSessionState,
  shouldNudgeSessionExpired,
  MattersAuthError,
} from "./api";
import { resolveAuthRoute, isUserPresent } from "./auth-route";
import { syncToLocalFiles, scanLocalArticles, detectBoundUser } from "./sync";
import { downloadMediaAndUpdate, rewriteAllInternalLinks } from "./downloader";
import { getConfig, saveConfig } from "./config";
import { overallProgress } from "./progress";
import { loadSocialData, saveSocialData, mergeSocialData, reconcileLegacySocialData } from "./social";
import {
  readFile,
  writeFile,
  showToast,
  dismissToast,
  readPluginFile,
  writePluginFile,
  pluginFileExists,
  getPluginEnvVar,
  emitEvent,
  onEvent,
} from "@symbiosis-lab/moss-api";
import { parseFrontmatter, regenerateFrontmatter } from "./converter";
import {
  initializeDomain,
  loginUrl,
  draftUrl,
  articleUrl,
  isMattersUrl,
} from "./domain";
import { looksLikePublishedArticleUrl } from "./url-detect";

// ============================================================================
// Social-fetch predicates (exported for unit tests — used in Phase 8 below)
// ============================================================================

/**
 * Should the social fetch for this article be SKIPPED?
 *
 * Skip only when:
 * - remoteCounts discovery succeeded (remoteCount defined)
 * - we've synced before with this code path (storedCount defined)
 * - remote count matches what we last recorded
 * - AND we genuinely have data: either zero comments everywhere, or we have
 *   stored comments to prove the count was accurate on last sync.
 *
 * A poisoned entry (storedCount=57, existingComments=[]) must NOT skip —
 * the count was recorded without actually fetching the data.
 */
export function shouldSkipSocialFetch(
  remoteCount: number | undefined,
  storedCount: number | undefined,
  existingCommentsLength: number,
): boolean {
  return (
    remoteCount !== undefined &&
    storedCount !== undefined &&
    remoteCount === storedCount &&
    (remoteCount === 0 || existingCommentsLength > 0)
  );
}

/**
 * What sinceTimestamp should be passed to fetchArticleComments?
 *
 * Pass lastSyncedAt only when we already have local comments AND the stored
 * count is defined. An entry whose count was cleared by reconcile (poisoned
 * entry) but which still has a FEW stored comments must do a FULL refetch —
 * giving it lastSyncedAt would drop all older comments via the since-filter,
 * re-recording a near-empty count and re-locking the skip permanently.
 */
export function resolveSinceTimestamp(
  existingCommentsLength: number,
  storedCount: number | undefined,
  lastSyncedAt: string | undefined,
): string | undefined {
  return existingCommentsLength > 0 && storedCount !== undefined ? lastSyncedAt : undefined;
}

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
 * Session-expired nudge. Throttled once per expiry event via a nudgedAt
 * stamp in auth.json (engine-independent: module state may reset per build
 * under the off-webview runtime). Every suppressed occurrence still logs.
 */
async function notifySessionExpired(): Promise<void> {
  console.warn("⚠️ Matters session expired; drafts and syndication paused until re-login");
  if (await shouldNudgeSessionExpired()) {
    await showToast({
      message: "Matters session expired. Log in to resume drafts and syndication.",
      variant: "warning",
      persistent: true,
    });
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
    // During login flow, check global cookies (fromCookie=true) since
    // the login page sets the token as a cookie in the shared WebKit store.
    // getAccessToken(true) will also persist the token to project storage.
    const token = await getAccessToken(true);

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
// ============================================================================
// Test-harness escape hatch (T8a, 2026-05-28)
// ============================================================================
//
// `MOSS_MATTERS_TEST_PROFILE` lets the onboarding e2e harness bypass the
// real Matters auth flow entirely. When set, the plugin:
//
//  1. (API layer) flips `apiConfig.queryMode = "user"` and sets
//     `apiConfig.testUserName = <profile>`, switching all GraphQL traffic
//     through `graphqlQueryPublic` (no cookies, no token cache).
//
//  2. (UI layer) skips `promptLogin()` outright. The auth webview never
//     opens — without this, the harness still observes the matters.news/
//     login page load and can't assert "import starts immediately".
//
// Both flips are required for end-to-end harness coverage; an API-only
// flip leaves the auth webview visible. The env var is read via the
// allow-listed `get_plugin_env_var` Tauri command (the plugin runtime
// has no direct `process.env` access). Default test profile is `@guo`.
//
// Production behavior is unchanged when the env var is unset — every
// call site degrades to the legacy auth flow.

let testProfileCache: string | null | undefined;

/**
 * Resolve the Matters test profile. Memoized — env vars don't change
 * mid-session, so we read once at first call. Returns `null` (not
 * `undefined`) when explicitly unset so consumers can distinguish
 * "not configured" from "not yet checked".
 *
 * Strips a leading `@` if present so the harness can pass either
 * `@guo` or `guo` and get the same result. `apiConfig.testUserName`
 * stores the bare username.
 */
async function getMattersTestProfile(): Promise<string | null> {
  if (testProfileCache !== undefined) return testProfileCache;
  const raw = await getPluginEnvVar("MOSS_MATTERS_TEST_PROFILE");
  if (!raw) {
    testProfileCache = null;
    return null;
  }
  const trimmed = raw.startsWith("@") ? raw.slice(1) : raw;
  testProfileCache = trimmed;
  console.log(`🧪 Matters: MOSS_MATTERS_TEST_PROFILE=${raw} → public-fetch mode (@${trimmed})`);
  return trimmed;
}

/**
 * Apply the test-profile escape hatch to `apiConfig`. No-op when the env
 * var is unset, so safe to call unconditionally. Returns the profile
 * name if the escape hatch was applied, `null` otherwise — callers use
 * the return value to decide whether to skip auth UI.
 */
async function applyTestProfileEscapeHatch(): Promise<string | null> {
  const profile = await getMattersTestProfile();
  if (!profile) return null;
  apiConfig.queryMode = "user";
  apiConfig.testUserName = profile;
  return profile;
}

async function promptLogin(): Promise<boolean> {
  // UI-layer escape hatch: when MOSS_MATTERS_TEST_PROFILE is set, skip
  // the login webview entirely and pretend authentication succeeded.
  // The API layer (apiConfig.queryMode = "user") already routes all
  // queries through the public path, so there is nothing to authenticate.
  const testProfile = await getMattersTestProfile();
  if (testProfile) {
    console.log(`🧪 Matters: skipping login UI (test profile @${testProfile})`);
    return true;
  }

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

  // T8a escape hatch: if MOSS_MATTERS_TEST_PROFILE is set, flip apiConfig
  // to public-fetch mode BEFORE any auth/binding logic runs. The promptLogin
  // helper also checks the env var and skips its UI — together these two
  // flips give the e2e harness a no-auth-webview import path. Idempotent;
  // no-op in production.
  const testProfile = await applyTestProfileEscapeHatch();

  // Start a PanelTask so the breadcrumb hairline animates during import.
  // hook = "import" — the process hook syncs articles from Matters (an import
  //   operation), not a transform/enhance.
  // trigger — moss owns this context (ADR-015): it stamps `context.trigger` when
  //   it invokes the hook. The onboarding card path → "onboarding_flow", which the
  //   router maps to (ActionPanel, Ambient) → the hairline; every build/preview
  //   rebuild → "background" (quiet). The plugin must NOT guess this from its own
  //   state (e.g. the test-profile env var) — that conflated "test mode" with
  //   "user-initiated onboarding" and left the hairline dead in production.
  //   Absent (older moss) ⇒ "background", the safe quiet default.
  const task = await startTask("Importing from Matters", {
    hook: "import",
    trigger: context.trigger ?? "background",
    hasProgress: true,
    cancellable: false,
  });

  console.log("🔐 Matters: process hook started");

  try {
    // Binding guard: only sync if project is bound to a Matters account
    {
      const bindingConfig = await getConfig();
      // Under the test-profile escape hatch the project is "bound" to the
      // test user implicitly — skip the binding detection / login prompt
      // since the harness already picked the profile.
      if (testProfile) {
        if (bindingConfig.boundUserName !== testProfile) {
          await saveConfig({
            ...bindingConfig,
            boundUserName: testProfile,
            userName: testProfile,
          });
          console.log(`🧪 Matters: auto-bound to @${testProfile} (test profile)`);
        }
      } else if (!bindingConfig.boundUserName) {
        const detectedUser = await detectBoundUser();
        if (detectedUser) {
          // Auto-bind from existing articles
          await saveConfig({ ...bindingConfig, boundUserName: detectedUser, userName: detectedUser });
          console.log(`🔗 Auto-bound to @${detectedUser} from existing articles`);
        } else {
          // Fresh project — binding requires login, which only a present
          // user can do. Background rebuilds exit quietly (spec §3.3:
          // background never opens a login window).
          if (!isUserPresent(context.trigger)) {
            console.log("🔗 Not bound and no user present; skipping sync quietly");
            await task.succeeded("No Matters account bound");
            return {
              success: true,
              message: "No Matters account bound. Skipping sync.",
            };
          }
          const loginSuccess = await promptLogin();
          if (!loginSuccess) {
            // Terminate the task before returning, or it stays Running in the
            // registry forever. Not bound ⇒ nothing to import; a clean success.
            await task.succeeded("No Matters account bound");
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

    // Phase 1: Authentication — tri-state session check + trigger routing.
    // Background must never open a login window (spec §3.3).
    await task.progress(overallProgress("authentication", 0, 1) / 100, "Checking authentication...");
    const sessionState = await getSessionState();
    const authConfig = await getConfig();
    // queryMode may be stale from a previous fallback run: public_fallback
    // flips it to "user" and module state persists across hook invocations
    // in the webview runtime. Reset to "viewer" here; the test profile owns
    // the flip when set (applied before this phase).
    if (!testProfile) {
      apiConfig.queryMode = "viewer";
    }
    const route = testProfile
      ? "proceed"
      : resolveAuthRoute(sessionState, context.trigger, Boolean(authConfig.userName));
    let isAuthenticated = sessionState === "valid";
    let usingUnauthenticatedMode = false;

    switch (route) {
      case "proceed":
        await task.progress(overallProgress("authentication", 1, 1) / 100, "Authenticated");
        console.log("✅ Matters: session usable, proceeding");
        break;

      case "public_fallback":
        console.log(`🔓 Session ${sessionState}, importing public articles for @${authConfig.userName}`);
        console.log("   Note: Drafts will not be available in unauthenticated mode");
        apiConfig.queryMode = "user";
        apiConfig.testUserName = authConfig.userName!;
        usingUnauthenticatedMode = true;
        isAuthenticated = false;
        if (sessionState === "expired") await notifySessionExpired();
        await task.progress(overallProgress("authentication", 1, 1) / 100, `Using saved user: @${authConfig.userName}`);
        break;

      case "prompt_login": {
        console.log(`🔐 Session ${sessionState}, prompting login (trigger: ${context.trigger})...`);
        await task.progress(overallProgress("authentication", 0, 1) / 100, "Waiting for login...");
        const loginSuccess = await promptLogin();
        if (!loginSuccess) {
          await task.failed("Login failed or timeout", true);
          await reportError("Login failed or timeout", "authentication", true);
          return {
            success: false,
            message: "Login failed or timeout. Please try again.",
          };
        }
        isAuthenticated = true;
        await task.progress(overallProgress("authentication", 1, 1) / 100, "Authenticated");
        console.log("✅ Matters: Authenticated");
        break;
      }

      case "soft_fail": {
        // 'expired' gets the nudge; 'none' is quiet (no session event to
        // report, and sync_on_build would re-toast every build).
        const message =
          sessionState === "expired"
            ? "session expired, log in again to import."
            : "not logged in, log in to import.";
        if (sessionState === "expired") await notifySessionExpired();
        await task.failed(message, true);
        return { success: false, message };
      }
    }

    // Check if sync is enabled
    const syncOnBuild = context.config?.sync_on_build ?? true;
    if (!syncOnBuild) {
      console.log("ℹ️  Sync on build is disabled, skipping...");
      // Terminate the task before returning (else it leaks as Running).
      // Sync intentionally off ⇒ a clean success, but only claim
      // "Authenticated" when the route actually proceeded with a usable
      // session; fallback/expired routes get the plain message.
      await task.succeeded("Sync disabled");
      return {
        success: true,
        message: route === "proceed" ? "Authenticated (sync disabled)" : "Sync disabled",
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
    await task.progress(overallProgress("fetching_articles", 0, 1) / 100, "Fetching articles from Matters.town...");
    const { articles, userName } = await fetchAllArticlesSince(lastSyncedAt);
    await task.progress(overallProgress("fetching_articles", 1, 1) / 100, `Found ${articles.length} article(s) to sync`);
    console.log(`   Found ${articles.length} article(s) to sync`);

    // Phase 3: Fetch drafts
    await task.progress(overallProgress("fetching_drafts", 0, 1) / 100, "Fetching drafts from Matters.town...");
    const drafts = await fetchAllDraftsSince(lastSyncedAt);
    await task.progress(overallProgress("fetching_drafts", 1, 1) / 100, `Found ${drafts.length} draft(s)`);
    console.log(`   Found ${drafts.length} draft(s)`);

    // Phase 4: Fetch collections
    await task.progress(overallProgress("fetching_collections", 0, 1) / 100, "Fetching collections from Matters.town...");
    const allCollections = await fetchAllCollections();
    const knownCollectionIds = new Set(pluginConfig.knownCollectionIds || []);
    const newCollections = allCollections.filter(c => !knownCollectionIds.has(c.id));
    const allCollectionIds = allCollections.map(c => c.id);
    await task.progress(overallProgress("fetching_collections", 1, 1) / 100, `Found ${newCollections.length} new collection(s) (${allCollections.length} total)`);
    console.log(`   Found ${newCollections.length} new collection(s) (${allCollections.length} total)`);

    // Phase 5: Fetch user profile (for homepage and language detection)
    await task.progress(overallProgress("fetching_profile", 0, 1) / 100, "Fetching user profile...");
    const profile = await fetchUserProfile();
    await task.progress(overallProgress("fetching_profile", 1, 1) / 100, `Profile: ${profile.displayName}`);
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
    await task.progress(overallProgress("syncing", 0, syncTotal) / 100, "Starting sync...");
    const { result: syncResult, articlePathMap } = await syncToLocalFiles(
      articles,
      drafts,
      allCollections,
      userName,
      context.config || {},
      profile,
      context.project_info.homepage_file,
      context.project_info.folder_name,
    );

    // Build summary message
    const parts: string[] = [];
    if (syncResult.created > 0) parts.push(`${syncResult.created} created`);
    if (syncResult.updated > 0) parts.push(`${syncResult.updated} updated`);
    if (syncResult.skipped > 0) parts.push(`${syncResult.skipped} unchanged`);
    if (syncResult.errors.length > 0) parts.push(`${syncResult.errors.length} errors`);

    const summary = parts.length > 0 ? parts.join(", ") : "no changes";
    await task.progress(overallProgress("syncing", syncTotal, syncTotal) / 100, `Sync complete: ${summary}`);
    console.log(`✅ Sync complete: ${summary}`);

    // Phase 7: Post-sync processing (run SEQUENTIALLY to avoid race conditions)
    // Both operations read/write the same markdown files, so they must not run in parallel.
    // Order: Media download first (updates image references), then link rewriting
    const mediaResult = await downloadMediaAndUpdate();
    await task.progress(overallProgress("rewriting_links", 0, 1) / 100, "Rewriting internal links...");
    const linkResult = await rewriteAllInternalLinks(articlePathMap, userName);
    await task.progress(overallProgress("rewriting_links", 1, 1) / 100, `Rewrote ${linkResult.linksRewritten} internal links`);

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
    // First, ask Matters once for `commentCount` per article (one paginated
    // pass). For each local article, skip the per-article comments query
    // entirely when the remote count matches what we recorded last sync.
    // Inside the per-article fetch, the existing `knownIds` + `lastSyncedAt`
    // short-circuits still apply to bound page-level work.
    let socialSummary = "";
    const articlesForSocialFetch = await scanLocalArticles();
    console.log(`📊 Checking social data for ${articlesForSocialFetch.length} local articles`);

    // Build shortHash → uid map for the legacy reconcile (issue #793).
    // scanLocalArticles() returns both fields; a null uid means the file
    // hasn't been built yet — those entries stay keyed by shortHash.
    const shortHashToUid = new Map<string, string>();
    for (const a of articlesForSocialFetch) {
      if (a.uid) shortHashToUid.set(a.shortHash, a.uid);
    }

    // One-time migration: if .moss/social/matters.json (legacy path) still
    // exists, merge it into .moss/data/social/matters.json and retire it.
    // loadSocialData() loads from the new canonical path; reconcile is called
    // on the initial load result so the merge happens before any fetch below.
    //
    // We call reconcile here (after scanLocalArticles) because the uid↔shortHash
    // mapping is needed to remap legacy shortHash-keyed entries to uid keys.
    {
      const preReconcile = await loadSocialData();
      const migrated = await reconcileLegacySocialData(preReconcile, shortHashToUid);
      if (migrated) {
        console.log("[matters] Legacy social data reconciled — reloading canonical store");
      }
    }

    if (articlesForSocialFetch.length > 0) {
      await task.progress(overallProgress("fetching_social", 0, articlesForSocialFetch.length) / 100, "Checking for new comments...");

      // One paginated query that returns {shortHash, commentCount} for the
      // user's whole library. ~4 queries per 200 articles vs. the previous
      // 200+ per-article queries. If this fails (network, etc.) we fall back
      // to checking every article so we don't silently drop new comments.
      let remoteCounts: Map<string, number> | null = null;
      try {
        remoteCounts = await fetchAllArticleCommentCounts();
        console.log(`📊 Got commentCount for ${remoteCounts.size} remote articles`);
      } catch (error) {
        console.warn(`   commentCount discovery failed (${error}); falling back to per-article fetch`);
      }

      const socialData = await loadSocialData();
      let totalComments = 0;
      let fetched = 0;
      let skipped = 0;

      for (let i = 0; i < articlesForSocialFetch.length; i++) {
        const article = articlesForSocialFetch[i];
        await task.progress(
          overallProgress("fetching_social", i + 1, articlesForSocialFetch.length) / 100,
          `Social data: ${article.title}`
        );

        try {
          // Compute social key: uid when available, fall back to path
          const socialKey = article.uid || article.path;
          if (!article.uid) {
            console.warn(`   Article "${article.title}" has no uid, falling back to path as social data key`);
          }

          // Skip the comments fetch when the remote count exactly matches
          // what we saw last sync. See shouldSkipSocialFetch (above) for the
          // full predicate rationale and known soft-correctness gap.
          const remoteCount = remoteCounts?.get(article.shortHash);
          const storedCount = socialData.articles[socialKey]?.lastKnownCommentCount;

          // Pass known comment IDs for early-exit pagination optimization
          const existingComments = socialData.articles[socialKey]?.comments || [];
          if (shouldSkipSocialFetch(remoteCount, storedCount, existingComments.length)) {
            skipped++;
            continue;
          }

          const knownIds = new Set(existingComments.map(c => c.id));
          // See resolveSinceTimestamp (above) for the full rationale.
          const sinceTimestamp = resolveSinceTimestamp(existingComments.length, storedCount, lastSyncedAt);
          const comments = await fetchArticleComments(article.shortHash, knownIds, sinceTimestamp);

          mergeSocialData(socialData, socialKey, comments, [], [], remoteCount);

          totalComments += comments.length;
          fetched++;

          // Save after each article to avoid losing data if later fetches hang
          await saveSocialData(socialData);
        } catch (error) {
          console.warn(`   Failed to fetch social data for ${article.title}: ${error}`);
        }
      }

      socialSummary = `, ${totalComments} new comments`;
      console.log(`✅ Social data: ${fetched} fetched, ${skipped} skipped (no change), ${totalComments} new comments`);
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

    // Only core sync errors are critical; media/link errors are non-critical (nice-to-have)
    // This allows partial success (e.g., all articles synced but some images failed to download)
    const criticalErrors = syncResult.errors;
    const finalMessage = `Synced from Matters: ${summary}${mediaSummary}${linkSummary}${socialSummary}`;

    // Honest receipt for EVERY unauthenticated-mode run (spec §3.3),
    // state-aware: expired session vs never-logged-in route differently.
    // Leading ". " closes the unpunctuated summary before it (otherwise
    // the receipt reads "no changes Matters session expired; ...").
    const unauthNote = usingUnauthenticatedMode
      ? sessionState === "expired"
        ? ". Matters session expired; log in to resume drafts and syndication."
        : ". Not logged in; log in to also import drafts."
      : "";

    if (criticalErrors.length === 0) {
      await task.succeeded(`${summary}${mediaSummary}${linkSummary}${socialSummary}${unauthNote}`);
    } else {
      await task.failed(`${criticalErrors.length} sync error(s)`, true);
    }

    return {
      success: criticalErrors.length === 0,
      message: finalMessage,
    };
  } catch (error) {
    if (error instanceof MattersAuthError) {
      // Pre-flight passed but the server revoked the token mid-run (rare).
      // graphqlQuery already stamped invalidatedAt, so the NEXT run routes
      // through the expired-session table; here we fail with honest copy.
      const message = "session expired, log in again to import.";
      await notifySessionExpired();
      await task.failed(message, true);
      console.error("❌ Matters: sync aborted, session rejected by server");
      return { success: false, message };
    }
    const cause = error instanceof Error ? error.message : String(error);
    await task.failed(`Sync failed: ${cause}`);
    await reportError(`Sync failed: ${cause}`, "process", true);
    console.error(`❌ Matters: Sync failed: ${cause}`);
    return {
      success: false,
      message: `Sync failed: ${cause}`,
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

  // Drive a moss Job for the syndication run (Step 3 Phase 5 Task 5.3).
  // The verb/noun MEANING is declared in the manifest's `contributes.jobs`
  // ("Syndicated" · "posts"); moss normalizes the verb (R13) and renders the
  // receipt "Syndicated · N posts". A partial failure is PROPOSED as an
  // advisory via `task.advise(...)`; moss holds the severity gavel.
  // Syndication runs after deploy (no onboarding gesture), so the trigger is
  // "background" — the quiet Workspace+Ambient surface. moss does not stamp a
  // `trigger` on SyndicateContext (unlike ProcessContext), so we choose the
  // safe quiet default directly rather than reading a field that isn't there.
  const task = await startTask("Syndicate", {
    hook: "syndicate",
    trigger: "background",
    hasProgress: true,
    cancellable: false,
    // Reference the manifest's `contributes.jobs.syndicate` descriptor
    // ("Syndicated" · "posts"). moss normalizes the verb (R13) and, on the
    // terminal `succeeded(_, count)`, renders "Syndicated · N posts" from its
    // OWN verb + amount — we no longer hand it a pre-formatted string.
    job: "syndicate",
  });

  try {
    if (!context.deployment) {
      await task.failed("No deployment information available");
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
      await task.succeeded("No new articles to syndicate");
      return {
        success: true,
        message: "No new articles to syndicate",
      };
    }

    console.log(`📡 Syndicating ${articlesToSyndicate.length} article(s) to Matters.town`);
    console.log(`🌐 Deployed site: ${siteUrl}`);
    console.log(`📅 Deployed at: ${deployed_at}`);

    // Check the session. Syndication is user-initiated by construction
    // (every trigger site is inside the user-clicked publish flow) and
    // write-scoped: no public fallback exists, so any non-valid session
    // goes straight to login.
    const sessionState = await getSessionState();
    if (sessionState !== "valid") {
      console.log(`🔐 Session state: ${sessionState}, prompting login...`);
      // Law 2: login-required is a blocking auth state — must persist.
      // Law 4: dismiss the toast if login succeeds so a resolved warning
      //         doesn't linger alongside the terminal ack.
      await showToast({ message: "Matters login required", variant: "warning", persistent: true, id: "matters-login-required" });
      const loginSuccess = await promptLogin();
      if (loginSuccess) {
        await dismissToast("matters-login-required");
      }
      if (!loginSuccess) {
        // Propose an actionable account advisory: the user must sign in to
        // finish. moss holds the gavel — a NeedsAction stays a quiet dot, an
        // actionable Blocking pops the panel; here we let moss decide.
        await task.advise({
          scope: "Account",
          severity: "NeedsAction",
          item: null,
          what: "Sign in to Matters to syndicate your posts",
          action: { InApp: { op: "SignIn", args: null, label: "Sign in" } },
        });
        await task.failed("Login required for syndication");
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

    const totalToSyndicate = articlesToSyndicate.length;
    let processed = 0;
    for (const article of articlesToSyndicate) {
      await task.progress(processed / totalToSyndicate, `Syndicating ${article.title}`);
      try {
        // Verify article is actually live at its deployed URL before syndicating.
        // Prevents publishing broken links (e.g., new article not yet deployed,
        // or GitHub Pages build failed).
        const live = await isArticleLive(siteUrl, article.url_path);
        if (!live) {
          console.log(`    ⏭ Skipping ${article.title} — not yet live at ${siteUrl}/${article.url_path}`);
          processed++;
          continue;
        }

        const result = await syndicateArticle(article, siteUrl, userName, {
          addCanonicalLink: addCanonicalLink as boolean,
          lang,
        }, task);

        if (result.publishedUrl) {
          published++;
        } else {
          draftsCreated++;
        }
      } catch (error) {
        if (error instanceof MattersAuthError) throw error; // session is dead: abort the run
        console.error(`    ✗ Failed to syndicate ${article.title}:`, error);
        errors.push(`${article.title}: ${error}`);
      }
      processed++;
    }

    const parts: string[] = [];
    if (published > 0) parts.push(`${published} published`);
    if (draftsCreated > 0) parts.push(`${draftsCreated} drafts created`);
    if (errors.length > 0) parts.push(`${errors.length} failed`);

    const summary = parts.join(", ");

    // A partial failure is PROPOSED as a per-run advisory (R13); moss clamps
    // it. ShippedDegraded ⇒ a quiet hairline dot (the run still succeeded).
    if (errors.length > 0) {
      await task.advise({
        scope: "Remote",
        severity: "ShippedDegraded",
        item: null,
        what: `${errors.length} post(s) could not be syndicated: ${errors[0]}`,
        action: "None",
      });
    }

    // Terminal: report the COUNT, not a pre-formatted string. moss owns the
    // receipt — it pairs the manifest's normalized verb ("Syndicated") with
    // this count + the declared noun ("posts") to render "Syndicated · N posts"
    // from its OWN value objects (Step 3 Phase 5, §8 + R13).
    // #808: a created-but-unpublished draft is NOT a syndication. Only an
    // API-confirmed publish (draft.article non-null) counts toward the success
    // receipt/toast. A draft saved for later is surfaced as a NeedsAction advisory.
    const syndicatedCount = published;

    if (errors.length > 0) {
      console.warn(`⚠️  Syndication complete: ${summary}`);
    } else {
      console.log(`✅ Syndication complete: ${summary}`);
    }
    await task.succeeded(undefined, syndicatedCount);

    // One terminal L3 shelf ack — the durable positive result (Law 3).
    // task.succeeded() already rendered "Syndicated · N posts" in L1;
    // this showToast({ variant: 'success' }) is the shelf record with the
    // "View profile" action link.
    // NOTE: showAck() is a frontend-only function (toast-manager.ts) and is
    // NOT exported from @symbiosis-lab/moss-api. Use showToast({ variant: 'success' }).
    if (syndicatedCount > 0) {
      const profileUrl = `https://matters.town/@${userName}`;
      await showToast({
        message: `Syndicated ${syndicatedCount} article${syndicatedCount === 1 ? "" : "s"} to Matters`,
        variant: "success",
        persistent: true,
        actions: [{ label: "View profile", url: profileUrl }],
      });
    }

    return {
      success: true,
      message: `Syndication: ${summary}`,
    };
  } catch (error) {
    if (error instanceof MattersAuthError) {
      // Same contract as the process hook's catch: the server revoked the
      // token mid-run; fail the task with honest copy (recoverable=true —
      // a re-login fixes it) and nudge the session-expired surface.
      const message = "session expired, log in again to publish.";
      await notifySessionExpired();
      await task.failed(message, true);
      console.error("❌ Matters: syndication aborted, session rejected by server");
      return { success: false, message };
    }
    const cause = error instanceof Error ? error.message : String(error);
    console.error("❌ Matters: Syndication failed:", cause);
    await task.failed(`Syndication failed: ${cause}`);
    return {
      success: false,
      message: `Syndication failed: ${cause}`,
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
  options: { addCanonicalLink: boolean; lang: string },
  task: TaskHandle,
): Promise<{ draftId: string; publishedUrl?: string }> {
  console.log(`  → Syndicating: ${article.title}`);

  const canonicalUrl = `${siteUrl.replace(/\/$/, "")}/${article.url_path.replace(/^\//, "")}`;

  // Step 1: Get content
  const { content: articleContent, isHtml } = getArticleContent(article);
  let content = articleContent;

  // Step 2: Normalize HTML (headings + image wrapping) — only for HTML content.
  // Strip moss's auto-injected article-title <h1> first (matters has its own
  // title field, so leaving the h1 in the body produces a visible duplicate
  // in the matters draft).
  if (isHtml) {
    content = stripArticleTitleH1(content, article.title);
    content = normalizeHtmlForMatters(content);
  }

  // Step 3: Add canonical link with lang
  if (options.addCanonicalLink) {
    content = addCanonicalLinkToContent(content, canonicalUrl, isHtml, options.lang);
  }

  // Step 4: Absolutize relative <a href> values against the article URL
  // BEFORE any image work. Without this, matters.town serves `<a href="../../foo.html">`
  // from its own domain and the link 404s. Same article-relative resolution
  // rule as image srcs (PR1). Done as a separate pass so href-only updates
  // don't trip the image-upload waitForUrl gate.
  //
  // Local image uploads happen post-draft (Step 8) — Matters' singleFileUpload
  // requires `entityId` for embeds, just as it does for cover.
  if (isHtml) {
    content = absolutizeRelativeHrefs(content, canonicalUrl);
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
  // Cover paths are conventionally site-relative (e.g. `/og-image.png` or
  // `assets/covers/foo.jpg`), so resolve against siteUrl, not canonicalUrl.
  const coverPath = article.frontmatter.cover as string | undefined;
  if (coverPath) {
    const coverUrl = new URL(coverPath.replace(/^\//, ""), siteUrl.replace(/\/$/, "") + "/").href;
    try {
      await waitForUrl(coverUrl);
      const coverAssetId = await uploadCoverByUrl(coverUrl, draft.id);
      console.log(`    🖼️ Cover uploaded: ${coverAssetId}`);
      // Update draft with cover
      await createDraft({ id: draft.id, title: draft.title, cover: coverAssetId });
      console.log(`    🖼️ Draft updated with cover`);
    } catch (error) {
      console.warn(`    ⚠️ Cover upload failed, continuing without cover: ${error}`);
    }
  }

  // Step 8: Upload embedded body images and re-put the draft with CDN URLs.
  // Same `entityId` requirement as cover, so this also has to wait until the
  // draft exists. The first putDraft above sent the relative-src content; if
  // any uploads succeed, this overwrites the body with the CDN-rewritten one.
  //
  // Wrapped in try/catch to match the cover flow's "continue on failure"
  // semantics. Without this, a single re-put error (e.g. matters API 5xx)
  // would skip the toast/openBrowser path and leave the user looking at a
  // generic syndication failure instead of the still-usable draft.
  if (isHtml) {
    try {
      const rewritten = await uploadAndReplaceLocalImages(content, canonicalUrl, draft.id);
      if (rewritten !== content) {
        await createDraft({ id: draft.id, title: draft.title, content: rewritten });
        console.log(`    🖼️ Draft updated with rewritten image srcs`);
      }
    } catch (error) {
      console.warn(`    ⚠️ Image upload step failed, draft body keeps relative srcs: ${error}`);
    }
  }

  // Step 9: Open draft in browser for user review; then signal L1 "waiting for you"
  // Law 3: the 10-min waitForPublishOrClose poll is textbook Awaiting semantics.
  // task.awaiting() fires AFTER openBrowser() so the amber dot appears when
  // the editor is already visible (semantically accurate: "waiting for you IN
  // Matters editor" — the editor is open when the wait starts).
  const draftPageUrl = draftUrl(draft.id);
  console.log(`    🌐 Opening draft for review: ${draftPageUrl}`);
  const browserHandle = await openBrowser(draftPageUrl);
  await task.awaiting("publish the draft", "Matters editor", "cancel");

  // Step 10: Poll for publish state change (10 min timeout)
  const publishedArticle = await waitForPublishOrClose(draft.id, 600000, browserHandle);

  if (publishedArticle) {
    // Step 11: Article was published - update local frontmatter
    const publishedUrl = articleUrl(userName, publishedArticle.slug, publishedArticle.shortHash);
    console.log(`    ✅ Published: ${publishedUrl}`);

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

  // Step 12: Closed/timeout without publishing — signal the ship conductor.
  // Emit 'matters-room-skipped' so the conductor in the main shell can advance
  // the ring segment for matters as 'skipped' (not 'failed'). The tauri_bridge
  // special-cases this event to broadcast to all windows (not just the browser
  // panel), matching how 'email-room-skipped' reaches the conductor. Best-effort:
  // failure to emit must not abort the cleanup below.
  try {
    await emitEvent("matters-room-skipped");
  } catch (err) {
    console.warn(`    ⚠️ Failed to emit matters-room-skipped: ${err}`);
  }

  // R9: Post-settle reconciliation — close/skip won the race but the article
  // may have been published in the same window (e.g. user published → closed
  // fast enough for close to win). Avoid leaving a misleading "Draft saved"
  // advisory when the article is actually live. Best-effort: a network failure
  // here must not abort the cleanup.
  let latePublish: { shortHash: string; slug: string } | null = null;
  try {
    const reconcileDraft = await fetchDraft(draft.id);
    if (reconcileDraft?.article) {
      latePublish = {
        shortHash: reconcileDraft.article.shortHash,
        slug: reconcileDraft.article.slug,
      };
      console.log(`    🔄 R9 reconciliation: article was published despite close/timeout`);
    }
  } catch (err) {
    console.warn(`    ⚠️ R9 reconciliation check failed: ${err}`);
  }

  if (latePublish) {
    // Article is actually live — update frontmatter and return as published.
    const publishedUrl = articleUrl(userName, latePublish.slug, latePublish.shortHash);
    if (article.source_path) {
      await updateFrontmatterSyndicated(article.source_path, publishedUrl).catch((err) => {
        console.warn(`    ⚠️ R9: Failed to update frontmatter: ${err}`);
      });
      await removeDraftId(article.source_path).catch(() => {});
    }
    await task.advise({
      scope: "Remote",
      severity: "Info",
      item: article.title,
      what: "Article published on Matters — frontmatter will sync",
      action: { Link: { href: publishedUrl, label: "View article" } },
    });
    return { draftId: draft.id, publishedUrl };
  }

  // Save draft ID for reuse next time
  if (article.source_path) {
    try {
      await saveDraftId(article.source_path, draft.id);
      console.log(`    💾 Draft ID saved for reuse`);
    } catch (err) {
      console.warn(`    ⚠️ Failed to save draft tracking: ${err}`);
    }
  }
  console.log(`    ⏱️ Publish timeout/close — draft saved for later`);
  // Draft timed out or user closed without publish; leave an actionable advisory
  // in the pill popover (Law 2: actionable state must not auto-fade in 5s).
  // advise() accumulates on the handle and flushes when task.succeeded() is
  // called after the loop — this is correct SDK behavior, not a leak.
  await task.advise({
    scope: "Remote",
    severity: "NeedsAction",
    item: article.title,
    what: "Draft saved — publish it on Matters when ready",
    action: { Link: { href: draftUrl(draft.id), label: "Open draft" } },
  });
  return { draftId: draft.id };
}

/**
 * Wait for draft to be published, browser to close, or timeout.
 *
 * Rewritten (R6) from a `while`-loop into a single `new Promise` executor
 * with a shared `settle()` guard so exactly ONE resolution wins. Four racing
 * branches all call `settle`:
 *
 *   (a) Poll loop — sleep(5s) then fetchDraft; if draft.article → settle published.
 *       Uses the `sleep` utility so tests can mock it to a no-op.
 *   (b) browserHandle.closed → settle(null) [keeps existing test-mock behaviour].
 *   (c) onEvent('browser-url-changed') — if URL looks like a published article,
 *       immediately call fetchDraft; if draft.article → settle published.
 *       The URL is a TRIGGER; the API is the source of truth.
 *   (d) setTimeout at timeoutMs → settle(null).
 *
 * Cleanup (url-listener + timeout handle) is guaranteed on EVERY resolution
 * path. The poll loop exits naturally once `settled` is true. A leaked
 * `onEvent` listener double-fires on the next article — unlisten is mandatory.
 *
 * Returns { shortHash, slug } on confirmed publish; null on close/timeout.
 *
 * NOTE: Matters is currently the last channel. When multi-channel ordering
 * changes, "done detection finishes the ship" must be revisited.
 *
 * @internal exported for unit tests only
 */
export async function waitForPublishOrClose(
  draftId: string,
  timeoutMs: number,
  browserHandle?: BrowserHandle
): Promise<{ shortHash: string; slug: string } | null> {
  console.log(`    ⏳ Waiting for publish (timeout: ${timeoutMs / 1000}s)...`);

  const pollIntervalMs = 5000; // 5 seconds

  return new Promise<{ shortHash: string; slug: string } | null>((resolve) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let unlistenUrl: (() => void) | undefined;

    function settle(value: { shortHash: string; slug: string } | null): void {
      if (settled) return;
      settled = true;

      // Cleanup: clear the global timeout and the URL listener so neither
      // fires again on a subsequent article. The poll loop exits via the
      // `settled` guard in its own loop.
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      if (unlistenUrl) unlistenUrl();

      if (value) {
        console.log(`    🎉 Publish detected!`);
        // R19 — Held confirmation beat: signal the shell bar first, hold
        // ~800ms so the "Published to Matters" bar is visible, THEN close
        // the browser. Prevents the "moss stole my tab" feeling. The 800ms
        // uses the same `sleep` helper as the poll loop so tests can mock it.
        (async () => {
          try {
            await emitEvent("matters-room-published");
          } catch (err) {
            console.warn(`    ⚠️ Failed to emit matters-room-published: ${err}`);
          }
          await sleep(800);
          closeBrowser().catch(() => { /* already closed */ });
          resolve(value);
        })();
      } else {
        resolve(value);
      }
    }

    // Branch (a): poll loop — uses sleep() so tests can mock it to a no-op.
    (async () => {
      while (!settled) {
        await sleep(pollIntervalMs);
        if (settled) break;
        try {
          const draft = await fetchDraft(draftId);
          if (draft?.article) {
            settle({ shortHash: draft.article.shortHash, slug: draft.article.slug });
          }
        } catch (err) {
          console.warn(`    ⚠️ Error checking draft status: ${err}`);
        }
      }
    })();

    // Branch (b): browser close
    if (browserHandle) {
      browserHandle.closed.then(() => {
        console.log(`    🚪 Browser closed by user`);
        settle(null);
      });
    }

    // Branch (c): URL-triggered immediate verify (latency optimisation; API is truth)
    onEvent<{ url: string }>("browser-url-changed", async (payload) => {
      // guard the leaked-listener race: if we've already settled (e.g. unlisten not yet stored), do nothing
      if (settled) return;
      const url = payload.url;
      console.log("[matters] browser-url-changed", url);
      if (!looksLikePublishedArticleUrl(url)) return;
      try {
        const draft = await fetchDraft(draftId);
        if (draft?.article) {
          settle({ shortHash: draft.article.shortHash, slug: draft.article.slug });
        }
      } catch (err) {
        console.warn(`    ⚠️ URL-triggered verify failed: ${err}`);
      }
    }).then((fn) => {
      unlistenUrl = fn;
    }).catch((err) => {
      // If onEvent fails (e.g. no Tauri runtime in test env), log and continue.
      // The API poll provides the correctness backstop regardless.
      console.warn(`    ⚠️ Could not register browser-url-changed listener: ${err}`);
    });

    // Branch (d): global timeout
    timeoutHandle = setTimeout(() => {
      console.log(`    ⏱️ Timeout reached, closing browser...`);
      closeBrowser().catch(() => { /* already closed */ });
      settle(null);
    }, timeoutMs);
  });
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
 * Image wrapping is also matters-specific. Matters' server-side HTML
 * sanitizer strips any `<img>` not inside `<figure class="image">` with
 * a `<figcaption>` child, and also strips `<figure>` with any other
 * class (`moss-image`, plain `<figure>`, etc.). Smoke test against
 * `server.matters.icu` on 2026-05-27 confirmed this contract empirically
 * (see `.credentials/accounts.md` for the test wallet).
 *
 * Phase 2A of the unified-image-emission migration (2026-05-25) removed
 * the plugin's matters-shape wrap on the assumption moss's
 * `<figure class="moss-image">` output would round-trip through matters.
 * It does not — matters strips that wrap entirely. So we restore the
 * wrap, but as a matters-specific pre-upload transform (not a
 * regression of moss-core's emission). See `wrapImagesForMatters`.
 */
/**
 * Strip moss's auto-injected article-title `<h1 class="moss-article-title">`
 * when its plain text equals the article's title. matters.town has its own
 * title field on the draft, so leaving the h1 in the body content produces a
 * visible duplicate ("Title" rendered as the heading + "Title" rendered as
 * the matters page H1 above it).
 *
 * Tolerates other `<h1>` tags in the body — only removes the moss-class one,
 * and only when its content matches. Authors who genuinely want a leading H1
 * with the same text as the title can opt out by removing the moss class.
 *
 * Exported for unit testing.
 */
export function stripArticleTitleH1(html: string, articleTitle: string): string {
  // Match <h1 ...class="...moss-article-title..."...>INNER</h1>
  const re = /<h1\b[^>]*class="[^"]*\bmoss-article-title\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/gi;
  return html.replace(re, (full, inner: string) => {
    // Compare plain text — strip tags and collapse whitespace on both sides.
    const innerText = inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const titleText = articleTitle.replace(/\s+/g, " ").trim();
    return innerText === titleText ? "" : full;
  });
}

/**
 * Absolutize relative `href` values on `<a>` elements against `baseUrl`.
 *
 * matters.town's editor preserves whatever URL we pass in the draft HTML.
 * Relative hrefs (e.g. `../../scale-compare.html`) end up resolved by the
 * matters editor against `https://matters.town/...`, breaking every internal
 * link from the original site. Resolve against the article's own canonical
 * URL so links retain their original meaning when viewed inside matters.
 *
 * - Skips absolute URLs (http://, https://, mailto:, data:, etc.)
 * - Skips fragment-only links (`#section`) — those reference the matters
 *   draft's own headings and should stay intra-document.
 * - Skips hrefs we can't resolve (logs and leaves them alone).
 *
 * Exported for unit testing.
 */
export function absolutizeRelativeHrefs(html: string, baseUrl: string): string {
  return html.replace(/<a\b([^>]*?)\shref="([^"]+)"([^>]*)>/gi, (full, before: string, href: string, after: string) => {
    // Leave absolute URLs, scheme-relative URLs, and fragment links untouched.
    if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) {
      return full;
    }
    let absolute: string;
    try {
      absolute = new URL(href, baseUrl).href;
    } catch (error) {
      console.warn(`    ⚠️ Could not resolve href ${href} against ${baseUrl}: ${error}`);
      return full;
    }
    return `<a${before} href="${absolute}"${after}>`;
  });
}

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

  // Step 3: Wrap images in matters' required <figure class="image"> shell.
  result = wrapImagesForMatters(result);

  return result;
}

/**
 * Convert every moss image-emission pattern into matters' required shape:
 * `<figure class="image"><img src="..."><figcaption>...</figcaption></figure>`.
 *
 * Matters' server-side sanitizer is strict (smoke-tested 2026-05-27 against
 * `server.matters.icu`):
 *
 *   - `<img>` outside a `<figure class="image">` → STRIPPED
 *   - `<figure class="moss-image">` → STRIPPED (along with contents)
 *   - `<figure>` (no class) → STRIPPED
 *   - `<figure class="image">` without a `<figcaption>` child → causes a
 *     server error ("Cannot read properties of undefined (reading 'firstChild')")
 *   - `<figure class="image">` with `<figcaption>` (empty is fine) → KEPT
 *   - `<picture>` inside `<figure class="image">` → kept on POST, server
 *     normalizes to bare `<img>` on read
 *
 * So we restore the wrap the matters plugin used to apply pre-Phase-2A,
 * but adapted for moss's new emission patterns (`<picture>` wrappers and
 * `<figure class="moss-image">` shells).
 *
 * Exported for unit testing.
 */
export function wrapImagesForMatters(html: string): string {
  let result = html;

  // Step A: Rename `<figure class="moss-image">` → `<figure class="image">`,
  // adding an empty `<figcaption>` if the body doesn't already have one.
  result = result.replace(
    /<figure\b[^>]*\bclass="[^"]*\bmoss-image\b[^"]*"[^>]*>([\s\S]*?)<\/figure>/gi,
    (_full, body) => {
      const hasFigcap = /<figcaption\b/i.test(body);
      const bodyWithCap = hasFigcap ? body : `${body}<figcaption></figcaption>`;
      return `<figure class="image">${bodyWithCap}</figure>`;
    },
  );

  // Helper: is `offset` inside an open `<figure>` or `<picture>` in `src`?
  // Looks back 400 chars (longer than any plausible single element start) for
  // an unclosed tag.
  const isInside = (src: string, offset: number, tag: "figure" | "picture"): boolean => {
    const preceding = src.substring(Math.max(0, offset - 400), offset);
    const openIdx = preceding.lastIndexOf(`<${tag}`);
    const closeIdx = preceding.lastIndexOf(`</${tag}`);
    return openIdx > closeIdx;
  };

  // Step B: `<p>` containing only a `<picture>` → hoist to a figure wrap.
  // A `<figure>` inside a `<p>` is invalid HTML and matters' parser splits the
  // `<p>` around it, producing stray empty `<p></p>` siblings. Hoist first.
  result = result.replace(
    /<p>\s*(<picture\b[^>]*>[\s\S]*?<\/picture>)\s*<\/p>/gi,
    (_full, picture: string) => `<figure class="image">${picture}<figcaption></figcaption></figure>`,
  );

  // Step C: Wrap remaining standalone `<picture>` blocks (not already inside
  // a `<figure>`). matters normalizes the picture down to just the `<img>` on
  // storage, but the wrap is what saves the image from being stripped.
  result = result.replace(
    /<picture\b[^>]*>[\s\S]*?<\/picture>/gi,
    (full, offset: number) => {
      if (isInside(result, offset, "figure")) return full;
      return `<figure class="image">${full}<figcaption></figcaption></figure>`;
    },
  );

  // Step D: `<p>` containing only an `<img>` → same hoist as Step B.
  result = result.replace(
    /<p>\s*(<img\b[^>]*>)\s*<\/p>/gi,
    (_full, img: string) => `<figure class="image">${img}<figcaption></figcaption></figure>`,
  );

  // Step E: Remaining bare `<img>` tags (not already inside a `<figure>` or
  // `<picture>`). After Step D this is rare — usually an inline image mixed
  // with text. We wrap regardless; matters would strip it otherwise.
  result = result.replace(/<img\b[^>]*>/gi, (imgTag, offset: number) => {
    if (isInside(result, offset, "figure")) return imgTag;
    if (isInside(result, offset, "picture")) return imgTag;
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
 * - Retries the upload with HEAD-probe backoff on 404s, since the article
 *   may have just been deployed and CDN propagation (GitHub Pages especially)
 *   can lag the deploy command's success by tens of seconds.
 *
 * @param content - HTML content containing img tags
 * @param baseUrl - URL to resolve relative srcs against. Pass the article's
 *   own canonical URL (e.g. "https://example.com/posts/foo/") so deep-relative
 *   paths like "../../assets/x.gif" resolve correctly. A bare site root would
 *   clamp `../../` to the root and lose the article's directory context.
 * @param entityId - Draft ID the embeds are being uploaded into. Matters'
 *   singleFileUpload requires this for type:"embed" — see uploadEmbedByUrl.
 *   Caller must therefore create the draft first, then call this and re-put
 *   the rewritten content via createDraft({ id: entityId, content: ... }).
 * @returns HTML content with local image srcs replaced by CDN URLs
 */
export async function uploadAndReplaceLocalImages(
  content: string,
  baseUrl: string,
  entityId: string,
  options: { waitOptions?: { totalMs?: number; intervalMs?: number } } = {},
): Promise<string> {
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
    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(src, baseUrl).href;
    } catch (error) {
      console.warn(`    ⚠️ Could not resolve image URL ${src} against ${baseUrl}: ${error}`);
      continue;
    }

    try {
      await waitForUrl(absoluteUrl, options.waitOptions);
      const cdnUrl = await uploadEmbedByUrl(absoluteUrl, entityId);
      replacements.set(src, cdnUrl);
      console.log(`    🖼️ Image uploaded: ${src} → ${cdnUrl}`);
    } catch (error) {
      console.warn(`    ⚠️ Image upload failed for ${absoluteUrl}, leaving unchanged: ${error}`);
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

/**
 * Poll a URL with HEAD until it returns 2xx, or throw after the budget.
 *
 * Used before matters' upload-by-URL to absorb the gap between a deploy
 * succeeding and the CDN actually serving the new file. GitHub Pages can
 * take tens of seconds to propagate after `git push` completes; matters'
 * server fetching too early returns a 404 that we cannot recover from
 * (matters silently caches the failure).
 *
 * Exported for unit testing.
 */
export async function waitForUrl(
  url: string,
  options: { totalMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const totalMs = options.totalMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 3_000;
  const deadline = Date.now() + totalMs;

  let lastError: unknown = null;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const response = await fetch(url, { method: "HEAD" });
      if (response.ok) {
        if (attempt > 1) {
          console.log(`    🌐 URL reachable after ${attempt} attempt(s): ${url}`);
        }
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
      console.log(`    ⏳ URL not yet reachable (attempt ${attempt}, HTTP ${response.status}): ${url}`);
    } catch (error) {
      lastError = error;
      console.log(`    ⏳ URL not yet reachable (attempt ${attempt}, ${error}): ${url}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`URL did not become reachable within ${totalMs}ms: ${url} (${lastError})`);
}
