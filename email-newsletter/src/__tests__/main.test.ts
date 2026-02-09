/**
 * Tests for Email Newsletter plugin
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AfterDeployContext, ArticleInfo } from "../types";

// Create mocks before importing the module
const mockHttpPost = vi.fn();
const mockReadPluginFile = vi.fn();
const mockWritePluginFile = vi.fn();
const mockPluginFileExists = vi.fn();
const mockShowToast = vi.fn();
const mockOpenBrowser = vi.fn();

// Mock moss-api functions
vi.mock("@symbiosis-lab/moss-api", () => ({
  httpPost: (...args: unknown[]) => mockHttpPost(...args),
  readPluginFile: (...args: unknown[]) => mockReadPluginFile(...args),
  writePluginFile: (...args: unknown[]) => mockWritePluginFile(...args),
  pluginFileExists: (...args: unknown[]) => mockPluginFileExists(...args),
  showToast: (...args: unknown[]) => mockShowToast(...args),
  openBrowser: (...args: unknown[]) => mockOpenBrowser(...args),
}));

import { syndicate } from "../main";

describe("Email Newsletter Plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShowToast.mockResolvedValue(undefined);
    mockWritePluginFile.mockResolvedValue(undefined);
    mockOpenBrowser.mockResolvedValue(undefined);
  });

  function createTestArticle(overrides: Partial<ArticleInfo> = {}): ArticleInfo {
    return {
      source_path: "posts/test.md",
      title: "Test Article",
      content: "# Hello World\n\nThis is a test article.",
      frontmatter: {},
      url_path: "posts/test.html",
      date: "2025-01-15",
      tags: ["test"],
      ...overrides,
    };
  }

  function createTestContext(
    overrides: Partial<AfterDeployContext> = {}
  ): AfterDeployContext {
    return {
      project_info: {
        project_type: "moss",
        content_folders: ["posts"],
        total_files: 10,
      },
      config: {
        api_key: "test-api-key",
      },
      site_files: ["index.html", "posts/test.html"],
      articles: [createTestArticle()],
      deployment: {
        method: "github-pages",
        url: "https://example.com",
        deployed_at: "2025-01-15T12:00:00Z",
        metadata: {},
      },
      ...overrides,
    };
  }

  describe("syndicate", () => {
    it("returns error when no API key is configured", async () => {
      const context = createTestContext({
        config: { api_key: undefined },
      });

      const result = await syndicate(context);

      expect(result.success).toBe(false);
      expect(result.message).toContain("No Buttondown API key");
    });

    it("returns error when no deployment info is available", async () => {
      const context = createTestContext({
        deployment: undefined,
      });

      const result = await syndicate(context);

      expect(result.success).toBe(false);
      expect(result.message).toContain("No deployment information");
    });

    it("succeeds with no articles when all already syndicated", async () => {
      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({
          articles: {
            "posts/test.html": {
              url_path: "posts/test.html",
              syndicated_at: "2025-01-15T12:00:00Z",
              email_id: "existing-id",
              status: "sent",
            },
          },
        })
      );

      const context = createTestContext();
      const result = await syndicate(context);

      expect(result.success).toBe(true);
      expect(result.message).toContain("No new articles");
    });

    it("creates draft emails", async () => {
      mockPluginFileExists.mockResolvedValue(false);
      mockHttpPost.mockResolvedValue({
        ok: true,
        status: 200,
        contentType: "application/json",
        body: new Uint8Array(),
        text: () =>
          JSON.stringify({
            id: "new-email-id",
            subject: "Test Article",
            status: "draft",
            creation_date: "2025-01-15T12:00:00Z",
          }),
      });

      const context = createTestContext();
      const result = await syndicate(context);

      expect(result.success).toBe(true);
      expect(result.message).toContain("1 drafts");

      // Verify API was called with draft status
      expect(mockHttpPost).toHaveBeenCalledWith(
        "https://api.buttondown.com/v1/emails",
        expect.objectContaining({
          status: "draft",
        }),
        expect.any(Object)
      );
    });

    it("includes canonical link in email body", async () => {
      mockPluginFileExists.mockResolvedValue(false);
      mockHttpPost.mockResolvedValue({
        ok: true,
        status: 200,
        contentType: "application/json",
        body: new Uint8Array(),
        text: () =>
          JSON.stringify({
            id: "new-email-id",
            subject: "Test Article",
            status: "draft",
            creation_date: "2025-01-15T12:00:00Z",
          }),
      });

      const context = createTestContext();
      await syndicate(context);

      // Verify email body contains canonical link
      expect(mockHttpPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining("https://example.com/posts/test"),
        }),
        expect.any(Object)
      );
    });

    it("shows toast notification on success", async () => {
      mockPluginFileExists.mockResolvedValue(false);
      mockHttpPost.mockResolvedValue({
        ok: true,
        status: 200,
        contentType: "application/json",
        body: new Uint8Array(),
        text: () =>
          JSON.stringify({
            id: "new-email-id",
            subject: "Test Article",
            status: "draft",
            creation_date: "2025-01-15T12:00:00Z",
          }),
      });

      const context = createTestContext();
      await syndicate(context);

      // Verify success toast was shown
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "success",
        })
      );
    });

    it("handles API errors gracefully", async () => {
      mockPluginFileExists.mockResolvedValue(false);
      mockHttpPost.mockResolvedValue({
        ok: false,
        status: 401,
        contentType: "application/json",
        body: new Uint8Array(),
        text: () => "Unauthorized",
      });

      const context = createTestContext();
      const result = await syndicate(context);

      expect(result.success).toBe(false);
      expect(result.message).toContain("1 failed");
    });

    it("always creates drafts regardless of send_as_draft config", async () => {
      mockPluginFileExists.mockResolvedValue(false);
      mockHttpPost.mockResolvedValue({
        ok: true,
        status: 200,
        contentType: "application/json",
        body: new Uint8Array(),
        text: () =>
          JSON.stringify({
            id: "new-email-id",
            subject: "Test Article",
            status: "draft",
            creation_date: "2025-01-15T12:00:00Z",
          }),
      });

      const context = createTestContext({
        config: { api_key: "test-key", send_as_draft: false },
      });
      const result = await syndicate(context);

      expect(result.success).toBe(true);

      // Verify API was called with draft status even though config says send_as_draft: false
      expect(mockHttpPost).toHaveBeenCalledWith(
        "https://api.buttondown.com/v1/emails",
        expect.objectContaining({
          status: "draft",
        }),
        expect.any(Object)
      );
    });

    it("calls openBrowser after creating drafts", async () => {
      mockPluginFileExists.mockResolvedValue(false);
      mockHttpPost.mockResolvedValue({
        ok: true,
        status: 200,
        contentType: "application/json",
        body: new Uint8Array(),
        text: () =>
          JSON.stringify({
            id: "new-email-id",
            subject: "Test Article",
            status: "draft",
            creation_date: "2025-01-15T12:00:00Z",
          }),
      });

      const context = createTestContext();
      await syndicate(context);

      // Verify openBrowser was called with Buttondown emails URL
      expect(mockOpenBrowser).toHaveBeenCalledWith(
        "https://buttondown.com/emails"
      );
    });

    it("does not open browser when no new articles to syndicate", async () => {
      mockPluginFileExists.mockResolvedValue(true);
      mockReadPluginFile.mockResolvedValue(
        JSON.stringify({
          articles: {
            "posts/test.html": {
              url_path: "posts/test.html",
              syndicated_at: "2025-01-15T12:00:00Z",
              email_id: "existing-id",
              status: "sent",
            },
          },
        })
      );

      const context = createTestContext();
      const result = await syndicate(context);

      expect(result.success).toBe(true);
      expect(result.message).toContain("No new articles");

      // Verify openBrowser was NOT called
      expect(mockOpenBrowser).not.toHaveBeenCalled();
    });

    it("shows toast with draft count before opening browser", async () => {
      mockPluginFileExists.mockResolvedValue(false);
      mockHttpPost.mockResolvedValue({
        ok: true,
        status: 200,
        contentType: "application/json",
        body: new Uint8Array(),
        text: () =>
          JSON.stringify({
            id: "new-email-id",
            subject: "Test Article",
            status: "draft",
            creation_date: "2025-01-15T12:00:00Z",
          }),
      });

      const context = createTestContext();
      await syndicate(context);

      // Verify toast was shown with draft count
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("drafts created"),
          variant: "success",
        })
      );

      // Verify openBrowser was called after
      expect(mockOpenBrowser).toHaveBeenCalled();
    });
  });
});
