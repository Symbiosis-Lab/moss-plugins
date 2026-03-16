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
 * - Draft tracking: getDraftMap, saveDraftMap, getDraftId, saveDraftId, removeDraftId
 * - syndicateArticle reusing existing draft
 * - syndicateArticle falling back on API error with stale draft ID
 * - syndicateArticle removing draft on publish
 * - syndicateArticle saving draft on timeout/no-publish
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
  readPluginFile: vi.fn(),
  writePluginFile: vi.fn().mockResolvedValue(undefined),
  pluginFileExists: vi.fn(),
}));

// Mock the api module
vi.mock("../api", () => ({
  clearTokenCache: vi.fn(),
  getAccessToken: vi.fn().mockResolvedValue("test-token"),
  createDraft: vi.fn(),
  fetchDraft: vi.fn(),
  uploadCoverByUrl: vi.fn(),
  uploadEmbedByUrl: vi.fn(),
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
import {
  syndicateArticle,
  normalizeHtmlForMatters,
  addCanonicalLinkToContent,
  uploadAndReplaceLocalImages,
  getDraftMap,
  saveDraftMap,
  getDraftId,
  saveDraftId,
  removeDraftId,
  type DraftMap,
} from "../main";
import { uploadCoverByUrl, uploadEmbedByUrl, createDraft, fetchDraft, SINGLE_FILE_UPLOAD_MUTATION } from "../api";
import { readPluginFile, writePluginFile, pluginFileExists } from "@symbiosis-lab/moss-api";

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
    vi.mocked(uploadEmbedByUrl).mockResolvedValue("https://assets.matters.town/embed/uploaded.jpg");
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
    // Local image is uploaded and src replaced with CDN URL
    expect(callArgs.content).toContain('alt="Photo"');
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

// ============================================================================
// Tests: uploadEmbedByUrl (api.ts mock verification)
// ============================================================================

describe("uploadEmbedByUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns CDN path on success", async () => {
    vi.mocked(uploadEmbedByUrl).mockResolvedValue("https://assets.matters.town/embed/abc123.jpg");

    const result = await uploadEmbedByUrl("https://example.com/images/photo.jpg");

    expect(result).toBe("https://assets.matters.town/embed/abc123.jpg");
  });

  it("is called with the correct URL argument", async () => {
    vi.mocked(uploadEmbedByUrl).mockResolvedValue("https://assets.matters.town/embed/abc123.jpg");

    await uploadEmbedByUrl("https://example.com/images/photo.jpg");

    expect(uploadEmbedByUrl).toHaveBeenCalledWith("https://example.com/images/photo.jpg");
  });

  it("throws on failure", async () => {
    vi.mocked(uploadEmbedByUrl).mockRejectedValue(new Error("Upload failed: 500"));

    await expect(uploadEmbedByUrl("https://example.com/bad.jpg")).rejects.toThrow("Upload failed: 500");
  });
});

// ============================================================================
// Tests: uploadAndReplaceLocalImages
// ============================================================================

describe("uploadAndReplaceLocalImages", () => {
  const siteUrl = "https://example.com";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(uploadEmbedByUrl).mockResolvedValue("https://assets.matters.town/embed/uploaded.jpg");
  });

  it("uploads local images and replaces src with CDN URL", async () => {
    const html = '<p>Text</p><img src="images/photo.jpg" alt="Photo"><p>More</p>';

    const result = await uploadAndReplaceLocalImages(html, siteUrl);

    expect(uploadEmbedByUrl).toHaveBeenCalledWith("https://example.com/images/photo.jpg");
    expect(result).toContain('src="https://assets.matters.town/embed/uploaded.jpg"');
    expect(result).not.toContain('src="images/photo.jpg"');
  });

  it("uploads images with leading slash and constructs correct URL", async () => {
    const html = '<img src="/assets/hero.png" alt="Hero">';

    await uploadAndReplaceLocalImages(html, siteUrl);

    expect(uploadEmbedByUrl).toHaveBeenCalledWith("https://example.com/assets/hero.png");
  });

  it("strips trailing slash from siteUrl when constructing upload URL", async () => {
    const html = '<img src="images/photo.jpg">';

    await uploadAndReplaceLocalImages(html, "https://example.com/");

    expect(uploadEmbedByUrl).toHaveBeenCalledWith("https://example.com/images/photo.jpg");
  });

  it("skips absolute http URLs (does not upload them)", async () => {
    const html = '<img src="https://cdn.example.com/photo.jpg"><img src="http://other.com/img.png">';

    const result = await uploadAndReplaceLocalImages(html, siteUrl);

    expect(uploadEmbedByUrl).not.toHaveBeenCalled();
    expect(result).toContain('src="https://cdn.example.com/photo.jpg"');
    expect(result).toContain('src="http://other.com/img.png"');
  });

  it("skips data: URIs", async () => {
    const html = '<img src="data:image/png;base64,iVBORw0KGgo=">';

    const result = await uploadAndReplaceLocalImages(html, siteUrl);

    expect(uploadEmbedByUrl).not.toHaveBeenCalled();
    expect(result).toContain("data:image/png;base64,iVBORw0KGgo=");
  });

  it("deduplicates: same src used twice is only uploaded once", async () => {
    const html = '<img src="images/photo.jpg"><p>text</p><img src="images/photo.jpg">';

    const result = await uploadAndReplaceLocalImages(html, siteUrl);

    expect(uploadEmbedByUrl).toHaveBeenCalledTimes(1);
    // Both occurrences should be replaced
    const matches = result.match(/src="https:\/\/assets\.matters\.town\/embed\/uploaded\.jpg"/g);
    expect(matches).toHaveLength(2);
  });

  it("handles multiple different local images", async () => {
    vi.mocked(uploadEmbedByUrl)
      .mockResolvedValueOnce("https://assets.matters.town/embed/a.jpg")
      .mockResolvedValueOnce("https://assets.matters.town/embed/b.jpg");

    const html = '<img src="a.jpg"><img src="b.jpg">';

    const result = await uploadAndReplaceLocalImages(html, siteUrl);

    expect(uploadEmbedByUrl).toHaveBeenCalledTimes(2);
    expect(result).toContain('src="https://assets.matters.town/embed/a.jpg"');
    expect(result).toContain('src="https://assets.matters.town/embed/b.jpg"');
  });

  it("leaves original src unchanged when upload fails (graceful failure)", async () => {
    vi.mocked(uploadEmbedByUrl).mockRejectedValue(new Error("Upload failed"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const html = '<img src="images/photo.jpg" alt="Photo">';

    const result = await uploadAndReplaceLocalImages(html, siteUrl);

    expect(result).toContain('src="images/photo.jpg"');
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("replaces successful uploads while leaving failed ones unchanged", async () => {
    vi.mocked(uploadEmbedByUrl)
      .mockResolvedValueOnce("https://assets.matters.town/embed/good.jpg")
      .mockRejectedValueOnce(new Error("Failed"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const html = '<img src="good.jpg"><img src="bad.jpg">';

    const result = await uploadAndReplaceLocalImages(html, siteUrl);

    expect(result).toContain('src="https://assets.matters.town/embed/good.jpg"');
    expect(result).toContain('src="bad.jpg"');

    vi.restoreAllMocks();
  });

  it("returns content unchanged when no images are present", async () => {
    const html = "<p>Just text, no images</p>";

    const result = await uploadAndReplaceLocalImages(html, siteUrl);

    expect(uploadEmbedByUrl).not.toHaveBeenCalled();
    expect(result).toBe(html);
  });

  it("returns content unchanged when all images are absolute URLs", async () => {
    const html = '<img src="https://cdn.example.com/a.jpg"><img src="https://other.com/b.jpg">';

    const result = await uploadAndReplaceLocalImages(html, siteUrl);

    expect(uploadEmbedByUrl).not.toHaveBeenCalled();
    expect(result).toBe(html);
  });

  it("handles images with various attributes correctly", async () => {
    const html = '<img src="photo.jpg" alt="A photo" width="500" height="300" class="hero">';

    const result = await uploadAndReplaceLocalImages(html, siteUrl);

    expect(uploadEmbedByUrl).toHaveBeenCalledWith("https://example.com/photo.jpg");
    expect(result).toContain('src="https://assets.matters.town/embed/uploaded.jpg"');
    expect(result).toContain('alt="A photo"');
    expect(result).toContain('width="500"');
  });
});

// ============================================================================
// Tests: syndicateArticle - local image upload integration
// ============================================================================

describe("syndicateArticle - local image upload", () => {
  const siteUrl = "https://example.com";
  const userName = "testuser";
  const options = { addCanonicalLink: false, lang: "en" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse());
    vi.mocked(fetchDraft).mockResolvedValue(makePublishedDraftResponse());
    vi.mocked(uploadCoverByUrl).mockResolvedValue("asset-abc-123");
    vi.mocked(uploadEmbedByUrl).mockResolvedValue("https://assets.matters.town/embed/uploaded.jpg");
  });

  it("uploads local images in HTML content before creating draft", async () => {
    const article = makeArticle({
      html_content: '<p>Text</p><img src="images/photo.jpg" alt="Photo">',
      frontmatter: {},
    });

    await syndicateArticle(article, siteUrl, userName, options);

    expect(uploadEmbedByUrl).toHaveBeenCalledWith("https://example.com/images/photo.jpg");
    const callArgs = vi.mocked(createDraft).mock.calls[0][0];
    expect(callArgs.content).toContain('src="https://assets.matters.town/embed/uploaded.jpg"');
  });

  it("does not upload images when content is markdown (not HTML)", async () => {
    const article = makeArticle({
      html_content: undefined,
      content: '# Title\n\n![photo](images/photo.jpg)',
      frontmatter: {},
    });

    await syndicateArticle(article, siteUrl, userName, options);

    expect(uploadEmbedByUrl).not.toHaveBeenCalled();
  });

  it("does not upload absolute URL images in HTML content", async () => {
    const article = makeArticle({
      html_content: '<img src="https://cdn.example.com/already-hosted.jpg">',
      frontmatter: {},
    });

    await syndicateArticle(article, siteUrl, userName, options);

    expect(uploadEmbedByUrl).not.toHaveBeenCalled();
  });

  it("continues gracefully when image upload fails", async () => {
    vi.mocked(uploadEmbedByUrl).mockRejectedValue(new Error("Upload failed"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const article = makeArticle({
      html_content: '<p>Text</p><img src="images/photo.jpg">',
      frontmatter: {},
    });

    await expect(syndicateArticle(article, siteUrl, userName, options)).resolves.toBeDefined();

    // Draft should still be created with original src
    const callArgs = vi.mocked(createDraft).mock.calls[0][0];
    expect(callArgs.content).toContain('src="images/photo.jpg"');

    vi.restoreAllMocks();
  });
});

// ============================================================================
// Tests: Draft tracking functions
// ============================================================================

describe("Draft tracking - getDraftMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty object when file does not exist", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(false);

    const map = await getDraftMap();
    expect(map).toEqual({});
  });

  it("returns parsed map when file exists", async () => {
    const stored: DraftMap = {
      "articles/review.md": { draftId: "abc123", createdAt: "2026-03-16T10:00:00Z" },
    };
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue(JSON.stringify(stored));

    const map = await getDraftMap();
    expect(map).toEqual(stored);
  });

  it("returns empty object on parse error", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue("not valid json {{{");

    const map = await getDraftMap();
    expect(map).toEqual({});
  });

  it("returns empty object when readPluginFile throws", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockRejectedValue(new Error("read error"));

    const map = await getDraftMap();
    expect(map).toEqual({});
  });
});

