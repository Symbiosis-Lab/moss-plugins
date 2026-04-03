/**
 * TDD tests for Jekyll translatePageTree
 *
 * Jekyll conventions differ from Hugo:
 * - Homepage stays as index.md (no rename)
 * - posts/ folder maps to _posts/ (Jekyll convention)
 * - draft: true → published: false in frontmatter
 * - Other folders keep their names
 */

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

describe("translatePageTree (Jekyll)", () => {
  const runtimeDir = "runtime";

  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockCreateSymlink.mockResolvedValue(undefined);
  });

  it("symlinks root-level leaf pages", async () => {
    const tree = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({ source_path: "about.md", title: "About" }),
      ],
    });

    await translatePageTree(tree, runtimeDir);

    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "about.md",
      `${runtimeDir}/about.md`
    );
  });

  it("symlinks homepage as index.md (no rename unlike Hugo)", async () => {
    const tree = makeNode({
      source_path: "",
      title: "Home",
      is_folder: true,
      content_html: "<h1>Welcome</h1>",
      children: [],
    });

    await translatePageTree(tree, runtimeDir);

    // Jekyll uses index.md, not _index.md
    expect(mockWriteFile).toHaveBeenCalledWith(
      `${runtimeDir}/index.md`,
      expect.stringContaining("Welcome")
    );
  });

  it("maps posts/ folder to _posts/ (Jekyll convention)", async () => {
    const tree = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({
          source_path: "posts",
          title: "Posts",
          is_folder: true,
          children: [
            makeNode({ source_path: "posts/hello.md", title: "Hello" }),
          ],
        }),
      ],
    });

    await translatePageTree(tree, runtimeDir);

    // posts/hello.md → _posts/hello.md
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "posts/hello.md",
      `${runtimeDir}/_posts/hello.md`
    );
  });

  it("keeps non-posts folders with their original names", async () => {
    const tree = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({
          source_path: "projects",
          title: "Projects",
          is_folder: true,
          children: [
            makeNode({ source_path: "projects/app.md", title: "App" }),
          ],
        }),
      ],
    });

    await translatePageTree(tree, runtimeDir);

    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "projects/app.md",
      `${runtimeDir}/projects/app.md`
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

    await translatePageTree(tree, runtimeDir);

    expect(mockCreateSymlink).toHaveBeenCalledTimes(1);
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "visible.md",
      `${runtimeDir}/visible.md`
    );
  });

  it("creates index.md for subfolder nodes", async () => {
    const tree = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({
          source_path: "docs",
          title: "Docs",
          is_folder: true,
          content_html: "<p>Documentation</p>",
          children: [],
        }),
      ],
    });

    await translatePageTree(tree, runtimeDir);

    // Jekyll uses index.md for folder pages
    expect(mockWriteFile).toHaveBeenCalledWith(
      `${runtimeDir}/docs/index.md`,
      expect.stringContaining("Documentation")
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

    await translatePageTree(tree, runtimeDir);

    expect(mockWriteFile).toHaveBeenCalledWith(
      `${runtimeDir}/docs/index.md`,
      expect.anything()
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      `${runtimeDir}/docs/guide/index.md`,
      expect.anything()
    );
    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "docs/guide/intro.md",
      `${runtimeDir}/docs/guide/intro.md`
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

    await translatePageTree(tree, runtimeDir);

    expect(mockCreateSymlink).toHaveBeenCalledWith(
      "文章/你好.md",
      `${runtimeDir}/文章/你好.md`
    );
  });

  it("translates nav_weight to order in frontmatter", async () => {
    const tree = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({
          source_path: "docs",
          title: "Docs",
          is_folder: true,
          nav: true,
          nav_weight: 5,
          children: [],
        }),
      ],
    });

    await translatePageTree(tree, runtimeDir);

    const writeCall = mockWriteFile.mock.calls.find(
      (c: string[]) => c[0] === `${runtimeDir}/docs/index.md`
    );
    expect(writeCall).toBeDefined();
    const content = writeCall![1];
    // Jekyll uses "order" not "weight"
    expect(content).toContain("order: 5");
  });
});
