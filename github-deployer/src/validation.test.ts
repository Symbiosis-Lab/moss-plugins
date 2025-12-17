/**
 * Unit tests for validation.ts
 *
 * These tests verify the validation logic structure.
 * Functions that call Tauri require integration tests, but we can test
 * the error message formatting and validation flow.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Create mock functions
vi.mock("./utils", () => {
  const mockInvoke = vi.fn();
  return {
    getTauriCore: () => ({ invoke: mockInvoke }),
    log: vi.fn().mockResolvedValue(undefined),
    __mockInvoke: mockInvoke,
  };
});

// Import after mocking
import {
  validateGitRepository,
  validateSiteCompiled,
  validateGitHubRemote,
  validateAll,
} from "./validation";
import * as utils from "./utils";

// Access the mock through module
const getMockInvoke = () => (utils as { __mockInvoke: ReturnType<typeof vi.fn> }).__mockInvoke;

describe("validateGitRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("passes when git repository exists", async () => {
    // Mock successful git check
    getMockInvoke().mockResolvedValueOnce({ success: true, stdout: ".git", stderr: "", exit_code: 0 });

    await expect(validateGitRepository("/project")).resolves.toBeUndefined();
  });

  it("throws descriptive error when not a git repository", async () => {
    // Mock failed git check
    getMockInvoke().mockRejectedValueOnce(new Error("Not a git repo"));

    await expect(validateGitRepository("/project")).rejects.toThrow(
      "This folder is not a git repository"
    );
  });

  it("includes helpful instructions in error message", async () => {
    getMockInvoke().mockRejectedValueOnce(new Error("Not a git repo"));

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
    getMockInvoke().mockResolvedValueOnce(["index.html", "style.css"]);

    await expect(validateSiteCompiled("/project/.moss/site")).resolves.toBeUndefined();
  });

  it("throws when site directory is empty", async () => {
    getMockInvoke().mockResolvedValueOnce([]);

    await expect(validateSiteCompiled("/project/.moss/site")).rejects.toThrow(
      "Site directory is empty"
    );
  });

  it("throws when site directory doesn't exist", async () => {
    getMockInvoke().mockRejectedValueOnce(new Error("Directory not found"));

    await expect(validateSiteCompiled("/project/.moss/site")).rejects.toThrow(
      "Site not found at .moss/site"
    );
  });
});

describe("validateGitHubRemote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes and returns URL for valid GitHub remote", async () => {
    // First call: hasGitRemote check
    getMockInvoke().mockResolvedValueOnce({
      success: true,
      stdout: "https://github.com/user/repo.git",
      stderr: "",
      exit_code: 0,
    });
    // Second call: getRemoteUrl
    getMockInvoke().mockResolvedValueOnce({
      success: true,
      stdout: "https://github.com/user/repo.git",
      stderr: "",
      exit_code: 0,
    });

    const result = await validateGitHubRemote("/project");
    expect(result).toBe("https://github.com/user/repo.git");
  });

  it("throws when no remote is configured", async () => {
    getMockInvoke().mockRejectedValueOnce(new Error("No remote"));

    await expect(validateGitHubRemote("/project")).rejects.toThrow("No git remote configured");
  });

  it("throws for non-GitHub remotes", async () => {
    // First call: hasGitRemote check (pass)
    getMockInvoke().mockResolvedValueOnce({
      success: true,
      stdout: "https://gitlab.com/user/repo.git",
      stderr: "",
      exit_code: 0,
    });
    // Second call: getRemoteUrl
    getMockInvoke().mockResolvedValueOnce({
      success: true,
      stdout: "https://gitlab.com/user/repo.git",
      stderr: "",
      exit_code: 0,
    });

    await expect(validateGitHubRemote("/project")).rejects.toThrow("is not a GitHub URL");
  });
});

describe("validateAll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs all validations in sequence", async () => {
    // isGitRepository
    getMockInvoke().mockResolvedValueOnce({ success: true, stdout: ".git", stderr: "", exit_code: 0 });
    // validateSiteCompiled - list_directory_files
    getMockInvoke().mockResolvedValueOnce(["index.html"]);
    // hasGitRemote
    getMockInvoke().mockResolvedValueOnce({
      success: true,
      stdout: "https://github.com/user/repo.git",
      stderr: "",
      exit_code: 0,
    });
    // getRemoteUrl
    getMockInvoke().mockResolvedValueOnce({
      success: true,
      stdout: "https://github.com/user/repo.git",
      stderr: "",
      exit_code: 0,
    });

    const result = await validateAll("/project", "/project/.moss/site");
    expect(result).toBe("https://github.com/user/repo.git");
  });

  it("stops on first validation failure", async () => {
    // Fail on git repository check
    getMockInvoke().mockRejectedValueOnce(new Error("Not a git repo"));

    await expect(validateAll("/project", "/project/.moss/site")).rejects.toThrow(
      "This folder is not a git repository"
    );

    // Should not have continued to other validations
    expect(getMockInvoke()).toHaveBeenCalledTimes(1);
  });
});
