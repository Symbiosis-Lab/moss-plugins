/**
 * Unit tests for git.ts pure functions
 *
 * These tests cover the pure functions that don't require Tauri invoke calls.
 * Functions that call Tauri (runGit, etc.) require integration tests with the full runtime.
 */

import { describe, it, expect } from "vitest";
import { parseGitHubUrl, extractGitHubPagesUrl } from "../git";

describe("parseGitHubUrl", () => {
  describe("HTTPS URLs", () => {
    it("parses standard HTTPS URL", () => {
      const result = parseGitHubUrl("https://github.com/user/repo.git");
      expect(result).toEqual({ owner: "user", repo: "repo" });
    });

    it("parses HTTPS URL without .git extension", () => {
      const result = parseGitHubUrl("https://github.com/user/repo");
      expect(result).toEqual({ owner: "user", repo: "repo" });
    });

    it("parses org repo HTTPS URL", () => {
      const result = parseGitHubUrl("https://github.com/anthropics/moss.git");
      expect(result).toEqual({ owner: "anthropics", repo: "moss" });
    });

    it("handles hyphenated repo names", () => {
      const result = parseGitHubUrl("https://github.com/user/my-awesome-repo.git");
      expect(result).toEqual({ owner: "user", repo: "my-awesome-repo" });
    });

    it("handles underscored repo names", () => {
      const result = parseGitHubUrl("https://github.com/user/my_repo.git");
      expect(result).toEqual({ owner: "user", repo: "my_repo" });
    });
  });

  describe("SSH URLs", () => {
    it("parses standard SSH URL", () => {
      const result = parseGitHubUrl("git@github.com:user/repo.git");
      expect(result).toEqual({ owner: "user", repo: "repo" });
    });

    it("parses SSH URL without .git extension", () => {
      const result = parseGitHubUrl("git@github.com:user/repo");
      expect(result).toEqual({ owner: "user", repo: "repo" });
    });

    it("parses org repo SSH URL", () => {
      const result = parseGitHubUrl("git@github.com:anthropics/moss.git");
      expect(result).toEqual({ owner: "anthropics", repo: "moss" });
    });
  });

  describe("invalid URLs", () => {
    it("returns null for non-GitHub HTTPS URL", () => {
      const result = parseGitHubUrl("https://gitlab.com/user/repo.git");
      expect(result).toBeNull();
    });

    it("returns null for non-GitHub SSH URL", () => {
      const result = parseGitHubUrl("git@gitlab.com:user/repo.git");
      expect(result).toBeNull();
    });

    it("returns null for malformed URL", () => {
      const result = parseGitHubUrl("not-a-valid-url");
      expect(result).toBeNull();
    });

    it("returns null for empty string", () => {
      const result = parseGitHubUrl("");
      expect(result).toBeNull();
    });

    it("returns null for GitHub URL with extra path segments", () => {
      const result = parseGitHubUrl("https://github.com/user/repo/extra");
      expect(result).toBeNull();
    });
  });
});

describe("extractGitHubPagesUrl", () => {
  it("generates correct Pages URL from HTTPS remote", () => {
    const result = extractGitHubPagesUrl("https://github.com/user/repo.git");
    expect(result).toBe("https://user.github.io/repo");
  });

  it("generates correct Pages URL from SSH remote", () => {
    const result = extractGitHubPagesUrl("git@github.com:user/repo.git");
    expect(result).toBe("https://user.github.io/repo");
  });

  it("generates correct Pages URL for org repos", () => {
    const result = extractGitHubPagesUrl("https://github.com/anthropics/moss.git");
    expect(result).toBe("https://anthropics.github.io/moss");
  });

  it("throws for non-GitHub URLs", () => {
    expect(() => {
      extractGitHubPagesUrl("https://gitlab.com/user/repo.git");
    }).toThrow("Could not parse GitHub URL from remote");
  });

  it("throws for invalid URLs", () => {
    expect(() => {
      extractGitHubPagesUrl("not-a-url");
    }).toThrow("Could not parse GitHub URL from remote");
  });
});
