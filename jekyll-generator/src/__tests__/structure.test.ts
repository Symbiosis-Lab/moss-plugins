/**
 * Unit tests for Jekyll Structure Translation
 *
 * Tests the translation logic from moss project structure to Jekyll structure.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the moss-api module with hoisted mocks
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

// Import after mocking
import {
  createJekyllStructure,
  createJekyllConfig,
  type ProjectInfo,
  type SiteConfig,
} from "../structure";

describe("Jekyll Structure Translation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writtenFiles.clear();
  });

  describe("createJekyllStructure", () => {
    it("copies homepage as index.md", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue("# Home");
      mockListFiles.mockResolvedValue(["index.md"]);

      const projectInfo: ProjectInfo = {
        content_folders: [],
        total_files: 1,
        homepage_file: "index.md",
      };

      await createJekyllStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/jekyll-generator/.runtime"
      );

      expect(writtenFiles.has(".moss/plugins/jekyll-generator/.runtime/index.md")).toBe(true);
      expect(writtenFiles.get(".moss/plugins/jekyll-generator/.runtime/index.md")).toBe("# Home");
    });

    it("copies root markdown files (excluding homepage)", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockImplementation((path: string) => {
        if (path === "index.md") return Promise.resolve("# Home");
        if (path === "about.md") return Promise.resolve("# About");
        if (path === "contact.md") return Promise.resolve("# Contact");
        return Promise.resolve("");
      });
      mockListFiles.mockResolvedValue(["index.md", "about.md", "contact.md"]);

      const projectInfo: ProjectInfo = {
        content_folders: [],
        total_files: 3,
        homepage_file: "index.md",
      };

      await createJekyllStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/jekyll-generator/.runtime"
      );

      expect(writtenFiles.has(".moss/plugins/jekyll-generator/.runtime/about.md")).toBe(true);
      expect(writtenFiles.has(".moss/plugins/jekyll-generator/.runtime/contact.md")).toBe(true);
    });

    it("does not duplicate homepage in content folder", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue("# Home");
      mockListFiles.mockResolvedValue(["index.md", "about.md"]);

      const projectInfo: ProjectInfo = {
        content_folders: [],
        total_files: 2,
        homepage_file: "index.md",
      };

      await createJekyllStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/jekyll-generator/.runtime"
      );

      // Homepage should only appear once at root
      const homepageWrites = Array.from(writtenFiles.keys()).filter(
        (k) => k.endsWith("/index.md")
      );
      expect(homepageWrites).toHaveLength(1);
    });

    it("copies collection files to _posts directory for posts", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockImplementation((path: string) => {
        if (path === "index.md") return Promise.resolve("# Home");
        if (path === "posts/post-1.md") return Promise.resolve("# Post 1");
        if (path === "posts/post-2.md") return Promise.resolve("# Post 2");
        return Promise.resolve("");
      });
      mockListFiles.mockResolvedValue([
        "index.md",
        "posts/post-1.md",
        "posts/post-2.md",
      ]);

      const projectInfo: ProjectInfo = {
        content_folders: ["posts"],
        total_files: 3,
        homepage_file: "index.md",
      };

      await createJekyllStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/jekyll-generator/.runtime"
      );

      // Posts should be in _posts directory (Jekyll convention)
      expect(writtenFiles.has(".moss/plugins/jekyll-generator/.runtime/_posts/post-1.md")).toBe(true);
      expect(writtenFiles.has(".moss/plugins/jekyll-generator/.runtime/_posts/post-2.md")).toBe(true);
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

      await createJekyllStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/jekyll-generator/.runtime"
      );

      // Should not throw
      expect(writtenFiles.has(".moss/plugins/jekyll-generator/.runtime/about.md")).toBe(true);
    });

    it("copies text assets to assets/ directory", async () => {
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

      await createJekyllStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/jekyll-generator/.runtime"
      );

      expect(writtenFiles.has(".moss/plugins/jekyll-generator/.runtime/assets/style.css")).toBe(true);
    });

    it("handles multiple content folders", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockImplementation((path: string) => {
        if (path === "index.md") return Promise.resolve("# Home");
        if (path === "posts/post-1.md") return Promise.resolve("# Post");
        if (path === "projects/project-1.md") return Promise.resolve("# Project");
        return Promise.resolve("");
      });
      mockListFiles.mockResolvedValue([
        "index.md",
        "posts/post-1.md",
        "projects/project-1.md",
      ]);

      const projectInfo: ProjectInfo = {
        content_folders: ["posts", "projects"],
        total_files: 3,
        homepage_file: "index.md",
      };

      await createJekyllStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/jekyll-generator/.runtime"
      );

      // posts go to _posts, other collections to their own directories
      expect(writtenFiles.has(".moss/plugins/jekyll-generator/.runtime/_posts/post-1.md")).toBe(true);
      expect(writtenFiles.has(".moss/plugins/jekyll-generator/.runtime/projects/project-1.md")).toBe(true);
    });

    it("handles nested folder structures", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockImplementation((path: string) => {
        if (path === "index.md") return Promise.resolve("# Home");
        if (path === "docs/guide/intro.md") return Promise.resolve("# Intro");
        return Promise.resolve("");
      });
      mockListFiles.mockResolvedValue(["index.md", "docs/guide/intro.md"]);

      const projectInfo: ProjectInfo = {
        content_folders: ["docs"],
        total_files: 2,
        homepage_file: "index.md",
      };

      await createJekyllStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/jekyll-generator/.runtime"
      );

      expect(writtenFiles.has(".moss/plugins/jekyll-generator/.runtime/docs/guide/intro.md")).toBe(true);
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

      await createJekyllStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/jekyll-generator/.runtime"
      );

      expect(writtenFiles.has(".moss/plugins/jekyll-generator/.runtime/文章/article.md")).toBe(true);
    });
  });

  describe("createJekyllConfig", () => {
    it("creates _config.yml with default values", async () => {
      const siteConfig: SiteConfig = {};

      await createJekyllConfig(
        siteConfig,
        "/project/.moss/plugins/jekyll-generator/.runtime",
        "/project"
      );

      expect(writtenFiles.has(".moss/plugins/jekyll-generator/.runtime/_config.yml")).toBe(true);
      const config = writtenFiles.get(".moss/plugins/jekyll-generator/.runtime/_config.yml");
      expect(config).toContain("title:");
      expect(config).toContain("baseurl:");
    });

    it("uses site_name and base_url from config", async () => {
      const siteConfig: SiteConfig = {
        site_name: "My Site",
        base_url: "/blog",
      };

      await createJekyllConfig(
        siteConfig,
        "/project/.moss/plugins/jekyll-generator/.runtime",
        "/project"
      );

      const config = writtenFiles.get(".moss/plugins/jekyll-generator/.runtime/_config.yml");
      expect(config).toContain('title: "My Site"');
      expect(config).toContain('baseurl: "/blog"');
    });

    it("includes required Jekyll settings", async () => {
      const siteConfig: SiteConfig = {};

      await createJekyllConfig(
        siteConfig,
        "/project/.moss/plugins/jekyll-generator/.runtime",
        "/project"
      );

      const config = writtenFiles.get(".moss/plugins/jekyll-generator/.runtime/_config.yml");
      // Jekyll requires certain settings
      expect(config).toContain("markdown:");
      expect(config).toContain("kramdown");
    });
  });
});