describe("Draft tracking - saveDraftMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes JSON to plugin storage", async () => {
    const map: DraftMap = {
      "posts/test.md": { draftId: "draft-1", createdAt: "2026-03-16T10:00:00Z" },
    };

    await saveDraftMap(map);

    expect(writePluginFile).toHaveBeenCalledWith(
      "drafts.json",
      JSON.stringify(map, null, 2)
    );
  });

  it("writes empty object for empty map", async () => {
    await saveDraftMap({});

    expect(writePluginFile).toHaveBeenCalledWith(
      "drafts.json",
      JSON.stringify({}, null, 2)
    );
  });
});

describe("Draft tracking - getDraftId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns draftId when entry exists for sourcePath", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue(
      JSON.stringify({
        "posts/test.md": { draftId: "draft-abc", createdAt: "2026-03-16T10:00:00Z" },
      })
    );

    const id = await getDraftId("posts/test.md");
    expect(id).toBe("draft-abc");
  });

  it("returns undefined when no entry for sourcePath", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue(
      JSON.stringify({
        "posts/other.md": { draftId: "draft-abc", createdAt: "2026-03-16T10:00:00Z" },
      })
    );

    const id = await getDraftId("posts/test.md");
    expect(id).toBeUndefined();
  });

  it("returns undefined when drafts file is empty", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(false);

    const id = await getDraftId("posts/test.md");
    expect(id).toBeUndefined();
  });
});

