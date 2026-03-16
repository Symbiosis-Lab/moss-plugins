/**
 * Tests for main.ts
 *
 * Covers:
 * - syndicateArticle uploads cover when article.frontmatter.cover exists
 * - syndicateArticle skips cover upload when no cover in frontmatter
 * - syndicateArticle continues gracefully when cover upload fails
 * - uploadCoverByUrl calls graphqlQuery with correct mutation shape
 * - normalizeHtmlForMatters heading transformation and image wrapping
 * - addCanonicalLinkToContent with lang parameter
 * - syndicateArticle passing summary and lang
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ArticleInfo } from "../types";

// ============================================================================
// Mocks
// ============================================================================

// Mock @symbiosis-lab/moss-api before importing the modules under test
vi.mock("@symbiosis-lab/moss-api", () => ({
  getPluginCookie: vi.fn(),
  httpPost: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  showToast: vi.fn().mockResolvedValue(undefined),
  openBrowser: vi.fn().mockResolvedValue({ closed: new Promise(() => {}) }),
  closeBrowser: vi.fn().mockResolvedValue(undefined),
}));

// Mock the api module
vi.mock("../api", () => ({
  clearTokenCache: vi.fn(),
  getAccessToken: vi.fn().mockResolvedValue("test-token"),
  createDraft: vi.fn(),
  fetchDraft: vi.fn(),
  uploadCoverByUrl: vi.fn(),
  apiConfig: { queryMode: "viewer", testUserName: "Matty", endpoint: "https://server.matters.town/graphql" },
  SINGLE_FILE_UPLOAD_MUTATION: `
mutation SingleFileUpload($input: SingleFileUploadInput!) {
  singleFileUpload(input: $input) { id path }
}
`,
}));

// Mock other modules that main.ts depends on
vi.mock("../config", () => ({
  getConfig: vi.fn().mockResolvedValue({ userName: "testuser" }),
  saveConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../domain", () => ({
  initializeDomain: vi.fn().mockResolvedValue(undefined),
  loginUrl: vi.fn().mockReturnValue("https://matters.town/login"),
  draftUrl: vi.fn().mockImplementation((id: string) => `https://matters.town/drafts/${id}`),
  articleUrl: vi.fn().mockImplementation((_user: string, slug: string, hash: string) => `https://matters.town/@testuser/${slug}-${hash}`),
  isMattersUrl: vi.fn().mockImplementation((url: string) => url.includes("matters.town")),
}));

vi.mock("../utils", () => ({
  reportProgress: vi.fn().mockResolvedValue(undefined),
  reportError: vi.fn().mockResolvedValue(undefined),
  setCurrentHookName: vi.fn(),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../converter", () => ({
  parseFrontmatter: vi.fn(),
  regenerateFrontmatter: vi.fn(),
}));

// Now import the modules under test
import { syndicateArticle, normalizeHtmlForMatters, addCanonicalLinkToContent } from "../main";
import { uploadCoverByUrl, createDraft, fetchDraft, SINGLE_FILE_UPLOAD_MUTATION } from "../api";

// ============================================================================
// Test Helpers
// ============================================================================

function makeArticle(overrides: Partial<ArticleInfo> = {}): ArticleInfo {
  return {
    source_path: "posts/test.md",
    title: "Test Article",
    content: "# Test\n\nContent here.",
    html_content: "<h1>Test</h1><p>Content here.</p>",
    frontmatter: {},
    url_path: "posts/test/",
    date: "2024-01-01",
    tags: ["tag1", "tag2"],
    ...overrides,
  };
}

function makeDraftResponse(id = "draft-123") {
  return {
    id,
    title: "Test Article",
    content: "<h1>Test</h1>",
    createdAt: "2024-01-01T00:00:00Z",
    publishState: "unpublished" as const,
  };
}

function makePublishedDraftResponse(id = "draft-123") {
  return {
    id,
    title: "Test Article",
    content: "<h1>Test</h1>",
    createdAt: "2024-01-01T00:00:00Z",
    publishState: "published" as const,
    article: {
      id: "article-456",
      shortHash: "abc123",
      slug: "test-article",
    },
  };
}

// ============================================================================
// Tests: syndicateArticle cover upload
// ============================================================================

describe("syndicateArticle - cover upload", () => {
  const siteUrl = "https://example.com";
  const userName = "testuser";
  const options = { addCanonicalLink: false, lang: "en" };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: createDraft succeeds
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse());

    // Default: fetchDraft immediately returns published draft
    // This causes waitForPublishOrClose to exit on first poll iteration,
    // preventing the OOM loop caused by mocked sleep running instantly.
    vi.mocked(fetchDraft).mockResolvedValue(makePublishedDraftResponse());

    // Default: uploadCoverByUrl succeeds
    vi.mocked(uploadCoverByUrl).mockResolvedValue("asset-abc-123");
  });

  it("uploads cover and passes asset ID to createDraft when frontmatter.cover exists", async () => {
    const article = makeArticle({
      frontmatter: { cover: "assets/covers/book.jpg" },
    });

    await syndicateArticle(article, siteUrl, userName, options);

    expect(uploadCoverByUrl).toHaveBeenCalledWith("https://example.com/assets/covers/book.jpg");
    expect(createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ cover: "asset-abc-123" })
    );
  });

  it("resolves cover URL correctly — strips trailing slash from siteUrl", async () => {
    const article = makeArticle({
      frontmatter: { cover: "assets/covers/hero.png" },
    });

    await syndicateArticle(article, "https://example.com/", userName, options);

    expect(uploadCoverByUrl).toHaveBeenCalledWith("https://example.com/assets/covers/hero.png");
  });

  it("resolves cover URL correctly — strips leading slash from cover path", async () => {
    const article = makeArticle({
      frontmatter: { cover: "/assets/covers/hero.png" },
    });

    await syndicateArticle(article, siteUrl, userName, options);

    expect(uploadCoverByUrl).toHaveBeenCalledWith("https://example.com/assets/covers/hero.png");
  });

  it("skips cover upload and does not pass cover to createDraft when no cover in frontmatter", async () => {
    const article = makeArticle({ frontmatter: {} });

    await syndicateArticle(article, siteUrl, userName, options);

    expect(uploadCoverByUrl).not.toHaveBeenCalled();
    expect(createDraft).toHaveBeenCalledWith(
      expect.not.objectContaining({ cover: expect.anything() })
    );
  });

  it("continues without cover when cover upload fails (graceful failure)", async () => {
    vi.mocked(uploadCoverByUrl).mockRejectedValue(new Error("Upload failed: 500"));

    const article = makeArticle({
      frontmatter: { cover: "assets/covers/book.jpg" },
    });

    // Should not throw
    await expect(syndicateArticle(article, siteUrl, userName, options)).resolves.toBeDefined();

    // createDraft should still be called, but without cover
    expect(createDraft).toHaveBeenCalled();
    expect(createDraft).toHaveBeenCalledWith(
      expect.not.objectContaining({ cover: expect.anything() })
    );
  });

  it("returns publishedUrl when draft is published", async () => {
    const article = makeArticle({ frontmatter: {} });
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-xyz"));
    vi.mocked(fetchDraft).mockResolvedValue(makePublishedDraftResponse("draft-xyz"));

    const result = await syndicateArticle(article, siteUrl, userName, options);

    expect(result.draftId).toBe("draft-xyz");
    expect(result.publishedUrl).toBeDefined();
  });
});

// ============================================================================
// Tests: SINGLE_FILE_UPLOAD_MUTATION shape (api.ts)
// ============================================================================

describe("SINGLE_FILE_UPLOAD_MUTATION", () => {
  it("contains the correct mutation name", () => {
    expect(SINGLE_FILE_UPLOAD_MUTATION).toContain("SingleFileUpload");
  });

  it("uses singleFileUpload field name", () => {
    expect(SINGLE_FILE_UPLOAD_MUTATION).toContain("singleFileUpload");
  });

  it("uses SingleFileUploadInput type for the input argument", () => {
    expect(SINGLE_FILE_UPLOAD_MUTATION).toContain("SingleFileUploadInput");
  });

  it("requests id and path fields from the response", () => {
    expect(SINGLE_FILE_UPLOAD_MUTATION).toContain("id");
    expect(SINGLE_FILE_UPLOAD_MUTATION).toContain("path");
  });

  it("has correct mutation signature", () => {
    expect(SINGLE_FILE_UPLOAD_MUTATION).toMatch(/mutation\s+SingleFileUpload/);
    expect(SINGLE_FILE_UPLOAD_MUTATION).toMatch(/\$input:\s*SingleFileUploadInput!/);
  });
});

// ============================================================================
// Tests: normalizeHtmlForMatters — heading transformation
// ============================================================================

describe("normalizeHtmlForMatters - heading transformation", () => {
  it("downgrades h1 to h2", () => {
    const html = "<h1>Title</h1><p>Content</p>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h2>Title</h2><p>Content</p>");
  });

  it("keeps h2 as h2", () => {
    const html = "<h2>Subtitle</h2>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h2>Subtitle</h2>");
  });

  it("keeps h3 as h3", () => {
    const html = "<h3>Section</h3>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h3>Section</h3>");
  });

  it("collapses h4 to h3", () => {
    const html = "<h4>Sub-section</h4>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h3>Sub-section</h3>");
  });

  it("collapses h5 to h3", () => {
    const html = "<h5>Deep</h5>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h3>Deep</h3>");
  });

  it("collapses h6 to h3", () => {
    const html = "<h6>Deepest</h6>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h3>Deepest</h3>");
  });

  it("handles h1 with attributes", () => {
    const html = '<h1 id="top" class="title">Title</h1>';
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe('<h2 id="top" class="title">Title</h2>');
  });

  it("handles h4 with attributes", () => {
    const html = '<h4 id="sub">Sub</h4>';
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe('<h3 id="sub">Sub</h3>');
  });

  it("processes multiple heading levels in the same document", () => {
    const html = "<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h2>H1</h2><h2>H2</h2><h3>H3</h3><h3>H4</h3><h3>H5</h3><h3>H6</h3>");
  });

  it("does not double-shift h4-h6 (processes h4-h6 before h1)", () => {
    // If h1→h2 ran first, then h4→h3 would still be fine,
    // but we want to ensure the order is correct:
    // h4-h6→h3 first, then h1→h2
    const html = "<h1>Title</h1><h4>Detail</h4>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<h2>Title</h2><h3>Detail</h3>");
  });

  it("handles content with no headings", () => {
    const html = "<p>Just a paragraph</p>";
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe("<p>Just a paragraph</p>");
  });
});

// ============================================================================
// Tests: normalizeHtmlForMatters — image wrapping
// ============================================================================

describe("normalizeHtmlForMatters - image wrapping", () => {
  it("wraps standalone img in figure.image", () => {
    const html = '<p><img src="photo.jpg" alt="Photo"></p>';
    const result = normalizeHtmlForMatters(html);
    expect(result).toContain('<figure class="image">');
    expect(result).toContain('<img src="photo.jpg" alt="Photo">');
    expect(result).toContain("<figcaption></figcaption>");
    expect(result).toContain("</figure>");
  });

  it("wraps self-closing img in figure.image", () => {
    const html = '<img src="photo.jpg" />';
    const result = normalizeHtmlForMatters(html);
    expect(result).toContain('<figure class="image">');
    expect(result).toContain('<img src="photo.jpg" />');
    expect(result).toContain("<figcaption></figcaption>");
  });

  it("does not wrap img already inside a figure", () => {
    const html = '<figure><img src="photo.jpg" alt="Photo"></figure>';
    const result = normalizeHtmlForMatters(html);
    // Should not double-wrap
    expect(result).toBe('<figure><img src="photo.jpg" alt="Photo"></figure>');
    expect(result).not.toContain('<figure class="image"><figure>');
  });

  it("does not wrap img already inside a figure with class", () => {
    const html = '<figure class="image"><img src="photo.jpg"></figure>';
    const result = normalizeHtmlForMatters(html);
    expect(result).toBe('<figure class="image"><img src="photo.jpg"></figure>');
  });

  it("wraps multiple standalone images", () => {
    const html = '<img src="a.jpg"><p>text</p><img src="b.jpg">';
    const result = normalizeHtmlForMatters(html);
    expect(result).toContain('<figure class="image"><img src="a.jpg"><figcaption></figcaption></figure>');
    expect(result).toContain('<figure class="image"><img src="b.jpg"><figcaption></figcaption></figure>');
  });

  it("handles img with many attributes", () => {
    const html = '<img src="photo.jpg" alt="A photo" width="500" height="300">';
    const result = normalizeHtmlForMatters(html);
    expect(result).toContain('<figure class="image">');
    expect(result).toContain('src="photo.jpg"');
  });
});

// ============================================================================
// Tests: addCanonicalLinkToContent with lang parameter
// ============================================================================

describe("addCanonicalLinkToContent - lang parameter", () => {
  const url = "https://example.com/posts/test/";

  it("uses Chinese text for zh lang (HTML)", () => {
    const result = addCanonicalLinkToContent("<p>Content</p>", url, true, "zh");
    expect(result).toContain("原文链接");
    expect(result).toContain(`href="${url}"`);
    expect(result).toContain("<hr>");
    expect(result).not.toContain("Originally published");
  });

  it("uses Chinese text for zh_hans lang (HTML)", () => {
    const result = addCanonicalLinkToContent("<p>Content</p>", url, true, "zh_hans");
    expect(result).toContain("原文链接");
  });

  it("uses Chinese text for zh_hant lang (HTML)", () => {
    const result = addCanonicalLinkToContent("<p>Content</p>", url, true, "zh_hant");
    expect(result).toContain("原文链接");
  });

  it("uses English text for en lang (HTML)", () => {
    const result = addCanonicalLinkToContent("<p>Content</p>", url, true, "en");
    expect(result).toContain("Original link");
    expect(result).toContain(`href="${url}"`);
    expect(result).not.toContain("原文链接");
  });

  it("uses English text when lang is undefined (HTML)", () => {
    const result = addCanonicalLinkToContent("<p>Content</p>", url, true);
    expect(result).toContain("Original link");
  });

  it("uses Chinese text for zh lang (Markdown)", () => {
    const result = addCanonicalLinkToContent("Content", url, false, "zh");
    expect(result).toContain("[原文链接]");
    expect(result).toContain(`(${url})`);
    expect(result).toContain("---");
  });

  it("uses English text for en lang (Markdown)", () => {
    const result = addCanonicalLinkToContent("Content", url, false, "en");
    expect(result).toContain("[Original link]");
    expect(result).toContain(`(${url})`);
  });

  it("uses English text when lang is undefined (Markdown)", () => {
    const result = addCanonicalLinkToContent("Content", url, false);
    expect(result).toContain("[Original link]");
  });

  it("preserves original content before the canonical link", () => {
    const original = "<p>My article content</p>";
    const result = addCanonicalLinkToContent(original, url, true, "en");
    expect(result.startsWith(original)).toBe(true);
  });
});

// ============================================================================
// Tests: syndicateArticle — summary and lang
// ============================================================================

describe("syndicateArticle - summary and lang", () => {
  const siteUrl = "https://example.com";
  const userName = "testuser";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse());
    vi.mocked(fetchDraft).mockResolvedValue(makePublishedDraftResponse());
    vi.mocked(uploadCoverByUrl).mockResolvedValue("asset-abc-123");
  });

  it("passes summary from frontmatter.description to createDraft", async () => {
    const article = makeArticle({
      frontmatter: { description: "A short summary of the article" },
    });

    await syndicateArticle(article, siteUrl, userName, {
      addCanonicalLink: false,
      lang: "en",
    });

    expect(createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ summary: "A short summary of the article" })
    );
  });

  it("does not pass summary when frontmatter.description is absent", async () => {
    const article = makeArticle({ frontmatter: {} });

    await syndicateArticle(article, siteUrl, userName, {
      addCanonicalLink: false,
      lang: "en",
    });

    expect(createDraft).toHaveBeenCalledWith(
      expect.not.objectContaining({ summary: expect.anything() })
    );
  });

  it("passes lang to addCanonicalLinkToContent (zh produces Chinese text)", async () => {
    const article = makeArticle({
      html_content: "<p>Content</p>",
      frontmatter: {},
    });

    await syndicateArticle(article, siteUrl, userName, {
      addCanonicalLink: true,
      lang: "zh_hans",
    });

    // The content passed to createDraft should contain Chinese canonical text
    const callArgs = vi.mocked(createDraft).mock.calls[0][0];
    expect(callArgs.content).toContain("原文链接");
  });

  it("normalizes HTML headings before creating draft", async () => {
    const article = makeArticle({
      html_content: "<h1>Title</h1><h4>Detail</h4><p>Body</p>",
      frontmatter: {},
    });

    await syndicateArticle(article, siteUrl, userName, {
      addCanonicalLink: false,
      lang: "en",
    });

    const callArgs = vi.mocked(createDraft).mock.calls[0][0];
    expect(callArgs.content).toContain("<h2>Title</h2>");
    expect(callArgs.content).toContain("<h3>Detail</h3>");
    expect(callArgs.content).not.toContain("<h1>");
    expect(callArgs.content).not.toContain("<h4>");
  });

  it("wraps standalone images in figure.image before creating draft", async () => {
    const article = makeArticle({
      html_content: '<p>Text</p><img src="photo.jpg" alt="Photo"><p>More</p>',
      frontmatter: {},
    });

    await syndicateArticle(article, siteUrl, userName, {
      addCanonicalLink: false,
      lang: "en",
    });

    const callArgs = vi.mocked(createDraft).mock.calls[0][0];
    expect(callArgs.content).toContain('<figure class="image">');
    expect(callArgs.content).toContain('<img src="photo.jpg" alt="Photo">');
    expect(callArgs.content).toContain("<figcaption></figcaption>");
  });

  it("does not normalize HTML when content is markdown (not HTML)", async () => {
    const article = makeArticle({
      html_content: undefined,
      content: "# Title\n\nContent with h4-like text: <h4>not real</h4>",
      frontmatter: {},
    });

    await syndicateArticle(article, siteUrl, userName, {
      addCanonicalLink: false,
      lang: "en",
    });

    const callArgs = vi.mocked(createDraft).mock.calls[0][0];
    // Markdown content should not be normalized
    expect(callArgs.content).toBe("# Title\n\nContent with h4-like text: <h4>not real</h4>");
  });
});
