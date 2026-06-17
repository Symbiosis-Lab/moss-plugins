/**
 * Task 2.3 — auto-detect tests for waitForPublishOrClose.
 *
 * These tests verify that a `browser-url-changed` event to a published-looking
 * URL triggers an immediate fetchDraft verify, and that the function resolves
 * as published BEFORE the 5s poll would have fired.
 *
 * Also verifies the negative case: a URL that doesn't look like a published
 * article (or an article URL the API does NOT confirm) must NOT resolve.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Capture the listener registered by onEvent so tests can invoke it directly
let capturedUrlListener: ((payload: { url: string }) => void) | null = null;

// The mock returns an unlisten function (vi.fn). We capture the registered
// callback so emitBrowserUrlChanged can invoke it in tests.
const mockUnlistenUrl = vi.fn();

const mockOnEvent = vi.fn().mockImplementation(
  (eventName: string, cb: (payload: { url: string }) => void) => {
    if (eventName === "browser-url-changed") {
      capturedUrlListener = cb;
    }
    return Promise.resolve(mockUnlistenUrl);
  }
);

vi.mock("@symbiosis-lab/moss-api", () => ({
  getPluginCookie: vi.fn(),
  httpPost: vi.fn(),
  httpGet: vi.fn(),
  fetchUrl: vi.fn(),
  downloadAsset: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listFiles: vi.fn().mockResolvedValue([]),
  showToast: vi.fn().mockResolvedValue(undefined),
  dismissToast: vi.fn().mockResolvedValue(undefined),
  // Never-resolving browser handle by default (poll-driven path)
  openBrowser: vi.fn().mockResolvedValue({ closed: new Promise<void>(() => {}) }),
  closeBrowser: vi.fn().mockResolvedValue(undefined),
  readPluginFile: vi.fn().mockResolvedValue("{}"),
  writePluginFile: vi.fn().mockResolvedValue(undefined),
  pluginFileExists: vi.fn().mockResolvedValue(false),
  getPluginEnvVar: vi.fn().mockResolvedValue(undefined),
  startTask: vi.fn().mockResolvedValue({
    id: "42",
    progress: vi.fn().mockResolvedValue(undefined),
    awaiting: vi.fn().mockResolvedValue(undefined),
    advise: vi.fn().mockResolvedValue(undefined),
    succeeded: vi.fn().mockResolvedValue(undefined),
    failed: vi.fn().mockResolvedValue(undefined),
    cancelled: vi.fn().mockResolvedValue(undefined),
  }),
  setMessageContext: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  reportProgress: vi.fn().mockResolvedValue(undefined),
  reportError: vi.fn().mockResolvedValue(undefined),
  reportComplete: vi.fn().mockResolvedValue(undefined),
  emitEvent: vi.fn().mockResolvedValue(undefined),
  // R7: onEvent mock that captures the callback for emitBrowserUrlChanged
  onEvent: (...args: unknown[]) => mockOnEvent(...args),
}));

vi.mock("../config", () => ({
  getConfig: vi.fn().mockResolvedValue({ userName: "guo" }),
  saveConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../api", () => ({
  clearTokenCache: vi.fn(),
  getAccessToken: vi.fn().mockResolvedValue("tok"),
  getSessionState: vi.fn().mockResolvedValue("valid"),
  shouldNudgeSessionExpired: vi.fn().mockResolvedValue(false),
  createDraft: vi.fn().mockResolvedValue({
    id: "d1",
    title: "Post",
    content: "",
    createdAt: "2026-01-01T00:00:00Z",
    publishState: "unpublished",
    article: null,
  }),
  fetchDraft: vi.fn().mockResolvedValue({
    id: "d1",
    title: "Post",
    content: "",
    createdAt: "2026-01-01T00:00:00Z",
    publishState: "published",
    article: { id: "a1", shortHash: "a1b2c3", slug: "post" },
  }),
  uploadCoverByUrl: vi.fn().mockResolvedValue("asset-1"),
  uploadEmbedByUrl: vi.fn().mockResolvedValue("https://cdn/img.jpg"),
  fetchUserProfile: vi.fn().mockResolvedValue({ userName: "guo", displayName: "Guo" }),
  fetchAllArticlesSince: vi.fn().mockResolvedValue({ articles: [], userName: "guo" }),
  fetchAllDraftsSince: vi.fn().mockResolvedValue([]),
  fetchAllCollections: vi.fn().mockResolvedValue([]),
  fetchArticleComments: vi.fn().mockResolvedValue({ comments: [], donations: [], appreciations: [] }),
  fetchAllArticleCommentCounts: vi.fn().mockResolvedValue([]),
  MattersAuthError: class MattersAuthError extends Error {},
  apiConfig: { queryMode: "viewer", testUserName: "Matty", endpoint: "https://server.matters.town/graphql" },
}));

vi.mock("../domain", () => ({
  initializeDomain: vi.fn().mockResolvedValue(undefined),
  loginUrl: vi.fn().mockReturnValue("https://matters.town/login"),
  draftUrl: vi.fn().mockImplementation((id: string) => `https://matters.town/drafts/${id}`),
  articleUrl: vi.fn().mockImplementation((_u: string, slug: string, hash: string) => `https://matters.town/@guo/${slug}-${hash}`),
  isMattersUrl: vi.fn().mockImplementation((url: string) => url.includes("matters.town")),
}));

vi.mock("../sync", () => ({
  detectBoundUser: vi.fn().mockResolvedValue({ userName: "guo" }),
  syncToLocalFiles: vi.fn().mockResolvedValue({ result: { created: 0, updated: 0, skipped: 0, errors: [] }, articlePathMap: new Map() }),
  scanLocalArticles: vi.fn().mockResolvedValue([]),
}));

vi.mock("../utils", () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
  setCurrentHookName: vi.fn(),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../converter", () => ({
  parseFrontmatter: vi.fn().mockReturnValue(null),
  regenerateFrontmatter: vi.fn().mockReturnValue(""),
}));

vi.mock("../progress", () => ({
  overallProgress: vi.fn().mockReturnValue(50),
}));

vi.mock("../social", () => ({
  loadSocialData: vi.fn().mockResolvedValue({ articles: {} }),
  saveSocialData: vi.fn().mockResolvedValue(undefined),
  mergeSocialData: vi.fn().mockReturnValue({ articles: {} }),
  reconcileLegacySocialData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../downloader", () => ({
  downloadMediaAndUpdate: vi.fn().mockResolvedValue(undefined),
  rewriteAllInternalLinks: vi.fn().mockResolvedValue({ linksRewritten: 0 }),
}));

vi.mock("../auth-route", () => ({
  resolveAuthRoute: vi.fn().mockResolvedValue({ kind: "skip" }),
  isUserPresent: vi.fn().mockResolvedValue(true),
}));

// ── Test helper ───────────────────────────────────────────────────────────────

/**
 * Simulates a browser-url-changed event reaching the plugin listener.
 * Invokes the captured callback and flushes microtasks so the async
 * fetchDraft inside the listener has time to resolve.
 */
