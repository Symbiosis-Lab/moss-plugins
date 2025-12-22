import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractAssetUuid,
  escapeRegex,
  buildAssetUrlPattern,
  replaceAssetUrls,
  calculateRelativePath,
  withTimeout,
} from "../downloader";

// Note: The downloader module heavily depends on:
// 1. window.__TAURI__ for file operations
// 2. global fetch for HTTP requests
// 3. Other utils functions
//
// Full integration tests would require mocking these. Here we test
// the module's structure and any pure logic that can be extracted.

describe("Downloader Module", () => {
  describe("Module Structure", () => {
    it("exports downloadMediaAndUpdate function", async () => {
      const module = await import("../downloader");
      expect(typeof module.downloadMediaAndUpdate).toBe("function");
    });

    it("exports rewriteAllInternalLinks function", async () => {
      const module = await import("../downloader");
      expect(typeof module.rewriteAllInternalLinks).toBe("function");
    });
  });

  describe("Constants", () => {
    // These are internal constants, but we can verify the module loads correctly
    it("module loads without errors", async () => {
      await expect(import("../downloader")).resolves.toBeDefined();
    });
  });
});

describe("extractAssetUuid", () => {
  it("extracts UUID from assets.matters.news URL", () => {
    const url = "https://assets.matters.news/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2/141562277039-pic-hd.jpg";
    expect(extractAssetUuid(url)).toBe("66296200-de80-43f1-a1a2-ce2b1403a3e2");
  });

  it("extracts UUID from imagedelivery.net URL", () => {
    const url = "https://imagedelivery.net/kDRCweMmqLnTPNlbum-pYA/prod/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2/141562277039-pic-hd.jpg/public";
    expect(extractAssetUuid(url)).toBe("66296200-de80-43f1-a1a2-ce2b1403a3e2");
  });

  it("extracts UUID without filename suffix", () => {
    const url = "https://assets.matters.news/embed/8ef4fb5d-ae3f-4e10-826b-169b0762d555.png";
    expect(extractAssetUuid(url)).toBe("8ef4fb5d-ae3f-4e10-826b-169b0762d555");
  });

  it("handles uppercase UUIDs", () => {
    const url = "https://example.com/66296200-DE80-43F1-A1A2-CE2B1403A3E2.jpg";
    expect(extractAssetUuid(url)).toBe("66296200-DE80-43F1-A1A2-CE2B1403A3E2");
  });

  it("returns null for URL without UUID", () => {
    const url = "https://example.com/image.jpg";
    expect(extractAssetUuid(url)).toBeNull();
  });

  it("returns null for malformed UUID", () => {
    const url = "https://example.com/66296200-de80-43f1-a1a2.jpg"; // Missing last segment
    expect(extractAssetUuid(url)).toBeNull();
  });

  it("returns first UUID if multiple present", () => {
    const url = "https://example.com/66296200-de80-43f1-a1a2-ce2b1403a3e2/8ef4fb5d-ae3f-4e10-826b-169b0762d555.png";
    expect(extractAssetUuid(url)).toBe("66296200-de80-43f1-a1a2-ce2b1403a3e2");
  });
});

describe("escapeRegex", () => {
  it("escapes dots", () => {
    expect(escapeRegex("file.png")).toBe("file\\.png");
  });

  it("escapes special regex characters", () => {
    expect(escapeRegex("test.*+?^${}()|[]\\")).toBe("test\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");
  });

  it("leaves alphanumeric and hyphens unchanged", () => {
    expect(escapeRegex("66296200-de80-43f1-a1a2-ce2b1403a3e2")).toBe("66296200-de80-43f1-a1a2-ce2b1403a3e2");
  });

  it("handles empty string", () => {
    expect(escapeRegex("")).toBe("");
  });
});

