/**
 * Unit tests for Hugo Structure Translation
 *
 * Tests the structure translation logic using mocked moss-api functions.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the moss-api module with hoisted mocks
const { mockReadFile, mockWriteFile, mockListFiles, mockFileExists } =
  vi.hoisted(() => ({
    mockReadFile: vi.fn(),
    mockWriteFile: vi.fn(),
    mockListFiles: vi.fn(),
    mockFileExists: vi.fn(),
  }));

vi.mock("@symbiosis-lab/moss-api", () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  listFiles: mockListFiles,
  fileExists: mockFileExists,
}));

// Import after mocking
import {
  createHugoStructure,
  createHugoConfig,
  cleanupRuntime,
  type ProjectInfo,
  type SiteConfig,
} from "../structure";

describe("createHugoStructure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("copies homepage as _index.md", async () => {
    // Setup mocks - new API only takes relativePath
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue("# Home");
    mockListFiles.mockResolvedValue(["index.md"]);
    mockWriteFile.mockResolvedValue(undefined);

    const projectInfo: ProjectInfo = {
      content_folders: [],
      total_files: 1,
      homepage_file: "index.md",
    };

    await createHugoStructure(
      "/test/project",
      projectInfo,
      "/test/project/.moss/plugins/hugo-generator/.runtime"
    );

    // Verify homepage was written as _index.md (new API: relativePath, content)
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("content/_index.md"),
      "# Home"
    );
  });

  it("copies root markdown files (excluding homepage)", async () => {
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockImplementation(async (file: string) => {
      if (file === "index.md") return "# Home";
      if (file === "about.md") return "# About";
      return "";
    });
    mockListFiles.mockResolvedValue(["index.md", "about.md"]);
    mockWriteFile.mockResolvedValue(undefined);

    const projectInfo: ProjectInfo = {
      content_folders: [],
      total_files: 2,
      homepage_file: "index.md",
    };

    await createHugoStructure(
      "/test/project",
      projectInfo,
      "/test/project/.moss/plugins/hugo-generator/.runtime"
    );

    // Verify about.md was copied (new API: relativePath, content)
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("content/about.md"),
      "# About"
    );
  });

  it("does not duplicate homepage in root markdown files", async () => {
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue("# Home");
    mockListFiles.mockResolvedValue(["index.md"]);
    mockWriteFile.mockResolvedValue(undefined);

    const projectInfo: ProjectInfo = {
      content_folders: [],
      total_files: 1,
      homepage_file: "index.md",
    };

    await createHugoStructure(
      "/test/project",
      projectInfo,
      "/test/project/.moss/plugins/hugo-generator/.runtime"
    );

    // Verify only _index.md was written, not index.md (new API: args[0] is path)
    const writeFileCalls = mockWriteFile.mock.calls;
    const contentWrites = writeFileCalls.filter((call: string[]) =>
      call[0].includes("content/")
    );
    expect(contentWrites).toHaveLength(1);
    expect(contentWrites[0][0]).toContain("_index.md");
  });

  it("copies content folder files with index.md → _index.md renaming", async () => {
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockImplementation(async (file: string) => {
      if (file === "index.md") return "# Home";
      if (file === "posts/index.md") return "# Posts";
      if (file === "posts/article.md") return "# Article";
      return "";
    });
    mockListFiles.mockResolvedValue([
      "index.md",
      "posts/index.md",
      "posts/article.md",
    ]);
    mockWriteFile.mockResolvedValue(undefined);

    const projectInfo: ProjectInfo = {
      content_folders: ["posts"],
      total_files: 3,
      homepage_file: "index.md",
    };

    await createHugoStructure(
      "/test/project",
      projectInfo,
      "/test/project/.moss/plugins/hugo-generator/.runtime"
    );

    // Verify posts/index.md was renamed to _index.md
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("content/posts/_index.md"),
      "# Posts"
    );

    // Verify posts/article.md was copied as-is
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("content/posts/article.md"),
      "# Article"
    );
  });

  it("handles missing homepage gracefully", async () => {
    mockFileExists.mockResolvedValue(false);
    mockListFiles.mockResolvedValue(["about.md"]);
    mockReadFile.mockResolvedValue("# About");
    mockWriteFile.mockResolvedValue(undefined);

    const projectInfo: ProjectInfo = {
      content_folders: [],
      total_files: 1,
      homepage_file: undefined,
    };

    // Should not throw
    await expect(
      createHugoStructure(
        "/test/project",
        projectInfo,
        "/test/project/.moss/plugins/hugo-generator/.runtime"
      )
    ).resolves.not.toThrow();
  });

  it("copies text assets to static folder", async () => {
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockImplementation(async (file: string) => {
      if (file === "index.md") return "# Home";
      if (file === "assets/style.css") return "body { color: black; }";
      return "";
    });
    mockListFiles.mockResolvedValue(["index.md", "assets/style.css"]);
    mockWriteFile.mockResolvedValue(undefined);

    const projectInfo: ProjectInfo = {
      content_folders: [],
      total_files: 1,
      homepage_file: "index.md",
    };

    await createHugoStructure(
      "/test/project",
      projectInfo,
      "/test/project/.moss/plugins/hugo-generator/.runtime"
    );

    // Verify CSS file was copied to static
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("static/assets/style.css"),
      "body { color: black; }"
    );
  });

  it("handles multiple content folders", async () => {
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockImplementation(async (file: string) => {
      if (file === "index.md") return "# Home";
      if (file === "posts/post.md") return "# Post";
      if (file === "projects/project.md") return "# Project";
      return "";
    });
    mockListFiles.mockResolvedValue([
      "index.md",
      "posts/post.md",
      "projects/project.md",
    ]);
    mockWriteFile.mockResolvedValue(undefined);

    const projectInfo: ProjectInfo = {
      content_folders: ["posts", "projects"],
      total_files: 3,
      homepage_file: "index.md",
    };

    await createHugoStructure(
      "/test/project",
      projectInfo,
      "/test/project/.moss/plugins/hugo-generator/.runtime"
    );

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("content/posts/post.md"),
      "# Post"
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("content/projects/project.md"),
      "# Project"
    );
  });

  it("handles nested folder structure", async () => {
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockImplementation(async (file: string) => {
      if (file === "index.md") return "# Home";
      if (file === "docs/guide/intro.md") return "# Intro";
      if (file === "docs/guide/index.md") return "# Guide";
      return "";
    });
    mockListFiles.mockResolvedValue([
      "index.md",
      "docs/guide/intro.md",
      "docs/guide/index.md",
    ]);
    mockWriteFile.mockResolvedValue(undefined);

    const projectInfo: ProjectInfo = {
      content_folders: ["docs"],
      total_files: 3,
      homepage_file: "index.md",
    };

    await createHugoStructure(
      "/test/project",
      projectInfo,
      "/test/project/.moss/plugins/hugo-generator/.runtime"
    );

    // Verify nested index.md is renamed to _index.md
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("content/docs/guide/_index.md"),
      "# Guide"
    );

    // Verify other files are copied as-is
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("content/docs/guide/intro.md"),
      "# Intro"
    );
  });

  it("handles Chinese folder names", async () => {
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockImplementation(async (file: string) => {
      if (file === "index.md") return "# Home";
      if (file === "文章/文章1.md") return "# 文章1";
      return "";
    });
    mockListFiles.mockResolvedValue(["index.md", "文章/文章1.md"]);
    mockWriteFile.mockResolvedValue(undefined);

    const projectInfo: ProjectInfo = {
      content_folders: ["文章"],
      total_files: 2,
      homepage_file: "index.md",
    };

    await createHugoStructure(
      "/test/project",
      projectInfo,
      "/test/project/.moss/plugins/hugo-generator/.runtime"
    );

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("content/文章/文章1.md"),
      "# 文章1"
    );
  });
});

describe("createHugoConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates hugo.toml with default values", async () => {
    mockWriteFile.mockResolvedValue(undefined);

    const siteConfig: SiteConfig = {};

    await createHugoConfig(
      siteConfig,
      "/test/project/.moss/plugins/hugo-generator/.runtime",
      "/test/project"
    );

    // New API: writeFile(relativePath, content)
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("hugo.toml"),
      expect.stringContaining('baseURL = "/"')
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("hugo.toml"),
      expect.stringContaining('title = "Site"')
    );
  });

  it("uses site_name from config", async () => {
    mockWriteFile.mockResolvedValue(undefined);

    const siteConfig: SiteConfig = { site_name: "My Blog" };

    await createHugoConfig(
      siteConfig,
      "/test/project/.moss/plugins/hugo-generator/.runtime",
      "/test/project"
    );

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('title = "My Blog"')
    );
  });

  it("uses base_url from config", async () => {
    mockWriteFile.mockResolvedValue(undefined);

    const siteConfig: SiteConfig = { base_url: "https://example.com/" };

    await createHugoConfig(
      siteConfig,
      "/test/project/.moss/plugins/hugo-generator/.runtime",
      "/test/project"
    );

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('baseURL = "https://example.com/"')
    );
  });

  it("includes required Hugo settings", async () => {
    mockWriteFile.mockResolvedValue(undefined);

    const siteConfig: SiteConfig = {};

    await createHugoConfig(
      siteConfig,
      "/test/project/.moss/plugins/hugo-generator/.runtime",
      "/test/project"
    );

    // New API: args[1] is content (not args[2])
    const configContent = mockWriteFile.mock.calls[0][1];

    // Check for permalink configuration
    expect(configContent).toContain("[permalinks]");
    // Check for disabled features
    expect(configContent).toContain("disableKinds");
    // Check for markdown settings
    expect(configContent).toContain("[markup.goldmark]");
    expect(configContent).toContain("unsafe = true");
  });
});

describe("cleanupRuntime", () => {
  it("is a no-op (cleanup handled by moss core)", async () => {
    // cleanupRuntime should not throw
    await expect(
      cleanupRuntime("/test/project/.moss/plugins/hugo-generator/.runtime")
    ).resolves.not.toThrow();
  });
});
