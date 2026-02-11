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
} from "../api";

// Mock the SDK's getPluginCookie
vi.mock("@symbiosis-lab/moss-api", async () => {
  const actual = await vi.importActual("@symbiosis-lab/moss-api");
  return {
    ...actual,
    getPluginCookie: vi.fn(),
  };
});

import { getPluginCookie } from "@symbiosis-lab/moss-api";

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
    expect(USER_PROFILE_QUERY).toContain("language");
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
