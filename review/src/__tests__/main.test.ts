import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockFetchUrl = vi.hoisted(() => vi.fn());
const mockReadPluginFile = vi.hoisted(() => vi.fn());

vi.mock("@symbiosis-lab/moss-api", () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  fetchUrl: mockFetchUrl,
  readPluginFile: mockReadPluginFile,
}));

import { process } from "../main";
import type { ProcessContext } from "../types";

import bookFixture from "./fixtures/neodb-book.json";

const makeProcessCtx = (): ProcessContext => ({
  project_info: { total_files: 10, homepage_file: null, site_name: "test" },
  config: {},
});

describe("process hook", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockFetchUrl.mockReset();
  });

  it("skips when no article-map.json", async () => {
    mockReadFile.mockRejectedValue(new Error("Not found"));

    const result = await process(makeProcessCtx());
    expect(result.success).toBe(true);
    expect(result.message).toContain("No article map");
  });

  it("fetches NeoDB data for articles with neodb frontmatter", async () => {
    // article-map.json
    mockReadFile.mockImplementation((path: string) => {
      if (path === ".moss/article-map.json") {
        return Promise.resolve(JSON.stringify({
          articles: {
            "reading/test": {
              source_path: "reading/test.md",
              url_path: "reading/test/",
              uid: "abc12345",
            },
          },
        }));
      }
      if (path === "reading/test.md") {
        return Promise.resolve(
          "---\ntitle: Test\nneodb: https://neodb.social/book/2ZSdZMnRJZKYD8QFRNNwrp\nrating: 4\n---\nBody"
        );
      }
      if (path === ".moss/social/review.json") {
        return Promise.reject(new Error("Not found"));
      }
      return Promise.reject(new Error("Unknown file: " + path));
    });

    mockFetchUrl.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => JSON.stringify(bookFixture),
    });

    mockWriteFile.mockResolvedValue(undefined);

    const result = await process(makeProcessCtx());
    expect(result.success).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledWith(
      ".moss/social/review.json",
      expect.any(String)
    );
  });
});

