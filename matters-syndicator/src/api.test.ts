import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GRAPHQL_ENDPOINT,
  ARTICLES_QUERY,
  DRAFTS_QUERY,
  COLLECTIONS_QUERY,
  clearTokenCache,
} from "./api";

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
