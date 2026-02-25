/**
 * Unit tests for enhance hook functionality
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HookResult } from "@symbiosis-lab/moss-api";

// Mock the moss-api
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockListSiteFilesWithSizes = vi.fn();
const mockReadPluginFile = vi.fn();
const mockWritePluginFile = vi.fn();
const mockPluginFileExists = vi.fn();
const mockHttpGet = vi.fn();

vi.mock("@symbiosis-lab/moss-api", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  listSiteFilesWithSizes: (...args: unknown[]) =>
    mockListSiteFilesWithSizes(...args),
  readPluginFile: (...args: unknown[]) => mockReadPluginFile(...args),
  writePluginFile: (...args: unknown[]) => mockWritePluginFile(...args),
  pluginFileExists: (...args: unknown[]) => mockPluginFileExists(...args),
  httpGet: (...args: unknown[]) => mockHttpGet(...args),
}));

describe("enhance hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListSiteFilesWithSizes.mockResolvedValue([]);
    mockPluginFileExists.mockResolvedValue(false);
  });

  interface EnhanceContext {
    project_path: string;
    moss_dir: string;
    output_dir: string;
    project_info: { project_path: string; moss_dir: string; output_dir: string };
    config: Record<string, unknown>;
    interactions: unknown[];
  }

  const createEnhanceContext = (
    config: Record<string, unknown> = { api_key: "test-key" }
  ): EnhanceContext => ({
    project_path: "/test/project",
    moss_dir: "/test/.moss",
    output_dir: "/test/output",
    project_info: {
      project_path: "/test/project",
      moss_dir: "/test/.moss",
      output_dir: "/test/output",
    },
    config,
    interactions: [],
  });

  describe("enhance injects subscribe form into footer HTML", () => {
    it("should inject subscribe form after RSS link in footer", async () => {
      const html = `<!DOCTYPE html>
<html>
<body>
  <div class="footer-content">
    <p class="footer-description">Subscribe</p>
    <a href="/feed.xml" class="footer-link" data-external>RSS</a>
  </div>
</body>
</html>`;

      mockListSiteFilesWithSizes.mockResolvedValue([
        { path: "test.html", size: 100 },
      ]);
      mockReadFile.mockResolvedValue(html);
      mockWriteFile.mockResolvedValue(undefined);
      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "testuser" })
      );

      const ctx = createEnhanceContext();

      const { enhance } = await import("../enhance");
      const result: HookResult = await enhance(ctx);

      expect(result.success).toBe(true);
      expect(mockReadFile).toHaveBeenCalledWith(".moss/site/test.html");
      expect(mockWriteFile).toHaveBeenCalled();
      expect(mockWriteFile.mock.calls[0][0]).toBe(".moss/site/test.html");

      const writtenHtml = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenHtml).toContain('<form action="https://buttondown.com/api/emails/embed-subscribe/testuser"');
      expect(writtenHtml).toContain('method="post"');
      expect(writtenHtml).toContain('type="email"');
      expect(writtenHtml).toContain('name="email"');
    });
  });

  describe("enhance preserves RSS link", () => {
    it("should keep RSS link after injecting subscribe form", async () => {
      const html = `<!DOCTYPE html>
<html>
<body>
  <div class="footer-content">
    <p class="footer-description">Subscribe</p>
    <a href="/feed.xml" class="footer-link" data-external>RSS</a>
  </div>
</body>
</html>`;

      mockListSiteFilesWithSizes.mockResolvedValue([
        { path: "test.html", size: 100 },
      ]);
      mockReadFile.mockResolvedValue(html);
      mockWriteFile.mockResolvedValue(undefined);
      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "testuser" })
      );

      const ctx = createEnhanceContext();

      const { enhance } = await import("../enhance");
      await enhance(ctx);

      const writtenHtml = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenHtml).toContain('<a href="/feed.xml" class="footer-link" data-external>RSS</a>');
    });
  });

  describe("enhance skips files without footer", () => {
    it("should not modify HTML without footer-content div", async () => {
      const html = `<!DOCTYPE html>
<html>
<body>
  <div class="main-content">
    <h1>Test</h1>
  </div>
</body>
</html>`;

      mockListSiteFilesWithSizes.mockResolvedValue([
        { path: "test.html", size: 100 },
      ]);
      mockReadFile.mockResolvedValue(html);
      mockWriteFile.mockResolvedValue(undefined);
      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "testuser" })
      );

      const ctx = createEnhanceContext();

      const { enhance } = await import("../enhance");
      await enhance(ctx);

      // writeFile should not be called for files without footer
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  describe("enhance uses cached username when available", () => {
    it("should use cached username and not call API", async () => {
      const html = `<!DOCTYPE html>
<html>
<body>
  <div class="footer-content">
    <p class="footer-description">Subscribe</p>
    <a href="/feed.xml" class="footer-link" data-external>RSS</a>
  </div>
</body>
</html>`;

      mockListSiteFilesWithSizes.mockResolvedValue([
        { path: "test.html", size: 100 },
      ]);
      mockReadFile.mockResolvedValue(html);
      mockWriteFile.mockResolvedValue(undefined);
      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "cached-user" })
      );

      const ctx = createEnhanceContext();

      const { enhance } = await import("../enhance");
      await enhance(ctx);

      // Should not call httpGet when cache exists
      expect(mockHttpGet).not.toHaveBeenCalled();

      // Should use cached username
      const writtenHtml = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenHtml).toContain("embed-subscribe/cached-user");
    });

    it("should call API when cache does not exist", async () => {
      const html = `<!DOCTYPE html>
<html>
<body>
  <div class="footer-content">
    <p class="footer-description">Subscribe</p>
    <a href="/feed.xml" class="footer-link" data-external>RSS</a>
  </div>
</body>
</html>`;

      mockListSiteFilesWithSizes.mockResolvedValue([
        { path: "test.html", size: 100 },
      ]);
      mockReadFile.mockResolvedValue(html);
      mockWriteFile.mockResolvedValue(undefined);
      mockPluginFileExists.mockResolvedValue(false);
      mockHttpGet.mockResolvedValue({
        ok: true,
        status: 200,
        contentType: "application/json",
        body: new Uint8Array(),
        text: () => JSON.stringify({ username: "api-user" }),
      });

      const ctx = createEnhanceContext();

      const { enhance } = await import("../enhance");
      await enhance(ctx);

      // Should call httpGet when cache doesn't exist
      expect(mockHttpGet).toHaveBeenCalledWith(
        "https://api.buttondown.com/v1/newsletters",
        expect.objectContaining({
          headers: { Authorization: "Token test-key" },
        })
      );

      // Should cache the result
      expect(mockWritePluginFile).toHaveBeenCalledWith(
        "newsletter-info.json",
        JSON.stringify({ username: "api-user" })
      );
    });
  });

  describe("enhance is idempotent (safe to run multiple times)", () => {
    it("should produce identical output when run twice on the same HTML", async () => {
      const originalHtml = `<!DOCTYPE html>
<html>
<body>
  <div class="footer-content">
    <p class="footer-description">Subscribe</p>
    <a href="/feed.xml" class="footer-link" data-external>RSS</a>
  </div>
</body>
</html>`;

      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "testuser" })
      );
      mockWriteFile.mockResolvedValue(undefined);

      // First run: inject into original HTML
      mockListSiteFilesWithSizes.mockResolvedValue([
        { path: "test.html", size: 100 },
      ]);
      mockReadFile.mockResolvedValue(originalHtml);

      const ctx = createEnhanceContext();
      const { enhance } = await import("../enhance");
      await enhance(ctx);

      const firstRunOutput = mockWriteFile.mock.calls[0][1] as string;

      // Second run: inject into already-enhanced HTML
      vi.clearAllMocks();
      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "testuser" })
      );
      mockWriteFile.mockResolvedValue(undefined);
      mockListSiteFilesWithSizes.mockResolvedValue([
        { path: "test.html", size: 100 },
      ]);
      mockReadFile.mockResolvedValue(firstRunOutput);

      await enhance(ctx);

      // If idempotent, writeFile should NOT be called (modified === html)
      // OR if called, the output should be identical
      if (mockWriteFile.mock.calls.length > 0) {
        const secondRunOutput = mockWriteFile.mock.calls[0][1] as string;
        expect(secondRunOutput).toBe(firstRunOutput);
      }
      // If writeFile wasn't called, that means modified === html, which is perfect
    });
  });

  describe("enhance produces inline footer layout", () => {
    it("should not include a label element", async () => {
      const html = `<!DOCTYPE html>
<html lang="en">
<body>
  <div class="footer-content">
    <p class="footer-description">Subscribe</p>
    <a href="/feed.xml" class="footer-link" data-external>RSS</a>
  </div>
</body>
</html>`;

      mockListSiteFilesWithSizes.mockResolvedValue([
        { path: "test.html", size: 100 },
      ]);
      mockReadFile.mockResolvedValue(html);
      mockWriteFile.mockResolvedValue(undefined);
      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "testuser" })
      );

      const ctx = createEnhanceContext();

      const { enhance } = await import("../enhance");
      await enhance(ctx);

      const writtenHtml = mockWriteFile.mock.calls[0][1] as string;
      // No label element — use placeholder instead
      expect(writtenHtml).not.toContain('<label');
    });

    it("should use placeholder text for email input", async () => {
      const html = `<!DOCTYPE html>
<html lang="en">
<body>
  <div class="footer-content">
    <p class="footer-description">Subscribe</p>
    <a href="/feed.xml" class="footer-link" data-external>RSS</a>
  </div>
</body>
</html>`;

      mockListSiteFilesWithSizes.mockResolvedValue([
        { path: "test.html", size: 100 },
      ]);
      mockReadFile.mockResolvedValue(html);
      mockWriteFile.mockResolvedValue(undefined);
      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "testuser" })
      );

      const ctx = createEnhanceContext();

      const { enhance } = await import("../enhance");
      await enhance(ctx);

      const writtenHtml = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenHtml).toContain('placeholder="email"');
    });

    it("should use Chinese placeholder for zh-lang pages", async () => {
      const html = `<!DOCTYPE html>
<html lang="zh-Hans">
<body>
  <div class="footer-content">
    <p class="footer-description">订阅</p>
    <a href="/feed.xml" class="footer-link" data-external>RSS</a>
  </div>
</body>
</html>`;

      mockListSiteFilesWithSizes.mockResolvedValue([
        { path: "test.html", size: 100 },
      ]);
      mockReadFile.mockResolvedValue(html);
      mockWriteFile.mockResolvedValue(undefined);
      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "testuser" })
      );

      const ctx = createEnhanceContext();

      const { enhance } = await import("../enhance");
      await enhance(ctx);

      const writtenHtml = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenHtml).toContain('placeholder="邮箱"');
    });

    it("should use Subscribe/订阅 as button text", async () => {
      const html = `<!DOCTYPE html>
<html lang="zh-Hans">
<body>
  <div class="footer-content">
    <p class="footer-description">订阅</p>
    <a href="/feed.xml" class="footer-link" data-external>RSS</a>
  </div>
</body>
</html>`;

      mockListSiteFilesWithSizes.mockResolvedValue([
        { path: "test.html", size: 100 },
      ]);
      mockReadFile.mockResolvedValue(html);
      mockWriteFile.mockResolvedValue(undefined);
      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "testuser" })
      );

      const ctx = createEnhanceContext();

      const { enhance } = await import("../enhance");
      await enhance(ctx);

      const writtenHtml = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenHtml).toContain('>订阅</button>');
    });
  });

  describe("enhance removes footer-description when injecting form", () => {
    it("should strip the footer-description paragraph since the button replaces it", async () => {
      // Real footer structure: <p class="footer-description"> and <a class="footer-link"> as siblings
      const html = `<!DOCTYPE html>
<html lang="en">
<body>
  <div class="footer-content">
    <p class="footer-description">Subscribe</p>
    <a href="/feed.xml" class="footer-link" data-external>RSS</a>
  </div>
</body>
</html>`;

      mockListSiteFilesWithSizes.mockResolvedValue([
        { path: "test.html", size: 100 },
      ]);
      mockReadFile.mockResolvedValue(html);
      mockWriteFile.mockResolvedValue(undefined);
      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "testuser" })
      );

      const ctx = createEnhanceContext();

      const { enhance } = await import("../enhance");
      await enhance(ctx);

      const writtenHtml = mockWriteFile.mock.calls[0][1] as string;
      // Footer-description should be removed (button already says Subscribe)
      expect(writtenHtml).not.toContain("footer-description");
      // Form and RSS link should still be present
      expect(writtenHtml).toContain("footer-subscribe-form");
      expect(writtenHtml).toContain("footer-link");
    });
  });

  describe("enhance handles missing API key gracefully", () => {
    it("should return success:false when no API key configured", async () => {
      const ctx = createEnhanceContext({ api_key: undefined });

      const { enhance } = await import("../enhance");
      const result: HookResult = await enhance(ctx);

      expect(result.success).toBe(false);
      expect(result.message).toContain("No API key configured");
    });

    it("should not attempt to process files when no API key", async () => {
      const ctx = createEnhanceContext({ api_key: "" });

      const { enhance } = await import("../enhance");
      await enhance(ctx);

      expect(mockListSiteFilesWithSizes).not.toHaveBeenCalled();
      expect(mockReadFile).not.toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });
});
