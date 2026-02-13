/**
 * Tests for Phase 3 fix: Progress heartbeat during interactive form
 *
 * Problem: The 60-second inactivity timer expires while user fills out the
 * "Choose repository name" form because no progress updates are sent during showBrowserForm().
 *
 * Solution: Wrap showBrowserForm with a progress heartbeat that sends updates
 * every 30 seconds to keep the inactivity timer alive.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock moss-api
const mockShowBrowserForm = vi.fn().mockResolvedValue(null);

vi.mock("@symbiosis-lab/moss-api", () => ({
  showBrowserForm: (...args: unknown[]) => mockShowBrowserForm(...args),
  executeBinary: vi.fn().mockResolvedValue({ success: true, stdout: "", stderr: "" }),
}));

// Mock utils
const mockReportProgress = vi.fn().mockResolvedValue(undefined);

vi.mock("../utils", () => ({
  log: vi.fn().mockResolvedValue(undefined),
  reportProgress: (...args: unknown[]) => mockReportProgress(...args),
}));

// Mock token module
const mockGetToken = vi.fn();
const mockGetTokenFromGit = vi.fn();
const mockStoreToken = vi.fn();

vi.mock("../token", () => ({
  getToken: () => mockGetToken(),
  getTokenFromGit: () => mockGetTokenFromGit(),
  storeToken: (token: string) => mockStoreToken(token),
}));

// Mock auth module
const mockPromptLogin = vi.fn();
const mockValidateToken = vi.fn();
const mockHasRequiredScopes = vi.fn();

vi.mock("../auth", () => ({
  promptLogin: () => mockPromptLogin(),
  validateToken: (token: string) => mockValidateToken(token),
  hasRequiredScopes: (scopes: string[]) => mockHasRequiredScopes(scopes),
}));

// Mock github-api module
const mockGetAuthenticatedUser = vi.fn();
const mockCheckRepoExists = vi.fn();
const mockCreateRepository = vi.fn();

vi.mock("../github-api", () => ({
  getAuthenticatedUser: (token: string) => mockGetAuthenticatedUser(token),
  checkRepoExists: (owner: string, name: string, token: string) => mockCheckRepoExists(owner, name, token),
  createRepository: (name: string, token: string, description?: string) => mockCreateRepository(name, token, description),
}));

describe("Phase 3: Progress Heartbeat During Interactive Form", () => {
  let ensureGitHubRepo: () => Promise<{
    name: string;
    sshUrl: string;
    fullName: string;
  } | null>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useRealTimers();

    // Setup: Authenticated user with root repo taken (triggers UI)
    mockGetToken.mockResolvedValue("test-token");
    mockGetAuthenticatedUser.mockResolvedValue({ login: "testuser" });
    mockCheckRepoExists.mockResolvedValue(true); // Root repo exists - triggers UI

    // Dynamic import to get the function
    const module = await import("../repo-setup");
    ensureGitHubRepo = module.ensureGitHubRepo;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends progress heartbeat every 30 seconds during form interaction", async () => {
    vi.useFakeTimers();

    // Simulate user taking 75 seconds to fill out form (should trigger 2 heartbeats)
    let formResolve: ((value: { name: string }) => void) | null = null;
    mockShowBrowserForm.mockImplementation(() => {
      return new Promise((resolve) => {
        formResolve = resolve as (value: { name: string }) => void;
      });
    });

    // Start the repo setup (will call showBrowserForm and start heartbeat)
    const resultPromise = ensureGitHubRepo();

    // Fast-forward: 0s -> no heartbeat yet (first one starts immediately but we check calls)
    await vi.advanceTimersByTimeAsync(0);
    expect(mockReportProgress).not.toHaveBeenCalled(); // No progress yet

    // Fast-forward: 30s -> first heartbeat
    await vi.advanceTimersByTimeAsync(30000);
    expect(mockReportProgress).toHaveBeenCalledTimes(1);
    expect(mockReportProgress).toHaveBeenCalledWith("setup", 0, 6, "Setting up GitHub repository...");

    // Fast-forward: 60s -> second heartbeat
    await vi.advanceTimersByTimeAsync(30000);
    expect(mockReportProgress).toHaveBeenCalledTimes(2);
    expect(mockReportProgress).toHaveBeenNthCalledWith(2, "setup", 0, 6, "Setting up GitHub repository...");

    // Fast-forward: 75s -> user submits form
    await vi.advanceTimersByTimeAsync(15000);
    mockCreateRepository.mockResolvedValue({
      name: "my-website",
      fullName: "testuser/my-website",
      sshUrl: "git@github.com:testuser/my-website.git",
    });

    // User submits form
    formResolve!({ name: "my-website" });

    // Wait for completion
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    // Total progress calls: 2 heartbeats during form
    expect(mockReportProgress).toHaveBeenCalledTimes(2);

    // Verify successful result
    expect(result).toEqual({
      name: "my-website",
      sshUrl: "git@github.com:testuser/my-website.git",
      fullName: "testuser/my-website",
    });
  });

  it("clears heartbeat interval when form is submitted", async () => {
    vi.useFakeTimers();

    // User submits form after 35 seconds (should trigger 1 heartbeat, then clear)
    let formResolve: ((value: { name: string }) => void) | null = null;
    mockShowBrowserForm.mockImplementation(() => {
      return new Promise((resolve) => {
        formResolve = resolve as (value: { name: string }) => void;
      });
    });

    mockCreateRepository.mockResolvedValue({
      name: "quick-submit",
      fullName: "testuser/quick-submit",
      sshUrl: "git@github.com:testuser/quick-submit.git",
    });

    // Start the repo setup
    const resultPromise = ensureGitHubRepo();

    // Fast-forward: 35s -> first heartbeat happens
    await vi.advanceTimersByTimeAsync(35000);
    expect(mockReportProgress).toHaveBeenCalledTimes(1);

    // User submits form (should clear interval)
    formResolve!({ name: "quick-submit" });

    // Wait for completion
    await vi.runAllTimersAsync();
    await resultPromise;

    // Reset mock to track future calls
    mockReportProgress.mockClear();

    // Fast-forward another 30s - NO more heartbeats should occur
    await vi.advanceTimersByTimeAsync(30000);
    expect(mockReportProgress).not.toHaveBeenCalled();
  });

  it("clears heartbeat interval when form is cancelled", async () => {
    vi.useFakeTimers();

    // User cancels form after 35 seconds
    let formResolve: ((value: null) => void) | null = null;
    mockShowBrowserForm.mockImplementation(() => {
      return new Promise((resolve) => {
        formResolve = resolve as (value: null) => void;
      });
    });

    // Start the repo setup
    const resultPromise = ensureGitHubRepo();

    // Fast-forward: 35s -> first heartbeat happens
    await vi.advanceTimersByTimeAsync(35000);
    expect(mockReportProgress).toHaveBeenCalledTimes(1);

    // User cancels form (should clear interval)
    formResolve!(null);

    // Wait for completion
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBeNull();

    // Reset mock to track future calls
    mockReportProgress.mockClear();

    // Fast-forward another 30s - NO more heartbeats should occur
    await vi.advanceTimersByTimeAsync(30000);
    expect(mockReportProgress).not.toHaveBeenCalled();
  });

  it("prevents timeout during long form interaction (>60s)", async () => {
    vi.useFakeTimers();

    // Simulate user taking 120 seconds (2 minutes) - should NOT timeout
    let formResolve: ((value: { name: string }) => void) | null = null;
    mockShowBrowserForm.mockImplementation(() => {
      return new Promise((resolve) => {
        formResolve = resolve as (value: { name: string }) => void;
      });
    });

    mockCreateRepository.mockResolvedValue({
      name: "slow-user",
      fullName: "testuser/slow-user",
      sshUrl: "git@github.com:testuser/slow-user.git",
    });

    // Start the repo setup
    const resultPromise = ensureGitHubRepo();

    // Fast-forward: 120s in 30s increments to simulate heartbeats
    await vi.advanceTimersByTimeAsync(30000); // 30s - 1st heartbeat
    await vi.advanceTimersByTimeAsync(30000); // 60s - 2nd heartbeat
    await vi.advanceTimersByTimeAsync(30000); // 90s - 3rd heartbeat
    await vi.advanceTimersByTimeAsync(30000); // 120s - 4th heartbeat

    // Verify 4 heartbeats occurred (every 30s for 120s)
    expect(mockReportProgress).toHaveBeenCalledTimes(4);

    // User finally submits form
    formResolve!({ name: "slow-user" });

    // Wait for completion
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    // Should complete successfully - NO timeout
    expect(result).toEqual({
      name: "slow-user",
      sshUrl: "git@github.com:testuser/slow-user.git",
      fullName: "testuser/slow-user",
    });
  });

  it("uses consistent progress message for all heartbeats", async () => {
    vi.useFakeTimers();

    let formResolve: ((value: { name: string }) => void) | null = null;
    mockShowBrowserForm.mockImplementation(() => {
      return new Promise((resolve) => {
        formResolve = resolve as (value: { name: string }) => void;
      });
    });

    mockCreateRepository.mockResolvedValue({
      name: "test",
      fullName: "testuser/test",
      sshUrl: "git@github.com:testuser/test.git",
    });

    // Start the repo setup
    const resultPromise = ensureGitHubRepo();

    // Trigger 3 heartbeats
    await vi.advanceTimersByTimeAsync(30000);
    await vi.advanceTimersByTimeAsync(30000);
    await vi.advanceTimersByTimeAsync(30000);

    expect(mockReportProgress).toHaveBeenCalledTimes(3);

    // All heartbeats should use the same message
    expect(mockReportProgress).toHaveBeenNthCalledWith(1, "setup", 0, 6, "Setting up GitHub repository...");
    expect(mockReportProgress).toHaveBeenNthCalledWith(2, "setup", 0, 6, "Setting up GitHub repository...");
    expect(mockReportProgress).toHaveBeenNthCalledWith(3, "setup", 0, 6, "Setting up GitHub repository...");

    // Complete
    formResolve!({ name: "test" });
    await vi.runAllTimersAsync();
    await resultPromise;
  });

  it("handles showBrowserForm rejection gracefully", async () => {
    vi.useFakeTimers();

    // Simulate error during form display
    mockShowBrowserForm.mockRejectedValue(new Error("Form display error"));

    // Start the repo setup (catch the error to prevent unhandled rejection)
    let result: any;
    let error: any;
    try {
      result = await ensureGitHubRepo();
    } catch (e) {
      error = e;
    }

    // Fast-forward to trigger any pending timers
    await vi.runAllTimersAsync();

    // Should return null on error (the wrapper catches and returns null)
    // Or if it throws, that's also acceptable behavior
    if (!error) {
      expect(result).toBeNull();
    }

    // Reset mock to track future calls
    mockReportProgress.mockClear();

    // Interval should be cleared - no more heartbeats
    await vi.advanceTimersByTimeAsync(30000);
    expect(mockReportProgress).not.toHaveBeenCalled();
  });

  it("does not start heartbeat when auto-creating root repo (no UI)", async () => {
    vi.useFakeTimers();

    // Root repo doesn't exist - auto-create (no UI)
    mockCheckRepoExists.mockResolvedValue(false);
    mockCreateRepository.mockResolvedValue({
      name: "testuser.github.io",
      fullName: "testuser/testuser.github.io",
      sshUrl: "git@github.com:testuser/testuser.github.io.git",
    });

    // Execute
    const result = await ensureGitHubRepo();

    // Fast-forward time - should be no heartbeats
    await vi.advanceTimersByTimeAsync(60000);

    // showBrowserForm should NOT be called (auto-create path)
    expect(mockShowBrowserForm).not.toHaveBeenCalled();

    // reportProgress should NOT be called (no heartbeat)
    expect(mockReportProgress).not.toHaveBeenCalled();

    // Should succeed
    expect(result).toEqual({
      name: "testuser.github.io",
      sshUrl: "git@github.com:testuser/testuser.github.io.git",
      fullName: "testuser/testuser.github.io",
    });
  });
});
