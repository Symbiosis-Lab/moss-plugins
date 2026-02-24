import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GRAPHQL_ENDPOINT,
  ARTICLES_QUERY,
  DRAFTS_QUERY,
  COLLECTIONS_QUERY,
  PROFILE_QUERY,
  ARTICLE_COMMENTS_QUERY,
  ARTICLE_DONATIONS_QUERY,
  ARTICLE_APPRECIATIONS_QUERY,
  PUT_DRAFT_MUTATION,
  PUT_COLLECTION_MUTATION,
  USER_ARTICLES_QUERY,
  USER_COLLECTIONS_QUERY,
  USER_PROFILE_QUERY,
  apiConfig,
  clearTokenCache,
  getAccessToken,
  fetchAllDraftsSince,
} from "../api";
import type { MattersDraft } from "../types";

// Mock the SDK's getPluginCookie and httpPost
vi.mock("@symbiosis-lab/moss-api", async () => {
  const actual = await vi.importActual("@symbiosis-lab/moss-api");
  return {
    ...actual,
    getPluginCookie: vi.fn(),
    httpPost: vi.fn(),
  };
});

import { getPluginCookie, httpPost } from "@symbiosis-lab/moss-api";

describe("API Constants", () => {
  it("has correct GraphQL endpoint", () => {
    expect(GRAPHQL_ENDPOINT).toBe("https://server.matters.town/graphql");
  });

  it("ARTICLES_QUERY includes required fields", () => {
    expect(ARTICLES_QUERY).toContain("MePublishedArticles");
    expect(ARTICLES_QUERY).toContain("articles");
    expect(ARTICLES_QUERY).toContain("title");
    expect(ARTICLES_QUERY).toContain("content");
    expect(ARTICLES_QUERY).toContain("shortHash");
    expect(ARTICLES_QUERY).toContain("pageInfo");
  });

  it("DRAFTS_QUERY includes required fields", () => {
    expect(DRAFTS_QUERY).toContain("MeDrafts");
    expect(DRAFTS_QUERY).toContain("drafts");
    expect(DRAFTS_QUERY).toContain("title");
    expect(DRAFTS_QUERY).toContain("content");
  });

  it("COLLECTIONS_QUERY includes required fields", () => {
    expect(COLLECTIONS_QUERY).toContain("MeCollections");
    expect(COLLECTIONS_QUERY).toContain("collections");
    expect(COLLECTIONS_QUERY).toContain("articles");
  });
});

describe("clearTokenCache", () => {
  it("clears the token cache without error", () => {
    expect(() => clearTokenCache()).not.toThrow();
  });
});

// Note: Integration tests for graphqlQuery, fetchAllArticles, etc. would require
// mocking the global fetch and window.__TAURI__ objects. These are better suited
// for integration tests with a proper test harness.

describe("GraphQL Query Structure", () => {
  it("ARTICLES_QUERY requests pagination with 50 items", () => {
    expect(ARTICLES_QUERY).toContain("first: 50");
  });

  it("DRAFTS_QUERY requests pagination with 50 items", () => {
    expect(DRAFTS_QUERY).toContain("first: 50");
  });

  it("COLLECTIONS_QUERY requests pagination with 50 items", () => {
    expect(COLLECTIONS_QUERY).toContain("first: 50");
  });

  it("COLLECTIONS_QUERY requests up to 100 articles per collection", () => {
    expect(COLLECTIONS_QUERY).toContain("first: 100");
  });

  it("ARTICLES_QUERY filters by active state", () => {
    expect(ARTICLES_QUERY).toContain("state: active");
  });
});

