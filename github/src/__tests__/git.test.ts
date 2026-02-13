/**
 * Unit tests for git.ts pure functions
 *
 * These tests cover the pure functions that don't require Tauri invoke calls.
 * Functions that call Tauri (runGit, etc.) require integration tests with the full runtime.
 */

import { describe, it, expect } from "vitest";
import { parseGitHubUrl, extractGitHubPagesUrl, parseStaleWorktreePath, buildFindFilesCommand, fingerprintsMatch, parseLsTreeOutput, compareFingerprints } from "../git";

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

describe("parseStaleWorktreePath", () => {
  describe("Bug 24 fix: handles different Git version error messages", () => {
    it("parses 'already checked out at' error (older Git format)", () => {
      const errorMsg = "fatal: 'gh-pages' is already checked out at '/tmp/moss-gh-pages-123'";
      const result = parseStaleWorktreePath(errorMsg);
      expect(result).toBe("/tmp/moss-gh-pages-123");
    });

    it("parses 'already used by worktree at' error (newer Git format)", () => {
      // This is the error message format from Git 2.42+ that was causing Bug 24 to resurface
      const errorMsg = "fatal: 'gh-pages' is already used by worktree at '/private/tmp/moss-gh-pages-1768321101925-6p0m1h'";
      const result = parseStaleWorktreePath(errorMsg);
      expect(result).toBe("/private/tmp/moss-gh-pages-1768321101925-6p0m1h");
    });

    it("handles error with /private/tmp prefix (macOS symlink resolution)", () => {
      const errorMsg = "fatal: 'gh-pages' is already used by worktree at '/private/tmp/moss-gh-pages-stale'";
      const result = parseStaleWorktreePath(errorMsg);
      expect(result).toBe("/private/tmp/moss-gh-pages-stale");
    });

    it("returns null for unrelated git errors", () => {
      const errorMsg = "fatal: not a git repository (or any of the parent directories): .git";
      const result = parseStaleWorktreePath(errorMsg);
      expect(result).toBeNull();
    });

    it("returns null for empty error message", () => {
      const result = parseStaleWorktreePath("");
      expect(result).toBeNull();
    });

    it("handles error message with extra text", () => {
      const errorMsg = "Preparing worktree (checking out 'gh-pages')\nfatal: 'gh-pages' is already used by worktree at '/tmp/test'";
      const result = parseStaleWorktreePath(errorMsg);
      expect(result).toBe("/tmp/test");
    });
  });
});

describe("buildFindFilesCommand", () => {
  it("builds command that strips siteDir prefix correctly", () => {
    const cmd = buildFindFilesCommand(".moss/site");
    // The sed pattern must contain the actual siteDir value, not a literal ${siteDir}
    expect(cmd).not.toContain("${siteDir}");
    expect(cmd).toContain(".moss/site");
    // The sed pattern should strip the prefix
    expect(cmd).toMatch(/sed.*\.moss\/site/);
  });

  it("escapes special regex characters in path", () => {
    const cmd = buildFindFilesCommand("path/with.dots");
    // Dots should be escaped for sed regex
    expect(cmd).toContain("path/with\\.dots");
  });

  it("handles paths with spaces", () => {
    const cmd = buildFindFilesCommand("path with spaces");
    // Path should be quoted
    expect(cmd).toContain('"path with spaces"');
  });
});

describe("fingerprintsMatch", () => {
  describe("map-based comparison for sort-independent matching", () => {
    it("returns true when maps have identical entries", () => {
      const local = new Map([
        ["index.html", "abc123"],
        ["style.css", "def456"],
      ]);
      const remote = new Map([
        ["index.html", "abc123"],
        ["style.css", "def456"],
      ]);
      expect(fingerprintsMatch(local, remote)).toBe(true);
    });

    it("returns true when maps have same entries in different insertion order", () => {
      // This is the key test - demonstrates sort-independence
      const local = new Map([
        ["文章/test.html", "abc123"],  // Chinese filename first
        ["assets/img.png", "def456"],
        ["index.html", "ghi789"],
      ]);
      const remote = new Map([
        ["index.html", "ghi789"],       // Different insertion order
        ["assets/img.png", "def456"],
        ["文章/test.html", "abc123"],
      ]);
      expect(fingerprintsMatch(local, remote)).toBe(true);
    });

    it("returns false when file counts differ", () => {
      const local = new Map([
        ["index.html", "abc123"],
        ["style.css", "def456"],
      ]);
      const remote = new Map([
        ["index.html", "abc123"],
      ]);
      expect(fingerprintsMatch(local, remote)).toBe(false);
    });

    it("returns false when a file hash differs", () => {
      const local = new Map([
        ["index.html", "abc123"],
        ["style.css", "def456"],
      ]);
      const remote = new Map([
        ["index.html", "abc123"],
        ["style.css", "DIFFERENT"],
      ]);
      expect(fingerprintsMatch(local, remote)).toBe(false);
    });

    it("returns false when a file is missing in remote", () => {
      const local = new Map([
        ["index.html", "abc123"],
        ["style.css", "def456"],
      ]);
      const remote = new Map([
        ["index.html", "abc123"],
        ["other.css", "def456"],  // Different filename
      ]);
      expect(fingerprintsMatch(local, remote)).toBe(false);
    });

    it("returns true for empty maps", () => {
      const local = new Map<string, string>();
      const remote = new Map<string, string>();
      expect(fingerprintsMatch(local, remote)).toBe(true);
    });
  });
});

