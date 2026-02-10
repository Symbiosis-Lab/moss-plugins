/**
 * Unit tests for enhance hook functionality
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HookResult } from "@symbiosis-lab/moss-api";

// Mock the moss-api
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockListFiles = vi.fn();
const mockReadPluginFile = vi.fn();
const mockWritePluginFile = vi.fn();
const mockPluginFileExists = vi.fn();
const mockHttpGet = vi.fn();

vi.mock("@symbiosis-lab/moss-api", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  listFiles: (...args: unknown[]) => mockListFiles(...args),
  readPluginFile: (...args: unknown[]) => mockReadPluginFile(...args),
  writePluginFile: (...args: unknown[]) => mockWritePluginFile(...args),
  pluginFileExists: (...args: unknown[]) => mockPluginFileExists(...args),
  httpGet: (...args: unknown[]) => mockHttpGet(...args),
}));

describe("enhance hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListFiles.mockResolvedValue([]);
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
    <a href="/feed.xml" class="footer-link" data-external>RSS</a>
  </div>
</body>
</html>`;

      mockListFiles.mockResolvedValue(["test.html"]);
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
      expect(mockWriteFile).toHaveBeenCalled();

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
    <a href="/feed.xml" class="footer-link" data-external>RSS</a>
  </div>
</body>
</html>`;

      mockListFiles.mockResolvedValue(["test.html"]);
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

      mockListFiles.mockResolvedValue(["test.html"]);
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
    <a href="/feed.xml" class="footer-link" data-external>RSS</a>
  </div>
</body>
</html>`;

      mockListFiles.mockResolvedValue(["test.html"]);
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
    <a href="/feed.xml" class="footer-link" data-external>RSS</a>
  </div>
</body>
</html>`;

      mockListFiles.mockResolvedValue(["test.html"]);
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

      expect(mockListFiles).not.toHaveBeenCalled();
      expect(mockReadFile).not.toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });
});
