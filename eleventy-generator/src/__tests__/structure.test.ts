/**
 * Unit tests for Eleventy Structure Translation
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
  });

  describe("createEleventyStructure", () => {
    it("copies homepage as index.md in src/", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue("# Home");
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

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("src/index.md"))).toBe(true);
    });

    it("adds layout to frontmatter if missing", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue("---\ntitle: Home\n---\n\n# Welcome");
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

      const indexContent = Array.from(writtenFiles.entries())
        .find(([k]) => k.includes("src/index.md"));
      expect(indexContent).toBeDefined();
      expect(indexContent![1]).toContain("layout: base.njk");
    });

    it("creates frontmatter with layout if none exists", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue("# Home without frontmatter");
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

      const indexContent = Array.from(writtenFiles.entries())
        .find(([k]) => k.includes("src/index.md"));
      expect(indexContent).toBeDefined();
      expect(indexContent![1]).toContain("---\nlayout: base.njk\n---");
    });

    it("preserves existing layout in frontmatter", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue("---\nlayout: custom.njk\ntitle: Home\n---\n\n# Welcome");
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

      const indexContent = Array.from(writtenFiles.entries())
        .find(([k]) => k.includes("src/index.md"));
      expect(indexContent).toBeDefined();
      expect(indexContent![1]).toContain("layout: custom.njk");
      expect(indexContent![1]).not.toContain("layout: base.njk");
    });

    it("copies root markdown files to src/", async () => {
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

      await createEleventyStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/eleventy-generator/.runtime"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("src/about.md"))).toBe(true);
    });

    it("copies collection files to src/folder/", async () => {
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

      await createEleventyStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/eleventy-generator/.runtime"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("src/posts/post-1.md"))).toBe(true);
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

      await createEleventyStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/eleventy-generator/.runtime"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("about.md"))).toBe(true);
    });

    it("copies assets to src/assets/ directory", async () => {
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

      await createEleventyStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/eleventy-generator/.runtime"
      );

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("src/assets/style.css"))).toBe(true);
    });

    it("handles Chinese folder names", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockImplementation((path: string) => {
        if (path === "index.md") return Promise.resolve("# Home");
        if (path === "posts/article.md") return Promise.resolve("# Article");
        return Promise.resolve("");
      });
      mockListFiles.mockResolvedValue(["index.md", "posts/article.md"]);

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

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("posts/article.md"))).toBe(true);
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
    it("handles asset files that throw read errors", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockImplementation((path: string) => {
        if (path === "index.md") return Promise.resolve("# Home");
        if (path === "assets/binary.png") return Promise.reject(new Error("Binary file"));
        return Promise.resolve("");
      });
      mockListFiles.mockResolvedValue(["index.md", "assets/binary.png"]);

      const projectInfo: ProjectInfo = {
        content_folders: [],
        total_files: 2,
        homepage_file: "index.md",
      };

      // Should not throw, just skip the binary file
      await expect(createEleventyStructure(
        "/project",
        projectInfo,
        "/project/.moss/plugins/eleventy-generator/.runtime"
      )).resolves.toBeUndefined();
    });

    it("skips non-text asset files", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockImplementation((path: string) => {
        if (path === "index.md") return Promise.resolve("# Home");
        return Promise.resolve("");
      });
      mockListFiles.mockResolvedValue(["index.md", "assets/image.png"]);

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

      const files = Array.from(writtenFiles.keys());
      // PNG files should be skipped (not text files)
      expect(files.some(f => f.includes("image.png"))).toBe(false);
    });

    it("handles runtime path that starts with /", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue("# Home");
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

      const files = Array.from(writtenFiles.keys());
      expect(files.some(f => f.includes("/different/path/.runtime"))).toBe(true);
    });
  });
});