describe("buildAssetUrlPattern", () => {
  it("creates pattern that matches assets.matters.news URL", () => {
    const pattern = buildAssetUrlPattern("66296200-de80-43f1-a1a2-ce2b1403a3e2");
    const url = "https://assets.matters.news/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2/file.jpg";
    expect(pattern.test(url)).toBe(true);
  });

  it("creates pattern that matches imagedelivery.net URL", () => {
    const pattern = buildAssetUrlPattern("66296200-de80-43f1-a1a2-ce2b1403a3e2");
    const url = "https://imagedelivery.net/kDRCweMmqLnTPNlbum-pYA/prod/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2/public";
    expect(pattern.test(url)).toBe(true);
  });

  it("does not match URL with different UUID", () => {
    const pattern = buildAssetUrlPattern("66296200-de80-43f1-a1a2-ce2b1403a3e2");
    const url = "https://assets.matters.news/embed/8ef4fb5d-ae3f-4e10-826b-169b0762d555.png";
    expect(pattern.test(url)).toBe(false);
  });

  it("does not match non-URL text containing UUID", () => {
    const pattern = buildAssetUrlPattern("66296200-de80-43f1-a1a2-ce2b1403a3e2");
    const text = "The asset ID is 66296200-de80-43f1-a1a2-ce2b1403a3e2";
    expect(pattern.test(text)).toBe(false);
  });

  it("stops at markdown image closing paren", () => {
    const pattern = buildAssetUrlPattern("66296200-de80-43f1-a1a2-ce2b1403a3e2");
    const markdown = "![](https://assets.matters.news/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2.jpg)*caption*";
    const match = markdown.match(pattern);
    expect(match).not.toBeNull();
    expect(match![0]).toBe("https://assets.matters.news/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2.jpg");
  });
});

describe("replaceAssetUrls", () => {
  const assetId = "66296200-de80-43f1-a1a2-ce2b1403a3e2";
  const localPath = "assets/66296200-de80-43f1-a1a2-ce2b1403a3e2.jpg";

  it("replaces assets.matters.news URL in markdown", () => {
    const content = "![](https://assets.matters.news/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2/file.jpg)";
    const result = replaceAssetUrls(content, assetId, localPath);
    expect(result.replaced).toBe(true);
    expect(result.content).toBe(`![](${localPath})`);
  });

  it("replaces imagedelivery.net URL in markdown", () => {
    const content = "![](https://imagedelivery.net/xxx/prod/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2/public)";
    const result = replaceAssetUrls(content, assetId, localPath);
    expect(result.replaced).toBe(true);
    expect(result.content).toBe(`![](${localPath})`);
  });

  it("replaces multiple occurrences", () => {
    const content = `
![](https://assets.matters.news/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2.jpg)
Some text
![](https://imagedelivery.net/xxx/66296200-de80-43f1-a1a2-ce2b1403a3e2/public)
`.trim();
    const result = replaceAssetUrls(content, assetId, localPath);
    expect(result.replaced).toBe(true);
    expect(result.content).toBe(`
![](${localPath})
Some text
![](${localPath})
`.trim());
  });

  it("returns replaced=false when no match", () => {
    const content = "![](https://example.com/other-image.jpg)";
    const result = replaceAssetUrls(content, assetId, localPath);
    expect(result.replaced).toBe(false);
    expect(result.content).toBe(content);
  });

  it("preserves surrounding content", () => {
    const content = "Before ![alt](https://assets.matters.news/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2.jpg)*caption* After";
    const result = replaceAssetUrls(content, assetId, localPath);
    expect(result.replaced).toBe(true);
    expect(result.content).toBe(`Before ![alt](${localPath})*caption* After`);
  });

  it("handles URL without extension", () => {
    const content = "![](https://assets.matters.news/embed/66296200-de80-43f1-a1a2-ce2b1403a3e2)";
    const result = replaceAssetUrls(content, assetId, localPath);
    expect(result.replaced).toBe(true);
    expect(result.content).toBe(`![](${localPath})`);
  });
});