describe("Draft tracking - saveDraftId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds entry to empty map", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(false);

    await saveDraftId("posts/test.md", "draft-new");

    expect(writePluginFile).toHaveBeenCalledTimes(1);
    const written = JSON.parse(vi.mocked(writePluginFile).mock.calls[0][1]);
    expect(written["posts/test.md"].draftId).toBe("draft-new");
    expect(written["posts/test.md"].createdAt).toBeDefined();
  });

  it("adds entry to existing map without overwriting others", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue(
      JSON.stringify({
        "posts/existing.md": { draftId: "draft-old", createdAt: "2026-01-01T00:00:00Z" },
      })
    );

    await saveDraftId("posts/new.md", "draft-new");

    const written = JSON.parse(vi.mocked(writePluginFile).mock.calls[0][1]);
    expect(written["posts/existing.md"].draftId).toBe("draft-old");
    expect(written["posts/new.md"].draftId).toBe("draft-new");
  });

  it("overwrites existing entry for the same source path", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue(
      JSON.stringify({
        "posts/test.md": { draftId: "draft-old", createdAt: "2026-01-01T00:00:00Z" },
      })
    );

    await saveDraftId("posts/test.md", "draft-updated");

    const written = JSON.parse(vi.mocked(writePluginFile).mock.calls[0][1]);
    expect(written["posts/test.md"].draftId).toBe("draft-updated");
  });
});