describe("parseLsTreeOutput", () => {
  it("parses standard git ls-tree output", () => {
    const output = `100644 blob abc123def456\tindex.html
100644 blob def789ghi012\tassets/style.css`;

    const result = parseLsTreeOutput(output);

    expect(result.size).toBe(2);
    expect(result.get("index.html")).toBe("abc123def456");
    expect(result.get("assets/style.css")).toBe("def789ghi012");
  });

  it("handles Chinese filenames (non-ASCII)", () => {
    const output = `100644 blob abc123\t文章/测试文件.html
100644 blob def456\tassets/图片.png`;

    const result = parseLsTreeOutput(output);

    expect(result.size).toBe(2);
    expect(result.get("文章/测试文件.html")).toBe("abc123");
    expect(result.get("assets/图片.png")).toBe("def456");
  });

  it("handles empty output", () => {
    const result = parseLsTreeOutput("");
    expect(result.size).toBe(0);
  });

  it("handles output with only whitespace lines", () => {
    const output = `

    `;
    const result = parseLsTreeOutput(output);
    expect(result.size).toBe(0);
  });

  it("skips malformed lines without tab separator", () => {
    const output = `100644 blob abc123\tvalid.html
malformed line without tab
100644 blob def456\tother.html`;

    const result = parseLsTreeOutput(output);

    expect(result.size).toBe(2);
    expect(result.get("valid.html")).toBe("abc123");
    expect(result.get("other.html")).toBe("def456");
  });

  it("handles filenames with spaces", () => {
    const output = `100644 blob abc123\tpath/to/file with spaces.html`;

    const result = parseLsTreeOutput(output);

    expect(result.size).toBe(1);
    expect(result.get("path/to/file with spaces.html")).toBe("abc123");
  });
});

describe("compareFingerprints", () => {
  it("detects no changes when fingerprints match", () => {
    const local = new Map([
      ["index.html", "abc123"],
      ["style.css", "def456"],
    ]);
    const remote = new Map([
      ["index.html", "abc123"],
      ["style.css", "def456"],
    ]);

    const result = compareFingerprints(local, remote);

    expect(result.hasChanges).toBe(false);
    expect(result.modified).toBe(0);
    expect(result.added).toBe(0);
    expect(result.deleted).toBe(0);
  });

  it("detects added files", () => {
    const local = new Map([
      ["index.html", "abc123"],
      ["new-file.html", "xyz789"],
    ]);
    const remote = new Map([
      ["index.html", "abc123"],
    ]);

    const result = compareFingerprints(local, remote);

    expect(result.hasChanges).toBe(true);
    expect(result.added).toBe(1);
    expect(result.addedFiles).toContain("new-file.html");
    expect(result.modified).toBe(0);
    expect(result.deleted).toBe(0);
  });

  it("detects deleted files", () => {
    const local = new Map([
      ["index.html", "abc123"],
    ]);
    const remote = new Map([
      ["index.html", "abc123"],
      ["old-file.html", "def456"],
    ]);

    const result = compareFingerprints(local, remote);

    expect(result.hasChanges).toBe(true);
    expect(result.deleted).toBe(1);
    expect(result.deletedFiles).toContain("old-file.html");
    expect(result.added).toBe(0);
    expect(result.modified).toBe(0);
  });

  it("detects modified files", () => {
    const local = new Map([
      ["index.html", "abc123"],
      ["style.css", "MODIFIED_HASH"],
    ]);
    const remote = new Map([
      ["index.html", "abc123"],
      ["style.css", "def456"],
    ]);

    const result = compareFingerprints(local, remote);

    expect(result.hasChanges).toBe(true);
    expect(result.modified).toBe(1);
    expect(result.modifiedFiles).toContain("style.css");
    expect(result.added).toBe(0);
    expect(result.deleted).toBe(0);
  });

  it("detects multiple types of changes", () => {
    const local = new Map([
      ["index.html", "MODIFIED"],
      ["new.html", "new123"],
    ]);
    const remote = new Map([
      ["index.html", "abc123"],
      ["deleted.html", "del456"],
    ]);

    const result = compareFingerprints(local, remote);

    expect(result.hasChanges).toBe(true);
    expect(result.modified).toBe(1);
    expect(result.added).toBe(1);
    expect(result.deleted).toBe(1);
  });

  it("handles Chinese filenames correctly", () => {
    const local = new Map([
      ["文章/测试.html", "abc123"],
      ["文章/新文件.html", "new456"],
    ]);
    const remote = new Map([
      ["文章/测试.html", "abc123"],
      ["文章/旧文件.html", "old789"],
    ]);

    const result = compareFingerprints(local, remote);

    expect(result.hasChanges).toBe(true);
    expect(result.added).toBe(1);
    expect(result.addedFiles).toContain("文章/新文件.html");
    expect(result.deleted).toBe(1);
    expect(result.deletedFiles).toContain("文章/旧文件.html");
  });

  it("handles empty fingerprints", () => {
    const local = new Map<string, string>();
    const remote = new Map<string, string>();

    const result = compareFingerprints(local, remote);

    expect(result.hasChanges).toBe(false);
  });
});
