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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("symlinks a root-level leaf page", async () => {
    const root = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({ source_path: "about.md", title: "About" }),
      ],
    });

    await translatePageTree(root, "src/content");

    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "about.md",
      "src/content/about.md"
    );
  });

  it("writes index.md for homepage (root folder)", async () => {
    const root = makeNode({
      source_path: "",
      title: "Home",
      is_folder: true,
      children: [],
    });

    await translatePageTree(root, "src/content");

    expect(mockWriteFile).toHaveBeenCalledWith(
      "src/content/index.md",
      expect.stringContaining("title: \"Home\"")
    );
  });

  it("writes index.md for a subfolder and processes children", async () => {
    const root = makeNode({
      source_path: "",
      title: "Home",
      is_folder: true,
      children: [
        makeNode({
          source_path: "blog",
          title: "Blog",
          is_folder: true,
          children: [
            makeNode({ source_path: "blog/first-post.md", title: "First Post" }),
          ],
        }),
      ],
    });

    await translatePageTree(root, "src/content");

    // Subfolder gets index.md
    expect(mockWriteFile).toHaveBeenCalledWith(
      "src/content/blog/index.md",
      expect.stringContaining("title: \"Blog\"")
    );
    // Child leaf gets symlinked
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "blog/first-post.md",
      "src/content/blog/first-post.md"
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
          is_folder: true,
          children: [
            makeNode({
              source_path: "docs/guide",
              title: "Guide",
              is_folder: true,
              children: [
                makeNode({
                  source_path: "docs/guide/intro.md",
                  title: "Intro",
                }),
              ],
            }),
          ],
        }),
      ],
    });

    await translatePageTree(root, "src/content");

    expect(mockWriteFile).toHaveBeenCalledWith(
      "src/content/docs/index.md",
      expect.stringContaining("title: \"Docs\"")
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      "src/content/docs/guide/index.md",
      expect.stringContaining("title: \"Guide\"")
    );
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "docs/guide/intro.md",
      "src/content/docs/guide/intro.md"
    );
  });

  it("skips draft nodes entirely", async () => {
    const root = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({ source_path: "visible.md", title: "Visible" }),
        makeNode({ source_path: "hidden.md", title: "Hidden", draft: true }),
        makeNode({
          source_path: "draft-folder",
          title: "Draft Folder",
          is_folder: true,
          draft: true,
          children: [
            makeNode({ source_path: "draft-folder/child.md", title: "Child" }),
          ],
        }),
      ],
    });

    await translatePageTree(root, "src/content");

    expect(mockCreateSymlink).toHaveBeenCalledTimes(1);
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "visible.md",
      "src/content/visible.md"
    );
    // No calls for draft nodes or their children
    expect(mockWriteFile).not.toHaveBeenCalledWith(
      "src/content/draft-folder/index.md",
      expect.anything()
    );
  });

  it("handles Chinese folder and file names", async () => {
    const root = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({
          source_path: "文章",
          title: "文章",
          is_folder: true,
          children: [
            makeNode({ source_path: "文章/你好世界.md", title: "你好世界" }),
          ],
        }),
      ],
    });

    await translatePageTree(root, "src/content");

    expect(mockWriteFile).toHaveBeenCalledWith(
      "src/content/文章/index.md",
      expect.stringContaining("title: \"文章\"")
    );
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "文章/你好世界.md",
      "src/content/文章/你好世界.md"
    );
  });

  it("maps nav_weight to weight in frontmatter", async () => {
    const root = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({
          source_path: "docs",
          title: "Docs",
          is_folder: true,
          nav_weight: 10,
          children: [],
        }),
      ],
    });

    await translatePageTree(root, "src/content");

    const writeCall = mockWriteFile.mock.calls.find(
      (c: string[]) => c[0] === "src/content/docs/index.md"
    );
    expect(writeCall).toBeDefined();
    expect(writeCall![1]).toContain("weight: 10");
  });
});
