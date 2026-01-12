/**
 * Unit tests for Hugo Structure Translation
 *
 * Tests the structure translation logic using mocked moss-api functions.
 * Verifies that symlinks are used for efficiency, with copies only when renaming is required.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the moss-api module with hoisted mocks
const { mockReadFile, mockWriteFile, mockListFiles, mockFileExists, mockCreateSymlink } =
  vi.hoisted(() => ({
    mockReadFile: vi.fn(),
    mockWriteFile: vi.fn(),
    mockListFiles: vi.fn(),
    mockFileExists: vi.fn(),
    mockCreateSymlink: vi.fn(),
  }));

vi.mock("@symbiosis-lab/moss-api", () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  listFiles: mockListFiles,
  fileExists: mockFileExists,
  createSymlink: mockCreateSymlink,
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
    mockCreateSymlink.mockResolvedValue(undefined);
  });

  it("copies homepage as _index.md (rename required)", async () => {
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
      "/test/project/.moss/plugins/hugo/.runtime"
    );

    // Homepage must be COPIED (not symlinked) because it's renamed from index.md to _index.md
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("content/_index.md"),
      "# Home"
    );
  });

  it("uses symlink for root markdown files (excluding homepage)", async () => {
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockImplementation(async (file: string) => {
      if (file === "index.md") return "# Home";
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
      "/test/project/.moss/plugins/hugo/.runtime"
    );

    // about.md should be SYMLINKED (not copied)
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "about.md",
      expect.stringContaining("content/about.md")
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
      "/test/project/.moss/plugins/hugo/.runtime"
    );

    // Verify only _index.md was written
    const writeFileCalls = mockWriteFile.mock.calls;
    const contentWrites = writeFileCalls.filter((call: string[]) =>
      call[0].includes("content/")
    );
    expect(contentWrites).toHaveLength(1);
    expect(contentWrites[0][0]).toContain("_index.md");

    // Verify no symlink was created for homepage
    expect(mockCreateSymlink).not.toHaveBeenCalledWith(
      "index.md",
      expect.anything()
    );
  });

  it("copies index.md → _index.md but symlinks other content files", async () => {
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockImplementation(async (file: string) => {
      if (file === "index.md") return "# Home";
      if (file === "posts/index.md") return "# Posts";
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
      "/test/project/.moss/plugins/hugo/.runtime"
    );

    // posts/index.md must be COPIED because it's renamed to _index.md
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("content/posts/_index.md"),
      "# Posts"
    );

    // posts/article.md should be SYMLINKED
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "posts/article.md",
      expect.stringContaining("content/posts/article.md")
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
        "/test/project/.moss/plugins/hugo/.runtime"
      )
    ).resolves.not.toThrow();
  });

  it("uses symlinks for asset files", async () => {
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue("# Home");
    mockListFiles.mockResolvedValue(["index.md", "assets/style.css", "assets/logo.png"]);
    mockWriteFile.mockResolvedValue(undefined);

    const projectInfo: ProjectInfo = {
      content_folders: [],
      total_files: 1,
      homepage_file: "index.md",
    };

    await createHugoStructure(
      "/test/project",
      projectInfo,
      "/test/project/.moss/plugins/hugo/.runtime"
    );

    // Assets should be SYMLINKED (supports binary files correctly)
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "assets/style.css",
      expect.stringContaining("static/assets/style.css")
    );
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "assets/logo.png",
      expect.stringContaining("static/assets/logo.png")
    );
  });

  it("handles multiple content folders with symlinks", async () => {
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue("# Home");
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
      "/test/project/.moss/plugins/hugo/.runtime"
    );

    // Non-index files should be SYMLINKED
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "posts/post.md",
      expect.stringContaining("content/posts/post.md")
    );
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "projects/project.md",
      expect.stringContaining("content/projects/project.md")
    );
  });

  it("handles nested folder structure with symlinks", async () => {
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockImplementation(async (file: string) => {
      if (file === "index.md") return "# Home";
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
      "/test/project/.moss/plugins/hugo/.runtime"
    );

    // Nested index.md must be COPIED (renamed to _index.md)
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("content/docs/guide/_index.md"),
      "# Guide"
    );

    // Other files should be SYMLINKED
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "docs/guide/intro.md",
      expect.stringContaining("content/docs/guide/intro.md")
    );
  });

  it("handles Chinese folder names with symlinks", async () => {
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue("# Home");
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
      "/test/project/.moss/plugins/hugo/.runtime"
    );

    // Chinese filename should be SYMLINKED
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "文章/文章1.md",
      expect.stringContaining("content/文章/文章1.md")
    );
  });

  it("verifies symlinks are used for efficiency, not copies", async () => {
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue("# Home");
    mockListFiles.mockResolvedValue([
      "index.md",
      "about.md",
      "contact.md",
      "posts/post1.md",
      "posts/post2.md",
      "assets/image.png",
    ]);
    mockWriteFile.mockResolvedValue(undefined);

    const projectInfo: ProjectInfo = {
      content_folders: ["posts"],
      total_files: 6,
      homepage_file: "index.md",
    };

    await createHugoStructure(
      "/test/project",
      projectInfo,
      "/test/project/.moss/plugins/hugo/.runtime"
    );

    // Only homepage should be copied (rename required)
    const writeCalls = mockWriteFile.mock.calls.filter((call: string[]) =>
      call[0].includes("content/")
    );
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0][0]).toContain("_index.md");

    // All other files should be symlinked
    expect(mockCreateSymlink).toHaveBeenCalledTimes(5); // about, contact, post1, post2, image
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
      "/test/project/.moss/plugins/hugo/.runtime",
      "/test/project"
    );

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
      "/test/project/.moss/plugins/hugo/.runtime",
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
      "/test/project/.moss/plugins/hugo/.runtime",
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
      "/test/project/.moss/plugins/hugo/.runtime",
      "/test/project"
    );

    const configContent = mockWriteFile.mock.calls[0][1];

    expect(configContent).toContain("[permalinks]");
    expect(configContent).toContain("disableKinds");
    expect(configContent).toContain("[markup.goldmark]");
    expect(configContent).toContain("unsafe = true");
  });
});

describe("cleanupRuntime", () => {
  it("is a no-op (cleanup handled by moss core)", async () => {
    await expect(
      cleanupRuntime("/test/project/.moss/plugins/hugo/.runtime")
    ).resolves.not.toThrow();
  });
});
