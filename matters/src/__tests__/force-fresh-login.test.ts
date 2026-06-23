/**
 * Tests for force-fresh login behavior (per-folder isolation).
 *
 * Verifies that promptLogin():
 *   (a) clears the stored token AND plugin cookies BEFORE opening the browser
 *   (b) re-binds boundUserName/userName to the freshly-authenticated account
 *       via affirmBindingFromProfile() on success
 *
 * Mirror of auth-routing.test.ts mock harness — same factory structure, same
 * hoisted helpers, same full mock set needed to drive process() end-to-end.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mocks
// ============================================================================

const mockGetConfig = vi.fn();
const mockSaveConfig = vi.fn().mockResolvedValue(undefined);
const mockDetectBoundUser = vi.fn();
const mockGetAccessToken = vi.fn();
const mockFetchUserProfile = vi.fn();
const mockOpenBrowser = vi.fn();
const mockCloseBrowser = vi.fn().mockResolvedValue(undefined);
const mockGetSessionState = vi.fn();
const mockShouldNudge = vi.fn();
const mockFetchAllArticlesSince = vi.fn().mockResolvedValue({ articles: [], userName: "testuser" });
const mockShowToast = vi.fn().mockResolvedValue(undefined);
const mockDismissToast = vi.fn().mockResolvedValue(undefined);
const mockTaskFailed = vi.fn().mockResolvedValue(undefined);
const mockTaskSucceeded = vi.fn().mockResolvedValue(undefined);
// Hoisted so it is accessible inside vi.mock AND in test assertions.
const mockApiConfig = vi.hoisted(() => ({
  queryMode: "viewer",
  testUserName: "Matty",
  endpoint: "https://server.matters.town/graphql",
}));
const mockTaskAwaiting = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// Capture mock refs for clearStoredToken / clearPluginCookies so tests can
// push call-order sentinels into an array.
const mockClearStoredToken = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockClearPluginCookies = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockOpenBrowserHoisted = vi.hoisted(() => vi.fn().mockResolvedValue({ closed: new Promise<void>(() => {}) }));

vi.mock("@symbiosis-lab/moss-api", () => ({
  getPluginCookie: vi.fn(),
  httpPost: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listFiles: vi.fn().mockResolvedValue([]),
  showToast: (...args: unknown[]) => mockShowToast(...args),
  dismissToast: (...args: unknown[]) => mockDismissToast(...args),
  openBrowser: (...args: unknown[]) => mockOpenBrowserHoisted(...args),
  closeBrowser: (...args: unknown[]) => mockCloseBrowser(...args),
  returnToEditor: vi.fn().mockResolvedValue(undefined),
  readPluginFile: vi.fn(),
  writePluginFile: vi.fn().mockResolvedValue(undefined),
  pluginFileExists: vi.fn(),
  // T8a escape hatch — undefined = no test profile = production path.
  getPluginEnvVar: vi.fn().mockResolvedValue(undefined),
  // clearPluginCookies — called by promptLogin() before opening the browser.
  clearPluginCookies: (...args: unknown[]) => mockClearPluginCookies(...args),
  startTask: vi.fn().mockResolvedValue({
    id: "0",
    progress: vi.fn().mockResolvedValue(undefined),
    awaiting: (...args: unknown[]) => mockTaskAwaiting(...args),
    advise: vi.fn().mockResolvedValue(undefined),
    succeeded: (...args: unknown[]) => mockTaskSucceeded(...args),
    failed: (...args: unknown[]) => mockTaskFailed(...args),
    cancelled: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../config", () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
}));

vi.mock("../sync", () => ({
  detectBoundUser: (...args: unknown[]) => mockDetectBoundUser(...args),
  syncToLocalFiles: vi.fn().mockResolvedValue({
    result: { created: 0, updated: 0, skipped: 0, errors: [] },
    articlePathMap: new Map(),
  }),
  scanLocalArticles: vi.fn().mockResolvedValue([]),
}));

vi.mock("../api", () => ({
  clearTokenCache: vi.fn(),
  getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
  saveStoredToken: vi.fn().mockResolvedValue(undefined),
  loadStoredToken: vi.fn().mockResolvedValue(null),
  clearStoredToken: (...args: unknown[]) => mockClearStoredToken(...args),
  fetchAllArticlesSince: (...args: unknown[]) => mockFetchAllArticlesSince(...args),
  fetchAllDraftsSince: vi.fn().mockResolvedValue([]),
  fetchAllCollections: vi.fn().mockResolvedValue([]),
  fetchUserProfile: (...args: unknown[]) => mockFetchUserProfile(...args),
  fetchArticleComments: vi.fn().mockResolvedValue({ comments: [], donations: [], appreciations: [] }),
  fetchAllArticleCommentCounts: vi.fn().mockResolvedValue(new Map()),
  apiConfig: mockApiConfig,
  getSessionState: (...args: unknown[]) => mockGetSessionState(...args),
  shouldNudgeSessionExpired: (...args: unknown[]) => mockShouldNudge(...args),
  markSessionInvalidated: vi.fn().mockResolvedValue(undefined),
  MattersAuthError: class MattersAuthError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = "MattersAuthError";
      this.code = code;
    }
  },
}));

vi.mock("../domain", () => ({
  initializeDomain: vi.fn().mockResolvedValue("matters.town"),
  getDomain: vi.fn().mockReturnValue("matters.town"),
  loginUrl: vi.fn().mockReturnValue("https://matters.town/login"),
  articleUrl: vi.fn(),
  isMattersUrl: vi.fn(),
}));

vi.mock("../utils", () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
  setCurrentHookName: vi.fn(),
  // sleep resolves instantly so waitForToken's delays are instant in tests.
  sleep: vi.fn().mockResolvedValue(undefined),
  formatArticleSyncSummary: vi.fn(() => "articles synced"),
}));

vi.mock("../progress", () => ({
  overallProgress: vi.fn().mockReturnValue(0),
}));

vi.mock("../converter", () => ({
  parseFrontmatter: vi.fn(),
  regenerateFrontmatter: vi.fn(),
}));

vi.mock("../downloader", () => ({
  downloadMediaAndUpdate: vi.fn().mockResolvedValue({ imagesDownloaded: 0, imagesSkipped: 0, errors: [] }),
  rewriteAllInternalLinks: vi.fn().mockResolvedValue({ linksRewritten: 0 }),
}));

vi.mock("../social", () => ({
  loadSocialData: vi.fn().mockResolvedValue({}),
  saveSocialData: vi.fn().mockResolvedValue(undefined),
  mergeSocialData: vi.fn().mockReturnValue({}),
  reconcileLegacySocialData: vi.fn().mockResolvedValue(false),
}));

import { process as processHook } from "../main";

// ============================================================================
// Fixtures
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  mockApiConfig.queryMode = "viewer";
  mockApiConfig.testUserName = "Matty";
  mockShouldNudge.mockResolvedValue(false);
  mockTaskAwaiting.mockResolvedValue(undefined);
  // Restore hoisted openBrowser after clearAllMocks
  mockOpenBrowserHoisted.mockResolvedValue({ closed: new Promise<void>(() => {}) });
  // Default: clearStoredToken + clearPluginCookies no-op
  mockClearStoredToken.mockResolvedValue(undefined);
  mockClearPluginCookies.mockResolvedValue(undefined);
});

// ============================================================================
// Tests
// ============================================================================

describe("force-fresh login", () => {
  it("clears stored token AND cookies BEFORE opening the login browser", async () => {
    // Unbound fresh folder — will reach promptLogin() via the binding-guard path.
    mockGetConfig.mockResolvedValue({});
    mockGetSessionState.mockResolvedValue("none");
    mockDetectBoundUser.mockResolvedValue(null);
    mockGetAccessToken.mockResolvedValue(null); // no token → waitForToken fails

    // Browser closes immediately so the hook exits cleanly (login fails).
    mockOpenBrowserHoisted.mockResolvedValue({ closed: Promise.resolve() });

    // Track call order via a shared sentinel array.
    const order: string[] = [];
    mockClearStoredToken.mockImplementation(async () => { order.push("clearStoredToken"); });
    mockClearPluginCookies.mockImplementation(async () => { order.push("clearPluginCookies"); });
    mockOpenBrowserHoisted.mockImplementation(async () => {
      order.push("openBrowser");
      return { closed: Promise.resolve() };
    });

    await processHook({
      trigger: "onboarding_flow",
      config: { sync_on_build: false },
      project_info: { folder_name: "test", homepage_file: null, lang: "en" },
    } as never);

    // Both clear operations must have fired.
    const clearTokenIdx = order.indexOf("clearStoredToken");
    const clearCookiesIdx = order.indexOf("clearPluginCookies");
    const openBrowserIdx = order.indexOf("openBrowser");

    expect(clearTokenIdx).toBeGreaterThanOrEqual(0);
    expect(clearCookiesIdx).toBeGreaterThanOrEqual(0);
    expect(openBrowserIdx).toBeGreaterThanOrEqual(0);

    // Both clears must precede openBrowser.
    expect(clearTokenIdx).toBeLessThan(openBrowserIdx);
    expect(clearCookiesIdx).toBeLessThan(openBrowserIdx);
  });

  it("re-binds boundUserName to the freshly-authenticated account on success", async () => {
    // Already-bound-wrong folder: config has "alice", but "bob" logs in.
    mockGetConfig.mockResolvedValue({ boundUserName: "alice", userName: "alice" });
    // Expired session + settings_manual → prompt_login auth route.
    mockGetSessionState.mockResolvedValue("expired");

    // Browser stays open (never-closing handle) so waitForToken can poll.
    mockOpenBrowserHoisted.mockResolvedValue({ closed: new Promise<void>(() => {}) });
    // getAccessToken returns the fresh token on first poll → waitForToken succeeds.
    mockGetAccessToken.mockResolvedValue("fresh-token");
    // fetchUserProfile returns "bob" (the freshly-authenticated account).
    mockFetchUserProfile.mockResolvedValue({ userName: "bob", displayName: "Bob", language: null });

    await processHook({
      trigger: "settings_manual",
      config: { sync_on_build: false },
      project_info: { folder_name: "test", homepage_file: null, lang: "en" },
    } as never);

    // affirmBindingFromProfile (called from promptLogin) must have saved "bob".
    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ boundUserName: "bob", userName: "bob" })
    );
  });
});
