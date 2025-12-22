import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractAssetUuid,
  escapeRegex,
  buildAssetUrlPattern,
  replaceAssetUrls,
  calculateRelativePath,
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

// Note: withTimeout was removed - timeout handling is now done by Rust side
// (tokio::time::timeout with Semaphore for concurrency control)

// ============================================================================
// Integration Tests with Mock Tauri
// ============================================================================

import { setupMockTauri, type MockTauriContext } from "@symbiosis-lab/moss-api/testing";

describe("downloadMediaAndUpdate - partial completion", () => {
  let ctx: MockTauriContext;
  const projectPath = "/test-project";

  beforeEach(() => {
    ctx = setupMockTauri();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("updates file references for successfully downloaded images", async () => {
    // Set up a markdown file with 2 images
    const uuid1 = "aaaaaaaa-1111-1111-1111-111111111111";
    const uuid2 = "bbbbbbbb-2222-2222-2222-222222222222";
    const markdownContent = `---
title: "Test Article"
---

# Article

![](https://assets.matters.news/embed/${uuid1}.jpg)

Some text

![](https://assets.matters.news/embed/${uuid2}.jpg)
`;
    ctx.filesystem.setFile(`${projectPath}/article.md`, markdownContent);

    // Configure URL responses - uuid1 succeeds, uuid2 fails with 404
    ctx.urlConfig.setResponse(`https://assets.matters.news/embed/${uuid1}.jpg`, {
      status: 200,
      ok: true,
      contentType: "image/jpeg",
      bytesWritten: 1024,
      actualPath: `assets/${uuid1}.jpg`,
    });
    ctx.urlConfig.setResponse(`https://assets.matters.news/embed/${uuid2}.jpg`, {
      status: 404,
      ok: false,
      contentType: null,
      bytesWritten: 0,
      actualPath: "",
    });

    // Run the download and update function
    const { downloadMediaAndUpdate } = await import("../downloader");
    const result = await downloadMediaAndUpdate(projectPath);

    // Verify: 1 image downloaded, 1 error
    expect(result.imagesDownloaded).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);

    // Verify: File was modified to update successful reference
    const updatedContent = ctx.filesystem.getFile(`${projectPath}/article.md`)?.content;
    expect(updatedContent).toBeDefined();

    // UUID1 should be replaced with local path
    expect(updatedContent).toContain(`assets/${uuid1}.jpg`);
    expect(updatedContent).not.toContain(`https://assets.matters.news/embed/${uuid1}.jpg`);

    // UUID2 should remain as remote URL (download failed)
    expect(updatedContent).toContain(`https://assets.matters.news/embed/${uuid2}.jpg`);
  });

  it("tracks downloaded UUIDs correctly in map", async () => {
    const uuid = "cccccccc-3333-3333-3333-333333333333";
    const markdownContent = `---
title: "Test"
---

![](https://assets.matters.news/embed/${uuid}.png)
`;
    ctx.filesystem.setFile(`${projectPath}/test.md`, markdownContent);

    ctx.urlConfig.setResponse(`https://assets.matters.news/embed/${uuid}.png`, {
      status: 200,
      ok: true,
      contentType: "image/png",
      bytesWritten: 512,
      actualPath: `assets/${uuid}.png`,
    });

    const { downloadMediaAndUpdate } = await import("../downloader");
    const result = await downloadMediaAndUpdate(projectPath);

    expect(result.imagesDownloaded).toBe(1);
    expect(result.filesProcessed).toBe(1);

    // Verify the file was updated
    const updatedContent = ctx.filesystem.getFile(`${projectPath}/test.md`)?.content;
    expect(updatedContent).toContain(`assets/${uuid}.png`);
  });

  it("handles file in subdirectory with correct relative path", async () => {
    const uuid = "dddddddd-4444-4444-4444-444444444444";
    const markdownContent = `---
title: "Nested Article"
---

![](https://assets.matters.news/embed/${uuid}.jpg)
`;
    // File in nested directory
    ctx.filesystem.setFile(`${projectPath}/文章/游记/article.md`, markdownContent);

    ctx.urlConfig.setResponse(`https://assets.matters.news/embed/${uuid}.jpg`, {
      status: 200,
      ok: true,
      contentType: "image/jpeg",
      bytesWritten: 2048,
      actualPath: `assets/${uuid}.jpg`,
    });

    const { downloadMediaAndUpdate } = await import("../downloader");
    const result = await downloadMediaAndUpdate(projectPath);

    expect(result.imagesDownloaded).toBe(1);

    // Verify relative path is correct (../../assets/uuid.jpg)
    const updatedContent = ctx.filesystem.getFile(`${projectPath}/文章/游记/article.md`)?.content;
    expect(updatedContent).toContain(`../../assets/${uuid}.jpg`);
  });

  it("skips already existing assets", async () => {
    const existingUuid = "eeeeeeee-5555-5555-5555-555555555555";
    const newUuid = "ffffffff-6666-6666-6666-666666666666";

    const markdownContent = `---
title: "Test"
---

![](https://assets.matters.news/embed/${existingUuid}.jpg)
![](https://assets.matters.news/embed/${newUuid}.jpg)
`;
    ctx.filesystem.setFile(`${projectPath}/article.md`, markdownContent);

    // Simulate existing asset on disk
    ctx.filesystem.setFile(`${projectPath}/assets/${existingUuid}.jpg`, "[binary image data]");

    // Only configure the new UUID
    ctx.urlConfig.setResponse(`https://assets.matters.news/embed/${newUuid}.jpg`, {
      status: 200,
      ok: true,
      contentType: "image/jpeg",
      bytesWritten: 1024,
      actualPath: `assets/${newUuid}.jpg`,
    });

    const { downloadMediaAndUpdate } = await import("../downloader");
    const result = await downloadMediaAndUpdate(projectPath);

    // Only 1 new download (existing was skipped)
    expect(result.imagesDownloaded).toBe(1);
    expect(result.imagesSkipped).toBe(1);
  });

  it("updates cover reference in frontmatter", async () => {
    const uuid = "11111111-aaaa-bbbb-cccc-dddddddddddd";
    const markdownContent = `---
title: "Article with Cover"
cover: "https://imagedelivery.net/xxx/prod/embed/${uuid}.jpeg/public"
---

# Content
`;
    ctx.filesystem.setFile(`${projectPath}/article.md`, markdownContent);

    ctx.urlConfig.setResponse(`https://imagedelivery.net/xxx/prod/embed/${uuid}.jpeg/public`, {
      status: 200,
      ok: true,
      contentType: "image/jpeg",
      bytesWritten: 4096,
      actualPath: `assets/${uuid}.jpg`,
    });

    const { downloadMediaAndUpdate } = await import("../downloader");
    const result = await downloadMediaAndUpdate(projectPath);

    expect(result.imagesDownloaded).toBe(1);
    expect(result.filesProcessed).toBe(1);

    const updatedContent = ctx.filesystem.getFile(`${projectPath}/article.md`)?.content;
    expect(updatedContent).toContain(`cover: "assets/${uuid}.jpg"`);
  });

  it("updates references when asset already exists (self-correcting)", async () => {
    // This test reproduces the production bug:
    // 1. Asset was downloaded in a previous run (exists on disk)
    // 2. But the file still has remote URL (previous run was interrupted)
    // 3. Running again should update the reference even though download is skipped
    const uuid = "2ef1d558-bca4-4792-bb63-41ee12fa95ac";
    const markdownContent = `---
title: "色达"
---

![](https://assets.matters.news/embed/${uuid}.jpeg)
`;
    ctx.filesystem.setFile(`${projectPath}/文章/游记/色达.md`, markdownContent);

    // Asset already exists on disk (from previous interrupted run)
    ctx.filesystem.setFile(`${projectPath}/assets/${uuid}.jpg`, "[binary image data]");

    const { downloadMediaAndUpdate } = await import("../downloader");
    const result = await downloadMediaAndUpdate(projectPath);

    // Asset should be skipped (already exists), not downloaded
    expect(result.imagesDownloaded).toBe(0);
    expect(result.imagesSkipped).toBe(1);

    // But file should still be updated with local path
    expect(result.filesProcessed).toBe(1);

    const updatedContent = ctx.filesystem.getFile(`${projectPath}/文章/游记/色达.md`)?.content;
    expect(updatedContent).toBeDefined();
    // Should use relative path from nested directory
    expect(updatedContent).toContain(`../../assets/${uuid}.jpg`);
    expect(updatedContent).not.toContain(`https://assets.matters.news/embed/${uuid}.jpeg`);
  });

  it("updates multiple references when multiple assets already exist", async () => {
    // Same scenario but with multiple images
    const uuid1 = "aaaa1111-1111-1111-1111-111111111111";
    const uuid2 = "bbbb2222-2222-2222-2222-222222222222";
    const uuid3 = "cccc3333-3333-3333-3333-333333333333";

    const markdownContent = `---
title: "Multi Image Article"
cover: "https://assets.matters.news/embed/${uuid1}.jpg"
---

![](https://assets.matters.news/embed/${uuid2}.png)

Some text

![](https://assets.matters.news/embed/${uuid3}.jpeg)
`;
    ctx.filesystem.setFile(`${projectPath}/nested/dir/article.md`, markdownContent);

    // All 3 assets exist on disk
    ctx.filesystem.setFile(`${projectPath}/assets/${uuid1}.jpg`, "[image 1]");
    ctx.filesystem.setFile(`${projectPath}/assets/${uuid2}.png`, "[image 2]");
    ctx.filesystem.setFile(`${projectPath}/assets/${uuid3}.jpeg`, "[image 3]");

    const { downloadMediaAndUpdate } = await import("../downloader");
    const result = await downloadMediaAndUpdate(projectPath);

    // All 3 skipped, none downloaded
    expect(result.imagesDownloaded).toBe(0);
    expect(result.imagesSkipped).toBe(3);

    // File should be updated
    expect(result.filesProcessed).toBe(1);

    const updatedContent = ctx.filesystem.getFile(`${projectPath}/nested/dir/article.md`)?.content;
    expect(updatedContent).toBeDefined();

    // All 3 should be updated to relative paths
    expect(updatedContent).toContain(`cover: "../../assets/${uuid1}.jpg"`);
    expect(updatedContent).toContain(`../../assets/${uuid2}.png`);
    expect(updatedContent).toContain(`../../assets/${uuid3}.jpeg`);

    // None should have remote URLs
    expect(updatedContent).not.toContain("https://assets.matters.news");
  });
});
