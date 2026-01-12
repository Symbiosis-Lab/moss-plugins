/**
 * Unit tests for Astro Structure Translation
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockReadFile, mockWriteFile, mockListFiles, mockFileExists, writtenFiles } =
  vi.hoisted(() => {
    const writtenFiles = new Map<string, string>();
    return {
      mockReadFile: vi.fn(),
      mockWriteFile: vi.fn().mockImplementation((path: string, content: string) => {
        writtenFiles.set(path, content);
        return Promise.resolve();
      }),
      mockListFiles: vi.fn(),
      mockFileExists: vi.fn(),
      writtenFiles,
    };
  });

vi.mock("@symbiosis-lab/moss-api", () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  listFiles: mockListFiles,
  fileExists: mockFileExists,
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
  });

  describe("createAstroStructure", () => {
    it("copies homepage as index.astro in src/pages", async () => {
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
        "/project/.moss/plugins/astro-generator/.runtime"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("src/pages/index.astro"))).toBe(true);
    });

    it("copies root markdown files as Astro pages", async () => {
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
        "/project/.moss/plugins/astro-generator/.runtime"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("src/pages/about.astro"))).toBe(true);
    });

    it("copies collection files to src/content/", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockImplementation((path: string) => {
        if (path === "index.md") return Promise.resolve("# Home");
        if (path === "posts/post-1.md") return Promise.resolve("# Post 1");
        return Promise.resolve("");
      });
      mockListFiles.mockResolvedValue(["index.md", "posts/post-1.md"]);

      const projectInfo: ProjectInfo = {
        content_folders: ["posts"],
        total_files: 2,
        homepage_file: "index.md",
      };

      await createAstroStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/astro-generator/.runtime"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("src/content/posts/post-1.md"))).toBe(true);
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
        "/project/.moss/plugins/astro-generator/.runtime"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("about.astro"))).toBe(true);
    });

    it("copies assets to public/ directory", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockImplementation((path: string) => {
        if (path === "index.md") return Promise.resolve("# Home");
        if (path === "assets/style.css") return Promise.resolve("body {}");
        return Promise.resolve("");
      });
      mockListFiles.mockResolvedValue(["index.md", "assets/style.css"]);

      const projectInfo: ProjectInfo = {
        content_folders: [],
        total_files: 2,
        homepage_file: "index.md",
      };

      await createAstroStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/astro-generator/.runtime"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("public/assets/style.css"))).toBe(true);
    });

    it("handles Chinese folder names", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockImplementation((path: string) => {
        if (path === "index.md") return Promise.resolve("# 首页");
        if (path === "文章/article.md") return Promise.resolve("# 文章");
        return Promise.resolve("");
      });
      mockListFiles.mockResolvedValue(["index.md", "文章/article.md"]);

      const projectInfo: ProjectInfo = {
        content_folders: ["文章"],
        total_files: 2,
        homepage_file: "index.md",
      };

      await createAstroStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/astro-generator/.runtime"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("文章/article.md"))).toBe(true);
    });
  });

  describe("createAstroConfig", () => {
    it("creates astro.config.mjs with default values", async () => {
      const siteConfig: SiteConfig = {};

      await createAstroConfig(
        siteConfig,
        "/project/.moss/plugins/astro-generator/.runtime",
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
        "/project/.moss/plugins/astro-generator/.runtime",
        "/project"
      );

      const configFile = Array.from(writtenFiles.entries())
        .find(([k]) => k.includes("astro.config.mjs"));
      expect(configFile).toBeDefined();
      expect(configFile![1]).toContain("My Site");
    });
  });
});
