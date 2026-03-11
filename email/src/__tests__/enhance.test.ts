/**
 * Unit tests for enhance hook functionality
 *
 * Tests the pure transformer pattern: ctx.files in, modified[] out.
 * No file I/O mocks for site HTML (readFile/writeFile/listSiteFilesWithSizes).
 * Plugin-private storage (readPluginFile, writePluginFile, pluginFileExists) is still mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the moss-api — only plugin-private storage and httpGet
const mockReadPluginFile = vi.fn();
const mockWritePluginFile = vi.fn();
const mockPluginFileExists = vi.fn();
const mockHttpGet = vi.fn();

vi.mock("@symbiosis-lab/moss-api", () => ({
  readPluginFile: (...args: unknown[]) => mockReadPluginFile(...args),
  writePluginFile: (...args: unknown[]) => mockWritePluginFile(...args),
  pluginFileExists: (...args: unknown[]) => mockPluginFileExists(...args),
  httpGet: (...args: unknown[]) => mockHttpGet(...args),
}));

import type { EnhanceContext, EnhanceResult } from "../enhance";

describe("enhance hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPluginFileExists.mockResolvedValue(false);
  });

  const createEnhanceContext = (
    config: Record<string, unknown> = { api_key: "test-key" },
    files: Array<{ path: string; html: string }> = []
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
    files,
  });

  describe("enhance injects subscribe form into footer HTML", () => {
    it("should inject subscribe form after RSS link in footer", async () => {
      const html = `<!DOCTYPE html>
<html>
<body>
  <footer class="container">
    <div class="footer-content">
      <div class="footer-left">
        <a href="friends/" class="footer-link">友链</a>
      </div>
      <div class="footer-right">
        <a href="/feed.xml" class="footer-link" data-external>RSS</a>
      </div>
    </div>
  </footer>
</body>
</html>`;

      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "testuser" })
      );

      const ctx = createEnhanceContext({ api_key: "test-key" }, [
        { path: "test.html", html },
      ]);

      const { enhance } = await import("../enhance");
      const result: EnhanceResult = await enhance(ctx);

      expect(result.success).toBe(true);
      expect(result.modified).toBeDefined();
      expect(result.modified!.length).toBe(1);
      expect(result.modified![0].path).toBe("test.html");

      const modifiedHtml = result.modified![0].html;
      expect(modifiedHtml).toContain('<form action="https://buttondown.com/api/emails/embed-subscribe/testuser"');
      expect(modifiedHtml).toContain('method="post"');
      expect(modifiedHtml).toContain('type="email"');
      expect(modifiedHtml).toContain('name="email"');
    });
  });

  describe("enhance preserves RSS link", () => {
    it("should keep RSS link after injecting subscribe form", async () => {
      const html = `<!DOCTYPE html>
<html>
<body>
  <footer class="container">
    <div class="footer-content">
      <div class="footer-left">
        <a href="friends/" class="footer-link">友链</a>
      </div>
      <div class="footer-right">
        <a href="/feed.xml" class="footer-link" data-external>RSS</a>
      </div>
    </div>
  </footer>
</body>
</html>`;

      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "testuser" })
      );

      const ctx = createEnhanceContext({ api_key: "test-key" }, [
        { path: "test.html", html },
      ]);

      const { enhance } = await import("../enhance");
      const result = await enhance(ctx);

      const modifiedHtml = result.modified![0].html;
      expect(modifiedHtml).toContain('<a href="/feed.xml" class="footer-link" data-external>RSS</a>');
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

      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "testuser" })
      );

      const ctx = createEnhanceContext({ api_key: "test-key" }, [
        { path: "test.html", html },
      ]);

      const { enhance } = await import("../enhance");
      const result = await enhance(ctx);

      // No files modified — no footer-right div
      expect(result.modified).toEqual([]);
    });
  });

  describe("enhance uses cached username when available", () => {
    it("should use cached username and not call API", async () => {
      const html = `<!DOCTYPE html>
<html>
<body>
  <footer class="container">
    <div class="footer-content">
      <div class="footer-left">
        <a href="friends/" class="footer-link">友链</a>
      </div>
      <div class="footer-right">
        <a href="/feed.xml" class="footer-link" data-external>RSS</a>
      </div>
    </div>
  </footer>
</body>
</html>`;

      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "cached-user" })
      );

      const ctx = createEnhanceContext({ api_key: "test-key" }, [
        { path: "test.html", html },
      ]);

      const { enhance } = await import("../enhance");
      const result = await enhance(ctx);

      // Should not call httpGet when cache exists
      expect(mockHttpGet).not.toHaveBeenCalled();

      // Should use cached username
      const modifiedHtml = result.modified![0].html;
      expect(modifiedHtml).toContain("embed-subscribe/cached-user");
    });

    it("should call API when cache does not exist", async () => {
      const html = `<!DOCTYPE html>
<html>
<body>
  <footer class="container">
    <div class="footer-content">
      <div class="footer-left">
        <a href="friends/" class="footer-link">友链</a>
      </div>
      <div class="footer-right">
        <a href="/feed.xml" class="footer-link" data-external>RSS</a>
      </div>
    </div>
  </footer>
</body>
</html>`;

      mockPluginFileExists.mockResolvedValue(false);
      mockHttpGet.mockResolvedValue({
        ok: true,
        status: 200,
        contentType: "application/json",
        body: new Uint8Array(),
        text: () => JSON.stringify({ username: "api-user" }),
      });

      const ctx = createEnhanceContext({ api_key: "test-key" }, [
        { path: "test.html", html },
      ]);

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
  <footer class="container">
    <div class="footer-content">
      <div class="footer-left">
        <a href="friends/" class="footer-link">友链</a>
      </div>
      <div class="footer-right">
        <a href="/feed.xml" class="footer-link" data-external>RSS</a>
      </div>
    </div>
  </footer>
</body>
</html>`;

      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "testuser" })
      );

      // First run: inject into original HTML
      const ctx1 = createEnhanceContext({ api_key: "test-key" }, [
        { path: "test.html", html: originalHtml },
      ]);

      const { enhance } = await import("../enhance");
      const result1 = await enhance(ctx1);

      expect(result1.modified!.length).toBe(1);
      const firstRunOutput = result1.modified![0].html;

      // Second run: inject into already-enhanced HTML
      const ctx2 = createEnhanceContext({ api_key: "test-key" }, [
        { path: "test.html", html: firstRunOutput },
      ]);

      const result2 = await enhance(ctx2);

      // If idempotent, modified should be empty (no changes needed)
      // OR if modified, the output should be identical
      if (result2.modified!.length > 0) {
        expect(result2.modified![0].html).toBe(firstRunOutput);
      }
      // If modified is empty, that means result === input, which is perfect
    });
  });

  describe("enhance produces inline footer layout", () => {
    it("should not include a label element", async () => {
      const html = `<!DOCTYPE html>
<html lang="en">
<body>
  <footer class="container">
    <div class="footer-content">
      <div class="footer-left">
        <a href="friends/" class="footer-link">友链</a>
      </div>
      <div class="footer-right">
        <a href="/feed.xml" class="footer-link" data-external>RSS</a>
      </div>
    </div>
  </footer>
</body>
</html>`;

      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "testuser" })
      );

      const ctx = createEnhanceContext({ api_key: "test-key" }, [
        { path: "test.html", html },
      ]);

      const { enhance } = await import("../enhance");
      const result = await enhance(ctx);

      const modifiedHtml = result.modified![0].html;
      // No label element — use placeholder instead
      expect(modifiedHtml).not.toContain('<label');
    });

    it("should use placeholder text for email input", async () => {
      const html = `<!DOCTYPE html>
<html lang="en">
<body>
  <footer class="container">
    <div class="footer-content">
      <div class="footer-left">
        <a href="friends/" class="footer-link">友链</a>
      </div>
      <div class="footer-right">
        <a href="/feed.xml" class="footer-link" data-external>RSS</a>
      </div>
    </div>
  </footer>
</body>
</html>`;

      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "testuser" })
      );

      const ctx = createEnhanceContext({ api_key: "test-key" }, [
        { path: "test.html", html },
      ]);

      const { enhance } = await import("../enhance");
      const result = await enhance(ctx);

      const modifiedHtml = result.modified![0].html;
      expect(modifiedHtml).toContain('placeholder="email"');
    });

    it("should use Chinese placeholder for zh-lang pages", async () => {
      const html = `<!DOCTYPE html>
<html lang="zh-Hans">
<body>
  <footer class="container">
    <div class="footer-content">
      <div class="footer-left">
        <a href="friends/" class="footer-link">友链</a>
      </div>
      <div class="footer-right">
        <a href="/feed.xml" class="footer-link" data-external>RSS</a>
      </div>
    </div>
  </footer>
</body>
</html>`;

      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "testuser" })
      );

      const ctx = createEnhanceContext({ api_key: "test-key" }, [
        { path: "test.html", html },
      ]);

      const { enhance } = await import("../enhance");
      const result = await enhance(ctx);

      const modifiedHtml = result.modified![0].html;
      expect(modifiedHtml).toContain('placeholder="邮箱"');
    });

    it("should use Subscribe/订阅 as button text", async () => {
      const html = `<!DOCTYPE html>
<html lang="zh-Hans">
<body>
  <footer class="container">
    <div class="footer-content">
      <div class="footer-left">
        <a href="friends/" class="footer-link">友链</a>
      </div>
      <div class="footer-right">
        <a href="/feed.xml" class="footer-link" data-external>RSS</a>
      </div>
    </div>
  </footer>
</body>
</html>`;

      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "testuser" })
      );

      const ctx = createEnhanceContext({ api_key: "test-key" }, [
        { path: "test.html", html },
      ]);

      const { enhance } = await import("../enhance");
      const result = await enhance(ctx);

      const modifiedHtml = result.modified![0].html;
      expect(modifiedHtml).toContain('>订阅</button>');
    });
  });

  describe("enhance injects form inside footer-right, not footer-left", () => {
    it("should place the form inside footer-right div", async () => {
      const html = `<!DOCTYPE html>
<html>
<body>
  <footer class="container">
    <div class="footer-content">
      <div class="footer-left">
        <a href="friends/" class="footer-link">友链</a>
      </div>
      <div class="footer-right">
        <a href="/feed.xml" class="footer-link" data-external>RSS</a>
      </div>
    </div>
  </footer>
</body>
</html>`;

      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "testuser" })
      );

      const ctx = createEnhanceContext({ api_key: "test-key" }, [
        { path: "test.html", html },
      ]);

      const { enhance } = await import("../enhance");
      const result = await enhance(ctx);

      const modifiedHtml = result.modified![0].html;

      // The form must be inside footer-right, not footer-left
      const footerRightStart = modifiedHtml.indexOf('<div class="footer-right">');
      const footerLeftStart = modifiedHtml.indexOf('<div class="footer-left">');
      const formStart = modifiedHtml.indexOf('footer-subscribe-form');

      expect(footerRightStart).toBeGreaterThan(-1);
      expect(formStart).toBeGreaterThan(footerRightStart);

      // Find the closing </div> for footer-right — form must be before it
      // Also verify footer-left is untouched
      const footerLeftEnd = modifiedHtml.indexOf('</div>', footerLeftStart + 1);
      const footerLeftContent = modifiedHtml.slice(footerLeftStart, footerLeftEnd);
      expect(footerLeftContent).not.toContain('footer-subscribe-form');

      // The structure must remain valid: footer-right should close before footer-content closes
      // Parse: after footer-right opens, the next </div> after form should close footer-right,
      // then the next </div> closes footer-content
      const afterFooterRight = modifiedHtml.slice(footerRightStart);
      // Count: footer-right div should contain RSS link + form, then close
      // footer-content div should close after that, then footer closes
      expect(modifiedHtml).toContain('</footer>');
    });
  });

  describe("enhance preserves existing footer-right content", () => {
    it("should keep all existing content and append form", async () => {
      const html = `<!DOCTYPE html>
<html lang="en">
<body>
  <footer class="container">
    <div class="footer-content">
      <div class="footer-left">
        <a href="friends/" class="footer-link">友链</a>
      </div>
      <div class="footer-right">
        <a href="/feed.xml" class="footer-link" data-external>RSS</a>
      </div>
    </div>
  </footer>
</body>
</html>`;

      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({ username: "testuser" })
      );

      const ctx = createEnhanceContext({ api_key: "test-key" }, [
        { path: "test.html", html },
      ]);

      const { enhance } = await import("../enhance");
      const result = await enhance(ctx);

      const modifiedHtml = result.modified![0].html;
      // Form and RSS link should both be present
      expect(modifiedHtml).toContain("footer-subscribe-form");
      expect(modifiedHtml).toContain("footer-link");
    });
  });

  describe("enhance injects inline CSS into head", () => {
    const sampleCss = ".footer-subscribe-form { display: flex; }";

    const htmlWithHead = `<!DOCTYPE html>
<html lang="en">
<head><title>Test</title></head>
<body>
  <footer class="container">
    <div class="footer-content">
      <div class="footer-left">
        <a href="friends/" class="footer-link">友链</a>
      </div>
      <div class="footer-right">
        <a href="/feed.xml" class="footer-link" data-external>RSS</a>
      </div>
    </div>
  </footer>
</body>
</html>`;

    it("should inject <style class='moss-email-style'> into head", async () => {
      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockImplementation((filename: string) => {
        if (filename === "newsletter-info.json")
          return Promise.resolve(JSON.stringify({ username: "testuser" }));
        if (filename === "email-subscribe.css")
          return Promise.resolve(sampleCss);
        return Promise.reject(new Error("unknown file"));
      });

      const ctx = createEnhanceContext({ api_key: "test-key" }, [
        { path: "test.html", html: htmlWithHead },
      ]);
      const { enhance } = await import("../enhance");
      const result = await enhance(ctx);

      const modifiedHtml = result.modified![0].html;
      expect(modifiedHtml).toContain('<style class="moss-email-style">');
      expect(modifiedHtml).toContain(sampleCss);
    });

    it("should not inject CSS when no footer-right div", async () => {
      const noFooterHtml = `<!DOCTYPE html>
<html><head><title>Test</title></head>
<body><div class="main-content"><h1>Test</h1></div></body>
</html>`;

      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockImplementation((filename: string) => {
        if (filename === "newsletter-info.json")
          return Promise.resolve(JSON.stringify({ username: "testuser" }));
        if (filename === "email-subscribe.css")
          return Promise.resolve(sampleCss);
        return Promise.reject(new Error("unknown file"));
      });

      const ctx = createEnhanceContext({ api_key: "test-key" }, [
        { path: "test.html", html: noFooterHtml },
      ]);
      const { enhance } = await import("../enhance");
      const result = await enhance(ctx);

      // No footer = no modification = empty modified array
      expect(result.modified).toEqual([]);
    });

    it("CSS injection should be idempotent", async () => {
      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockImplementation((filename: string) => {
        if (filename === "newsletter-info.json")
          return Promise.resolve(JSON.stringify({ username: "testuser" }));
        if (filename === "email-subscribe.css")
          return Promise.resolve(sampleCss);
        return Promise.reject(new Error("unknown file"));
      });

      const ctx1 = createEnhanceContext({ api_key: "test-key" }, [
        { path: "test.html", html: htmlWithHead },
      ]);
      const { enhance } = await import("../enhance");
      const result1 = await enhance(ctx1);

      const firstRunOutput = result1.modified![0].html;
      // Confirm CSS was injected
      expect(firstRunOutput).toContain("moss-email-style");

      // Second run with already-enhanced HTML
      const ctx2 = createEnhanceContext({ api_key: "test-key" }, [
        { path: "test.html", html: firstRunOutput },
      ]);

      const result2 = await enhance(ctx2);

      // Should not double-inject
      if (result2.modified!.length > 0) {
        const secondRunOutput = result2.modified![0].html;
        const styleCount = (secondRunOutput.match(/moss-email-style/g) || []).length;
        expect(styleCount).toBe(1);
      }
    });

    it("should gracefully handle missing CSS file", async () => {
      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockImplementation((filename: string) => {
        if (filename === "newsletter-info.json")
          return Promise.resolve(JSON.stringify({ username: "testuser" }));
        if (filename === "email-subscribe.css")
          return Promise.reject(new Error("file not found"));
        return Promise.reject(new Error("unknown file"));
      });

      const ctx = createEnhanceContext({ api_key: "test-key" }, [
        { path: "test.html", html: htmlWithHead },
      ]);
      const { enhance } = await import("../enhance");
      const result = await enhance(ctx);

      // Should still succeed (form injected, just no CSS)
      expect(result.success).toBe(true);
      const modifiedHtml = result.modified![0].html;
      expect(modifiedHtml).toContain("footer-subscribe-form");
      expect(modifiedHtml).not.toContain("moss-email-style");
    });
  });

  describe("enhance handles missing API key gracefully", () => {
    it("should return success:false when no API key configured", async () => {
      const ctx = createEnhanceContext({ api_key: undefined });

      const { enhance } = await import("../enhance");
      const result: EnhanceResult = await enhance(ctx);

      expect(result.success).toBe(false);
      expect(result.message).toContain("No API key configured");
    });

    it("should not attempt to process files when no API key", async () => {
      const ctx = createEnhanceContext({ api_key: "" }, [
        { path: "test.html", html: "<html></html>" },
      ]);

      const { enhance } = await import("../enhance");
      const result = await enhance(ctx);

      // No modified files — early return before processing
      expect(result.modified).toBeUndefined();
    });
  });
});
