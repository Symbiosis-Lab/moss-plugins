/**
 * Unit tests for Eleventy Structure Translation
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockReadFile, mockWriteFile, mockListFiles, mockFileExists, mockCreateSymlink, writtenFiles, createdSymlinks } =
  vi.hoisted(() => {
    const writtenFiles = new Map<string, string>();
    const createdSymlinks = new Map<string, string>();
    return {
      mockReadFile: vi.fn(),
      mockWriteFile: vi.fn().mockImplementation((path: string, content: string) => {
        writtenFiles.set(path, content);
        return Promise.resolve();
      }),
      mockListFiles: vi.fn(),
      mockFileExists: vi.fn(),
      mockCreateSymlink: vi.fn().mockImplementation((target: string, link: string) => {
        createdSymlinks.set(link, target);
        return Promise.resolve();
      }),
      writtenFiles,
      createdSymlinks,
    };
  });

vi.mock("@symbiosis-lab/moss-api", () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  listFiles: mockListFiles,
  fileExists: mockFileExists,
  createSymlink: mockCreateSymlink,
}));

import {
  createEleventyStructure,
  createEleventyConfig,
  cleanupRuntime,
  type ProjectInfo,
  type SiteConfig,
} from "../structure";
import { getEleventyBuildArgs } from "../eleventy-config";
import { createDefaultLayouts, createCollectionData } from "../templates";

describe("Eleventy Structure Translation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writtenFiles.clear();
    createdSymlinks.clear();
  });

  describe("createEleventyStructure", () => {
    it("symlinks homepage as index.md in src/", async () => {
      mockFileExists.mockResolvedValue(true);
      mockListFiles.mockResolvedValue(["index.md"]);

      const projectInfo: ProjectInfo = {
        content_folders: [],
        total_files: 1,
        homepage_file: "index.md",
      };

      await createEleventyStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/eleventy-generator/.runtime"
      );

      // Homepage is symlinked (not written)
      expect(mockCreateSymlink).toHaveBeenCalledWith(
        "index.md",
        expect.stringContaining("src/index.md")
      );
    });

    it("symlinks root markdown files to src/", async () => {
      mockFileExists.mockResolvedValue(true);
      mockListFiles.mockResolvedValue(["index.md", "about.md"]);

      const projectInfo: ProjectInfo = {
        content_folders: [],
        total_files: 2,
        homepage_file: "index.md",
      };

      await createEleventyStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/eleventy-generator/.runtime"
      );

      // Root files are symlinked
      expect(mockCreateSymlink).toHaveBeenCalledWith(
        "about.md",
        expect.stringContaining("src/about.md")
      );
    });

    it("symlinks collection files to src/folder/", async () => {
      mockFileExists.mockResolvedValue(true);
      mockListFiles.mockResolvedValue(["index.md", "posts/post-1.md"]);

      const projectInfo: ProjectInfo = {
        content_folders: ["posts"],
        total_files: 2,
        homepage_file: "index.md",
      };

      await createEleventyStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/eleventy-generator/.runtime"
      );

      // Collection files are symlinked
      expect(mockCreateSymlink).toHaveBeenCalledWith(
        "posts/post-1.md",
        expect.stringContaining("src/posts/post-1.md")
      );
    });

    it("handles missing homepage gracefully", async () => {
      mockFileExists.mockResolvedValue(false);
      mockListFiles.mockResolvedValue(["about.md"]);

      const projectInfo: ProjectInfo = {
        content_folders: [],
        total_files: 1,
        homepage_file: undefined,
      };

      await createEleventyStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/eleventy-generator/.runtime"
      );

      // about.md should be symlinked
      expect(mockCreateSymlink).toHaveBeenCalledWith(
        "about.md",
        expect.stringContaining("src/about.md")
      );
    });

    it("symlinks assets to src/assets/ directory", async () => {
      mockFileExists.mockResolvedValue(true);
      mockListFiles.mockResolvedValue(["index.md", "assets/style.css"]);

      const projectInfo: ProjectInfo = {
        content_folders: [],
        total_files: 2,
        homepage_file: "index.md",
      };

      await createEleventyStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/eleventy-generator/.runtime"
      );

      // Assets are symlinked
      expect(mockCreateSymlink).toHaveBeenCalledWith(
        "assets/style.css",
        expect.stringContaining("src/assets/style.css")
      );
    });

    it("handles Chinese folder names", async () => {
      mockFileExists.mockResolvedValue(true);
      mockListFiles.mockResolvedValue(["index.md", "文章/article.md"]);

      const projectInfo: ProjectInfo = {
        content_folders: ["文章"],
        total_files: 2,
        homepage_file: "index.md",
      };

      await createEleventyStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/eleventy-generator/.runtime"
      );

      // Chinese folder content is symlinked
      expect(mockCreateSymlink).toHaveBeenCalledWith(
        "文章/article.md",
        expect.stringContaining("文章/article.md")
      );
    });

    it("uses symlinks for all content files (no writeFile for content)", async () => {
      mockFileExists.mockResolvedValue(true);
      mockListFiles.mockResolvedValue([
        "index.md",
        "about.md",
        "posts/post1.md",
        "posts/post2.md",
        "assets/style.css",
      ]);

      const projectInfo: ProjectInfo = {
        content_folders: ["posts"],
        total_files: 5,
        homepage_file: "index.md",
      };

      await createEleventyStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/eleventy-generator/.runtime"
      );

      // All files should be symlinked
      expect(mockCreateSymlink).toHaveBeenCalledTimes(5); // index, about, post1, post2, style.css
      // writeFile should not be called for content
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  describe("createEleventyConfig", () => {
    it("creates eleventy.config.js with default values", async () => {
      const siteConfig: SiteConfig = {};

      await createEleventyConfig(
        siteConfig,
        "/project/.moss/plugins/eleventy-generator/.runtime",
        "/project"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("eleventy.config.js"))).toBe(true);
    });

    it("uses site_name and base_url from config", async () => {
      const siteConfig: SiteConfig = {
        site_name: "My Site",
        base_url: "/blog",
      };

      await createEleventyConfig(
        siteConfig,
        "/project/.moss/plugins/eleventy-generator/.runtime",
        "/project"
      );

      const configFile = Array.from(writtenFiles.entries())
        .find(([k]) => k.includes("eleventy.config.js"));
      expect(configFile).toBeDefined();
      expect(configFile![1]).toContain("My Site");
      expect(configFile![1]).toContain("/blog");
    });

    it("configures correct directory structure", async () => {
      const siteConfig: SiteConfig = {};

      await createEleventyConfig(
        siteConfig,
        "/project/.moss/plugins/eleventy-generator/.runtime",
        "/project"
      );

      const configFile = Array.from(writtenFiles.entries())
        .find(([k]) => k.includes("eleventy.config.js"));
      expect(configFile).toBeDefined();
      expect(configFile![1]).toContain('input: "src"');
      expect(configFile![1]).toContain('output: "_site"');
    });
  });

  describe("cleanupRuntime", () => {
    it("is a no-op function", async () => {
      // cleanupRuntime is a no-op but should not throw
      await expect(cleanupRuntime("/some/path")).resolves.toBeUndefined();
    });
  });

  describe("getEleventyBuildArgs", () => {
    it("returns correct build arguments", () => {
      const args = getEleventyBuildArgs("src", "_site");
      expect(args).toContain("@11ty/eleventy");
      expect(args).toContain("--input");
      expect(args).toContain("src");
      expect(args).toContain("--output");
      expect(args).toContain("_site");
    });
  });

  describe("createDefaultLayouts", () => {
    it("creates base layout file", async () => {
      await createDefaultLayouts(
        "/project/.moss/plugins/eleventy-generator/.runtime",
        "/project"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("_includes/layouts/base.njk"))).toBe(true);
    });

    it("creates post layout file", async () => {
      await createDefaultLayouts(
        "/project/.moss/plugins/eleventy-generator/.runtime",
        "/project"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("_includes/layouts/post.njk"))).toBe(true);
    });

    it("creates package.json for eleventy site", async () => {
      await createDefaultLayouts(
        "/project/.moss/plugins/eleventy-generator/.runtime",
        "/project"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("package.json"))).toBe(true);

      const pkgJson = Array.from(writtenFiles.entries())
        .find(([k]) => k.includes("package.json"));
      expect(pkgJson![1]).toContain("@11ty/eleventy");
    });

    it("handles path that does not start with basePath", async () => {
      await createDefaultLayouts(
        "/other-path/.runtime",
        "/project"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("base.njk"))).toBe(true);
    });
  });

  describe("createCollectionData", () => {
    it("creates collection data file with correct structure", async () => {
      await createCollectionData(
        "/project/.moss/plugins/eleventy-generator/.runtime",
        "/project",
        "posts"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("posts/posts.json"))).toBe(true);

      const dataFile = Array.from(writtenFiles.entries())
        .find(([k]) => k.includes("posts/posts.json"));
      expect(dataFile![1]).toContain('"layout": "post.njk"');
      expect(dataFile![1]).toContain('"tags": ["posts"]');
    });
  });

  describe("edge cases", () => {
    it("symlinks all asset files including binary", async () => {
      mockFileExists.mockResolvedValue(true);
      mockListFiles.mockResolvedValue(["index.md", "assets/binary.png"]);

      const projectInfo: ProjectInfo = {
        content_folders: [],
        total_files: 2,
        homepage_file: "index.md",
      };

      await createEleventyStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/eleventy-generator/.runtime"
      );

      // Binary assets are symlinked (not read/copied)
      expect(mockCreateSymlink).toHaveBeenCalledWith(
        "assets/binary.png",
        expect.stringContaining("src/assets/binary.png")
      );
    });

    it("handles runtime path that starts with /", async () => {
      mockFileExists.mockResolvedValue(true);
      mockListFiles.mockResolvedValue(["index.md"]);

      const projectInfo: ProjectInfo = {
        content_folders: [],
        total_files: 1,
        homepage_file: "index.md",
      };

      await createEleventyStructure(
        "/project",
        projectInfo,
        "/different/path/.runtime"
      );

      const links = Array.from(createdSymlinks.keys());
      expect(links.some(l => l.includes("/different/path/.runtime"))).toBe(true);
    });
  });
});
