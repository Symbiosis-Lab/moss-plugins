import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PageNode } from "@symbiosis-lab/moss-api";

const { mockWriteFile, mockCreateSymlink } = vi.hoisted(() => ({
  mockWriteFile: vi.fn(),
  mockCreateSymlink: vi.fn(),
}));

vi.mock("@symbiosis-lab/moss-api", () => ({
  writeFile: mockWriteFile,
  createSymlink: mockCreateSymlink,
}));

import { translatePageTree } from "../structure";

function makeNode(
  overrides: Partial<PageNode> & Pick<PageNode, "source_path" | "title">
): PageNode {
  return {
    url_path: "",
    slug: "",
    content_html: "",
    is_folder: false,
    children: [],
    nav: false,
    draft: false,
    unlisted: false,
    flatten: false,
    list_style: "list",
    also_in: [],
    frontmatter: {},
    ...overrides,
  };
}

describe("translatePageTree", () => {
  const contentDir = "runtime/src/content";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("symlinks a root leaf page", async () => {
    const root = makeNode({
      source_path: "",
      title: "Home",
      is_folder: true,
      children: [
        makeNode({ source_path: "about.md", title: "About", slug: "about" }),
      ],
    });

    await translatePageTree(root, contentDir);

    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "about.md",
      `${contentDir}/about.md`
    );
  });

  it("writes index.md for folder nodes with frontmatter", async () => {
    const root = makeNode({
      source_path: "",
      title: "Home",
      is_folder: true,
      children: [
        makeNode({
          source_path: "blog",
          title: "Blog",
          slug: "blog",
          is_folder: true,
          children: [
            makeNode({
              source_path: "blog/first.md",
              title: "First Post",
              slug: "first",
            }),
          ],
        }),
      ],
    });

    await translatePageTree(root, contentDir);

    // Folder should get index.md with frontmatter
    expect(mockWriteFile).toHaveBeenCalledWith(
      `${contentDir}/blog/index.md`,
      expect.stringContaining("title: \"Blog\"")
    );
    // Leaf should be symlinked
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "blog/first.md",
      `${contentDir}/blog/first.md`
    );
  });

  it("writes index.md for root folder (source_path='')", async () => {
    const root = makeNode({
      source_path: "",
      title: "My Site",
      is_folder: true,
      children: [],
    });

    await translatePageTree(root, contentDir);

    expect(mockWriteFile).toHaveBeenCalledWith(
      `${contentDir}/index.md`,
      expect.stringContaining("title: \"My Site\"")
    );
  });

  it("handles nested folders", async () => {
    const root = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({
          source_path: "docs",
          title: "Docs",
          slug: "docs",
          is_folder: true,
          children: [
            makeNode({
              source_path: "docs/api",
              title: "API",
              slug: "api",
              is_folder: true,
              children: [
                makeNode({
                  source_path: "docs/api/reference.md",
                  title: "Reference",
                  slug: "reference",
                }),
              ],
            }),
          ],
        }),
      ],
    });

    await translatePageTree(root, contentDir);

    expect(mockWriteFile).toHaveBeenCalledWith(
      `${contentDir}/docs/index.md`,
      expect.stringContaining("title: \"Docs\"")
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      `${contentDir}/docs/api/index.md`,
      expect.stringContaining("title: \"API\"")
    );
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "docs/api/reference.md",
      `${contentDir}/docs/api/reference.md`
    );
  });

  it("skips draft nodes entirely", async () => {
    const root = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({
          source_path: "secret.md",
          title: "Secret",
          slug: "secret",
          draft: true,
        }),
        makeNode({
          source_path: "public.md",
          title: "Public",
          slug: "public",
        }),
      ],
    });

    await translatePageTree(root, contentDir);

    expect(mockCreateSymlink).not.toHaveBeenCalledWith(
      "secret.md",
      expect.any(String)
    );
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "public.md",
      `${contentDir}/public.md`
    );
  });

  it("skips draft folder and all its children", async () => {
    const root = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({
          source_path: "drafts",
          title: "Drafts",
          slug: "drafts",
          is_folder: true,
          draft: true,
          children: [
            makeNode({
              source_path: "drafts/wip.md",
              title: "WIP",
              slug: "wip",
            }),
          ],
        }),
      ],
    });

    await translatePageTree(root, contentDir);

    expect(mockWriteFile).not.toHaveBeenCalledWith(
      `${contentDir}/drafts/index.md`,
      expect.any(String)
    );
    expect(mockCreateSymlink).not.toHaveBeenCalledWith(
      "drafts/wip.md",
      expect.any(String)
    );
  });

  it("handles Chinese titles", async () => {
    const root = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({
          source_path: "文章",
          title: "我的文章",
          slug: "文章",
          is_folder: true,
          children: [
            makeNode({
              source_path: "文章/你好.md",
              title: "你好世界",
              slug: "你好",
            }),
          ],
        }),
      ],
    });

    await translatePageTree(root, contentDir);

    expect(mockWriteFile).toHaveBeenCalledWith(
      `${contentDir}/文章/index.md`,
      expect.stringContaining("title: \"我的文章\"")
    );
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "文章/你好.md",
      `${contentDir}/文章/你好.md`
    );
  });

  it("maps nav_weight to weight in frontmatter", async () => {
    const root = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({
          source_path: "intro",
          title: "Introduction",
          slug: "intro",
          is_folder: true,
          nav_weight: 10,
          children: [],
        }),
      ],
    });

    await translatePageTree(root, contentDir);

    expect(mockWriteFile).toHaveBeenCalledWith(
      `${contentDir}/intro/index.md`,
      expect.stringContaining("weight: 10")
    );
  });

  it("includes date in frontmatter when present", async () => {
    const root = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({
          source_path: "news",
          title: "News",
          slug: "news",
          is_folder: true,
          date: "2024-01-15",
          children: [],
        }),
      ],
    });

    await translatePageTree(root, contentDir);

    expect(mockWriteFile).toHaveBeenCalledWith(
      `${contentDir}/news/index.md`,
      expect.stringContaining("date: \"2024-01-15\"")
    );
  });
});
