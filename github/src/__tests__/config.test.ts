/**
 * Tests for Plugin Config Module
 *
 * Tests config storage, retrieval, and clearing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock moss-api
const mockReadPluginFile = vi.fn();
const mockWritePluginFile = vi.fn();
const mockPluginFileExists = vi.fn();

vi.mock("@symbiosis-lab/moss-api", () => ({
  readPluginFile: (...args: unknown[]) => mockReadPluginFile(...args),
  writePluginFile: (...args: unknown[]) => mockWritePluginFile(...args),
  pluginFileExists: (...args: unknown[]) => mockPluginFileExists(...args),
  readFile: vi.fn(),
  setMessageContext: vi.fn(),
  log: vi.fn(),
}));

// Mock utils (config.ts currently imports log — will be removed)
vi.mock("../utils", () => ({
  log: vi.fn().mockResolvedValue(undefined),
}));

// Mock git (config.ts currently imports parseGitHubUrl — will be removed)
vi.mock("../git", () => ({
  parseGitHubUrl: vi.fn((url: string) => {
    const match = url.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (match) return { owner: match[1], repo: match[2] };
    return null;
  }),
}));

import { getRepoConfig, saveRepoConfig, clearRepoConfig } from "../config";

describe("config", () => {
  beforeEach(() => {
    mockReadPluginFile.mockReset();
    mockWritePluginFile.mockReset();
    mockPluginFileExists.mockReset();
  });

  describe("clearRepoConfig", () => {
    it("writes empty string to config file", async () => {
      mockWritePluginFile.mockResolvedValueOnce(undefined);

      await clearRepoConfig();

      expect(mockWritePluginFile).toHaveBeenCalledWith("config.json", "");
    });

    it("does not throw when write fails", async () => {
      mockWritePluginFile.mockRejectedValueOnce(new Error("write failed"));

      await expect(clearRepoConfig()).resolves.toBeUndefined();
    });
  });

  describe("getRepoConfig", () => {
    it("returns config from plugin file when it exists", async () => {
      mockPluginFileExists.mockResolvedValueOnce(true);
      mockReadPluginFile.mockResolvedValueOnce(
        JSON.stringify({ owner: "test", repo: "site" })
      );

      const result = await getRepoConfig();

      expect(result).toEqual({ owner: "test", repo: "site" });
    });

    it("returns null when config file has empty content (no migration)", async () => {
      mockPluginFileExists.mockResolvedValueOnce(true);
      mockReadPluginFile.mockResolvedValueOnce("");

      const result = await getRepoConfig();

      // Empty string → JSON parse fails → returns null (no migration fallback)
      expect(result).toBeNull();
    });

    it("returns null when no config file exists (no migration from .git/config)", async () => {
      mockPluginFileExists.mockResolvedValueOnce(false);

      // Even if .git/config exists with a valid remote, getRepoConfig should NOT
      // fall back to reading it. It should just return null.
      const { readFile: mockReadFile } = await import("@symbiosis-lab/moss-api");
      vi.mocked(mockReadFile).mockResolvedValueOnce(
        '[remote "origin"]\n\turl = git@github.com:alice/blog.git\n'
      );

      const result = await getRepoConfig();

      // No config file → returns null (no migration from .git/config)
      expect(result).toBeNull();
      // Should NOT have tried to read .git/config
      expect(mockReadFile).not.toHaveBeenCalled();
      // Should NOT have tried to write any migrated config
      expect(mockWritePluginFile).not.toHaveBeenCalled();
    });

    it("returns null when config file has invalid JSON", async () => {
      mockPluginFileExists.mockResolvedValueOnce(true);
      mockReadPluginFile.mockResolvedValueOnce("not json{{{");

      const result = await getRepoConfig();

      expect(result).toBeNull();
    });

    it("returns null when config is missing owner or repo", async () => {
      mockPluginFileExists.mockResolvedValueOnce(true);
      mockReadPluginFile.mockResolvedValueOnce(
        JSON.stringify({ owner: "test" }) // missing repo
      );

      const result = await getRepoConfig();

      expect(result).toBeNull();
    });
  });
});
