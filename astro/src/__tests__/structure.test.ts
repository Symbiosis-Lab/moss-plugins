/**
 * Unit tests for Astro Structure Translation
 *
 * Tests that symlinks are used for content collections and assets,
 * while pages are written as transformed Astro components.
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
  createAstroStructure,
  createAstroConfig,
  type ProjectInfo,
  type SiteConfig,
} from "../structure";

describe("Astro Structure Translation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writtenFiles.clear();
    createdSymlinks.clear();
  });

  describe("createAstroStructure", () => {
    it("writes homepage as index.astro in src/pages (transformed)", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue("# Home");
      mockListFiles.mockResolvedValue(["index.md"]);

      const projectInfo: ProjectInfo = {
        content_folders: [],
        total_files: 1,
        homepage_file: "index.md",
      };

      await createAstroStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/astro/.runtime"
      );

      // Homepage is written (transformed to Astro component)
      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("src/pages/index.astro"))).toBe(true);
    });

    it("writes root markdown files as Astro pages (transformed)", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockImplementation((path: string) => {
        if (path === "index.md") return Promise.resolve("# Home");
        if (path === "about.md") return Promise.resolve("# About");
        return Promise.resolve("");
      });
      mockListFiles.mockResolvedValue(["index.md", "about.md"]);

      const projectInfo: ProjectInfo = {
        content_folders: [],
        total_files: 2,
        homepage_file: "index.md",
      };

      await createAstroStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/astro/.runtime"
      );

      // Root pages are written (transformed to Astro components)
      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("src/pages/about.astro"))).toBe(true);
    });

    it("symlinks collection files to src/content/", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue("# Home");
      mockListFiles.mockResolvedValue(["index.md", "posts/post-1.md"]);

      const projectInfo: ProjectInfo = {
        content_folders: ["posts"],
        total_files: 2,
        homepage_file: "index.md",
      };

      await createAstroStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/astro/.runtime"
      );

      // Collection files are symlinked (not written)
      expect(mockCreateSymlink).toHaveBeenCalledWith(
        "posts/post-1.md",
        expect.stringContaining("src/content/posts/post-1.md")
      );
    });

    it("handles missing homepage gracefully", async () => {
      mockFileExists.mockResolvedValue(false);
      mockListFiles.mockResolvedValue(["about.md"]);
      mockReadFile.mockResolvedValue("# About");

      const projectInfo: ProjectInfo = {
        content_folders: [],
        total_files: 1,
        homepage_file: undefined,
      };

      await createAstroStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/astro/.runtime"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("about.astro"))).toBe(true);
    });

    it("symlinks assets to public/ directory", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue("# Home");
      mockListFiles.mockResolvedValue(["index.md", "assets/style.css", "assets/logo.png"]);

      const projectInfo: ProjectInfo = {
        content_folders: [],
        total_files: 3,
        homepage_file: "index.md",
      };

      await createAstroStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/astro/.runtime"
      );

      // Assets are symlinked
      expect(mockCreateSymlink).toHaveBeenCalledWith(
        "assets/style.css",
        expect.stringContaining("public/assets/style.css")
      );
      expect(mockCreateSymlink).toHaveBeenCalledWith(
        "assets/logo.png",
        expect.stringContaining("public/assets/logo.png")
      );
    });

    it("symlinks Chinese folder names", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue("# 首页");
      mockListFiles.mockResolvedValue(["index.md", "文章/article.md"]);

      const projectInfo: ProjectInfo = {
        content_folders: ["文章"],
        total_files: 2,
        homepage_file: "index.md",
      };

      await createAstroStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/astro/.runtime"
      );

      // Chinese folder content is symlinked
      expect(mockCreateSymlink).toHaveBeenCalledWith(
        "文章/article.md",
        expect.stringContaining("文章/article.md")
      );
    });
  });

  describe("createAstroConfig", () => {
    it("creates astro.config.mjs with default values", async () => {
      const siteConfig: SiteConfig = {};

      await createAstroConfig(
        siteConfig,
        "/project/.moss/plugins/astro/.runtime",
        "/project"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("astro.config.mjs"))).toBe(true);
    });

    it("uses site_name and base_url from config", async () => {
      const siteConfig: SiteConfig = {
        site_name: "My Site",
        base_url: "/blog",
      };

      await createAstroConfig(
        siteConfig,
        "/project/.moss/plugins/astro/.runtime",
        "/project"
      );

      const configFile = Array.from(writtenFiles.entries())
        .find(([k]) => k.includes("astro.config.mjs"));
      expect(configFile).toBeDefined();
      expect(configFile![1]).toContain("My Site");
    });
  });
});