describe("Social Data Queries", () => {
  it("ARTICLE_COMMENTS_QUERY includes required fields", () => {
    expect(ARTICLE_COMMENTS_QUERY).toContain("ArticleComments");
    expect(ARTICLE_COMMENTS_QUERY).toContain("comments");
    expect(ARTICLE_COMMENTS_QUERY).toContain("shortHash");
    expect(ARTICLE_COMMENTS_QUERY).toContain("content");
    expect(ARTICLE_COMMENTS_QUERY).toContain("createdAt");
    expect(ARTICLE_COMMENTS_QUERY).toContain("author");
    expect(ARTICLE_COMMENTS_QUERY).toContain("replyTo");
  });

  it("ARTICLE_DONATIONS_QUERY includes required fields", () => {
    expect(ARTICLE_DONATIONS_QUERY).toContain("ArticleDonations");
    expect(ARTICLE_DONATIONS_QUERY).toContain("donations");
    expect(ARTICLE_DONATIONS_QUERY).toContain("shortHash");
    expect(ARTICLE_DONATIONS_QUERY).toContain("sender");
    expect(ARTICLE_DONATIONS_QUERY).toContain("userName");
  });

  it("ARTICLE_APPRECIATIONS_QUERY includes required fields", () => {
    expect(ARTICLE_APPRECIATIONS_QUERY).toContain("ArticleAppreciations");
    expect(ARTICLE_APPRECIATIONS_QUERY).toContain("appreciationsReceived");
    expect(ARTICLE_APPRECIATIONS_QUERY).toContain("shortHash");
    expect(ARTICLE_APPRECIATIONS_QUERY).toContain("amount");
    expect(ARTICLE_APPRECIATIONS_QUERY).toContain("sender");
  });

  it("Social queries use pagination with 50 items", () => {
    expect(ARTICLE_COMMENTS_QUERY).toContain("first: 50");
    expect(ARTICLE_DONATIONS_QUERY).toContain("first: 50");
    expect(ARTICLE_APPRECIATIONS_QUERY).toContain("first: 50");
  });
});

describe("Syndication Mutations", () => {
  it("PUT_DRAFT_MUTATION includes required fields", () => {
    expect(PUT_DRAFT_MUTATION).toContain("PutDraft");
    expect(PUT_DRAFT_MUTATION).toContain("putDraft");
    expect(PUT_DRAFT_MUTATION).toContain("PutDraftInput");
    expect(PUT_DRAFT_MUTATION).toContain("id");
    expect(PUT_DRAFT_MUTATION).toContain("title");
    expect(PUT_DRAFT_MUTATION).toContain("publishState");
    expect(PUT_DRAFT_MUTATION).toContain("article");
  });

  it("PUT_COLLECTION_MUTATION includes required fields", () => {
    expect(PUT_COLLECTION_MUTATION).toContain("PutCollection");
    expect(PUT_COLLECTION_MUTATION).toContain("putCollection");
    expect(PUT_COLLECTION_MUTATION).toContain("PutCollectionInput");
    expect(PUT_COLLECTION_MUTATION).toContain("id");
    expect(PUT_COLLECTION_MUTATION).toContain("title");
  });
});

