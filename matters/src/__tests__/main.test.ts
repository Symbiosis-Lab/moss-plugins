/**
 * Tests for main.ts
 *
 * Covers:
 * - syndicateArticle uploads cover (bytes) when article.frontmatter.cover exists
 * - syndicateArticle skips cover upload when no cover in frontmatter
 * - syndicateArticle continues gracefully when cover upload fails
 * - siteRelativePathFromSrc path resolution and cross-origin/data-uri rejection
 * - imageMimeForPath / audioMimeForPath MIME mapping
 * - normalizeHtmlForMatters heading transformation and image pass-through
 * - addCanonicalLinkToContent with lang parameter
 * - syndicateArticle passing summary and lang
 * - Draft tracking: getDraftMap, saveDraftMap, getDraftId, saveDraftId, removeDraftId
 * - syndicateArticle reusing existing draft
 * - syndicateArticle falling back on API error with stale draft ID
 * - syndicateArticle removing draft on publish
 * - syndicateArticle saving draft on timeout/no-publish
 * - uploadAndReplaceLocalImages byte-upload flow
 * - uploadAndReplaceLocalAudio byte-upload flow
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ArticleInfo } from "../types";

// ============================================================================
// Mocks
// ============================================================================

// Mock @symbiosis-lab/moss-api before importing the modules under test
vi.mock("@symbiosis-lab/moss-api", () => ({
  getPluginCookie: vi.fn(),
  httpPost: vi.fn(),
  httpPostMultipart: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readSiteFile: vi.fn(),
  showToast: vi.fn().mockResolvedValue(undefined),
  openBrowser: vi.fn().mockResolvedValue({ closed: new Promise(() => {}) }),
  closeBrowser: vi.fn().mockResolvedValue(undefined),
  readPluginFile: vi.fn(),
  writePluginFile: vi.fn().mockResolvedValue(undefined),
  pluginFileExists: vi.fn(),
  // startTask mock — process hook needs a TaskHandle even when tests
  // only exercise syndicate helpers; keep it a no-op here.
  startTask: vi.fn().mockResolvedValue({
    id: "0",
    progress: vi.fn().mockResolvedValue(undefined),
    awaiting: vi.fn().mockResolvedValue(undefined),
    advise: vi.fn().mockResolvedValue(undefined),
    succeeded: vi.fn().mockResolvedValue(undefined),
    failed: vi.fn().mockResolvedValue(undefined),
    cancelled: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock the api module
vi.mock("../api", () => ({
  clearTokenCache: vi.fn(),
  getAccessToken: vi.fn().mockResolvedValue("test-token"),
  saveStoredToken: vi.fn().mockResolvedValue(undefined),
  loadStoredToken: vi.fn().mockResolvedValue(null),
  clearStoredToken: vi.fn().mockResolvedValue(undefined),
  createDraft: vi.fn(),
  fetchDraft: vi.fn(),
  uploadAssetMultipart: vi.fn(),
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
  wrapImagesForMatters,
  wrapAudioForMatters,
  stripArticleTitleH1,
  absolutizeRelativeHrefs,
  addCanonicalLinkToContent,
  uploadAndReplaceLocalImages,
  uploadAndReplaceLocalAudio,
  siteRelativePathFromSrc,
  imageMimeForPath,
  audioMimeForPath,
  waitForUrl,
  getDraftMap,
  saveDraftMap,
  getDraftId,
  saveDraftId,
  removeDraftId,
  type DraftMap,
} from "../main";
import { uploadAssetMultipart, createDraft, fetchDraft, SINGLE_FILE_UPLOAD_MUTATION } from "../api";
import { readSiteFile } from "@symbiosis-lab/moss-api";
import { readPluginFile, writePluginFile, pluginFileExists } from "@symbiosis-lab/moss-api";

// ============================================================================
// Global setup
// ============================================================================

// `waitForUrl` (used inside syndicateArticle and uploadAndReplaceLocalImages)
// polls fetch with HEAD until 2xx. Stub fetch globally so tests don't hit the
// network or burn the 60s default budget on every run.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200 } as unknown as Response),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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
// Shared task handle mock for syndicateArticle (Task M-2: threads task into
// syndicateArticle so per-article awaiting + advisory signals can reach L1)
// ============================================================================
//
// Deviation note (Blocker 2 — plan line 13):
// The plan listed main.test.ts as a modification target for:
//   (a) "assert showToast NOT called per-article"
//   (b) "timeout-advisory assertion"
// These invariants are fully covered by syndication-toast-law.test.ts
// (Law 1 + Law 2 describe blocks) which test exactly this on multi-article
// fixtures. Duplicating the assertion here would add noise without additional
// coverage — the invariant is tested in the dedicated law suite, not here.
// This is a deliberate deviation from the plan table's modification target.

const mockTask = {
  id: "0",
  progress: vi.fn().mockResolvedValue(undefined),
  awaiting: vi.fn().mockResolvedValue(undefined),
  advise: vi.fn().mockResolvedValue(undefined),
  succeeded: vi.fn().mockResolvedValue(undefined),
  failed: vi.fn().mockResolvedValue(undefined),
  cancelled: vi.fn().mockResolvedValue(undefined),
};

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

    // Default: readSiteFile returns fake base64 bytes, uploadAssetMultipart returns asset
    vi.mocked(readSiteFile).mockResolvedValue("ZmFrZQ==");
    vi.mocked(uploadAssetMultipart).mockResolvedValue({ id: "cover-asset-id-1", path: "https://assets.matters.news/cover/uploaded-cover.jpg" });
  });

  it("uploads cover bytes AFTER draft creation and updates draft with cover asset ID", async () => {
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-123"));

    const article = makeArticle({
      frontmatter: { cover: "assets/covers/book.jpg" },
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    // readSiteFile called with the site-relative path (leading slash stripped)
    expect(readSiteFile).toHaveBeenCalledWith("assets/covers/book.jpg");

    // uploadAssetMultipart called with correct type "cover" and entityId
    expect(uploadAssetMultipart).toHaveBeenCalledWith(
      expect.any(String),
      "book.jpg",
      "image/jpeg",
      "cover",
      "draft-123"
    );

    // First createDraft: without cover (draft doesn't exist yet)
    expect(createDraft).toHaveBeenNthCalledWith(1,
      expect.not.objectContaining({ cover: expect.anything() })
    );

    // Second createDraft: updates draft with cover asset ID (not path) AND preserves title
    expect(createDraft).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ id: "draft-123", cover: "cover-asset-id-1", title: "Test Article" })
    );
  });

  it("strips leading slash from cover path when reading site file", async () => {
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-123"));

    const article = makeArticle({
      frontmatter: { cover: "/assets/covers/hero.png" },
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    // Leading slash stripped for readSiteFile
    expect(readSiteFile).toHaveBeenCalledWith("assets/covers/hero.png");
    expect(uploadAssetMultipart).toHaveBeenCalledWith(
      expect.any(String),
      "hero.png",
      "image/png",
      "cover",
      "draft-123"
    );
  });

  it("skips cover upload and does not update draft when no cover in frontmatter", async () => {
    const article = makeArticle({ frontmatter: {} });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    // No cover upload at all
    expect(uploadAssetMultipart).not.toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(), "cover", expect.anything()
    );
    // Only one createDraft call (no cover update)
    expect(createDraft).toHaveBeenCalledTimes(1);
  });

  it("continues without cover when readSiteFile throws (graceful failure)", async () => {
    vi.mocked(readSiteFile).mockRejectedValueOnce(new Error("File not found"));
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-123"));

    const article = makeArticle({
      frontmatter: { cover: "assets/covers/book.jpg" },
    });

    // Should not throw
    await expect(syndicateArticle(article, siteUrl, userName, options, mockTask)).resolves.toBeDefined();

    // createDraft called only once (no cover update since upload failed)
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(createDraft).toHaveBeenCalledWith(
      expect.not.objectContaining({ cover: expect.anything() })
    );
  });

  it("continues without cover when uploadAssetMultipart throws (graceful failure)", async () => {
    vi.mocked(uploadAssetMultipart).mockRejectedValueOnce(new Error("Upload failed: 500"));
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-123"));

    const article = makeArticle({
      frontmatter: { cover: "assets/covers/book.jpg" },
    });

    // Should not throw
    await expect(syndicateArticle(article, siteUrl, userName, options, mockTask)).resolves.toBeDefined();

    // createDraft called only once (no cover update since upload failed)
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(createDraft).toHaveBeenCalledWith(
      expect.not.objectContaining({ cover: expect.anything() })
    );
  });

  it("returns publishedUrl when draft is published", async () => {
    const article = makeArticle({ frontmatter: {} });
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-xyz"));
    vi.mocked(fetchDraft).mockResolvedValue(makePublishedDraftResponse("draft-xyz"));

    const result = await syndicateArticle(article, siteUrl, userName, options, mockTask);

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
// Tests: stripArticleTitleH1
// ============================================================================

describe("stripArticleTitleH1", () => {
  it("strips moss-article-title h1 when text matches", () => {
    const html = '<h1 class="moss-article-title">My Title</h1><p>Body.</p>';
    expect(stripArticleTitleH1(html, "My Title")).toBe("<p>Body.</p>");
  });

  it("strips when class is one of several", () => {
    const html = '<h1 class="foo moss-article-title bar">My Title</h1><p>Body.</p>';
    expect(stripArticleTitleH1(html, "My Title")).toBe("<p>Body.</p>");
  });

  it("ignores h1 with the moss class but mismatched text (author-edited)", () => {
    const html = '<h1 class="moss-article-title">Different</h1>';
    expect(stripArticleTitleH1(html, "My Title")).toBe(html);
  });

  it("ignores plain h1 (no moss-article-title class)", () => {
    const html = '<h1>My Title</h1><p>Body.</p>';
    expect(stripArticleTitleH1(html, "My Title")).toBe(html);
  });

  it("ignores h2/h3 even when text matches and class is present", () => {
    const html = '<h2 class="moss-article-title">My Title</h2>';
    expect(stripArticleTitleH1(html, "My Title")).toBe(html);
  });

  it("tolerates inline tags inside the h1", () => {
    const html = '<h1 class="moss-article-title">My <em>fancy</em> Title</h1>';
    expect(stripArticleTitleH1(html, "My fancy Title")).toBe("");
  });

  it("collapses whitespace before comparing", () => {
    const html = '<h1 class="moss-article-title">  My\n  Title  </h1>';
    expect(stripArticleTitleH1(html, "My Title")).toBe("");
  });

  it("does not affect non-leading h1s on its own (multiple h1s case)", () => {
    // The strip is class-gated, so a body-internal plain <h1> survives.
    const html = '<h1 class="moss-article-title">My Title</h1><p>x</p><h1>Also Title</h1>';
    expect(stripArticleTitleH1(html, "My Title")).toBe('<p>x</p><h1>Also Title</h1>');
  });
});

// ============================================================================
// Tests: absolutizeRelativeHrefs
// ============================================================================

describe("absolutizeRelativeHrefs", () => {
  const baseUrl = "https://example.com/posts/foo/";

  it("resolves a deep-relative href against the article URL", () => {
    const html = '<a href="../../scale-compare.html">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(
      '<a href="https://example.com/scale-compare.html">link</a>',
    );
  });

  it("resolves a sibling-relative href", () => {
    const html = '<a href="other.html">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(
      '<a href="https://example.com/posts/foo/other.html">link</a>',
    );
  });

  it("resolves a root-relative href against the site origin", () => {
    const html = '<a href="/about/">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(
      '<a href="https://example.com/about/">link</a>',
    );
  });

  it("leaves http URLs untouched", () => {
    const html = '<a href="https://other.com/x">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(html);
  });

  it("leaves mailto: untouched", () => {
    const html = '<a href="mailto:a@b.com">email</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(html);
  });

  it("leaves fragment-only links untouched (intra-document)", () => {
    const html = '<a href="#section">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(html);
  });

  it("leaves protocol-relative URLs untouched", () => {
    const html = '<a href="//cdn.example.com/x.js">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(html);
  });

  it("preserves attributes around the href", () => {
    const html = '<a class="x" href="../foo.html" target="_blank" rel="noopener">link</a>';
    const result = absolutizeRelativeHrefs(html, baseUrl);
    expect(result).toContain('class="x"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener"');
    expect(result).toContain('href="https://example.com/posts/foo.html"');
  });

  it("handles multiple anchors in one document", () => {
    const html = '<a href="a.html">a</a><p>x</p><a href="../b.html">b</a>';
    const result = absolutizeRelativeHrefs(html, baseUrl);
    expect(result).toContain('href="https://example.com/posts/foo/a.html"');
    expect(result).toContain('href="https://example.com/posts/b.html"');
  });

  it("does not touch <img src> attributes", () => {
    const html = '<img src="../foo.gif">';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(html);
  });

  it("preserves &amp;-encoded query strings in resolved hrefs", () => {
    // moss-generated HTML uses HTML entities for & in attributes. Make sure
    // the regex captures and re-emits them unchanged so the resulting href
    // is still well-formed HTML.
    const html = '<a href="../foo?a=1&amp;b=2">link</a>';
    const result = absolutizeRelativeHrefs(html, baseUrl);
    expect(result).toContain('href="https://example.com/posts/foo?a=1&amp;b=2"');
  });

  it("leaves empty href untouched", () => {
    // The regex requires at least one character inside the quotes, so empty
    // hrefs fall through unchanged. That's the safer default — rewriting
    // empty hrefs to the article URL would silently turn a broken link into
    // a self-link, which is worse than leaving it broken.
    const html = '<a href="">link</a>';
    expect(absolutizeRelativeHrefs(html, baseUrl)).toBe(html);
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
// Tests: wrapImagesForMatters
// ============================================================================
//
// matters' server-side sanitizer requires images to be wrapped in
// `<figure class="image"><img src="..."><figcaption>...</figcaption></figure>`.
// Anything else (`<figure class="moss-image">`, `<picture>` standalone, bare
// `<img>`) gets stripped on draft storage. Empirically verified 2026-05-27
// via smoke test against `server.matters.icu`.
//
// `wrapImagesForMatters` is matters-specific — moss's emission stays as-is
// for the web; this transform only applies on the syndication path.

describe("wrapImagesForMatters", () => {
  it("wraps a bare img inside a <p> in figure.image", () => {
    const html = '<p><img src="photo.jpg" alt="Photo"></p>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><img src="photo.jpg" alt="Photo"><figcaption></figcaption></figure>',
    );
  });

  it("wraps a self-closing img alone in <p>", () => {
    const html = '<p><img src="photo.jpg" /></p>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><img src="photo.jpg" /><figcaption></figcaption></figure>',
    );
  });

  it("renames figure.moss-image → figure.image and adds empty figcaption when missing", () => {
    const html = '<figure class="moss-image"><img src="photo.jpg"></figure>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><img src="photo.jpg"><figcaption></figcaption></figure>',
    );
  });

  it("renames figure.moss-image → figure.image and preserves existing figcaption", () => {
    const html =
      '<figure class="moss-image"><img src="photo.jpg"><figcaption>A caption</figcaption></figure>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><img src="photo.jpg"><figcaption>A caption</figcaption></figure>',
    );
  });

  it("wraps standalone <picture> (variant pattern from moss raster output) in figure.image", () => {
    const html =
      '<picture><source srcset="photo.webp" type="image/webp"><img src="photo.jpg"></picture>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><picture><source srcset="photo.webp" type="image/webp"><img src="photo.jpg"></picture><figcaption></figcaption></figure>',
    );
  });

  it("hoists <p><picture></p> out of the <p> (figure-in-p is invalid HTML)", () => {
    const html =
      '<p><picture><source srcset="photo.webp"><img src="photo.jpg"></picture></p>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><picture><source srcset="photo.webp"><img src="photo.jpg"></picture><figcaption></figcaption></figure>',
    );
  });

  it("does not double-wrap <picture> that's already inside figure.image", () => {
    const html =
      '<figure class="moss-image"><picture><source srcset="photo.webp"><img src="photo.jpg"></picture><figcaption>Cap</figcaption></figure>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><picture><source srcset="photo.webp"><img src="photo.jpg"></picture><figcaption>Cap</figcaption></figure>',
    );
  });

  it("wraps multiple standalone images independently", () => {
    const html = '<p><img src="a.jpg"></p><p>text</p><p><img src="b.jpg"></p>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><img src="a.jpg"><figcaption></figcaption></figure>' +
        "<p>text</p>" +
        '<figure class="image"><img src="b.jpg"><figcaption></figcaption></figure>',
    );
  });

  it("leaves figure.image untouched (already in matters shape)", () => {
    const html =
      '<figure class="image"><img src="photo.jpg"><figcaption>cap</figcaption></figure>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<figure class="image"><img src="photo.jpg"><figcaption>cap</figcaption></figure>',
    );
  });

  it("wraps bare <img> between block elements", () => {
    const html = '<p>Before</p><img src="photo.jpg"><p>After</p>';
    const result = wrapImagesForMatters(html);
    expect(result).toBe(
      '<p>Before</p><figure class="image"><img src="photo.jpg"><figcaption></figcaption></figure><p>After</p>',
    );
  });
});

// ============================================================================
// Tests: wrapAudioForMatters
// ============================================================================
//
// moss emits audio as a bare `<audio class="moss-embed moss-embed-audio"
// controls preload="metadata"><source src="..." type="..."></audio>`. matters'
// server-side sanitizer STRIPS that shape entirely (the whole <audio> vanishes;
// only the fallback text leaks out as a stray <p>). Empirically verified
// 2026-06-16 against `server.matters.icu`: the only audio shape matters keeps is
//   <figure class="audio"><audio controls><source src="URL" type="MIME"></audio>
//   <figcaption>…</figcaption></figure>
// where (a) the URL MUST live on a <source> child (a `src` on <audio> itself is
// dropped), (b) a <figcaption> child is REQUIRED — its absence triggers a server
// error ("Cannot read properties of undefined (reading 'firstChild')"), empty is
// fine, and (c) matters keeps an EXTERNAL <source src> verbatim, so the audio can
// stream straight from the deployed site — no upload to matters is needed (and
// matters' `embedaudio` asset type rejects url-upload anyway).
//
// So this transform restructures moss's audio into matters' figure shape and
// absolutizes the <source src> against the article URL (same rule as
// absolutizeRelativeHrefs), so matters' player streams from the live site.

describe("wrapAudioForMatters", () => {
  const base = "https://example.com/posts/test/";

  it("wraps moss audio into figure.audio and absolutizes a relative src", () => {
    const html =
      '<audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="song.mp3" type="audio/mpeg">Your browser does not support the audio tag.</audio>';
    expect(wrapAudioForMatters(html, base)).toBe(
      '<figure class="audio"><audio controls><source src="https://example.com/posts/test/song.mp3" type="audio/mpeg"></audio><figcaption></figcaption></figure>',
    );
  });

  it("resolves deep-relative srcs against the article URL", () => {
    const html =
      '<audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="../assets/song.mp3" type="audio/mpeg">fallback</audio>';
    expect(wrapAudioForMatters(html, base)).toBe(
      '<figure class="audio"><audio controls><source src="https://example.com/posts/assets/song.mp3" type="audio/mpeg"></audio><figcaption></figcaption></figure>',
    );
  });

  it("leaves an already-absolute src unchanged", () => {
    const html =
      '<audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="https://cdn.example.com/a.mp3" type="audio/mpeg">x</audio>';
    expect(wrapAudioForMatters(html, base)).toBe(
      '<figure class="audio"><audio controls><source src="https://cdn.example.com/a.mp3" type="audio/mpeg"></audio><figcaption></figcaption></figure>',
    );
  });

  it("hoists audio out of a wrapping <p> (figure-in-p is invalid HTML)", () => {
    const html =
      '<p><audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="song.mp3" type="audio/mpeg">x</audio></p>';
    expect(wrapAudioForMatters(html, base)).toBe(
      '<figure class="audio"><audio controls><source src="https://example.com/posts/test/song.mp3" type="audio/mpeg"></audio><figcaption></figcaption></figure>',
    );
  });

  it("drops the <audio> fallback text (no leak into figcaption or siblings)", () => {
    const html =
      '<p>Before</p><audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="song.mp3" type="audio/mpeg">Your browser does not support the audio tag.</audio><p>After</p>';
    const result = wrapAudioForMatters(html, base);
    expect(result).not.toContain("does not support");
    expect(result).toBe(
      '<p>Before</p><figure class="audio"><audio controls><source src="https://example.com/posts/test/song.mp3" type="audio/mpeg"></audio><figcaption></figcaption></figure><p>After</p>',
    );
  });

  it("omits the type attr when moss emitted none", () => {
    const html =
      '<audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="song.mp3">x</audio>';
    expect(wrapAudioForMatters(html, base)).toBe(
      '<figure class="audio"><audio controls><source src="https://example.com/posts/test/song.mp3"></audio><figcaption></figcaption></figure>',
    );
  });

  it("wraps multiple audio embeds independently", () => {
    const html =
      '<audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="a.mp3" type="audio/mpeg">x</audio>' +
      "<p>mid</p>" +
      '<audio class="moss-embed moss-embed-audio" controls preload="metadata"><source src="b.wav" type="audio/wav">y</audio>';
    expect(wrapAudioForMatters(html, base)).toBe(
      '<figure class="audio"><audio controls><source src="https://example.com/posts/test/a.mp3" type="audio/mpeg"></audio><figcaption></figcaption></figure>' +
        "<p>mid</p>" +
        '<figure class="audio"><audio controls><source src="https://example.com/posts/test/b.wav" type="audio/wav"></audio><figcaption></figcaption></figure>',
    );
  });

  it("leaves content without audio untouched", () => {
    const html = "<h2>Title</h2><p>No audio here</p>";
    expect(wrapAudioForMatters(html, base)).toBe(html);
  });
});

// Also called via normalizeHtmlForMatters (the full pipeline)
describe("normalizeHtmlForMatters - image wrap (via pipeline)", () => {
  it("wraps a standalone img while leaving headings alone", () => {
    const html = '<h2>Title</h2><p><img src="photo.jpg"></p>';
    const result = normalizeHtmlForMatters(html);
    expect(result).toContain('<figure class="image"><img src="photo.jpg"><figcaption></figcaption></figure>');
    expect(result).toContain("<h2>Title</h2>");
  });

  it("downgrades h1 and wraps img in the same pass", () => {
    const html = '<h1>Title</h1><p><img src="photo.jpg"></p>';
    const result = normalizeHtmlForMatters(html);
    expect(result).toContain("<h2>Title</h2>");
    expect(result).toContain('<figure class="image"><img src="photo.jpg"><figcaption></figcaption></figure>');
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
    vi.mocked(readSiteFile).mockResolvedValue("ZmFrZQ==");
    vi.mocked(uploadAssetMultipart).mockResolvedValue({ id: "asset-id-1", path: "https://assets.matters.news/embed/uploaded.jpg" });
  });

  it("passes summary from frontmatter.description to createDraft", async () => {
    const article = makeArticle({
      frontmatter: { description: "A short summary of the article" },
    });

    await syndicateArticle(article, siteUrl, userName, {
      addCanonicalLink: false,
      lang: "en",
    }, mockTask);

    expect(createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ summary: "A short summary of the article" })
    );
  });

  it("does not pass summary when frontmatter.description is absent", async () => {
    const article = makeArticle({ frontmatter: {} });

    await syndicateArticle(article, siteUrl, userName, {
      addCanonicalLink: false,
      lang: "en",
    }, mockTask);

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
    }, mockTask);

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
    }, mockTask);

    const callArgs = vi.mocked(createDraft).mock.calls[0][0];
    expect(callArgs.content).toContain("<h2>Title</h2>");
    expect(callArgs.content).toContain("<h3>Detail</h3>");
    expect(callArgs.content).not.toContain("<h1>");
    expect(callArgs.content).not.toContain("<h4>");
  });

  it("wraps images in figure.image for matters compatibility", async () => {
    // matters' server-side sanitizer requires `<figure class="image">` with
    // a `<figcaption>` child or it strips the `<img>` entirely. Empirically
    // verified 2026-05-27. Phase 2A of the unified-image-emission migration
    // (2026-05-25) removed this wrap on the (incorrect) assumption that
    // moss's `<figure class="moss-image">` output would round-trip through
    // matters; it does not. So the plugin restores the wrap as a
    // matters-specific transform — moss-core's emission stays as-is.
    const article = makeArticle({
      html_content: '<p>Text</p><p><img src="photo.jpg" alt="Photo"></p><p>More</p>',
      frontmatter: {},
    });

    await syndicateArticle(article, siteUrl, userName, {
      addCanonicalLink: false,
      lang: "en",
    }, mockTask);

    const callArgs = vi.mocked(createDraft).mock.calls[0][0];
    expect(callArgs.content).toContain('<figure class="image">');
    expect(callArgs.content).toContain("<figcaption>");
    expect(callArgs.content).toContain('src="photo.jpg"');
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
    }, mockTask);

    const callArgs = vi.mocked(createDraft).mock.calls[0][0];
    // Markdown content should not be normalized
    expect(callArgs.content).toBe("# Title\n\nContent with h4-like text: <h4>not real</h4>");
  });
});

// ============================================================================
// Tests: siteRelativePathFromSrc
// ============================================================================

describe("siteRelativePathFromSrc", () => {
  const base = "https://liu-guo.com/posts/foo/";

  it("resolves a site-absolute src to a relative site path", () => {
    expect(siteRelativePathFromSrc("/image/x.jpg", "https://liu-guo.com/posts/foo/"))
      .toBe("image/x.jpg");
  });

  it("resolves a same-directory relative src", () => {
    expect(siteRelativePathFromSrc("photo.jpg", base)).toBe("posts/foo/photo.jpg");
  });

  it("resolves a parent-traversal relative src", () => {
    expect(siteRelativePathFromSrc("../a.jpg", "https://s.com/p/q/")).toBe("p/a.jpg");
  });

  it("resolves a deep-relative src (../../) against the article URL", () => {
    expect(siteRelativePathFromSrc("../../assets/x.gif", "https://example.com/writings/foo-bar/"))
      .toBe("assets/x.gif");
  });

  it("returns null for a data: URI", () => {
    expect(siteRelativePathFromSrc("data:image/png;base64,abc=", base)).toBeNull();
  });

  it("returns null for a cross-origin absolute URL", () => {
    expect(siteRelativePathFromSrc("https://other.com/x.jpg", base)).toBeNull();
  });

  it("returns null for a matters CDN URL (different origin)", () => {
    expect(siteRelativePathFromSrc("https://assets.matters.news/embed/abc.jpg", base)).toBeNull();
  });

  it("decodes percent-encoded pathname characters", () => {
    expect(siteRelativePathFromSrc("/%E5%9B%BE%E7%89%87/photo.png", "https://example.com/"))
      .toBe("图片/photo.png");
  });

  it("resolves same-origin absolute URL to its site path", () => {
    expect(siteRelativePathFromSrc("https://liu-guo.com/image/x.jpg", "https://liu-guo.com/posts/foo/"))
      .toBe("image/x.jpg");
  });
});

// ============================================================================
// Tests: imageMimeForPath
// ============================================================================

describe("imageMimeForPath", () => {
  it("maps .jpg to image/jpeg", () => {
    expect(imageMimeForPath("photo.jpg")).toBe("image/jpeg");
  });

  it("maps .jpeg to image/jpeg", () => {
    expect(imageMimeForPath("photo.jpeg")).toBe("image/jpeg");
  });

  it("maps .png to image/png", () => {
    expect(imageMimeForPath("cover.png")).toBe("image/png");
  });

  it("maps .webp to image/webp", () => {
    expect(imageMimeForPath("img.webp")).toBe("image/webp");
  });

  it("maps .gif to image/gif", () => {
    expect(imageMimeForPath("anim.gif")).toBe("image/gif");
  });

  it("maps .avif to image/avif", () => {
    expect(imageMimeForPath("photo.avif")).toBe("image/avif");
  });

  it("maps .svg to image/svg+xml", () => {
    expect(imageMimeForPath("icon.svg")).toBe("image/svg+xml");
  });

  it("returns application/octet-stream for unknown extensions", () => {
    expect(imageMimeForPath("file.bmp")).toBe("application/octet-stream");
  });
});

// ============================================================================
// Tests: audioMimeForPath
// ============================================================================

describe("audioMimeForPath", () => {
  it("maps .mp3 to audio/mpeg", () => {
    expect(audioMimeForPath("song.mp3")).toBe("audio/mpeg");
  });

  it("maps .wav to audio/wav", () => {
    expect(audioMimeForPath("sound.wav")).toBe("audio/wav");
  });

  it("maps .ogg to audio/ogg", () => {
    expect(audioMimeForPath("track.ogg")).toBe("audio/ogg");
  });

  it("maps .flac to audio/flac", () => {
    expect(audioMimeForPath("lossless.flac")).toBe("audio/flac");
  });

  it("maps .m4a to audio/mp4", () => {
    expect(audioMimeForPath("podcast.m4a")).toBe("audio/mp4");
  });

  it("maps .opus to audio/opus", () => {
    expect(audioMimeForPath("voice.opus")).toBe("audio/opus");
  });

  it("returns application/octet-stream for unknown extensions", () => {
    expect(audioMimeForPath("file.aiff")).toBe("application/octet-stream");
  });
});

// ============================================================================
// Tests: waitForUrl
// ============================================================================

describe("waitForUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns when fetch responds 2xx on first attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      waitForUrl("https://example.com/foo.gif", { totalMs: 1000, intervalMs: 50 }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/foo.gif", { method: "HEAD" });
  });

  it("retries while fetch returns 404, then succeeds when it goes 2xx", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 } as unknown as Response)
      .mockResolvedValueOnce({ ok: false, status: 404 } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      waitForUrl("https://example.com/late.gif", { totalMs: 5000, intervalMs: 10 }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws when budget elapses without a 2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      waitForUrl("https://example.com/never.gif", { totalMs: 60, intervalMs: 20 }),
    ).rejects.toThrow(/did not become reachable/);
  });
});

// ============================================================================
// Tests: uploadAndReplaceLocalImages
// ============================================================================

describe("uploadAndReplaceLocalImages", () => {
  const baseUrl = "https://example.com/posts/foo/";
  const entityId = "draft-test";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readSiteFile).mockResolvedValue("ZmFrZQ==");
    vi.mocked(uploadAssetMultipart).mockResolvedValue({
      id: "asset-id-1",
      path: "https://assets.matters.news/embed/uploaded.jpg",
    });
  });

  it("reads site file and uploads bytes, replaces src with CDN URL", async () => {
    const html = '<p>Text</p><img src="images/photo.jpg" alt="Photo"><p>More</p>';

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    expect(readSiteFile).toHaveBeenCalledWith("posts/foo/images/photo.jpg");
    expect(uploadAssetMultipart).toHaveBeenCalledWith(
      expect.any(String),
      "photo.jpg",
      "image/jpeg",
      "embed",
      entityId
    );
    expect(result).toContain('src="https://assets.matters.news/embed/uploaded.jpg"');
    expect(result).not.toContain('src="images/photo.jpg"');
  });

  it("resolves site-absolute src to correct site path", async () => {
    const html = '<img src="/assets/hero.png" alt="Hero">';

    await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    expect(readSiteFile).toHaveBeenCalledWith("assets/hero.png");
    expect(uploadAssetMultipart).toHaveBeenCalledWith(
      expect.any(String), "hero.png", "image/png", "embed", entityId
    );
  });

  it("leaves cross-origin absolute URLs unchanged (no upload)", async () => {
    const html = '<img src="https://cdn.example.com/photo.jpg"><img src="http://other.com/img.png">';

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    expect(uploadAssetMultipart).not.toHaveBeenCalled();
    expect(readSiteFile).not.toHaveBeenCalled();
    expect(result).toContain('src="https://cdn.example.com/photo.jpg"');
    expect(result).toContain('src="http://other.com/img.png"');
  });

  it("skips data: URIs (no upload, no replacement)", async () => {
    const html = '<img src="data:image/png;base64,iVBORw0KGgo=">';

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    expect(uploadAssetMultipart).not.toHaveBeenCalled();
    expect(result).toContain("data:image/png;base64,iVBORw0KGgo=");
  });

  it("deduplicates: same src used twice is only uploaded once", async () => {
    const html = '<img src="images/photo.jpg"><p>text</p><img src="images/photo.jpg">';

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    expect(uploadAssetMultipart).toHaveBeenCalledTimes(1);
    // Both occurrences should be replaced
    const matches = result.match(/src="https:\/\/assets\.matters\.news\/embed\/uploaded\.jpg"/g);
    expect(matches).toHaveLength(2);
  });

  it("handles multiple different local images", async () => {
    vi.mocked(uploadAssetMultipart)
      .mockResolvedValueOnce({ id: "id-a", path: "https://assets.matters.news/embed/a.jpg" })
      .mockResolvedValueOnce({ id: "id-b", path: "https://assets.matters.news/embed/b.jpg" });

    const html = '<img src="a.jpg"><img src="b.jpg">';

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    expect(uploadAssetMultipart).toHaveBeenCalledTimes(2);
    expect(result).toContain('src="https://assets.matters.news/embed/a.jpg"');
    expect(result).toContain('src="https://assets.matters.news/embed/b.jpg"');
  });

  it("falls back to absolutized deployed URL when upload fails (graceful failure)", async () => {
    vi.mocked(uploadAssetMultipart).mockRejectedValueOnce(new Error("Upload failed"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const html = '<img src="images/photo.jpg" alt="Photo">';

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    // Fallback: src becomes the absolutized deployed URL, not the original relative src
    expect(result).toContain('src="https://example.com/posts/foo/images/photo.jpg"');
    expect(result).not.toContain('src="images/photo.jpg"');
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("falls back to absolutized deployed URL when readSiteFile fails", async () => {
    vi.mocked(readSiteFile).mockRejectedValueOnce(new Error("File not found"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const html = '<img src="images/photo.jpg" alt="Photo">';

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    // Fallback: absolutized deployed URL
    expect(result).toContain('src="https://example.com/posts/foo/images/photo.jpg"');
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("replaces successful uploads while falling back on failed ones", async () => {
    vi.mocked(uploadAssetMultipart)
      .mockResolvedValueOnce({ id: "id-good", path: "https://assets.matters.news/embed/good.jpg" })
      .mockRejectedValueOnce(new Error("Failed"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const html = '<img src="good.jpg"><img src="bad.jpg">';

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    expect(result).toContain('src="https://assets.matters.news/embed/good.jpg"');
    // bad.jpg gets absolutized fallback URL
    expect(result).toContain('src="https://example.com/posts/foo/bad.jpg"');

    vi.restoreAllMocks();
  });

  it("returns content unchanged when no images are present", async () => {
    const html = "<p>Just text, no images</p>";

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    expect(uploadAssetMultipart).not.toHaveBeenCalled();
    expect(result).toBe(html);
  });

  it("returns content unchanged when all images are already-uploaded matters URLs (cross-origin)", async () => {
    const html = '<img src="https://assets.matters.news/embed/abc.jpg">';

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    expect(uploadAssetMultipart).not.toHaveBeenCalled();
    expect(readSiteFile).not.toHaveBeenCalled();
    // Cross-origin absolute URL stays exactly as-is
    expect(result).toBe(html);
  });

  it("preserves other attributes when replacing src", async () => {
    const html = '<img src="photo.jpg" alt="A photo" width="500" height="300" class="hero">';

    const result = await uploadAndReplaceLocalImages(html, baseUrl, entityId);

    expect(result).toContain('src="https://assets.matters.news/embed/uploaded.jpg"');
    expect(result).toContain('alt="A photo"');
    expect(result).toContain('width="500"');
  });
});

// ============================================================================
// Tests: uploadAndReplaceLocalAudio
// ============================================================================

describe("uploadAndReplaceLocalAudio", () => {
  // After wrapAudioForMatters, the <source src> is already an absolutized
  // deployed URL (e.g. "https://liu-guo.com/posts/foo/song.mp3"). The audio
  // upload step tries to read it from the local build and replace it with a
  // durable matters CDN URL; on failure the absolutized deployed URL stays.
  const baseUrl = "https://liu-guo.com/posts/foo/";
  const entityId = "draft-audio-test";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readSiteFile).mockResolvedValue("ZmFrZQ==");
    vi.mocked(uploadAssetMultipart).mockResolvedValue({
      id: "audio-asset-id",
      path: "https://assets.matters.news/embedaudio/uploaded.mp3",
    });
  });

  it("uploads audio bytes and replaces <source src> with CDN URL", async () => {
    const html =
      '<figure class="audio"><audio controls>' +
      '<source src="https://liu-guo.com/posts/foo/song.mp3" type="audio/mpeg">' +
      '</audio><figcaption></figcaption></figure>';

    const result = await uploadAndReplaceLocalAudio(html, baseUrl, entityId);

    expect(readSiteFile).toHaveBeenCalledWith("posts/foo/song.mp3");
    expect(uploadAssetMultipart).toHaveBeenCalledWith(
      expect.any(String),
      "song.mp3",
      "audio/mpeg",
      "embedaudio",
      entityId
    );
    expect(result).toContain('src="https://assets.matters.news/embedaudio/uploaded.mp3"');
    expect(result).not.toContain('src="https://liu-guo.com/posts/foo/song.mp3"');
  });

  it("leaves <source src> unchanged on upload error (deployed URL streams fine)", async () => {
    vi.mocked(uploadAssetMultipart).mockRejectedValueOnce(new Error("Upload failed"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const html =
      '<figure class="audio"><audio controls>' +
      '<source src="https://liu-guo.com/posts/foo/song.mp3" type="audio/mpeg">' +
      '</audio><figcaption></figcaption></figure>';

    const result = await uploadAndReplaceLocalAudio(html, baseUrl, entityId);

    // src stays unchanged — the deployed URL lets matters stream it
    expect(result).toContain('src="https://liu-guo.com/posts/foo/song.mp3"');

    vi.restoreAllMocks();
  });

  it("leaves <source src> unchanged on readSiteFile error", async () => {
    vi.mocked(readSiteFile).mockRejectedValueOnce(new Error("File not found"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const html =
      '<figure class="audio"><audio controls>' +
      '<source src="https://liu-guo.com/posts/foo/song.mp3" type="audio/mpeg">' +
      '</audio><figcaption></figcaption></figure>';

    const result = await uploadAndReplaceLocalAudio(html, baseUrl, entityId);

    expect(result).toContain('src="https://liu-guo.com/posts/foo/song.mp3"');

    vi.restoreAllMocks();
  });

  it("does NOT touch <img src> attributes — only matches <source>", async () => {
    const html =
      '<figure class="image"><img src="https://liu-guo.com/posts/foo/photo.jpg"></figure>' +
      '<figure class="audio"><audio controls>' +
      '<source src="https://liu-guo.com/posts/foo/song.mp3" type="audio/mpeg">' +
      '</audio><figcaption></figcaption></figure>';

    const result = await uploadAndReplaceLocalAudio(html, baseUrl, entityId);

    // img src is not changed
    expect(result).toContain('src="https://liu-guo.com/posts/foo/photo.jpg"');
    // source src is replaced
    expect(result).toContain('src="https://assets.matters.news/embedaudio/uploaded.mp3"');
    // readSiteFile only called once (for the audio, not the image)
    expect(readSiteFile).toHaveBeenCalledTimes(1);
    expect(readSiteFile).toHaveBeenCalledWith("posts/foo/song.mp3");
  });

  it("returns content unchanged when no <source> elements are present", async () => {
    const html = "<p>Just text, no audio</p>";

    const result = await uploadAndReplaceLocalAudio(html, baseUrl, entityId);

    expect(uploadAssetMultipart).not.toHaveBeenCalled();
    expect(result).toBe(html);
  });

  it("leaves cross-origin <source src> unchanged (external CDN audio)", async () => {
    const html =
      '<figure class="audio"><audio controls>' +
      '<source src="https://cdn.other.com/song.mp3" type="audio/mpeg">' +
      '</audio><figcaption></figcaption></figure>';

    const result = await uploadAndReplaceLocalAudio(html, baseUrl, entityId);

    // Cross-origin src → no upload, no change
    expect(readSiteFile).not.toHaveBeenCalled();
    expect(uploadAssetMultipart).not.toHaveBeenCalled();
    expect(result).toBe(html);
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
    vi.mocked(readSiteFile).mockResolvedValue("ZmFrZQ==");
    vi.mocked(uploadAssetMultipart).mockResolvedValue({
      id: "asset-id-1",
      path: "https://assets.matters.news/embed/uploaded.jpg",
    });
  });

  it("reads site file bytes and uploads AFTER draft creation with entityId, then re-puts draft", async () => {
    // Regression: Matters' singleFileUpload mutation requires `entityId` for
    // type:"embed", just as it does for cover. Uploading before the draft
    // exists fails with "Entity id needs to be specified.", leaving the body
    // <img> srcs as relative paths (which 404 inside matters.town).
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-123"));

    const article = makeArticle({
      html_content: '<p>Text</p><img src="images/photo.jpg" alt="Photo">',
      frontmatter: {},
      url_path: "posts/test/",
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    // readSiteFile called with the decoded site path resolved against the article URL
    expect(readSiteFile).toHaveBeenCalledWith("posts/test/images/photo.jpg");

    // uploadAssetMultipart called with embed type and the draft's entityId
    expect(uploadAssetMultipart).toHaveBeenCalledWith(
      expect.any(String),
      "photo.jpg",
      "image/jpeg",
      "embed",
      "draft-123"
    );

    // First putDraft: original content (still has the relative src — the
    // draft must exist before we have an entityId to upload against).
    expect(createDraft).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ content: expect.stringContaining('src="images/photo.jpg"') }),
    );

    // Second putDraft: rewrites content with CDN URLs, preserves title.
    expect(createDraft).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: "draft-123",
        title: "Test Article",
        content: expect.stringContaining('src="https://assets.matters.news/embed/uploaded.jpg"'),
      }),
    );
  });

  it("resolves deep-relative srcs (../../) against article path, not site root", async () => {
    // Regression: a post at /writings/foo-bar/ with `<img src="../../assets/x.gif">`
    // must read from assets/x.gif (resolved via parent traversal), not be
    // dropped/mis-resolved. Earlier code passed bare siteUrl as the base, so
    // `../../` clamped to root and the per-article directory was never used.
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-deep"));
    const article = makeArticle({
      html_content: '<img src="../../assets/scale-compare-recording.gif">',
      frontmatter: {},
      url_path: "writings/foo-bar/",
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    expect(readSiteFile).toHaveBeenCalledWith("assets/scale-compare-recording.gif");
    expect(uploadAssetMultipart).toHaveBeenCalledWith(
      expect.any(String),
      "scale-compare-recording.gif",
      expect.any(String),
      "embed",
      "draft-deep"
    );
  });

  it("does not upload images when content is markdown (not HTML)", async () => {
    const article = makeArticle({
      html_content: undefined,
      content: '# Title\n\n![photo](images/photo.jpg)',
      frontmatter: {},
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    expect(readSiteFile).not.toHaveBeenCalled();
    expect(uploadAssetMultipart).not.toHaveBeenCalled();
  });

  it("does not upload absolute cross-origin URL images in HTML content", async () => {
    const article = makeArticle({
      html_content: '<img src="https://cdn.example.com/already-hosted.jpg">',
      frontmatter: {},
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    expect(readSiteFile).not.toHaveBeenCalled();
    expect(uploadAssetMultipart).not.toHaveBeenCalled();
  });

  it("continues gracefully when image upload step throws — does not re-put draft with relative src", async () => {
    // When readSiteFile + uploadAssetMultipart both fail, the src becomes
    // the absolutized fallback URL (not the original relative one). No
    // re-put happens only when the rewritten content equals original content.
    vi.mocked(readSiteFile).mockRejectedValue(new Error("File not found"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const article = makeArticle({
      html_content: '<p>Text</p><img src="images/photo.jpg">',
      frontmatter: {},
      url_path: "posts/test/",
    });

    await expect(syndicateArticle(article, siteUrl, userName, options, mockTask)).resolves.toBeDefined();

    vi.restoreAllMocks();
  });

  it("continues gracefully when re-put after image upload throws (matches cover's failure semantics)", async () => {
    // Regression: a single 5xx on the embed re-put used to kill syndicateArticle,
    // skipping the toast/openBrowser path while the draft itself was already
    // created. Cover survives the same failure (try/catch around its block),
    // and embed should too — the user is still better off seeing the draft.
    vi.mocked(createDraft)
      .mockResolvedValueOnce(makeDraftResponse("draft-rep")) // first putDraft: ok
      .mockRejectedValueOnce(new Error("matters 503")) // re-put: fails
      .mockResolvedValue(makeDraftResponse("draft-rep")); // any later calls: ok
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const article = makeArticle({
      html_content: '<p>Text</p><img src="images/photo.jpg">',
      frontmatter: {},
    });

    await expect(syndicateArticle(article, siteUrl, userName, options, mockTask)).resolves.toBeDefined();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Asset upload step failed"),
    );

    vi.restoreAllMocks();
  });

  it("absolutizes relative <a href> links against the article URL", async () => {
    // Regression: matters.town serves whatever URL we send. Relative hrefs in
    // the draft (e.g. `../../scale-compare.html`) end up resolved against
    // matters.town/me/drafts/... and 404 every internal link from the source.
    const article = makeArticle({
      html_content: '<p>See <a href="../../scale-compare.html">the demo</a>.</p>',
      frontmatter: {},
      url_path: "writings/foo-bar/",
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    const draftContent = vi.mocked(createDraft).mock.calls[0][0].content!;
    expect(draftContent).toContain('href="https://example.com/scale-compare.html"');
    expect(draftContent).not.toContain('href="../../scale-compare.html"');
  });

  it("strips the moss-injected article-title h1 to avoid duplicating the matters title", async () => {
    // Regression: moss's pipeline auto-injects <h1 class="moss-article-title">
    // into html_content. matters.town has its own title field, so leaving the
    // h1 in the body shows the title twice in the published draft.
    const article = makeArticle({
      title: "My Title",
      html_content:
        '<h1 class="moss-article-title">My Title</h1><p>Body.</p>',
      frontmatter: {},
      url_path: "posts/test/",
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    const draftContent = vi.mocked(createDraft).mock.calls[0][0].content!;
    expect(draftContent).not.toContain('moss-article-title');
    // The matters title field carries the title.
    expect(vi.mocked(createDraft).mock.calls[0][0].title).toBe("My Title");
    // The first non-whitespace content should not be a title heading.
    expect(draftContent.trim().startsWith("<p>Body.</p>")).toBe(true);
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

    vi.mocked(readSiteFile).mockResolvedValue("ZmFrZQ==");
    vi.mocked(uploadAssetMultipart).mockResolvedValue({ id: "asset-id-1", path: "https://assets.matters.news/embed/uploaded.jpg" });
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

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    expect(createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ id: "existing-draft-99" })
    );
  });

  it("does not pass id to createDraft when no draft is tracked", async () => {
    vi.mocked(pluginFileExists).mockResolvedValue(false);

    const article = makeArticle({ source_path: "posts/test.md", frontmatter: {} });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

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

    const result = await syndicateArticle(article, siteUrl, userName, options, mockTask);

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
      syndicateArticle(article, siteUrl, userName, options, mockTask)
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

    const result = await syndicateArticle(article, siteUrl, userName, options, mockTask);

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

    const result = await syndicateArticle(article, siteUrl, userName, options, mockTask);

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

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    // writePluginFile should NOT have been called with drafts.json
    const draftWriteCalls = vi.mocked(writePluginFile).mock.calls.filter(
      call => call[0] === "drafts.json"
    );
    expect(draftWriteCalls).toHaveLength(0);

    vi.spyOn(Date, "now").mockRestore();
  });
});

// ============================================================================
// Tests: Cover path decoding for non-ASCII paths
// ============================================================================

describe("syndicateArticle - cover path decoding", () => {
  const siteUrl = "https://example.com";
  const userName = "testuser";
  const options = { addCanonicalLink: false, lang: "en" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse());
    vi.mocked(fetchDraft).mockResolvedValue(makePublishedDraftResponse());
    vi.mocked(readSiteFile).mockResolvedValue("ZmFrZQ==");
    vi.mocked(uploadAssetMultipart).mockResolvedValue({ id: "cover-id-1", path: "https://assets.matters.news/cover/cover.png" });
  });

  it("decodes percent-encoded Chinese characters in cover path for readSiteFile", async () => {
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-cn"));

    // frontmatter.cover may contain literal Chinese or percent-encoded chars
    const article = makeArticle({
      frontmatter: { cover: "%E5%9B%BE%E7%89%87/cover-image.png" },
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    // readSiteFile should receive the DECODED path (filesystem uses decoded chars)
    const readCall = vi.mocked(readSiteFile).mock.calls[0][0];
    expect(readCall).toBe("图片/cover-image.png");
    expect(readCall).not.toContain("%");
  });

  it("reads ASCII cover paths without modification", async () => {
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-ascii"));

    const article = makeArticle({
      frontmatter: { cover: "assets/covers/book.jpg" },
    });

    await syndicateArticle(article, siteUrl, userName, options, mockTask);

    expect(readSiteFile).toHaveBeenCalledWith("assets/covers/book.jpg");
    expect(uploadAssetMultipart).toHaveBeenCalledWith(
      expect.any(String),
      "book.jpg",
      "image/jpeg",
      "cover",
      "draft-ascii"
    );
  });
});

// ============================================================================
// Tests: uploadAndReplaceLocalImages — non-ASCII path decoding for readSiteFile
// ============================================================================

describe("uploadAndReplaceLocalImages - non-ASCII path decoding", () => {
  const baseUrl = "https://example.com/posts/foo/";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readSiteFile).mockResolvedValue("ZmFrZQ==");
    vi.mocked(uploadAssetMultipart).mockResolvedValue({ id: "id-1", path: "https://assets.matters.news/embed/uploaded.jpg" });
  });

  it("decodes percent-encoded Chinese characters in src for readSiteFile", async () => {
    // Browsers may percent-encode non-ASCII in src attributes; readSiteFile
    // needs the decoded filesystem path.
    const html = '<img src="%E5%9B%BE%E7%89%87/photo.png" alt="Photo">';

    await uploadAndReplaceLocalImages(html, baseUrl, "draft-cn");

    const readCall = vi.mocked(readSiteFile).mock.calls[0][0];
    expect(readCall).toContain("图片/photo.png");
    expect(readCall).not.toContain("%E5%9B%BE%E7%89%87");
  });

  it("passes literal Chinese src characters to readSiteFile decoded", async () => {
    // src may contain raw non-ASCII if the author typed it directly
    const html = '<img src="图片/photo.png" alt="Photo">';

    await uploadAndReplaceLocalImages(html, baseUrl, "draft-cn");

    const readCall = vi.mocked(readSiteFile).mock.calls[0][0];
    expect(readCall).toContain("图片/photo.png");
  });
});

// ============================================================================
// Tests: waitForPublishOrClose detects browser close
// ============================================================================

describe("syndicateArticle - browser close detection", () => {
  const siteUrl = "https://example.com";
  const userName = "testuser";
  const options = { addCanonicalLink: false, lang: "en" };

  beforeEach(async () => {
    vi.clearAllMocks();

    const { sleep } = await import("../utils");
    vi.mocked(sleep).mockResolvedValue(undefined);

    const sdk = await import("@symbiosis-lab/moss-api");
    vi.mocked(sdk.showToast).mockResolvedValue(undefined);
    vi.mocked(sdk.closeBrowser).mockResolvedValue(undefined);

    const domain = await import("../domain");
    vi.mocked(domain.draftUrl).mockImplementation((id: string) => `https://matters.town/drafts/${id}`);
    vi.mocked(domain.articleUrl).mockImplementation((_user: string, slug: string, hash: string) => `https://matters.town/@testuser/${slug}-${hash}`);

    vi.mocked(pluginFileExists).mockResolvedValue(false);
    vi.mocked(createDraft).mockResolvedValue(makeDraftResponse("draft-close-test"));
    vi.mocked(readSiteFile).mockResolvedValue("ZmFrZQ==");
    vi.mocked(uploadAssetMultipart).mockResolvedValue({ id: "asset-id-1", path: "https://assets.matters.news/embed/uploaded.jpg" });
  });

  it("exits immediately when browser is closed, saves draft for reuse", async () => {
    const sdk = await import("@symbiosis-lab/moss-api");

    // Simulate browser closing after first sleep call
    let resolveClose!: (reason: any) => void;
    const closedPromise = new Promise<any>((resolve) => { resolveClose = resolve; });
    vi.mocked(sdk.openBrowser).mockResolvedValue({ closed: closedPromise });

    // Draft never gets published (no article field)
    vi.mocked(fetchDraft).mockResolvedValue({
      id: "draft-close-test",
      title: "Test",
      content: "<p>Test</p>",
      createdAt: "2024-01-01T00:00:00Z",
      publishState: "unpublished" as const,
    });

    // Track how many times fetchDraft is polled.
    // Clock does NOT advance past timeout — so if waitForPublishOrClose
    // doesn't detect browser close, it will poll in an infinite loop.
    // We cap sleep calls to detect this.
    let sleepCallCount = 0;
    const MAX_SLEEP_CALLS = 5;
    const { sleep } = await import("../utils");
    vi.mocked(sleep).mockImplementation(async () => {
      sleepCallCount++;
      if (sleepCallCount === 1) {
        // Resolve browser close on first poll iteration
        resolveClose({ type: "user" });
        // Yield so the promise can settle
        await Promise.resolve();
        await Promise.resolve();
      }
      if (sleepCallCount > MAX_SLEEP_CALLS) {
        // Safety valve: prevent infinite loop in current (broken) code.
        // Force timeout by making Date.now() return a large value.
        vi.spyOn(Date, "now").mockReturnValue(Date.now() + 999999999);
      }
    });

    const article = makeArticle({ source_path: "posts/test.md", frontmatter: {} });

    const result = await syndicateArticle(article, siteUrl, userName, options, mockTask);

    // Should NOT have published (browser was closed)
    expect(result.publishedUrl).toBeUndefined();

    // Key assertion: browser close should stop polling after 1 sleep call.
    // If the code doesn't detect browser close, it will poll many times
    // until our safety valve kicks in at MAX_SLEEP_CALLS.
    expect(sleepCallCount).toBeLessThanOrEqual(2);

    // Draft ID should be saved for reuse
    const draftWriteCalls = vi.mocked(writePluginFile).mock.calls.filter(
      call => call[0] === "drafts.json"
    );
    expect(draftWriteCalls.length).toBeGreaterThan(0);
    const written = JSON.parse(draftWriteCalls[draftWriteCalls.length - 1][1]);
    expect(written["posts/test.md"].draftId).toBe("draft-close-test");
  });
});
