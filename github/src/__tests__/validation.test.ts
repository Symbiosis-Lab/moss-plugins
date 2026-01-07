/**
 * Unit tests for validation.ts
 *
 * These tests verify the validation logic structure.
 * Functions that call moss-api require mocking those modules.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock internal context for moss-api functions
const mockContext = {
  plugin_name: "github",
  project_path: "/project",
  moss_dir: "/project/.moss",
};

// Mock moss-api functions
const mockExecuteBinary = vi.fn();
const mockListFiles = vi.fn();

vi.mock("@symbiosis-lab/moss-api", () => ({
  executeBinary: (...args: unknown[]) => mockExecuteBinary(...args),
  listFiles: () => mockListFiles(),
}));

vi.mock("../utils", () => ({
  log: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocking
import {
  validateGitRepository,
  validateSiteCompiled,
  validateGitHubRemote,
  validateAll,
  isSSHRemote,
  hasUpstream,
  hasLocalCommits,
  remoteHasCommits,
  ensureRemote,
} from "../validation";

// Helper to setup internal context
function setupContext() {
  (globalThis as unknown as { __MOSS_INTERNAL_CONTEXT__: typeof mockContext }).__MOSS_INTERNAL_CONTEXT__ = mockContext;
}

function clearContext() {
  delete (globalThis as unknown as { __MOSS_INTERNAL_CONTEXT__?: typeof mockContext }).__MOSS_INTERNAL_CONTEXT__;
}

describe("validateGitRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContext();
  });

  afterEach(() => {
    vi.resetAllMocks();
    clearContext();
  });

  it("passes when git repository exists", async () => {
    // Mock successful git check (isGitRepository calls executeBinary with git rev-parse)
    mockExecuteBinary.mockResolvedValueOnce({ success: true, stdout: ".git", stderr: "", exitCode: 0 });

    await expect(validateGitRepository()).resolves.toBeUndefined();
  });

  it("throws descriptive error when not a git repository", async () => {
    // Mock failed git check
    mockExecuteBinary.mockResolvedValueOnce({ success: false, stdout: "", stderr: "Not a git repo", exitCode: 128 });

    await expect(validateGitRepository()).rejects.toThrow(
      "This folder is not a git repository"
    );
  });

  it("includes helpful instructions in error message", async () => {
    mockExecuteBinary.mockResolvedValueOnce({ success: false, stdout: "", stderr: "Not a git repo", exitCode: 128 });

    try {
      await validateGitRepository();
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const errorMessage = (error as Error).message;
      expect(errorMessage).toContain("git init");
      expect(errorMessage).toContain("git remote add origin");
    }
  });
});

describe("validateSiteCompiled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContext();
  });

  afterEach(() => {
    vi.resetAllMocks();
    clearContext();
  });

  it("passes when site directory has files", async () => {
    // listFiles returns all project files, including those in .moss/site/
    mockListFiles.mockResolvedValueOnce([".moss/site/index.html", ".moss/site/style.css", "README.md"]);

    await expect(validateSiteCompiled(".moss/site")).resolves.toBeUndefined();
  });

  it("throws when site directory is empty", async () => {
    // No files in .moss/site/
    mockListFiles.mockResolvedValueOnce(["README.md", "package.json"]);

    await expect(validateSiteCompiled(".moss/site")).rejects.toThrow(
      "Site directory is empty"
    );
  });

  it("throws when project listing fails", async () => {
    mockListFiles.mockRejectedValueOnce(new Error("Failed to list files"));

    await expect(validateSiteCompiled(".moss/site")).rejects.toThrow(
      "Site not found at .moss/site"
    );
  });
});

describe("validateGitHubRemote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContext();
  });

  afterEach(() => {
    vi.resetAllMocks();
    clearContext();
  });

  it("passes and returns URL for valid GitHub remote", async () => {
    // First call: hasGitRemote check (git remote get-url origin)
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "https://github.com/user/repo.git",
      stderr: "",
      exitCode: 0,
    });
    // Second call: getRemoteUrl (git remote get-url origin)
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "https://github.com/user/repo.git",
      stderr: "",
      exitCode: 0,
    });

    const result = await validateGitHubRemote();
    expect(result).toBe("https://github.com/user/repo.git");
  });

  it("throws when no remote is configured", async () => {
    // hasGitRemote fails
    mockExecuteBinary.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "No remote",
      exitCode: 128,
    });

    await expect(validateGitHubRemote()).rejects.toThrow("No git remote configured");
  });

  it("throws for non-GitHub remotes", async () => {
    // First call: hasGitRemote check (pass)
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "https://gitlab.com/user/repo.git",
      stderr: "",
      exitCode: 0,
    });
    // Second call: getRemoteUrl
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "https://gitlab.com/user/repo.git",
      stderr: "",
      exitCode: 0,
    });

    await expect(validateGitHubRemote()).rejects.toThrow("is not a GitHub URL");
  });
});

describe("validateAll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContext();
  });

  afterEach(() => {
    vi.resetAllMocks();
    clearContext();
  });

  it("runs git and remote validations (Bug 13: site validation moved to main.ts)", async () => {
    // isGitRepository (git rev-parse --git-dir)
    mockExecuteBinary.mockResolvedValueOnce({ success: true, stdout: ".git", stderr: "", exitCode: 0 });
    // Bug 13: listFiles is no longer called - site validation uses context.site_files in main.ts
    // hasGitRemote (git remote get-url origin)
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "https://github.com/user/repo.git",
      stderr: "",
      exitCode: 0,
    });
    // getRemoteUrl (git remote get-url origin)
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "https://github.com/user/repo.git",
      stderr: "",
      exitCode: 0,
    });

    const result = await validateAll();
    expect(result).toBe("https://github.com/user/repo.git");
    // Bug 13 fix: listFiles should NOT be called - site validation is done early in main.ts
    expect(mockListFiles).not.toHaveBeenCalled();
  });

  it("stops on first validation failure", async () => {
    // Fail on git repository check
    mockExecuteBinary.mockResolvedValueOnce({ success: false, stdout: "", stderr: "Not a git repo", exitCode: 128 });

    await expect(validateAll()).rejects.toThrow(
      "This folder is not a git repository"
    );

    // Should not have continued to other validations (only 1 executeBinary call, no listFiles call)
    expect(mockExecuteBinary).toHaveBeenCalledTimes(1);
    expect(mockListFiles).not.toHaveBeenCalled();
  });
});

describe("isSSHRemote", () => {
  it("returns true for SSH URLs with git@ prefix", () => {
    expect(isSSHRemote("git@github.com:user/repo.git")).toBe(true);
  });

  it("returns true for SSH URLs with ssh:// prefix", () => {
    expect(isSSHRemote("ssh://git@github.com/user/repo.git")).toBe(true);
  });

  it("returns false for HTTPS URLs", () => {
    expect(isSSHRemote("https://github.com/user/repo.git")).toBe(false);
  });

  it("returns false for HTTP URLs", () => {
    expect(isSSHRemote("http://github.com/user/repo.git")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isSSHRemote("")).toBe(false);
  });
});

// ============================================================================
// Bug 14: Smart Push Functions
// ============================================================================

describe("hasUpstream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContext();
  });

  afterEach(() => {
    vi.resetAllMocks();
    clearContext();
  });

  it("returns true when upstream is configured", async () => {
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "origin/main",
      stderr: "",
      exitCode: 0,
    });

    const result = await hasUpstream();
    expect(result).toBe(true);
  });

  it("returns false when no upstream is configured", async () => {
    mockExecuteBinary.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "fatal: no upstream configured for branch 'main'",
      exitCode: 128,
    });

    const result = await hasUpstream();
    expect(result).toBe(false);
  });
});

describe("hasLocalCommits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContext();
  });

  afterEach(() => {
    vi.resetAllMocks();
    clearContext();
  });

  it("returns true when commits exist", async () => {
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "abc123def456",
      stderr: "",
      exitCode: 0,
    });

    const result = await hasLocalCommits();
    expect(result).toBe(true);
  });

  it("returns false for fresh repo with no commits", async () => {
    mockExecuteBinary.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "fatal: ambiguous argument 'HEAD': unknown revision",
      exitCode: 128,
    });

    const result = await hasLocalCommits();
    expect(result).toBe(false);
  });
});

describe("remoteHasCommits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContext();
  });

  afterEach(() => {
    vi.resetAllMocks();
    clearContext();
  });

  it("returns true when remote has branches", async () => {
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "abc123\trefs/heads/main\ndef456\trefs/heads/develop",
      stderr: "",
      exitCode: 0,
    });

    const result = await remoteHasCommits();
    expect(result).toBe(true);
  });

  it("returns false when remote is empty", async () => {
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    const result = await remoteHasCommits();
    expect(result).toBe(false);
  });

  it("returns false when remote doesn't exist", async () => {
    mockExecuteBinary.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "fatal: 'origin' does not appear to be a git repository",
      exitCode: 128,
    });

    const result = await remoteHasCommits();
    expect(result).toBe(false);
  });
});

describe("ensureRemote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContext();
  });

  afterEach(() => {
    vi.resetAllMocks();
    clearContext();
  });

  it("adds remote if it does not exist", async () => {
    // First call: get-url fails (remote doesn't exist)
    mockExecuteBinary.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "fatal: No such remote 'origin'",
      exitCode: 128,
    });
    // Second call: add remote succeeds
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    await ensureRemote("origin", "git@github.com:user/repo.git");

    expect(mockExecuteBinary).toHaveBeenCalledTimes(2);
    // Verify remote add was called
    const addCall = mockExecuteBinary.mock.calls[1];
    expect(addCall[0].args).toContain("add");
  });

  it("updates remote if URL differs", async () => {
    // First call: get-url returns different URL
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "git@github.com:old/repo.git",
      stderr: "",
      exitCode: 0,
    });
    // Second call: set-url succeeds
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    await ensureRemote("origin", "git@github.com:new/repo.git");

    expect(mockExecuteBinary).toHaveBeenCalledTimes(2);
    // Verify remote set-url was called
    const setUrlCall = mockExecuteBinary.mock.calls[1];
    expect(setUrlCall[0].args).toContain("set-url");
  });

  it("does nothing if remote already has correct URL", async () => {
    // get-url returns same URL
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "git@github.com:user/repo.git",
      stderr: "",
      exitCode: 0,
    });

    await ensureRemote("origin", "git@github.com:user/repo.git");

    // Only one call (get-url), no add or set-url
    expect(mockExecuteBinary).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Bug 15: Site Change Detection Functions
// ============================================================================

import {
  hasSiteChanges,
  isAheadOfRemote,
  commitAndPushSiteChanges,
} from "../git";

describe("hasSiteChanges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContext();
  });

  afterEach(() => {
    vi.resetAllMocks();
    clearContext();
  });

  it("returns true when site has uncommitted changes", async () => {
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "M .moss/site/index.html\nA .moss/site/new-page.html",
      stderr: "",
      exitCode: 0,
    });

    const result = await hasSiteChanges();
    expect(result).toBe(true);
  });

  it("returns false when site has no changes", async () => {
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    const result = await hasSiteChanges();
    expect(result).toBe(false);
  });

  it("returns false when git status fails", async () => {
    mockExecuteBinary.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "fatal: not a git repository",
      exitCode: 128,
    });

    const result = await hasSiteChanges();
    expect(result).toBe(false);
  });
});

describe("isAheadOfRemote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContext();
  });

  afterEach(() => {
    vi.resetAllMocks();
    clearContext();
  });

  it("returns true when local is ahead of remote", async () => {
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "## main...origin/main [ahead 2]",
      stderr: "",
      exitCode: 0,
    });

    const result = await isAheadOfRemote();
    expect(result).toBe(true);
  });

  it("returns true when ahead and behind", async () => {
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "## main...origin/main [ahead 1, behind 3]",
      stderr: "",
      exitCode: 0,
    });

    const result = await isAheadOfRemote();
    expect(result).toBe(true);
  });

  it("returns false when in sync with remote", async () => {
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "## main...origin/main",
      stderr: "",
      exitCode: 0,
    });

    const result = await isAheadOfRemote();
    expect(result).toBe(false);
  });

  it("returns false when behind remote", async () => {
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "## main...origin/main [behind 2]",
      stderr: "",
      exitCode: 0,
    });

    const result = await isAheadOfRemote();
    expect(result).toBe(false);
  });

  it("returns false when git status fails", async () => {
    mockExecuteBinary.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "fatal: not a git repository",
      exitCode: 128,
    });

    const result = await isAheadOfRemote();
    expect(result).toBe(false);
  });
});

describe("commitAndPushSiteChanges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContext();
  });

  afterEach(() => {
    vi.resetAllMocks();
    clearContext();
  });

  it("returns null when no changes and not ahead of remote", async () => {
    // hasSiteChanges - no changes
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    // isAheadOfRemote - not ahead
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "## main...origin/main",
      stderr: "",
      exitCode: 0,
    });

    const result = await commitAndPushSiteChanges();
    expect(result).toBeNull();
  });

  it("stages, commits, and pushes when site has changes", async () => {
    // hasSiteChanges - has changes (git status --porcelain .moss/site/)
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "M .moss/site/index.html",
      stderr: "",
      exitCode: 0,
    });
    // stageFiles (git add .moss/site/)
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    // commit (git commit -m ...)
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    // commit returns rev-parse HEAD internally (git rev-parse HEAD)
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "abc123def",
      stderr: "",
      exitCode: 0,
    });
    // detectBranch (git branch --show-current)
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "main",
      stderr: "",
      exitCode: 0,
    });
    // hasUpstream (git rev-parse --abbrev-ref --symbolic-full-name @{u})
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "origin/main",
      stderr: "",
      exitCode: 0,
    });
    // push (git push)
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    // final rev-parse HEAD to return SHA
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "abc123def",
      stderr: "",
      exitCode: 0,
    });

    const result = await commitAndPushSiteChanges();
    expect(result).toBe("abc123def");
  });

  it("pushes without commit when local is ahead but no new changes", async () => {
    // hasSiteChanges - no new changes
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    // isAheadOfRemote - is ahead
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "## main...origin/main [ahead 1]",
      stderr: "",
      exitCode: 0,
    });
    // detectBranch
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "main",
      stderr: "",
      exitCode: 0,
    });
    // hasUpstream
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "origin/main",
      stderr: "",
      exitCode: 0,
    });
    // push
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    // rev-parse HEAD
    mockExecuteBinary.mockResolvedValueOnce({
      success: true,
      stdout: "xyz789",
      stderr: "",
      exitCode: 0,
    });

    const result = await commitAndPushSiteChanges();
    expect(result).toBe("xyz789");
    // Should NOT have called stage or commit (indices 2, 3 would be those)
    // The call order is: hasSiteChanges, isAheadOfRemote, detectBranch, hasUpstream, push, rev-parse
    expect(mockExecuteBinary).toHaveBeenCalledTimes(6);
  });
});