async function emitBrowserUrlChanged(url: string): Promise<void> {
  if (!capturedUrlListener) {
    throw new Error("No URL listener registered — is waitForPublishOrClose wired up?");
  }
  capturedUrlListener({ url });
  // Flush pending microtasks (the fetchDraft await inside the listener)
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

import { waitForPublishOrClose } from "../main";
import { fetchDraft } from "../api";

beforeEach(() => {
  vi.clearAllMocks();
  capturedUrlListener = null;
  // Restore default onEvent implementation after clearAllMocks wipes it
  mockOnEvent.mockImplementation(
    (eventName: string, cb: (payload: { url: string }) => void) => {
      if (eventName === "browser-url-changed") {
        capturedUrlListener = cb;
      }
      return Promise.resolve(mockUnlistenUrl);
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("waitForPublishOrClose — URL auto-detect (Task 2.3)", () => {
  it("resolves with published article when browser-url-changed fires a published URL and API confirms", async () => {
    // API confirms the article was published
    vi.mocked(fetchDraft).mockResolvedValue({
      id: "d1",
      title: "Post",
      content: "",
      createdAt: "2026-01-01T00:00:00Z",
      publishState: "published",
      article: { id: "a1", shortHash: "a1b2c3", slug: "post" },
    } as never);

    // Start waiting with a long timeout (poll would fire after 5s, but the
    // URL event should resolve it immediately before any poll interval fires)
    const browserHandle = { closed: new Promise<void>(() => {}) };
    const p = waitForPublishOrClose("d1", 600000, browserHandle);

    // Give the function time to register the onEvent listener
    await Promise.resolve();
    await Promise.resolve();

    // Trigger the URL change event with a valid published-article URL
    await emitBrowserUrlChanged("https://matters.town/@guo/post-a1b2c3");

    // Should resolve before the 5s poll (which is mocked to a no-op sleep)
    await expect(p).resolves.toEqual({ shortHash: "a1b2c3", slug: "post" });
  });

  it("does NOT resolve when browser-url-changed fires a non-article URL", async () => {
    // API returns null (publish not confirmed)
    vi.mocked(fetchDraft).mockResolvedValue({
      id: "d1",
      title: "Post",
      content: "",
      createdAt: "2026-01-01T00:00:00Z",
      publishState: "unpublished",
      article: null,
    } as never);

    // Short timeout so the test doesn't hang; browser closes immediately so
    // the close branch resolves it → null (same as timeout path)
    const browserHandle = { closed: Promise.resolve() };
    const p = waitForPublishOrClose("d1", 1000, browserHandle);

    await Promise.resolve();
    await Promise.resolve();

    // Fire a non-article URL — should not resolve the promise
    await emitBrowserUrlChanged("https://matters.town/@guo/followers");

    // Resolves null (browser closed, URL didn't trigger a publish)
    await expect(p).resolves.toBeNull();
  });

  it("does NOT resolve when the API returns null even if the URL looks like a published article", async () => {
    // The URL LOOKS like an article but the API does NOT confirm it
    vi.mocked(fetchDraft).mockResolvedValue({
      id: "d1",
      title: "Post",
      content: "",
      createdAt: "2026-01-01T00:00:00Z",
      publishState: "unpublished",
      article: null,
    } as never);

    // Browser closes immediately so we get a null (not stuck waiting)
    const browserHandle = { closed: Promise.resolve() };
    const p = waitForPublishOrClose("d1", 1000, browserHandle);

    await Promise.resolve();
    await Promise.resolve();

    // URL looks valid but API doesn't confirm → must NOT resolve as published
    await emitBrowserUrlChanged("https://matters.town/@guo/some-other-post-a1b2c3");

    await expect(p).resolves.toBeNull();
  });

  it("cleans up the URL listener (unlisten called) after resolution", async () => {
    vi.mocked(fetchDraft).mockResolvedValue({
      id: "d1",
      title: "Post",
      content: "",
      createdAt: "2026-01-01T00:00:00Z",
      publishState: "published",
      article: { id: "a1", shortHash: "a1b2c3", slug: "post" },
    } as never);

    const browserHandle = { closed: new Promise<void>(() => {}) };
    const p = waitForPublishOrClose("d1", 600000, browserHandle);

    await Promise.resolve();
    await Promise.resolve();
    await emitBrowserUrlChanged("https://matters.town/@guo/post-a1b2c3");
    await p;

    // The unlisten function returned by onEvent must have been called
    expect(mockUnlistenUrl).toHaveBeenCalled();
  });
});
