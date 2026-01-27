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
  MattersComment,
  MattersDonation,
  MattersAppreciation,
  MattersDraftWithArticle,
  ViewerArticlesResponse,
  ViewerDraftsResponse,
  ViewerCollectionsResponse,
  ViewerProfileResponse,
  ArticleCommentsResponse,
  ArticleDonationsResponse,
  ArticleAppreciationsResponse,
  PutDraftInput,
  PutDraftResponse,
  PutCollectionInput,
  PutCollectionResponse,
} from "./types";
import type {
  UserArticlesQuery,
  UserCollectionsQuery,
  UserProfileQuery,
} from "./__generated__/types";
import { log } from "./utils";
import { getPluginCookie, httpPost } from "@symbiosis-lab/moss-api";

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
// Social Data Queries (Comments, Donations, Appreciations)
// ============================================================================

export const ARTICLE_COMMENTS_QUERY = `
query ArticleComments($shortHash: String!, $after: String) {
  article(input: { shortHash: $shortHash }) {
    id
    shortHash
    comments(input: { first: 50, after: $after, sort: newest }) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          content
          createdAt
          state
          upvotes
          author {
            id
            userName
            displayName
            avatar
          }
          replyTo {
            id
            author {
              userName
            }
          }
        }
      }
    }
  }
}
`;

export const ARTICLE_DONATIONS_QUERY = `
query ArticleDonations($shortHash: String!, $after: String) {
  article(input: { shortHash: $shortHash }) {
    id
    shortHash
    donations(input: { first: 50, after: $after }) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          sender {
            id
            userName
            displayName
            avatar
          }
        }
      }
    }
  }
}
`;

export const ARTICLE_APPRECIATIONS_QUERY = `
query ArticleAppreciations($shortHash: String!, $after: String) {
  article(input: { shortHash: $shortHash }) {
    id
    shortHash
    appreciationsReceived(input: { first: 50, after: $after }) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          amount
          createdAt
          sender {
            id
            userName
            displayName
            avatar
          }
        }
      }
    }
  }
}
`;

// ============================================================================
// Syndication Mutations (Draft/Collection Creation)
// ============================================================================

export const PUT_DRAFT_MUTATION = `
mutation PutDraft($input: PutDraftInput!) {
  putDraft(input: $input) {
    id
    title
    content
    summary
    createdAt
    updatedAt
    tags
    cover
    publishState
    article {
      id
      shortHash
      slug
    }
  }
}
`;

export const GET_DRAFT_QUERY = `
query GetDraft($id: ID!) {
  node(input: { id: $id }) {
    ... on Draft {
      id
      title
      publishState
      article {
        id
        shortHash
        slug
      }
    }
  }
}
`;

