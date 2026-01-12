/**
 * Unit tests for Jekyll Structure Translation
 *
 * Tests the structure translation logic using mocked moss-api functions.
 * Verifies that symlinks are used for efficiency.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the moss-api module with hoisted mocks
const { mockReadFile, mockWriteFile, mockListFiles, mockFileExists, mockCreateSymlink, createdSymlinks } =
  vi.hoisted(() => {
    const createdSymlinks = new Map<string, string>();
    return {
      mockReadFile: vi.fn(),
      mockWriteFile: vi.fn(),
      mockListFiles: vi.fn(),
      mockFileExists: vi.fn(),
      mockCreateSymlink: vi.fn().mockImplementation((target: string, link: string) => {
        createdSymlinks.set(link, target);
        return Promise.resolve();
      }),
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

// Import after mocking
import {
  createJekyllStructure,
  createJekyllConfig,
  cleanupRuntime,
  type ProjectInfo,
  type SiteConfig,
} from "../structure";

describe("createJekyllStructure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createdSymlinks.clear();
  });

  it("symlinks homepage as index.md", async () => {
    mockFileExists.mockResolvedValue(true);
    mockListFiles.mockResolvedValue(["index.md"]);

    const projectInfo: ProjectInfo = {
      content_folders: [],
      total_files: 1,
      homepage_file: "index.md",
    };

    await createJekyllStructure(
      "/test/project",
      projectInfo,
      "/test/project/.moss/plugins/jekyll/.runtime"
    );

    // Jekyll can symlink homepage (no rename needed)
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "index.md",
      expect.stringContaining("index.md")
    );
  });

  it("symlinks root markdown files (excluding homepage)", async () => {
    mockFileExists.mockResolvedValue(true);
    mockListFiles.mockResolvedValue(["index.md", "about.md", "contact.md"]);

    const projectInfo: ProjectInfo = {
      content_folders: [],
      total_files: 3,
      homepage_file: "index.md",
    };

    await createJekyllStructure(
      "/test/project",
      projectInfo,
      "/test/project/.moss/plugins/jekyll/.runtime"
    );

    // about.md and contact.md should be symlinked
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "about.md",
      expect.stringContaining("about.md")
    );
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "contact.md",
      expect.stringContaining("contact.md")
    );
  });

  it("symlinks posts to _posts directory", async () => {
    mockFileExists.mockResolvedValue(true);
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
      "/test/project",
      projectInfo,
      "/test/project/.moss/plugins/jekyll/.runtime"
    );

    // posts/article.md should be symlinked to _posts/article.md
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "posts/post-1.md",
      expect.stringContaining("_posts/post-1.md")
    );
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "posts/post-2.md",
      expect.stringContaining("_posts/post-2.md")
    );
  });

  it("symlinks other content folders without renaming", async () => {
    mockFileExists.mockResolvedValue(true);
    mockListFiles.mockResolvedValue([
      "index.md",
      "projects/project1.md",
    ]);

    const projectInfo: ProjectInfo = {
      content_folders: ["projects"],
      total_files: 2,
      homepage_file: "index.md",
    };

    await createJekyllStructure(
      "/test/project",
      projectInfo,
      "/test/project/.moss/plugins/jekyll/.runtime"
    );

    // projects should stay as-is
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "projects/project1.md",
      expect.stringContaining("projects/project1.md")
    );
  });

  it("symlinks asset files", async () => {
    mockFileExists.mockResolvedValue(true);
    mockListFiles.mockResolvedValue(["index.md", "assets/style.css", "assets/logo.png"]);

    const projectInfo: ProjectInfo = {
      content_folders: [],
      total_files: 1,
      homepage_file: "index.md",
    };

    await createJekyllStructure(
      "/test/project",
      projectInfo,
      "/test/project/.moss/plugins/jekyll/.runtime"
    );

    // Assets should be symlinked
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "assets/style.css",
      expect.stringContaining("assets/style.css")
    );
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "assets/logo.png",
      expect.stringContaining("assets/logo.png")
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

    await expect(
      createJekyllStructure(
        "/test/project",
        projectInfo,
        "/test/project/.moss/plugins/jekyll/.runtime"
      )
    ).resolves.not.toThrow();
  });

  it("handles multiple content folders", async () => {
    mockFileExists.mockResolvedValue(true);
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
      "/test/project",
      projectInfo,
      "/test/project/.moss/plugins/jekyll/.runtime"
    );

    // posts go to _posts, other collections to their own directories
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "posts/post-1.md",
      expect.stringContaining("_posts/post-1.md")
    );
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "projects/project-1.md",
      expect.stringContaining("projects/project-1.md")
    );
  });

  it("handles nested folder structures", async () => {
    mockFileExists.mockResolvedValue(true);
    mockListFiles.mockResolvedValue(["index.md", "docs/guide/intro.md"]);

    const projectInfo: ProjectInfo = {
      content_folders: ["docs"],
      total_files: 2,
      homepage_file: "index.md",
    };

    await createJekyllStructure(
      "/test/project",
      projectInfo,
      "/test/project/.moss/plugins/jekyll/.runtime"
    );

    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "docs/guide/intro.md",
      expect.stringContaining("docs/guide/intro.md")
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

    await createJekyllStructure(
      "/test/project",
      projectInfo,
      "/test/project/.moss/plugins/jekyll/.runtime"
    );

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
      "assets/image.png",
    ]);

    const projectInfo: ProjectInfo = {
      content_folders: ["posts"],
      total_files: 5,
      homepage_file: "index.md",
    };

    await createJekyllStructure(
      "/test/project",
      projectInfo,
      "/test/project/.moss/plugins/jekyll/.runtime"
    );

    // All files should be symlinked (Jekyll doesn't need to rename content files)
    expect(mockCreateSymlink).toHaveBeenCalledTimes(5); // index, about, post1, post2, image
    // writeFile should not be called for content
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

describe("createJekyllConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates _config.yml with default values", async () => {
    mockWriteFile.mockResolvedValue(undefined);

    const siteConfig: SiteConfig = {};

    await createJekyllConfig(
      siteConfig,
      "/test/project/.moss/plugins/jekyll/.runtime",
      "/test/project"
    );

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("_config.yml"),
      expect.stringContaining('title: "Site"')
    );
  });

  it("uses site_name from config", async () => {
    mockWriteFile.mockResolvedValue(undefined);

    const siteConfig: SiteConfig = { site_name: "My Blog" };

    await createJekyllConfig(
      siteConfig,
      "/test/project/.moss/plugins/jekyll/.runtime",
      "/test/project"
    );

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('title: "My Blog"')
    );
  });

  it("uses base_url from config", async () => {
    mockWriteFile.mockResolvedValue(undefined);

    const siteConfig: SiteConfig = { base_url: "/blog" };

    await createJekyllConfig(
      siteConfig,
      "/test/project/.moss/plugins/jekyll/.runtime",
      "/test/project"
    );

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('baseurl: "/blog"')
    );
  });

  it("includes required Jekyll settings", async () => {
    mockWriteFile.mockResolvedValue(undefined);

    const siteConfig: SiteConfig = {};

    await createJekyllConfig(
      siteConfig,
      "/test/project/.moss/plugins/jekyll/.runtime",
      "/test/project"
    );

    const configContent = mockWriteFile.mock.calls[0][1];

    expect(configContent).toContain("markdown: kramdown");
    expect(configContent).toContain("permalink:");
    expect(configContent).toContain("exclude:");
  });
});

describe("cleanupRuntime", () => {
  it("is a no-op (cleanup handled by moss core)", async () => {
    await expect(
      cleanupRuntime("/test/project/.moss/plugins/jekyll/.runtime")
    ).resolves.not.toThrow();
  });
});
