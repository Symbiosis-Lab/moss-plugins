/**
 * Unit tests for validation.ts
 *
 * These tests verify the validation logic structure.
 * Functions that call moss-api require mocking those modules.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock moss-api functions
const mockExecuteBinary = vi.fn();
const mockListFiles = vi.fn();

vi.mock("@symbiosis-lab/moss-api", () => ({
  executeBinary: (...args: unknown[]) => mockExecuteBinary(...args),
  listFiles: (...args: unknown[]) => mockListFiles(...args),
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
} from "../validation";

describe("validateGitRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("passes when git repository exists", async () => {
    // Mock successful git check (isGitRepository calls executeBinary with git rev-parse)
    mockExecuteBinary.mockResolvedValueOnce({ success: true, stdout: ".git", stderr: "", exitCode: 0 });

    await expect(validateGitRepository("/project")).resolves.toBeUndefined();
  });

  it("throws descriptive error when not a git repository", async () => {
    // Mock failed git check
    mockExecuteBinary.mockResolvedValueOnce({ success: false, stdout: "", stderr: "Not a git repo", exitCode: 128 });

    await expect(validateGitRepository("/project")).rejects.toThrow(
      "This folder is not a git repository"
    );
  });

  it("includes helpful instructions in error message", async () => {
    mockExecuteBinary.mockResolvedValueOnce({ success: false, stdout: "", stderr: "Not a git repo", exitCode: 128 });

    try {
      await validateGitRepository("/project");
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
  });

  it("passes when site directory has files", async () => {
    // listFiles returns all project files, including those in .moss/site/
    mockListFiles.mockResolvedValueOnce([".moss/site/index.html", ".moss/site/style.css", "README.md"]);

    await expect(validateSiteCompiled("/project", ".moss/site")).resolves.toBeUndefined();
  });

  it("throws when site directory is empty", async () => {
    // No files in .moss/site/
    mockListFiles.mockResolvedValueOnce(["README.md", "package.json"]);

    await expect(validateSiteCompiled("/project", ".moss/site")).rejects.toThrow(
      "Site directory is empty"
    );
  });

  it("throws when project listing fails", async () => {
    mockListFiles.mockRejectedValueOnce(new Error("Failed to list files"));

    await expect(validateSiteCompiled("/project", ".moss/site")).rejects.toThrow(
      "Site not found at .moss/site"
    );
  });
});

describe("validateGitHubRemote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const result = await validateGitHubRemote("/project");
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

    await expect(validateGitHubRemote("/project")).rejects.toThrow("No git remote configured");
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

    await expect(validateGitHubRemote("/project")).rejects.toThrow("is not a GitHub URL");
  });
});

describe("validateAll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const result = await validateAll("/project", ".moss/site");
    expect(result).toBe("https://github.com/user/repo.git");
  });

  it("stops on first validation failure", async () => {
    // Fail on git repository check
    mockExecuteBinary.mockResolvedValueOnce({ success: false, stdout: "", stderr: "Not a git repo", exitCode: 128 });

    await expect(validateAll("/project", ".moss/site")).rejects.toThrow(
      "This folder is not a git repository"
    );

    // Should not have continued to other validations (only 1 executeBinary call, no listFiles call)
    expect(mockExecuteBinary).toHaveBeenCalledTimes(1);
    expect(mockListFiles).not.toHaveBeenCalled();
  });
});
