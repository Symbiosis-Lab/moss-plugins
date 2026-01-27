/**
 * Unit tests for translatePageTree (Eleventy)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PageNode } from "@symbiosis-lab/moss-api";

const { mockWriteFile, mockCreateSymlink, writtenFiles, createdSymlinks } =
  vi.hoisted(() => {
    const writtenFiles = new Map<string, string>();
    const createdSymlinks = new Map<string, string>();
    return {
      mockWriteFile: vi.fn().mockImplementation((path: string, content: string) => {
        writtenFiles.set(path, content);
        return Promise.resolve();
      }),
      mockCreateSymlink: vi.fn().mockImplementation((target: string, link: string) => {
        createdSymlinks.set(link, target);
        return Promise.resolve();
      }),
      writtenFiles,
      createdSymlinks,
    };
  });

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

const SRC = "/runtime/src";

describe("translatePageTree", () => {
  beforeEach(() => {
    mockWriteFile.mockClear();
    mockCreateSymlink.mockClear();
    writtenFiles.clear();
    createdSymlinks.clear();
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

    await translatePageTree(root, SRC);

    expect(createdSymlinks.get(`${SRC}/about.md`)).toBe("about.md");
  });

  it("writes homepage index.md for root folder", async () => {
    const root = makeNode({
      source_path: "",
      title: "My Site",
      is_folder: true,
      children: [],
    });

    await translatePageTree(root, SRC);

    const content = writtenFiles.get(`${SRC}/index.md`);
    expect(content).toBeDefined();
    expect(content).toContain("title: My Site");
  });

  it("writes index.md for a subfolder", async () => {
    const root = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({
          source_path: "blog",
          title: "Blog",
          is_folder: true,
          children: [
            makeNode({ source_path: "blog/post.md", title: "Post" }),
          ],
        }),
      ],
    });

    await translatePageTree(root, SRC);

    const content = writtenFiles.get(`${SRC}/blog/index.md`);
    expect(content).toBeDefined();
    expect(content).toContain("title: Blog");
    expect(createdSymlinks.get(`${SRC}/blog/post.md`)).toBe("blog/post.md");
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
              source_path: "docs/api",
              title: "API",
              is_folder: true,
              children: [
                makeNode({ source_path: "docs/api/ref.md", title: "Reference" }),
              ],
            }),
          ],
        }),
      ],
    });

    await translatePageTree(root, SRC);

    expect(writtenFiles.has(`${SRC}/docs/index.md`)).toBe(true);
    expect(writtenFiles.has(`${SRC}/docs/api/index.md`)).toBe(true);
    expect(createdSymlinks.get(`${SRC}/docs/api/ref.md`)).toBe("docs/api/ref.md");
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
          source_path: "drafts",
          title: "Drafts",
          is_folder: true,
          draft: true,
          children: [
            makeNode({ source_path: "drafts/wip.md", title: "WIP" }),
          ],
        }),
      ],
    });

    await translatePageTree(root, SRC);

    expect(createdSymlinks.has(`${SRC}/visible.md`)).toBe(true);
    expect(createdSymlinks.has(`${SRC}/hidden.md`)).toBe(false);
    expect(writtenFiles.has(`${SRC}/drafts/index.md`)).toBe(false);
    expect(createdSymlinks.has(`${SRC}/drafts/wip.md`)).toBe(false);
  });

  it("handles Chinese folder and file names", async () => {
    const root = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      children: [
        makeNode({
          source_path: "文档",
          title: "文档",
          is_folder: true,
          children: [
            makeNode({ source_path: "文档/介绍.md", title: "介绍" }),
          ],
        }),
      ],
    });

    await translatePageTree(root, SRC);

    expect(writtenFiles.has(`${SRC}/文档/index.md`)).toBe(true);
    expect(createdSymlinks.get(`${SRC}/文档/介绍.md`)).toBe("文档/介绍.md");
  });

  it("maps nav_weight to order in frontmatter", async () => {
    const root = makeNode({
      source_path: "",
      title: "Root",
      is_folder: true,
      nav_weight: 5,
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

    await translatePageTree(root, SRC);

    const rootContent = writtenFiles.get(`${SRC}/index.md`)!;
    expect(rootContent).toContain("order: 5");

    const docsContent = writtenFiles.get(`${SRC}/docs/index.md`)!;
    expect(docsContent).toContain("order: 10");
  });
});
