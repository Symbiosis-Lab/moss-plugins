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

  it("runs all validations in sequence", async () => {
    // isGitRepository (git rev-parse --git-dir)
    mockExecuteBinary.mockResolvedValueOnce({ success: true, stdout: ".git", stderr: "", exitCode: 0 });
    // validateSiteCompiled - listFiles returns files including ones in .moss/site
    mockListFiles.mockResolvedValueOnce([".moss/site/index.html", "README.md"]);
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

    const result = await validateAll(".moss/site");
    expect(result).toBe("https://github.com/user/repo.git");
  });

  it("stops on first validation failure", async () => {
    // Fail on git repository check
    mockExecuteBinary.mockResolvedValueOnce({ success: false, stdout: "", stderr: "Not a git repo", exitCode: 128 });

    await expect(validateAll(".moss/site")).rejects.toThrow(
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
