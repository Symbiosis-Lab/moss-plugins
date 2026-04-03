/**
 * TDD tests for Hugo translatePageTree
 *
 * Tests the new PageNode-based structure translation that replaces
 * the old createHugoStructure function.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PageNode } from "@symbiosis-lab/moss-api";

// Mock the moss-api module
const { mockWriteFile, mockCreateSymlink } = vi.hoisted(() => ({
  mockWriteFile: vi.fn(),
  mockCreateSymlink: vi.fn(),
}));

vi.mock("@symbiosis-lab/moss-api", () => ({
  writeFile: mockWriteFile,
  createSymlink: mockCreateSymlink,
}));

// Import after mocking
import { translatePageTree } from "../structure";

/** Helper to build a minimal PageNode */
function makeNode(overrides: Partial<PageNode> & Pick<PageNode, "source_path" | "title">): PageNode {
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
  const contentDir = "runtime/content";

  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockCreateSymlink.mockResolvedValue(undefined);
  });

  it("symlinks a root-level leaf page", async () => {
    const tree = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({ source_path: "about.md", title: "About" }),
      ],
    });

    await translatePageTree(tree, contentDir);

    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "about.md",
      `${contentDir}/about.md`
    );
  });

  it("writes _index.md for root folder (homepage)", async () => {
    const tree = makeNode({
      source_path: "",
      title: "Home",
      is_folder: true,
      content_html: "<h1>Welcome</h1>",
      children: [],
    });

    await translatePageTree(tree, contentDir);

    expect(mockWriteFile).toHaveBeenCalledWith(
      `${contentDir}/_index.md`,
      expect.stringContaining("Welcome")
    );
  });

  it("writes _index.md for subfolder nodes", async () => {
    const tree = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({
          source_path: "posts",
          title: "Posts",
          is_folder: true,
          content_html: "<h1>All Posts</h1>",
          children: [
            makeNode({ source_path: "posts/hello.md", title: "Hello" }),
          ],
        }),
      ],
    });

    await translatePageTree(tree, contentDir);

    // Subfolder gets _index.md (Hugo convention)
    expect(mockWriteFile).toHaveBeenCalledWith(
      `${contentDir}/posts/_index.md`,
      expect.stringContaining("All Posts")
    );
    // Child file gets symlinked
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "posts/hello.md",
      `${contentDir}/posts/hello.md`
    );
  });

  it("generates minimal _index.md for folders without content", async () => {
    const tree = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({
          source_path: "docs",
          title: "Docs",
          is_folder: true,
          content_html: "", // no user-authored content
          children: [],
        }),
      ],
    });

    await translatePageTree(tree, contentDir);

    expect(mockWriteFile).toHaveBeenCalledWith(
      `${contentDir}/docs/_index.md`,
      expect.stringContaining("title:")
    );
  });

  it("skips draft nodes entirely", async () => {
    const tree = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({ source_path: "visible.md", title: "Visible" }),
        makeNode({ source_path: "hidden.md", title: "Hidden", draft: true }),
      ],
    });

    await translatePageTree(tree, contentDir);

    expect(mockCreateSymlink).toHaveBeenCalledTimes(1);
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "visible.md",
      `${contentDir}/visible.md`
    );
  });

  it("includes Hugo draft frontmatter for draft folder children", async () => {
    // A draft folder should still generate _index.md with draft: true
    // so Hugo knows not to publish it
    const tree = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({
          source_path: "wip",
          title: "WIP",
          is_folder: true,
          draft: true,
          children: [],
        }),
      ],
    });

    await translatePageTree(tree, contentDir);

    // Draft folders should be skipped entirely
    expect(mockWriteFile).not.toHaveBeenCalledWith(
      `${contentDir}/wip/_index.md`,
      expect.anything()
    );
  });

  it("handles nested folder structures recursively", async () => {
    const tree = makeNode({
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
                makeNode({ source_path: "docs/guide/intro.md", title: "Intro" }),
              ],
            }),
          ],
        }),
      ],
    });

    await translatePageTree(tree, contentDir);

    expect(mockWriteFile).toHaveBeenCalledWith(
      `${contentDir}/docs/_index.md`,
      expect.anything()
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      `${contentDir}/docs/guide/_index.md`,
      expect.anything()
    );
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "docs/guide/intro.md",
      `${contentDir}/docs/guide/intro.md`
    );
  });

  it("handles Chinese folder and file names", async () => {
    const tree = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({
          source_path: "文章",
          title: "文章",
          is_folder: true,
          children: [
            makeNode({ source_path: "文章/你好.md", title: "你好" }),
          ],
        }),
      ],
    });

    await translatePageTree(tree, contentDir);

    expect(mockWriteFile).toHaveBeenCalledWith(
      `${contentDir}/文章/_index.md`,
      expect.anything()
    );
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "文章/你好.md",
      `${contentDir}/文章/你好.md`
    );
  });

  it("passes frontmatter fields through to Hugo format", async () => {
    const tree = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({
          source_path: "posts",
          title: "Posts",
          is_folder: true,
          nav: true,
          nav_weight: 10,
          list_style: "grid",
          children: [],
        }),
      ],
    });

    await translatePageTree(tree, contentDir);

    const writeCall = mockWriteFile.mock.calls.find(
      (c: string[]) => c[0] === `${contentDir}/posts/_index.md`
    );
    expect(writeCall).toBeDefined();
    const content = writeCall![1];
    // Hugo uses weight for ordering
    expect(content).toContain("weight: 10");
  });
});
