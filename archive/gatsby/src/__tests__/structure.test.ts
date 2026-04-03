/**
 * Unit tests for Gatsby Structure Translation
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
      mockCreateSymlink: vi.fn().mockImplementation((source: string, dest: string) => {
        createdSymlinks.set(dest, source);
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
  createGatsbyStructure,
  createGatsbyConfig,
  type ProjectInfo,
  type SiteConfig,
} from "../structure";

describe("Gatsby Structure Translation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writtenFiles.clear();
    createdSymlinks.clear();
  });

  describe("createGatsbyStructure", () => {
    it("copies homepage as index.js in src/pages", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue("# Home");
      mockListFiles.mockResolvedValue(["index.md"]);

      const projectInfo: ProjectInfo = {
        content_folders: [],
        total_files: 1,
        homepage_file: "index.md",
      };

      await createGatsbyStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/gatsby-generator/.runtime"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("src/pages/index.js"))).toBe(true);
    });

    it("copies root markdown files as Gatsby pages", async () => {
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

      await createGatsbyStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/gatsby-generator/.runtime"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("src/pages/about.js"))).toBe(true);
    });

    it("symlinks collection files to src/content/", async () => {
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

      await createGatsbyStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/gatsby-generator/.runtime"
      );

      const symlinks = Array.from(createdSymlinks.keys());
      expect(symlinks.some(f => f.includes("src/content/posts/post-1.md"))).toBe(true);
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

      await createGatsbyStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/gatsby-generator/.runtime"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("about.js"))).toBe(true);
    });

    it("symlinks assets to static/ directory", async () => {
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

      await createGatsbyStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/gatsby-generator/.runtime"
      );

      const symlinks = Array.from(createdSymlinks.keys());
      expect(symlinks.some(f => f.includes("static/assets/style.css"))).toBe(true);
    });

    it("handles folder names with symlinks", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockImplementation((path: string) => {
        if (path === "index.md") return Promise.resolve("# Home");
        if (path === "articles/article.md") return Promise.resolve("# Article");
        return Promise.resolve("");
      });
      mockListFiles.mockResolvedValue(["index.md", "articles/article.md"]);

      const projectInfo: ProjectInfo = {
        content_folders: ["articles"],
        total_files: 2,
        homepage_file: "index.md",
      };

      await createGatsbyStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/gatsby-generator/.runtime"
      );

      const symlinks = Array.from(createdSymlinks.keys());
      expect(symlinks.some(f => f.includes("articles/article.md"))).toBe(true);
    });

    it("generates React components with correct structure", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue("---\ntitle: Test Page\n---\n\n# Test Content");
      mockListFiles.mockResolvedValue(["index.md"]);

      const projectInfo: ProjectInfo = {
        content_folders: [],
        total_files: 1,
        homepage_file: "index.md",
      };

      await createGatsbyStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/gatsby-generator/.runtime"
      );

      const indexContent = Array.from(writtenFiles.entries())
        .find(([k]) => k.includes("src/pages/index.js"));

      expect(indexContent).toBeDefined();
      expect(indexContent![1]).toContain('import * as React from "react"');
      expect(indexContent![1]).toContain('import Layout from "../components/Layout"');
      expect(indexContent![1]).toContain('export default Page');
    });
  });

  describe("createGatsbyConfig", () => {
    it("creates gatsby-config.js with default values", async () => {
      const siteConfig: SiteConfig = {};

      await createGatsbyConfig(
        siteConfig,
        "/project/.moss/plugins/gatsby-generator/.runtime",
        "/project"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("gatsby-config.js"))).toBe(true);
    });

    it("uses site_name and base_url from config", async () => {
      const siteConfig: SiteConfig = {
        site_name: "My Site",
        base_url: "/blog",
      };

      await createGatsbyConfig(
        siteConfig,
        "/project/.moss/plugins/gatsby-generator/.runtime",
        "/project"
      );

      const configFile = Array.from(writtenFiles.entries())
        .find(([k]) => k.includes("gatsby-config.js"));
      expect(configFile).toBeDefined();
      expect(configFile![1]).toContain("My Site");
      expect(configFile![1]).toContain("/blog");
    });

    it("includes gatsby-transformer-remark plugin", async () => {
      const siteConfig: SiteConfig = {};

      await createGatsbyConfig(
        siteConfig,
        "/project/.moss/plugins/gatsby-generator/.runtime",
        "/project"
      );

      const configFile = Array.from(writtenFiles.entries())
        .find(([k]) => k.includes("gatsby-config.js"));
      expect(configFile).toBeDefined();
      expect(configFile![1]).toContain("gatsby-transformer-remark");
    });

    it("includes gatsby-source-filesystem plugin for content", async () => {
      const siteConfig: SiteConfig = {};

      await createGatsbyConfig(
        siteConfig,
        "/project/.moss/plugins/gatsby-generator/.runtime",
        "/project"
      );

      const configFile = Array.from(writtenFiles.entries())
        .find(([k]) => k.includes("gatsby-config.js"));
      expect(configFile).toBeDefined();
      expect(configFile![1]).toContain("gatsby-source-filesystem");
      expect(configFile![1]).toContain("src/content");
    });
  });
});