describe("calculateRelativePath", () => {
  it("returns asset path directly for root-level markdown", () => {
    // Markdown at root, asset in assets/
    expect(calculateRelativePath("article.md", "assets/image.png")).toBe("assets/image.png");
  });

  it("calculates path from nested markdown to assets", () => {
    // Markdown in 文章/, asset in assets/
    expect(calculateRelativePath("文章/article.md", "assets/image.png")).toBe("../assets/image.png");
  });

  it("calculates path from deeply nested markdown to assets", () => {
    // Markdown in a/b/c/, asset in assets/
    expect(calculateRelativePath("a/b/c/article.md", "assets/image.png")).toBe("../../../assets/image.png");
  });

  it("handles markdown and asset in same directory", () => {
    // Both in same directory
    expect(calculateRelativePath("folder/article.md", "folder/image.png")).toBe("image.png");
  });

  it("handles markdown in subdirectory of assets parent", () => {
    // Markdown in assets/docs/, asset in assets/
    expect(calculateRelativePath("assets/docs/article.md", "assets/image.png")).toBe("../image.png");
  });

  it("handles two-level nesting with Chinese characters", () => {
    // Real-world case with Chinese directory names
    expect(calculateRelativePath("刘果/文章/ipfs開發者大會記錄.md", "assets/66296200-de80-43f1-a1a2-ce2b1403a3e2.jpg"))
      .toBe("../../assets/66296200-de80-43f1-a1a2-ce2b1403a3e2.jpg");
  });
});

describe("withTimeout", () => {
  it("resolves when promise completes before timeout", async () => {
    const fastPromise = Promise.resolve("success");
    const result = await withTimeout(fastPromise, 1000, "timeout");
    expect(result).toBe("success");
  });

  it("rejects with timeout error when promise takes too long", async () => {
    const slowPromise = new Promise((resolve) => setTimeout(() => resolve("too slow"), 500));
    await expect(withTimeout(slowPromise, 50, "Custom timeout message"))
      .rejects.toThrow("Custom timeout message");
  });

  it("preserves the error from the original promise", async () => {
    const failingPromise = Promise.reject(new Error("Original error"));
    await expect(withTimeout(failingPromise, 1000, "timeout"))
      .rejects.toThrow("Original error");
  });

  it("resolves with correct value type", async () => {
    const typedPromise: Promise<{ id: number; name: string }> = Promise.resolve({ id: 1, name: "test" });
    const result = await withTimeout(typedPromise, 1000, "timeout");
    expect(result).toEqual({ id: 1, name: "test" });
  });

  it("works with immediate resolution", async () => {
    const immediate = Promise.resolve(42);
    const result = await withTimeout(immediate, 1, "timeout");
    expect(result).toBe(42);
  });

  it("works with async function results", async () => {
    const asyncFn = async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return "async result";
    };
    const result = await withTimeout(asyncFn(), 1000, "timeout");
    expect(result).toBe("async result");
  });
});

// Integration tests would look like this (commented out as they need mocking setup):
/*
describe("downloadAsset", () => {
  beforeEach(() => {
    // Mock window.__TAURI__
    (global as any).window = {
      __TAURI__: {
        core: {
          invoke: vi.fn(),
        },
      },
    };

    // Mock fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads and saves asset successfully", async () => {
    const mockResponse = {
      ok: true,
      headers: new Headers({ "content-type": "image/jpeg" }),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);
    (window.__TAURI__.core.invoke as any).mockResolvedValue(undefined);

    const { downloadAsset } = await import("./downloader");
    const result = await downloadAsset(
      "https://example.com/image.jpg",
      "image.jpg",
      "/project"
    );

    expect(result).toBe("assets/image.jpg");
  });

  it("retries on 429 rate limit", async () => {
    // First call returns 429, second succeeds
    const mockResponse429 = { ok: false, status: 429, statusText: "Too Many Requests" };
    const mockResponseOk = {
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    };

    (global.fetch as any)
      .mockResolvedValueOnce(mockResponse429)
      .mockResolvedValueOnce(mockResponseOk);

    const { downloadAsset } = await import("./downloader");
    const result = await downloadAsset(
      "https://example.com/image.png",
      "image.png",
      "/project"
    );

    expect(result).toBe("assets/image.png");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws on 404 without retry", async () => {
    const mockResponse = { ok: false, status: 404, statusText: "Not Found" };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const { downloadAsset } = await import("./downloader");
    await expect(
      downloadAsset("https://example.com/missing.jpg", "missing.jpg", "/project")
    ).rejects.toThrow("HTTP 404");
  });
});
*/
