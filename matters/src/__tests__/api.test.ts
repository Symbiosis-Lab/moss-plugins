import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GRAPHQL_ENDPOINT,
  ARTICLES_QUERY,
  DRAFTS_QUERY,
  COLLECTIONS_QUERY,
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
} from "../api";

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