describe("User Queries (Public)", () => {
  it("USER_ARTICLES_QUERY includes required fields", () => {
    expect(USER_ARTICLES_QUERY).toContain("UserArticles");
    expect(USER_ARTICLES_QUERY).toContain("$userName: String!");
    expect(USER_ARTICLES_QUERY).toContain("articles");
    expect(USER_ARTICLES_QUERY).toContain("shortHash");
    expect(USER_ARTICLES_QUERY).toContain("createdAt");
    expect(USER_ARTICLES_QUERY).toContain("revisedAt");
  });

  it("USER_COLLECTIONS_QUERY includes required fields", () => {
    expect(USER_COLLECTIONS_QUERY).toContain("UserCollections");
    expect(USER_COLLECTIONS_QUERY).toContain("$userName: String!");
    expect(USER_COLLECTIONS_QUERY).toContain("collections");
    expect(USER_COLLECTIONS_QUERY).toContain("articles");
  });

  it("USER_PROFILE_QUERY includes required fields", () => {
    expect(USER_PROFILE_QUERY).toContain("UserProfile");
    expect(USER_PROFILE_QUERY).toContain("$userName: String!");
    expect(USER_PROFILE_QUERY).toContain("displayName");
    expect(USER_PROFILE_QUERY).toContain("avatar");
  });

  it("USER_PROFILE_QUERY does NOT include settings (private field)", () => {
    // settings { language } is a private field that causes authorization errors
    // for unauthenticated public user queries
    expect(USER_PROFILE_QUERY).not.toMatch(/settings\s*\{/);
  });
});

describe("Pinned Works in Profile Queries", () => {
  it("PROFILE_QUERY includes pinnedWorks with inline fragments", () => {
    expect(PROFILE_QUERY).toContain("pinnedWorks");
    expect(PROFILE_QUERY).toContain("... on Article");
    expect(PROFILE_QUERY).toContain("slug");
    expect(PROFILE_QUERY).toContain("shortHash");
  });

  it("USER_PROFILE_QUERY includes pinnedWorks with inline fragments", () => {
    expect(USER_PROFILE_QUERY).toContain("pinnedWorks");
    expect(USER_PROFILE_QUERY).toContain("... on Article");
    expect(USER_PROFILE_QUERY).toContain("slug");
    expect(USER_PROFILE_QUERY).toContain("shortHash");
  });
});

describe("getAccessToken", () => {
  const mockGetPluginCookie = vi.mocked(getPluginCookie);

  beforeEach(() => {
    clearTokenCache();
    mockGetPluginCookie.mockReset();
  });

  it("returns undefined when getPluginCookie returns null (no context)", async () => {
    // null means "no plugin context" - distinct from "no cookies found"
    mockGetPluginCookie.mockResolvedValue(null);

    const result = await getAccessToken();

    expect(result).toBeUndefined();
  });

  it("returns null when cookies array is empty (no token found)", async () => {
    mockGetPluginCookie.mockResolvedValue([]);

    const result = await getAccessToken();

    expect(result).toBeNull();
  });

  it("returns null when __access_token cookie is not present", async () => {
    mockGetPluginCookie.mockResolvedValue([
      { name: "other_cookie", value: "some_value" },
    ]);

    const result = await getAccessToken();

    expect(result).toBeNull();
  });

  it("returns token value when __access_token cookie is present", async () => {
    mockGetPluginCookie.mockResolvedValue([
      { name: "__access_token", value: "my-secret-token" },
    ]);

    const result = await getAccessToken();

    expect(result).toBe("my-secret-token");
  });

  it("caches the token after first successful retrieval", async () => {
    mockGetPluginCookie.mockResolvedValue([
      { name: "__access_token", value: "cached-token" },
    ]);

    // First call
    const result1 = await getAccessToken();
    expect(result1).toBe("cached-token");

    // Second call should use cache (won't call getPluginCookie again)
    mockGetPluginCookie.mockResolvedValue([
      { name: "__access_token", value: "different-token" },
    ]);
    const result2 = await getAccessToken();

    expect(result2).toBe("cached-token");
    expect(mockGetPluginCookie).toHaveBeenCalledTimes(1);
  });

  it("clearTokenCache allows fresh retrieval", async () => {
    mockGetPluginCookie.mockResolvedValue([
      { name: "__access_token", value: "first-token" },
    ]);

    await getAccessToken();
    clearTokenCache();

    mockGetPluginCookie.mockResolvedValue([
      { name: "__access_token", value: "second-token" },
    ]);

    const result = await getAccessToken();

    expect(result).toBe("second-token");
    expect(mockGetPluginCookie).toHaveBeenCalledTimes(2);
  });
});

describe("API Configuration", () => {
  it("has default endpoint for production", () => {
    expect(apiConfig.endpoint).toBe("https://server.matters.town/graphql");
  });

  it("has default queryMode as viewer", () => {
    expect(apiConfig.queryMode).toBe("viewer");
  });

  it("has default testUserName", () => {
    expect(apiConfig.testUserName).toBeDefined();
  });

  it("allows endpoint to be changed", () => {
    const originalEndpoint = apiConfig.endpoint;
    apiConfig.endpoint = "https://server.matters.icu/graphql";
    expect(apiConfig.endpoint).toBe("https://server.matters.icu/graphql");
    apiConfig.endpoint = originalEndpoint; // Reset
  });

  it("allows queryMode to be changed", () => {
    const originalMode = apiConfig.queryMode;
    apiConfig.queryMode = "user";
    expect(apiConfig.queryMode).toBe("user");
    apiConfig.queryMode = originalMode; // Reset
  });
});

describe("fetchAllDraftsSince", () => {
  const mockGetPluginCookie = vi.mocked(getPluginCookie);
  const mockHttpPost = vi.mocked(httpPost);

  // Sample drafts with different creation dates
  const sampleDrafts: MattersDraft[] = [
    {
      id: "draft-1",
      title: "Old Draft",
      content: "<p>Old content</p>",
      createdAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "draft-2",
      title: "Mid Draft",
      content: "<p>Mid content</p>",
      summary: "A mid-period draft",
      createdAt: "2024-06-15T12:00:00Z",
      tags: ["test"],
    },
    {
      id: "draft-3",
      title: "Recent Draft",
      content: "<p>Recent content</p>",
      createdAt: "2025-01-10T08:30:00Z",
      cover: "https://example.com/cover.jpg",
    },
  ];

  /**
   * Helper: build a mock httpPost response that returns a single page of drafts.
   * Mimics the GraphQL response shape for ViewerDraftsResponse.
   */
  function mockDraftsResponse(drafts: MattersDraft[]) {
    const responseBody = JSON.stringify({
      data: {
        viewer: {
          id: "viewer-1",
          drafts: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: drafts.map((d) => ({ node: d })),
          },
        },
      },
    });
    return {
      status: 200,
      ok: true,
      contentType: "application/json",
      body: new Uint8Array(),
      text: () => responseBody,
    };
  }

  beforeEach(() => {
    clearTokenCache();
    mockGetPluginCookie.mockReset();
    mockHttpPost.mockReset();

    // Default: authenticated with a valid token
    mockGetPluginCookie.mockResolvedValue([
      { name: "__access_token", value: "test-token" },
    ]);

    // Default: return all sample drafts
    mockHttpPost.mockResolvedValue(mockDraftsResponse(sampleDrafts));
  });

  it("returns all drafts when no since parameter is provided", async () => {
    const result = await fetchAllDraftsSince();

    expect(result).toHaveLength(3);
    expect(result.map((d) => d.id)).toEqual(["draft-1", "draft-2", "draft-3"]);
  });

  it("filters drafts by createdAt > since when since is provided", async () => {
    // since is between draft-1 (2024-01-01) and draft-2 (2024-06-15)
    const result = await fetchAllDraftsSince("2024-03-01T00:00:00Z");

    // draft-2 and draft-3 are after the since date
    expect(result).toHaveLength(2);
    const ids = result.map((d) => d.id);
    expect(ids).toContain("draft-2");
    expect(ids).toContain("draft-3");
    expect(ids).not.toContain("draft-1");
  });

  it("returns empty array when all drafts are before since", async () => {
    // since is in the future, so no drafts should match
    const result = await fetchAllDraftsSince("2026-01-01T00:00:00Z");

    expect(result).toHaveLength(0);
    expect(result).toEqual([]);
  });

  it("excludes draft with exact createdAt === since (strict >)", async () => {
    // Use the exact createdAt of draft-2 as the since timestamp
    const result = await fetchAllDraftsSince("2024-06-15T12:00:00Z");

    // draft-2 has createdAt exactly equal to since, so it must be excluded
    const ids = result.map((d) => d.id);
    expect(ids).not.toContain("draft-2");

    // Only draft-3 is strictly after
    expect(result).toHaveLength(1);
    expect(ids).toContain("draft-3");
  });
});