export const PUT_COLLECTION_MUTATION = `
mutation PutCollection($input: PutCollectionInput!) {
  putCollection(input: $input) {
    id
    title
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
 *
 * Uses the SDK's auto-detected plugin context - no need to pass plugin name or project path.
 */
export async function getAccessToken(): Promise<string | null> {
  if (cachedAccessToken !== null) {
    return cachedAccessToken;
  }

  try {
    await log("log", "Getting cookies from plugin context");
    const cookies = await getPluginCookie();

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

  const response = await httpPost(
    apiConfig.endpoint,
    { query, variables },
    {
      headers: {
        "x-access-token": token,
      },
      timeoutMs: 30000,
    }
  );

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status}`);
  }

  const result = JSON.parse(response.text());
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
  console.log(`[matters] graphqlQueryPublic: fetching with vars:`, JSON.stringify(variables));

  const response = await httpPost(
    apiConfig.endpoint,
    { query, variables },
    {
      headers: {
        "User-Agent": "MattersPlugin/1.0",
        Accept: "application/json",
      },
      timeoutMs: 30000,
    }
  );

  console.log(`[matters] graphqlQueryPublic: response status ${response.status}`);

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status}`);
  }

  const result = JSON.parse(response.text());
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

// ============================================================================
// Social Data Fetching Functions
// ============================================================================

/**
 * Fetch all comments for an article with pagination
 * Works in both authenticated and public modes
 */
export async function fetchArticleComments(shortHash: string): Promise<MattersComment[]> {
  const allComments: MattersComment[] = [];
  let cursor: string | undefined;

  console.log(`   📝 Fetching comments for article ${shortHash}...`);

  do {
    // Comments can be fetched publicly via article query
    const data = await graphqlQueryPublic<ArticleCommentsResponse>(
      ARTICLE_COMMENTS_QUERY,
      { shortHash, after: cursor }
    );

    if (!data.article) {
      console.warn(`   ⚠️ Article ${shortHash} not found`);
      return [];
    }

    const { edges, pageInfo } = data.article.comments;

    for (const edge of edges) {
      const node = edge.node;
      allComments.push({
        id: node.id,
        content: node.content,
        createdAt: node.createdAt,
        state: node.state as "active" | "archived" | "banned" | "collapsed",
        upvotes: node.upvotes,
        author: {
          id: node.author.id,
          userName: node.author.userName,
          displayName: node.author.displayName,
          avatar: node.author.avatar,
        },
        replyToId: node.replyTo?.id,
        replyToAuthor: node.replyTo?.author?.userName,
      });
    }

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : undefined;
  } while (cursor);

  console.log(`   📝 Found ${allComments.length} comments`);
  return allComments;
}

/**
 * Fetch all donations for an article with pagination
 * Works in both authenticated and public modes
 */
export async function fetchArticleDonations(shortHash: string): Promise<MattersDonation[]> {
  const allDonations: MattersDonation[] = [];
  let cursor: string | undefined;

  console.log(`   💰 Fetching donations for article ${shortHash}...`);

  do {
    const data = await graphqlQueryPublic<ArticleDonationsResponse>(
      ARTICLE_DONATIONS_QUERY,
      { shortHash, after: cursor }
    );

    if (!data.article) {
      console.warn(`   ⚠️ Article ${shortHash} not found`);
      return [];
    }

    const { edges, pageInfo } = data.article.donations;

    for (const edge of edges) {
      const node = edge.node;
      allDonations.push({
        id: node.id,
        sender: {
          id: node.sender.id,
          userName: node.sender.userName,
          displayName: node.sender.displayName,
          avatar: node.sender.avatar,
        },
      });
    }

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : undefined;
  } while (cursor);

  console.log(`   💰 Found ${allDonations.length} donations`);
  return allDonations;
}

/**
 * Fetch all appreciations for an article with pagination
 * Works in both authenticated and public modes
 */
export async function fetchArticleAppreciations(shortHash: string): Promise<MattersAppreciation[]> {
  const allAppreciations: MattersAppreciation[] = [];
  let cursor: string | undefined;

  console.log(`   👏 Fetching appreciations for article ${shortHash}...`);

  do {
    const data = await graphqlQueryPublic<ArticleAppreciationsResponse>(
      ARTICLE_APPRECIATIONS_QUERY,
      { shortHash, after: cursor }
    );

    if (!data.article) {
      console.warn(`   ⚠️ Article ${shortHash} not found`);
      return [];
    }

    const { edges, pageInfo } = data.article.appreciationsReceived;

    for (const edge of edges) {
      const node = edge.node;
      allAppreciations.push({
        amount: node.amount,
        createdAt: node.createdAt,
        sender: {
          id: node.sender.id,
          userName: node.sender.userName,
          displayName: node.sender.displayName,
          avatar: node.sender.avatar,
        },
      });
    }

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : undefined;
  } while (cursor);

  const totalClaps = allAppreciations.reduce((sum, a) => sum + a.amount, 0);
  console.log(`   👏 Found ${allAppreciations.length} appreciators (${totalClaps} total claps)`);
  return allAppreciations;
}

// ============================================================================
// Incremental Sync Functions
// ============================================================================

/**
 * Fetch articles created since a given timestamp
 *
 * Note: The Matters API doesn't support direct datetime filtering on viewer.articles,
 * so we fetch all articles and filter client-side by createdAt.
 *
 * We intentionally filter by createdAt only (not revisedAt) to implement a
 * "download new content only" model. Remote edits are ignored to avoid
 * overwriting local changes.
 *
 * @param since - ISO timestamp to filter articles (optional, fetches all if not provided)
 */
export async function fetchAllArticlesSince(since?: string): Promise<{
  articles: MattersArticle[];
  userName: string;
}> {
  const { articles, userName } = await fetchAllArticles();

  if (!since) {
    console.log(`   📅 No lastSyncedAt, returning all ${articles.length} articles`);
    return { articles, userName };
  }

  const sinceDate = new Date(since);
  const filteredArticles = articles.filter((article) => {
    // Filter by createdAt only - ignore revisedAt to avoid overwriting local edits
    const articleDate = new Date(article.createdAt);
    return articleDate > sinceDate;
  });

  console.log(`   📅 Filtered to ${filteredArticles.length} new articles since ${since}`);
  return { articles: filteredArticles, userName };
}

// ============================================================================
// Syndication Functions (Draft/Collection Creation)
// ============================================================================

/**
 * Create or update a draft on Matters
 */
export async function createDraft(input: PutDraftInput): Promise<MattersDraftWithArticle> {
  console.log(`   📝 Creating draft: ${input.title}`);

  const data = await graphqlQuery<PutDraftResponse>(PUT_DRAFT_MUTATION, {
    input,
  });

  console.log(`   ✅ Draft created with ID: ${data.putDraft.id}`);
  return data.putDraft;
}

/**
 * Fetch a draft by ID to check its publish state
 */
export async function fetchDraft(draftId: string): Promise<MattersDraftWithArticle | null> {
  interface GetDraftResponse {
    node: MattersDraftWithArticle | null;
  }

  const data = await graphqlQuery<GetDraftResponse>(GET_DRAFT_QUERY, {
    id: draftId,
  });

  return data.node;
}

/**
 * Create a new collection on Matters
 */
export async function createCollection(input: PutCollectionInput): Promise<{ id: string; title: string }> {
  console.log(`   📁 Creating collection: ${input.title}`);

  const data = await graphqlQuery<PutCollectionResponse>(PUT_COLLECTION_MUTATION, {
    input,
  });

  console.log(`   ✅ Collection created with ID: ${data.putCollection.id}`);
  return data.putCollection;
}
