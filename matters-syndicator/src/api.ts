/**
 * GraphQL API client and authentication for Matters.town
 *
 * Supports two query modes:
 * - "viewer" (production): Uses authenticated viewer queries
 * - "user" (testing): Uses public user queries (no auth required)
 *
 * Configure via environment variables or apiConfig:
 * - MATTERS_API_ENDPOINT: GraphQL endpoint URL
 * - MATTERS_QUERY_MODE: "viewer" or "user"
 * - MATTERS_TEST_USER: Username for user queries in tests
 */

import type {
  MattersArticle,
  MattersDraft,
  MattersCollection,
  MattersUserProfile,
  ViewerArticlesResponse,
  ViewerDraftsResponse,
  ViewerCollectionsResponse,
  ViewerProfileResponse,
} from "./types";
import type {
  UserArticlesQuery,
  UserCollectionsQuery,
  UserProfileQuery,
} from "./__generated__/types";
import { log } from "./utils";
import { getPluginCookie } from "@symbiosis-lab/moss-api";

// ============================================================================
// Configuration
// ============================================================================

/** Get environment variable safely (works in both Node and browser) */
function getEnv(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
  return undefined;
}

/** API configuration - can be modified for testing */
export const apiConfig = {
  /** GraphQL endpoint URL */
  endpoint: getEnv("MATTERS_API_ENDPOINT") || "https://server.matters.town/graphql",
  /** Query mode: "viewer" (requires auth) or "user" (public, for testing) */
  queryMode: (getEnv("MATTERS_QUERY_MODE") || "viewer") as "viewer" | "user",
  /** Username for user queries in test mode */
  testUserName: getEnv("MATTERS_TEST_USER") || "Matty",
};

/** @deprecated Use apiConfig.endpoint instead */
export const GRAPHQL_ENDPOINT = "https://server.matters.town/graphql";

// ============================================================================
// GraphQL Queries
// ============================================================================

export const ARTICLES_QUERY = `
query MePublishedArticles($after: String) {
  viewer {
    id
    userName
    articles(input: { first: 50, after: $after, filter: { state: active } }) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          title
          slug
          shortHash
          content
          summary
          createdAt
          revisedAt
          tags {
            id
            content
          }
          cover
        }
      }
    }
  }
}
`;

export const DRAFTS_QUERY = `
query MeDrafts($after: String) {
  viewer {
    id
    drafts(input: { first: 50, after: $after }) {
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          title
          content
          summary
          createdAt
          updatedAt
          tags
          cover
        }
      }
    }
  }
}
`;

export const COLLECTIONS_QUERY = `
query MeCollections($after: String) {
  viewer {
    id
    collections(input: { first: 50, after: $after }) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          title
          description
          cover
          articles(input: { first: 100 }) {
            edges {
              node {
                id
                shortHash
                title
                slug
              }
            }
          }
        }
      }
    }
  }
}
`;

export const PROFILE_QUERY = `
query MeProfile {
  viewer {
    id
    userName
    displayName
    info {
      description
      profileCover
    }
    avatar
    settings {
      language
    }
  }
}
`;

// ============================================================================
// User Queries (for testing - no authentication required)
// ============================================================================

export const USER_ARTICLES_QUERY = `
query UserArticles($userName: String!, $after: String) {
  user(input: { userName: $userName }) {
    id
    userName
    articles(input: { first: 50, after: $after, filter: { state: active } }) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          title
          slug
          shortHash
          content
          summary
          createdAt
          revisedAt
          tags {
            id
            content
          }
          cover
        }
      }
    }
  }
}
`;

export const USER_COLLECTIONS_QUERY = `
query UserCollections($userName: String!, $after: String) {
  user(input: { userName: $userName }) {
    id
    collections(input: { first: 50, after: $after }) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          title
          description
          cover
          articles(input: { first: 100 }) {
            edges {
              node {
                id
                shortHash
                title
                slug
              }
            }
          }
        }
      }
    }
  }
}
`;

export const USER_PROFILE_QUERY = `
query UserProfile($userName: String!) {
  user(input: { userName: $userName }) {
    id
    userName
    displayName
    info {
      description
      profileCover
    }
    avatar
    settings {
      language
    }
  }
}
`;

// ============================================================================
// Token Management
// ============================================================================

let cachedAccessToken: string | null = null;

/**
 * Clear the cached access token
 */
export function clearTokenCache(): void {
  cachedAccessToken = null;
}

/**
 * Get access token from cookies (with caching)
 */
export async function getAccessToken(): Promise<string | null> {
  if (cachedAccessToken !== null) {
    return cachedAccessToken;
  }

  const projectPath = (window as unknown as { __MOSS_PROJECT_PATH__?: string }).__MOSS_PROJECT_PATH__;
  if (!projectPath) {
    await log("error", "Project path not available");
    return null;
  }

  try {
    await log("log", `Getting cookies for project: ${projectPath}`);
    const cookies = await getPluginCookie("matters-syndicator", projectPath);

    await log("log", `Received ${cookies?.length ?? 0} cookies`);

    if (cookies && cookies.length > 0) {
      const cookieNames = cookies.map((c) => c.name).join(", ");
      await log("log", `Cookie names: ${cookieNames}`);
    }

    const tokenCookie = cookies.find((c) => c.name === "__access_token");

    if (tokenCookie) {
      await log("log", `Found __access_token cookie (length: ${tokenCookie.value?.length ?? 0})`);
      cachedAccessToken = tokenCookie.value;
    } else {
      await log("warn", "__access_token cookie NOT found");
    }

    return cachedAccessToken;
  } catch (error) {
    await log("error", `Failed to get access token: ${error}`);
    return null;
  }
}

