/**
 * Unit tests for validation.ts
 *
 * Tests the pure validation logic (no git CLI dependencies).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../utils", () => ({
  log: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocking
import {
  validateGitHubRemote,
  validateAll,
  isSSHRemote,
} from "../validation";

describe("validateGitHubRemote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("passes and returns URL for valid GitHub HTTPS remote", async () => {
    const result = await validateGitHubRemote("https://github.com/user/repo.git");
    expect(result).toBe("https://github.com/user/repo.git");
  });

  it("passes and returns URL for valid GitHub SSH remote", async () => {
    const result = await validateGitHubRemote("git@github.com:user/repo.git");
    expect(result).toBe("git@github.com:user/repo.git");
  });

  it("throws when no URL is provided", async () => {
    await expect(validateGitHubRemote()).rejects.toThrow("No GitHub repository configured");
  });

  it("throws when URL is undefined", async () => {
    await expect(validateGitHubRemote(undefined)).rejects.toThrow("No GitHub repository configured");
  });

  it("throws for non-GitHub remotes", async () => {
    await expect(validateGitHubRemote("https://gitlab.com/user/repo.git")).rejects.toThrow("is not a GitHub URL");
  });

  it("throws for non-GitHub SSH remotes", async () => {
    await expect(validateGitHubRemote("git@gitlab.com:user/repo.git")).rejects.toThrow("is not a GitHub URL");
  });

  it("includes actual URL in error message", async () => {
    try {
      await validateGitHubRemote("https://gitlab.com/user/repo.git");
    } catch (error) {
      expect((error as Error).message).toContain("gitlab.com");
    }
  });
});

describe("validateAll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns the existing remote URL when valid", async () => {
    const result = await validateAll("https://github.com/user/repo.git");
    expect(result).toBe("https://github.com/user/repo.git");
  });

  it("returns SSH URL when valid", async () => {
    const result = await validateAll("git@github.com:user/repo.git");
    expect(result).toBe("git@github.com:user/repo.git");
  });

  it("throws when no URL is provided", async () => {
    await expect(validateAll()).rejects.toThrow("No GitHub repository configured");
  });

  it("throws for non-GitHub URL", async () => {
    await expect(validateAll("https://gitlab.com/user/repo.git")).rejects.toThrow("is not a GitHub URL");
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
