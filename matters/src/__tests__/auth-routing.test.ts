/**
 * Tests for trigger-aware auth routing in the process hook (and, from T6,
 * the syndicate session gate + mid-sync auth failure handling).
 *
 * Mock prelude copied from binding-guard.test.ts with the deltas the full
 * pipeline needs (binding-guard's tests use sync_on_build: false and return
 * early; these run the whole import path).
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
const mockShowToast = vi.fn().mockResolvedValue(undefined);
const mockTaskFailed = vi.fn().mockResolvedValue(undefined);
const mockTaskSucceeded = vi.fn().mockResolvedValue(undefined);
// vi.hoisted: the ../api factory passes this object through by VALUE
// (`apiConfig: mockApiConfig`), which evaluates at factory time — a plain
// top-level const would hit the vi.mock hoisting TDZ.
const mockApiConfig = vi.hoisted(() => ({
  queryMode: "viewer",
  testUserName: "Matty",
  endpoint: "https://server.matters.town/graphql",
}));

vi.mock("@symbiosis-lab/moss-api", () => ({
  getPluginCookie: vi.fn(),
  httpPost: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listFiles: vi.fn().mockResolvedValue([]),
  showToast: (...args: unknown[]) => mockShowToast(...args),
  openBrowser: (...args: unknown[]) => mockOpenBrowser(...args),
  closeBrowser: (...args: unknown[]) => mockCloseBrowser(...args),
  readPluginFile: vi.fn(),
  writePluginFile: vi.fn().mockResolvedValue(undefined),
  pluginFileExists: vi.fn(),
  // T8a escape hatch — undefined return = no test profile = production
  // path (which is what these routing tests exercise).
  getPluginEnvVar: vi.fn().mockResolvedValue(undefined),
  // startTask mock — returns a TaskHandle whose terminal transitions are
  // captured so tests can assert on the receipt copy.
  startTask: vi.fn().mockResolvedValue({
    id: "0",
    progress: vi.fn().mockResolvedValue(undefined),
    awaiting: vi.fn().mockResolvedValue(undefined),
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
  clearStoredToken: vi.fn().mockResolvedValue(undefined),
  fetchAllArticlesSince: vi.fn().mockResolvedValue({ articles: [], userName: "testuser" }),
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
  loginUrl: vi.fn().mockReturnValue("https://matters.town/login"),
  articleUrl: vi.fn(),
  isMattersUrl: vi.fn(),
}));

vi.mock("../utils", () => ({
  reportProgress: vi.fn().mockResolvedValue(undefined),
  reportError: vi.fn().mockResolvedValue(undefined),
  setCurrentHookName: vi.fn(),
  sleep: vi.fn().mockResolvedValue(undefined),
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
}));

import { process as processHook } from "../main";

// ============================================================================
// Fixtures
// ============================================================================

/** Passing-guard config fixture: boundUserName set so the guard is satisfied. */
const BOUND_CONFIG = { boundUserName: "guo", userName: "guo" };

function makeContext(trigger: string | undefined) {
  // Mirror binding-guard.test.ts's context fixture; only trigger varies.
  return {
    trigger,
    config: { sync_on_build: true },
    project_info: { folder_name: "test", homepage_file: null, lang: "en" },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApiConfig.queryMode = "viewer";
  mockApiConfig.testUserName = "Matty";
  mockGetConfig.mockResolvedValue({ ...BOUND_CONFIG, userName: "guo" });
  mockShouldNudge.mockResolvedValue(true);
  mockFetchUserProfile.mockResolvedValue({ userName: "guo", displayName: "Guo", language: "en" });
});

// ============================================================================
// Tests
// ============================================================================

describe("process hook auth routing", () => {
  it("expired + background + userName → public fallback, no login window, nudge toast", async () => {
    mockGetSessionState.mockResolvedValue("expired");
    await processHook(makeContext("background"));
    expect(mockOpenBrowser).not.toHaveBeenCalled();
    expect(mockApiConfig.queryMode).toBe("user");
    expect(mockApiConfig.testUserName).toBe("guo");
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast.mock.calls[0][0].message).toContain("session expired");
    expect(mockShowToast.mock.calls[0][0].message).not.toContain("—");
    expect(String(mockTaskSucceeded.mock.calls[0][0])).toContain("log in to resume");
  });

  it("nudge toast suppressed when the persisted throttle says no (logs only)", async () => {
    mockGetSessionState.mockResolvedValue("expired");
    mockShouldNudge.mockResolvedValue(false);
    await processHook(makeContext("background"));
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(String(mockTaskSucceeded.mock.calls[0][0])).toContain("log in to resume"); // receipt still honest
  });

  it("expired + background + NO userName → soft fail with session-expired copy", async () => {
    mockGetConfig.mockResolvedValue({ ...BOUND_CONFIG, userName: undefined });
    mockGetSessionState.mockResolvedValue("expired");
    const result = await processHook(makeContext("background"));
    expect(result.success).toBe(false);
    expect(String(mockTaskFailed.mock.calls[0][0])).toContain("session expired");
    expect(mockOpenBrowser).not.toHaveBeenCalled();
  });

  it("expired + settings_manual → opens the login window", async () => {
    mockGetSessionState.mockResolvedValue("expired");
    // Pre-closed handle: waitForToken's window-closed check exits the poll,
    // promptLogin returns false; we only assert the login UI was reached.
    mockOpenBrowser.mockResolvedValue({ closed: Promise.resolve() });
    const result = await processHook(makeContext("settings_manual"));
    expect(mockOpenBrowser).toHaveBeenCalled();
    expect(result.success).toBe(false); // login did not complete in this stub
  });

  it("none + settings_manual + userName → public fallback with not-logged-in receipt (existing behavior, now honest)", async () => {
    mockGetSessionState.mockResolvedValue("none");
    const result = await processHook(makeContext("settings_manual"));
    expect(mockOpenBrowser).not.toHaveBeenCalled();
    expect(mockApiConfig.queryMode).toBe("user");
    expect(result.success).toBe(true);
    expect(String(mockTaskSucceeded.mock.calls[0][0])).toContain("log in to also import drafts");
    expect(mockShowToast).not.toHaveBeenCalled(); // no session event, no toast
  });

  it("valid + background → proceeds in viewer mode, no toast, no login", async () => {
    mockGetSessionState.mockResolvedValue("valid");
    const result = await processHook(makeContext("background"));
    expect(mockOpenBrowser).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockApiConfig.queryMode).toBe("viewer");
    expect(result.success).toBe(true);
  });
});

describe("binding guard trigger gating", () => {
  it("unbound + background → quiet clean success, NO login window", async () => {
    mockGetConfig.mockResolvedValue({}); // no boundUserName
    mockDetectBoundUser.mockResolvedValue(null);
    const result = await processHook(makeContext("background"));
    expect(mockOpenBrowser).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.message).toContain("No Matters account bound");
  });

  it("unbound + onboarding_flow → still prompts login (user is present)", async () => {
    mockGetConfig.mockResolvedValue({});
    mockDetectBoundUser.mockResolvedValue(null);
    mockOpenBrowser.mockResolvedValue({ closed: Promise.resolve() });
    await processHook(makeContext("onboarding_flow"));
    expect(mockOpenBrowser).toHaveBeenCalled();
  });
});