// ============================================================================
// GraphQL Client
// ============================================================================

/**
 * Make authenticated GraphQL request to Matters API
 */
export async function graphqlQuery<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("No access token available. Please login first.");
  }

  const response = await fetch(apiConfig.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  if (result.errors && result.errors.length > 0) {
    throw new Error(result.errors[0]?.message || "GraphQL error");
  }
  return result.data;
}

/**
 * Make public (unauthenticated) GraphQL request to Matters API
 * Used for testing with the `user` field instead of `viewer`
 */
export async function graphqlQueryPublic<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(apiConfig.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "MattersPlugin/1.0",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  if (result.errors && result.errors.length > 0) {
    throw new Error(result.errors[0]?.message || "GraphQL error");
  }
  return result.data;
}

// ============================================================================
// Data Fetching Functions
// ============================================================================

/**
 * Fetch all published articles with pagination
 * Uses viewer query (authenticated) or user query (public) based on apiConfig.queryMode
 */
export async function fetchAllArticles(): Promise<{
  articles: MattersArticle[];
  userName: string;
}> {
  if (apiConfig.queryMode === "user") {
    return fetchUserArticles(apiConfig.testUserName);
  }
  return fetchViewerArticles();
}

/**
 * Fetch articles using authenticated viewer query
 */
async function fetchViewerArticles(): Promise<{
  articles: MattersArticle[];
  userName: string;
}> {
  const allArticles: MattersArticle[] = [];
  let cursor: string | undefined;
  let userName = "";

  console.log("📡 Fetching published articles from Matters (viewer mode)...");

  do {
    const data = await graphqlQuery<ViewerArticlesResponse>(ARTICLES_QUERY, {
      after: cursor,
    });

    if (!data.viewer) {
      throw new Error("Failed to fetch viewer data");
    }

    userName = data.viewer.userName;
    const { edges, pageInfo } = data.viewer.articles;

    for (const edge of edges) {
      allArticles.push(edge.node);
    }

    console.log(`   Fetched ${allArticles.length}/${data.viewer.articles.totalCount} articles...`);

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : undefined;
  } while (cursor);

  return { articles: allArticles, userName };
}

/**
 * Fetch articles using public user query (no authentication required)
 */
async function fetchUserArticles(userName: string): Promise<{
  articles: MattersArticle[];
  userName: string;
}> {
  const allArticles: MattersArticle[] = [];
  let cursor: string | undefined;

  console.log(`📡 Fetching published articles from Matters (user mode: @${userName})...`);

  do {
    const data = await graphqlQueryPublic<UserArticlesQuery>(USER_ARTICLES_QUERY, {
      userName,
      after: cursor,
    });

    if (!data.user) {
      throw new Error(`Failed to fetch user data for @${userName}`);
    }

    const { edges, pageInfo } = data.user.articles;

    if (edges) {
      for (const edge of edges) {
        // Map UserArticlesQuery node to MattersArticle
        allArticles.push({
          id: edge.node.id,
          title: edge.node.title,
          slug: edge.node.slug,
          shortHash: edge.node.shortHash,
          content: edge.node.content,
          summary: edge.node.summary,
          createdAt: edge.node.createdAt,
          revisedAt: edge.node.revisedAt ?? undefined,
          cover: edge.node.cover ?? undefined,
          tags: edge.node.tags?.map(t => ({ id: t.id, content: t.content })) ?? [],
        });
      }
    }

    console.log(`   Fetched ${allArticles.length}/${data.user.articles.totalCount} articles...`);

    cursor = pageInfo.hasNextPage ? (pageInfo.endCursor ?? undefined) : undefined;
  } while (cursor);

  return { articles: allArticles, userName };
}

/**
 * Fetch all drafts with pagination
 * Note: Drafts are only available via viewer query (requires authentication)
 * In user mode, returns an empty array
 */
export async function fetchAllDrafts(): Promise<MattersDraft[]> {
  // Drafts require authentication - not available via public user query
  if (apiConfig.queryMode === "user") {
    console.log("📡 Skipping drafts (not available in user mode)...");
    return [];
  }

  const allDrafts: MattersDraft[] = [];
  let cursor: string | undefined;

  console.log("📡 Fetching drafts from Matters (viewer mode)...");

  do {
    const data = await graphqlQuery<ViewerDraftsResponse>(DRAFTS_QUERY, {
      after: cursor,
    });

    if (!data.viewer) {
      throw new Error("Failed to fetch viewer data");
    }

    const { edges, pageInfo } = data.viewer.drafts;

    for (const edge of edges) {
      allDrafts.push(edge.node);
    }

    console.log(`   Fetched ${allDrafts.length} drafts...`);

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : undefined;
  } while (cursor);

  return allDrafts;
}