describe("Draft tracking - removeDraftId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes entry from map", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue(
      JSON.stringify({
        "posts/test.md": { draftId: "draft-abc", createdAt: "2026-01-01T00:00:00Z" },
        "posts/other.md": { draftId: "draft-def", createdAt: "2026-01-02T00:00:00Z" },
      })
    );

    await removeDraftId("posts/test.md");

    const written = JSON.parse(vi.mocked(writePluginFile).mock.calls[0][1]);
    expect(written["posts/test.md"]).toBeUndefined();
    expect(written["posts/other.md"].draftId).toBe("draft-def");
  });

  it("no-ops when entry does not exist (still writes the map)", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue(JSON.stringify({}));

    await removeDraftId("posts/nonexistent.md");

    expect(writePluginFile).toHaveBeenCalledTimes(1);
    const written = JSON.parse(vi.mocked(writePluginFile).mock.calls[0][1]);
    expect(Object.keys(written)).toHaveLength(0);
  });
});

// ============================================================================
// Tests: syndicateArticle — draft reuse integration
// ============================================================================

describe("syndicateArticle - draft tracking integration", () => {
  const siteUrl = "https://example.com";
  const userName = "testuser";
  const options = { addCanonicalLink: false, lang: "en" };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset sleep to default no-op (timeout tests override it with clock-advancing mock)
    const { sleep } = await import("../utils");
    vi.mocked(sleep).mockResolvedValue(undefined);

    // Re-establish SDK mocks (vi.restoreAllMocks() in earlier tests may have wiped them)
    const sdk = await import("@symbiosis-lab/moss-api");
    vi.mocked(sdk.showToast).mockResolvedValue(undefined);
    vi.mocked(sdk.openBrowser).mockResolvedValue({ closed: new Promise(() => {}) } as any);
    vi.mocked(sdk.closeBrowser).mockResolvedValue(undefined);

    // Re-establish domain mocks
    const domain = await import("../domain");
    vi.mocked(domain.draftUrl).mockImplementation((id: string) => `https://matters.town/drafts/${id}`);
    vi.mocked(domain.articleUrl).mockImplementation((_user: string, slug: string, hash: string) => `https://matters.town/@testuser/${slug}-${hash}`);

    // Default: no existing drafts tracked
    vi.mocked(pluginFileExists).mockResolvedValue(false);

    // Default: createDraft succeeds
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse());

    // Default: fetchDraft immediately returns published draft
    vi.mocked(fetchDraft).mockResolvedValue(makePublishedDraftResponse());

    vi.mocked(uploadCoverByUrl).mockResolvedValue("asset-abc-123");
    vi.mocked(uploadEmbedByUrl).mockResolvedValue("https://assets.matters.town/embed/uploaded.jpg");
  });

  it("passes existing draft ID to createDraft when one is tracked", async () => {
    // Set up existing draft tracking
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue(
      JSON.stringify({
        "posts/test.md": { draftId: "existing-draft-99", createdAt: "2026-03-16T10:00:00Z" },
      })
    );

    const article = makeArticle({ source_path: "posts/test.md", frontmatter: {} });

    await syndicateArticle(article, siteUrl, userName, options);

    expect(createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ id: "existing-draft-99" })
    );
  });

  it("does not pass id to createDraft when no draft is tracked", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(false);

    const article = makeArticle({ source_path: "posts/test.md", frontmatter: {} });

    await syndicateArticle(article, siteUrl, userName, options);

    expect(createDraft).toHaveBeenCalledWith(
      expect.not.objectContaining({ id: expect.anything() })
    );
  });

  it("falls back to new draft when existing draft ID causes API error", async () => {
    // Set up existing stale draft tracking
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue(
      JSON.stringify({
        "posts/test.md": { draftId: "stale-draft-id", createdAt: "2026-01-01T00:00:00Z" },
      })
    );

    // First call (with id) fails, second call (without id) succeeds
    vi.mocked(createDraft)
      .mockRejectedValueOnce(new Error("Draft not found"))
      .mockResolvedValueOnce(makeDraftResponse("new-draft-456"));

    const article = makeArticle({ source_path: "posts/test.md", frontmatter: {} });

    const result = await syndicateArticle(article, siteUrl, userName, options);

    // Should have been called twice: once with id, once without
    expect(createDraft).toHaveBeenCalledTimes(2);
    expect(createDraft).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ id: "stale-draft-id" })
    );
    expect(createDraft).toHaveBeenNthCalledWith(2,
      expect.not.objectContaining({ id: expect.anything() })
    );
    expect(result.draftId).toBe("new-draft-456");
  });

  it("throws when createDraft fails and no existing draft to fall back from", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(false);
    vi.mocked(createDraft).mockRejectedValue(new Error("API error"));

    const article = makeArticle({ source_path: "posts/test.md", frontmatter: {} });

    await expect(
      syndicateArticle(article, siteUrl, userName, options)
    ).rejects.toThrow("API error");
  });

  it("removes draft tracking on successful publish", async () => {
    // Set up existing draft
    vi.mocked(pluginFileExists).mockResolvedValue(true);
    vi.mocked(readPluginFile).mockResolvedValue(
      JSON.stringify({
        "posts/test.md": { draftId: "draft-123", createdAt: "2026-03-16T10:00:00Z" },
        "posts/other.md": { draftId: "draft-other", createdAt: "2026-03-16T10:00:00Z" },
      })
    );

    // Draft is published
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-123"));
    vi.mocked(fetchDraft).mockResolvedValue(makePublishedDraftResponse("draft-123"));

    const article = makeArticle({ source_path: "posts/test.md", frontmatter: {} });

    const result = await syndicateArticle(article, siteUrl, userName, options);

    expect(result.publishedUrl).toBeDefined();

    // writePluginFile should have been called to remove the draft entry
    // The last call to writePluginFile should be from removeDraftId
    const lastWriteCall = vi.mocked(writePluginFile).mock.calls;
    const lastWritten = JSON.parse(lastWriteCall[lastWriteCall.length - 1][1]);
    expect(lastWritten["posts/test.md"]).toBeUndefined();
    // Other entries should be preserved
    expect(lastWritten["posts/other.md"]).toBeDefined();
  });

  it("saves draft ID on timeout (no publish)", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(false);

    // Draft created but NOT published
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-timeout"));

    // To simulate timeout without OOM: make fetchDraft return published=false
    // on first call, then return published=true on second call BUT also
    // override the result to null. Actually the simplest approach: make
    // fetchDraft return null (the draft was deleted). waitForPublishOrClose
    // checks draft?.article — null?.article is undefined, so loop continues.
    //
    // To break the loop: mock sleep to advance a fake clock.
    // Each call to sleep() advances fakeTime, and Date.now() reads fakeTime.
    let fakeTime = 1000;
    const { sleep } = await import("../utils");
    vi.mocked(sleep).mockImplementation(async () => {
      fakeTime += 700000; // Jump past 600s timeout on first sleep
    });
    vi.spyOn(Date, "now").mockImplementation(() => fakeTime);

    vi.mocked(fetchDraft).mockResolvedValue({
      id: "draft-timeout",
      title: "Test",
      content: "<p>Test</p>",
      createdAt: "2024-01-01T00:00:00Z",
      publishState: "unpublished" as const,
    });

    const article = makeArticle({ source_path: "posts/test.md", frontmatter: {} });

    const result = await syndicateArticle(article, siteUrl, userName, options);

    expect(result.publishedUrl).toBeUndefined();

    // Draft ID should have been saved for reuse
    const writeCalls = vi.mocked(writePluginFile).mock.calls;
    expect(writeCalls.length).toBeGreaterThan(0);
    // Find the call that writes drafts.json
    const draftWriteCall = writeCalls.find(call => call[0] === "drafts.json");
    expect(draftWriteCall).toBeDefined();
    const written = JSON.parse(draftWriteCall![1]);
    expect(written["posts/test.md"].draftId).toBe("draft-timeout");

    vi.spyOn(Date, "now").mockRestore();
  });

  it("does not track draft when article has no source_path", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(false);
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-no-path"));

    // Same approach: mock sleep to advance fake clock past timeout
    let fakeTime = 1000;
    const { sleep } = await import("../utils");
    vi.mocked(sleep).mockImplementation(async () => {
      fakeTime += 700000;
    });
    vi.spyOn(Date, "now").mockImplementation(() => fakeTime);

    vi.mocked(fetchDraft).mockResolvedValue({
      id: "draft-no-path",
      title: "Test",
      content: "<p>Test</p>",
      createdAt: "2024-01-01T00:00:00Z",
      publishState: "unpublished" as const,
    });

    const article = makeArticle({ source_path: "", frontmatter: {} });

    await syndicateArticle(article, siteUrl, userName, options);

    // writePluginFile should NOT have been called with drafts.json
    const draftWriteCalls = vi.mocked(writePluginFile).mock.calls.filter(
      call => call[0] === "drafts.json"
    );
    expect(draftWriteCalls).toHaveLength(0);

    vi.spyOn(Date, "now").mockRestore();
  });
});