/**
 * Fetch all collections with pagination
 * Uses viewer query (authenticated) or user query (public) based on apiConfig.queryMode
 */
export async function fetchAllCollections(): Promise<MattersCollection[]> {
  if (apiConfig.queryMode === "user") {
    return fetchUserCollections(apiConfig.testUserName);
  }
  return fetchViewerCollections();
}

/**
 * Fetch collections using authenticated viewer query
 */
async function fetchViewerCollections(): Promise<MattersCollection[]> {
  const allCollections: MattersCollection[] = [];
  let cursor: string | undefined;

  console.log("📡 Fetching collections from Matters (viewer mode)...");

  do {
    const data = await graphqlQuery<ViewerCollectionsResponse>(COLLECTIONS_QUERY, {
      after: cursor,
    });

    if (!data.viewer) {
      throw new Error("Failed to fetch viewer data");
    }

    const { edges, pageInfo } = data.viewer.collections;

    for (const edge of edges) {
      const collection: MattersCollection = {
        id: edge.node.id,
        title: edge.node.title,
        description: edge.node.description,
        cover: edge.node.cover,
        articles: edge.node.articles.edges.map((e) => e.node),
      };
      allCollections.push(collection);
    }

    console.log(`   Fetched ${allCollections.length}/${data.viewer.collections.totalCount} collections...`);

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : undefined;
  } while (cursor);

  return allCollections;
}

/**
 * Fetch collections using public user query (no authentication required)
 */
async function fetchUserCollections(userName: string): Promise<MattersCollection[]> {
  const allCollections: MattersCollection[] = [];
  let cursor: string | undefined;

  console.log(`📡 Fetching collections from Matters (user mode: @${userName})...`);

  do {
    const data = await graphqlQueryPublic<UserCollectionsQuery>(USER_COLLECTIONS_QUERY, {
      userName,
      after: cursor,
    });

    if (!data.user) {
      throw new Error(`Failed to fetch user data for @${userName}`);
    }

    const { edges, pageInfo } = data.user.collections;

    if (edges) {
      for (const edge of edges) {
        const collection: MattersCollection = {
          id: edge.node.id,
          title: edge.node.title,
          description: edge.node.description ?? undefined,
          cover: edge.node.cover ?? undefined,
          articles: edge.node.articles.edges?.map((e) => e.node) ?? [],
        };
        allCollections.push(collection);
      }
    }

    console.log(`   Fetched ${allCollections.length}/${data.user.collections.totalCount} collections...`);

    cursor = pageInfo.hasNextPage ? (pageInfo.endCursor ?? undefined) : undefined;
  } while (cursor);

  return allCollections;
}

/**
 * Fetch user profile including displayName, bio, and language preference
 * Uses viewer query (authenticated) or user query (public) based on apiConfig.queryMode
 */
export async function fetchUserProfile(): Promise<MattersUserProfile> {
  if (apiConfig.queryMode === "user") {
    return fetchUserProfilePublic(apiConfig.testUserName);
  }
  return fetchViewerProfile();
}

/**
 * Fetch profile using authenticated viewer query
 */
async function fetchViewerProfile(): Promise<MattersUserProfile> {
  console.log("📡 Fetching user profile from Matters (viewer mode)...");

  const data = await graphqlQuery<ViewerProfileResponse>(PROFILE_QUERY);

  if (!data.viewer) {
    throw new Error("Failed to fetch user profile");
  }

  const profile: MattersUserProfile = {
    userName: data.viewer.userName,
    displayName: data.viewer.displayName,
    description: data.viewer.info?.description,
    avatar: data.viewer.avatar,
    profileCover: data.viewer.info?.profileCover,
    language: data.viewer.settings?.language,
  };

  console.log(`   Profile: ${profile.displayName} (@${profile.userName})`);
  console.log(`   Language: ${profile.language || "not set"}`);

  return profile;
}

/**
 * Fetch profile using public user query (no authentication required)
 */
async function fetchUserProfilePublic(userName: string): Promise<MattersUserProfile> {
  console.log(`📡 Fetching user profile from Matters (user mode: @${userName})...`);

  const data = await graphqlQueryPublic<UserProfileQuery>(USER_PROFILE_QUERY, {
    userName,
  });

  if (!data.user) {
    throw new Error(`Failed to fetch user profile for @${userName}`);
  }

  const profile: MattersUserProfile = {
    userName: data.user.userName ?? userName,
    displayName: data.user.displayName ?? userName,
    description: data.user.info?.description ?? undefined,
    avatar: data.user.avatar ?? undefined,
    profileCover: data.user.info?.profileCover ?? undefined,
    language: data.user.settings?.language,
  };

  console.log(`   Profile: ${profile.displayName} (@${profile.userName})`);
  console.log(`   Language: ${profile.language || "not set"}`);

  return profile;
}
