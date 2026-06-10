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
  ViewerArticleCommentCountsResponse,
  UserArticleCommentCountsResponse,
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
import { getPluginCookie, httpPost, readPluginFile, writePluginFile, pluginFileExists } from "@symbiosis-lab/moss-api";

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
    pinnedWorks {
      id
      pinned
      title
      cover
      __typename
      ... on Article {
        slug
        shortHash
      }
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
          language
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
    pinnedWorks {
      id
      pinned
      title
      cover
      __typename
      ... on Article {
        slug
        shortHash
      }
    }
  }
}
`;

// ============================================================================
// Lightweight comment-count discovery queries
// ============================================================================

/**
 * Fetch only `{shortHash, commentCount}` for every published article. Used to
 * decide which articles need a full comments fetch this sync.
 */
export const VIEWER_ARTICLE_COMMENT_COUNTS_QUERY = `
query ViewerArticleCommentCounts($after: String) {
  viewer {
    id
    articles(input: { first: 50, after: $after, filter: { state: active } }) {
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          shortHash
          commentCount
        }
      }
    }
  }
}
`;

export const USER_ARTICLE_COMMENT_COUNTS_QUERY = `
query UserArticleCommentCounts($userName: String!, $after: String) {
  user(input: { userName: $userName }) {
    id
    articles(input: { first: 50, after: $after, filter: { state: active } }) {
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          shortHash
          commentCount
        }
      }
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

const AUTH_FILE = "auth.json";

let cachedAccessToken: string | null = null;

/**
 * Clear the cached access token
 */
export function clearTokenCache(): void {
  cachedAccessToken = null;
}

/**
 * Load a USABLE access token from project-scoped plugin storage.
 *
 * Credential supply, not session evidence: returns null for expired or
 * server-invalidated tokens so no caller (graphqlQuery, and critically the
 * login flow's waitForToken poll, which reads storage FIRST) can pick up a
 * dead credential. getSessionState reads the raw record instead.
 */
export async function loadStoredToken(): Promise<string | null> {
  const record = await loadAuthRecord();
  if (!record || typeof record.accessToken !== "string") return null;
  if (isRecordDead(record)) return null;
  return record.accessToken;
}

/**
 * Save access token to project-scoped plugin storage.
 * This makes the token survive across sessions and scopes it to this project.
 */
export async function saveStoredToken(token: string): Promise<void> {
  const data = { accessToken: token, savedAt: new Date().toISOString() };
  await writePluginFile(AUTH_FILE, JSON.stringify(data, null, 2));
  console.log("💾 Access token saved to project storage");
}

/**
 * Remove stored access token from project storage.
 */
export async function clearStoredToken(): Promise<void> {
  cachedAccessToken = null;
  try {
    await writePluginFile(AUTH_FILE, "{}");
  } catch {
    // Ignore write failures
  }
}

// ============================================================================
// Session state
// ============================================================================

/**
 * Decode the `exp` claim from a JWT, in milliseconds since epoch.
 *
 * No signature verification: we are reading our own stored credential to
 * predict whether the server will accept it, not authenticating anyone.
 * Returns null when the token is not a decodable JWT or has no numeric exp,
 * in which case the caller must fall back to runtime detection.
 */
export function decodeJwtExpiryMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded));
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

export type SessionState = "valid" | "expired" | "none";

/** Tokens within this margin of expiry count as expired (clock skew). */
const EXPIRY_SKEW_MS = 60_000;

interface AuthRecord {
  accessToken?: string;
  savedAt?: string;
  /** Stamped when the server rejected the token (TOKEN_INVALID). */
  invalidatedAt?: string;
  /** Stamped when the expired-session nudge was shown for this record. */
  nudgedAt?: string;
}

async function loadAuthRecord(): Promise<AuthRecord | null> {
  try {
    const exists = await pluginFileExists(AUTH_FILE);
    if (!exists) return null;
    return JSON.parse(await readPluginFile(AUTH_FILE)) as AuthRecord;
  } catch {
    return null;
  }
}

/** A record whose token the server would reject (past exp or server-stamped). */
function isRecordDead(record: AuthRecord): boolean {
  if (record.invalidatedAt) return true;
  if (typeof record.accessToken !== "string") return false;
  const expMs = decodeJwtExpiryMs(record.accessToken);
  return expMs !== null && expMs <= Date.now() + EXPIRY_SKEW_MS;
}

/**
 * Honest session check: distinguishes a usable token ("valid"), a token the
 * server will reject ("expired": past JWT exp or server-stamped invalid),
 * and no token at all ("none"). Replaces the old presence-only check that
 * logged AUTHENTICATED for a 30-days-dead token. Reads the RAW record:
 * the expired token stays on disk as the "session expired" marker.
 */
export async function getSessionState(): Promise<SessionState> {
  const record = await loadAuthRecord();
  if (!record || typeof record.accessToken !== "string") return "none";

  if (record.invalidatedAt) {
    console.log(`🔑 Token present but server-invalidated at ${record.invalidatedAt}`);
    return "expired";
  }

  const expMs = decodeJwtExpiryMs(record.accessToken);
  if (expMs === null) {
    console.log("🔑 Token present (not a decodable JWT; assuming valid, runtime check will verify)");
    return "valid";
  }
  if (expMs <= Date.now() + EXPIRY_SKEW_MS) {
    console.log(`🔑 Token present but EXPIRED since ${new Date(expMs).toISOString()}`);
    return "expired";
  }
  console.log(`🔑 Token present, expires ${new Date(expMs).toISOString()}`);
  return "valid";
}

/**
 * The server rejected the token (TOKEN_INVALID/UNAUTHENTICATED). Stamp the
 * auth record so every later check is offline; keep the token so "expired
 * session" stays distinguishable from "never logged in" (they route
 * differently). A fresh login overwrites the whole record via
 * saveStoredToken, clearing the stamp.
 */
export async function markSessionInvalidated(): Promise<void> {
  cachedAccessToken = null;
  const record = await loadAuthRecord();
  if (!record || typeof record.accessToken !== "string") {
    // Nothing to invalidate. Stamping {invalidatedAt} alone would diverge
    // the checks: getSessionState would say "none" while isRecordDead says
    // dead. Clearing the cache above is still wanted.
    return;
  }
  record.invalidatedAt = new Date().toISOString();
  try {
    await writePluginFile(AUTH_FILE, JSON.stringify(record, null, 2));
  } catch {
    // Best-effort: the runtime backstop fires again on the next request.
  }
}

/**
 * Once-per-expiry-event throttle for the "session expired" toast, persisted
 * in the auth record (NOT module state: the off-webview engine migration
 * allows per-build contexts, under which module flags reset every build and
 * sync_on_build would toast every build). Fresh login rewrites the record,
 * clearing nudgedAt, so the next expiry event nudges again.
 */
export async function shouldNudgeSessionExpired(): Promise<boolean> {
  const record = await loadAuthRecord();
  if (!record || typeof record.accessToken !== "string") return false;
  if (record.nudgedAt) return false;
  record.nudgedAt = new Date().toISOString();
  try {
    await writePluginFile(AUTH_FILE, JSON.stringify(record, null, 2));
  } catch {
    // Failing to persist means we may nudge again next build; harmless.
  }
  return true;
}

/**
 * Get access token, preferring project-scoped storage over global cookies.
 *
 * Normal mode (default): reads from project storage only. If no stored token
 * exists, returns null — the caller must trigger a login flow.
 *
 * Cookie mode (fromCookie=true): also checks the global WebKit cookie store.
 * Used only during/after login to capture the freshly-set cookie.
 *
 * @param fromCookie - If true, fall back to global cookie store (login flow only)
 * @returns
 *   - `string` - The access token if found
 *   - `null` - No token found (but context was available)
 *   - `undefined` - No plugin context (e.g., hook ended, window closed)
 */
export async function getAccessToken(fromCookie = false): Promise<string | null | undefined> {
  if (cachedAccessToken !== null) {
    return cachedAccessToken;
  }

  // 1. Check project-scoped storage first
  try {
    const storedToken = await loadStoredToken();
    if (storedToken) {
      console.log("🔑 Using stored access token from project storage");
      cachedAccessToken = storedToken;
      return cachedAccessToken;
    }
  } catch {
    // Fall through to cookie check if allowed
  }

  // 2. Only check global cookies when explicitly requested (login flow)
  if (!fromCookie) {
    return null;
  }

  try {
    console.log("🍪 Checking cookies for access token (login flow)...");
    const cookies = await getPluginCookie();

    // null means "no plugin context" - signal caller to stop
    if (cookies === null) {
      console.log("⚠️ No plugin context - cannot get cookies");
      return undefined;
    }

    const tokenCookie = cookies.find((c) => c.name === "__access_token");

    if (tokenCookie) {
      console.log(`Found __access_token cookie (length: ${tokenCookie.value?.length ?? 0})`);
      // Dead-cookie filter: the shared WebKit store can still hold a token
      // the server has revoked (matches the invalidatedAt-stamped record) or
      // one whose exp already passed. Capturing it here would persist it via
      // saveStoredToken (erasing the invalidatedAt stamp) and end the login
      // poll with a dead credential, looping the user out of re-login. A
      // rejected cookie behaves as "no token found" so the poll keeps
      // waiting for the fresh one.
      const value = tokenCookie.value;
      const currentRecord = await loadAuthRecord();
      if (isRecordDead({ accessToken: value })) {
        console.warn("🍪 Ignoring expired __access_token cookie (stale login state)");
      } else if (currentRecord?.invalidatedAt && currentRecord.accessToken === value) {
        console.warn("🍪 Ignoring __access_token cookie matching the server-invalidated token");
      } else {
        cachedAccessToken = value;

        // Immediately persist to project storage so future calls don't need cookies
        try {
          await saveStoredToken(value);
        } catch (e) {
          console.warn(`Failed to persist token to storage: ${e}`);
        }
      }
    } else {
      console.warn("__access_token cookie NOT found");
    }

    return cachedAccessToken;
  } catch (error) {
    console.error(`❌ Failed to get access token: ${error}`);
    return null;
  }
}

/** GraphQL extensions.code values that mean "the session is dead". */
const AUTH_ERROR_CODES = new Set(["TOKEN_INVALID", "UNAUTHENTICATED"]);

/**
 * The Matters server rejected our credential. Matters signals this with
 * HTTP 500 (not 401) + extensions.code, so callers must catch this type
 * rather than match on status.
 */
export class MattersAuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MattersAuthError";
    this.code = code;
  }
}

interface GraphqlErrorShape {
  message?: string;
  extensions?: { code?: string };
}

function findAuthErrorCode(parsed: unknown): string | null {
  const errors = (parsed as { errors?: GraphqlErrorShape[] } | null)?.errors;
  if (!Array.isArray(errors)) return null;
  for (const e of errors) {
    const code = e?.extensions?.code;
    if (code && AUTH_ERROR_CODES.has(code)) return code;
  }
  return null;
}

/** One-line, length-capped body excerpt for error messages and logs. */
function bodySnippet(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max) + "…";
}

/**
 * Shared response handling. `authenticated` gates auth-code detection: only
 * the token-bearing path may interpret TOKEN_INVALID/UNAUTHENTICATED as
 * evidence about OUR session and stamp it; the public path sends no token,
 * so the same body there is just a failed request.
 */
async function handleGraphqlResponse<T>(
  response: { ok: boolean; status: number; text(): string },
  authenticated: boolean
): Promise<T> {
  const text = response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // non-JSON body (e.g. an HTML error page); fall through to status check
  }

  if (authenticated) {
    const authCode = findAuthErrorCode(parsed);
    if (authCode) {
      await markSessionInvalidated();
      throw new MattersAuthError(authCode, `Matters rejected the session (${authCode})`);
    }
  }
  if (!response.ok) {
    throw new Error(`GraphQL request failed (${response.status}): ${bodySnippet(text)}`);
  }
  const result = parsed as { errors?: GraphqlErrorShape[]; data: T } | null;
  if (!result) {
    throw new Error(`GraphQL request failed (${response.status}): non-JSON response: ${bodySnippet(text)}`);
  }
  if (result.errors && result.errors.length > 0) {
    throw new Error(result.errors[0]?.message || "GraphQL error");
  }
  return result.data;
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

  return handleGraphqlResponse<T>(response, true);
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

  return handleGraphqlResponse<T>(response, false);
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
          language: edge.node.language ?? undefined,
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
 * Fetch drafts created since a given timestamp
 *
 * Like fetchAllArticlesSince, fetches all drafts and filters client-side.
 * We filter by createdAt only (not updatedAt) for consistency with articles.
 *
 * @param since - ISO timestamp to filter drafts (optional, fetches all if not provided)
 */
export async function fetchAllDraftsSince(since?: string): Promise<MattersDraft[]> {
  const drafts = await fetchAllDrafts();

  if (!since) {
    console.log(`   📅 No lastSyncedAt, returning all ${drafts.length} drafts`);
    return drafts;
  }

  const sinceDate = new Date(since);
  const filteredDrafts = drafts.filter((draft) => {
    const draftDate = new Date(draft.createdAt);
    return draftDate > sinceDate;
  });

  console.log(`   📅 Filtered to ${filteredDrafts.length} new drafts since ${since}`);
  return filteredDrafts;
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
    pinnedWorks: (data.viewer.pinnedWorks || []).map((work) => ({
      id: work.id,
      type: work.__typename === "Article" ? "article" as const : "collection" as const,
      title: work.title,
      slug: work.__typename === "Article" ? work.slug : undefined,
      shortHash: work.__typename === "Article" ? work.shortHash : undefined,
      cover: work.cover,
    })),
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

  // Cast to access pinnedWorks which may not be in the generated types yet
  const userData = data.user as NonNullable<UserProfileQuery["user"]> & {
    pinnedWorks?: Array<{
      id: string;
      pinned: boolean;
      title: string;
      cover?: string;
      __typename?: string;
      slug?: string;
      shortHash?: string;
    }>;
  };

  const profile: MattersUserProfile = {
    userName: userData.userName ?? userName,
    displayName: userData.displayName ?? userName,
    description: userData.info?.description ?? undefined,
    avatar: userData.avatar ?? undefined,
    profileCover: userData.info?.profileCover ?? undefined,
    language: userData.settings?.language,
    pinnedWorks: (userData.pinnedWorks || []).map((work) => ({
      id: work.id,
      type: work.__typename === "Article" ? "article" as const : "collection" as const,
      title: work.title,
      slug: work.__typename === "Article" ? work.slug : undefined,
      shortHash: work.__typename === "Article" ? work.shortHash : undefined,
      cover: work.cover,
    })),
  };

  console.log(`   Profile: ${profile.displayName} (@${profile.userName})`);
  console.log(`   Language: ${profile.language || "not set"}`);

  return profile;
}

// ============================================================================
// Social Data Fetching Functions
// ============================================================================

/**
 * Fetch `commentCount` for every published article in one (paginated) pass.
 *
 * Returns a map keyed by `shortHash`. Used by the social-sync loop to skip
 * the per-article comments query when the count hasn't moved since last sync.
 *
 * Picks the query mode (viewer/user) from `apiConfig.queryMode`, matching
 * `fetchAllArticles()`.
 */
export async function fetchAllArticleCommentCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  let cursor: string | undefined;

  if (apiConfig.queryMode === "user") {
    const userName = apiConfig.testUserName;
    do {
      const data = await graphqlQueryPublic<UserArticleCommentCountsResponse>(
        USER_ARTICLE_COMMENT_COUNTS_QUERY,
        { userName, after: cursor }
      );

      const articles = data.user?.articles;
      if (!articles) break;

      for (const edge of articles.edges) {
        counts.set(edge.node.shortHash, edge.node.commentCount);
      }

      cursor = articles.pageInfo.hasNextPage ? articles.pageInfo.endCursor : undefined;
    } while (cursor);
  } else {
    do {
      const data = await graphqlQuery<ViewerArticleCommentCountsResponse>(
        VIEWER_ARTICLE_COMMENT_COUNTS_QUERY,
        { after: cursor }
      );

      if (!data.viewer) break;

      const { edges, pageInfo } = data.viewer.articles;
      for (const edge of edges) {
        counts.set(edge.node.shortHash, edge.node.commentCount);
      }

      cursor = pageInfo.hasNextPage ? pageInfo.endCursor : undefined;
    } while (cursor);
  }

  return counts;
}

/**
 * Fetch all comments for an article with pagination
 * Works in both authenticated and public modes
 */
export async function fetchArticleComments(
  shortHash: string,
  knownIds?: Set<string>,
  sinceTimestamp?: string
): Promise<MattersComment[]> {
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

    // Early exit: if all comments on this page are already known, no need
    // to paginate further (comments are sorted newest-first)
    if (knownIds && knownIds.size > 0 && edges.length > 0) {
      const allKnown = edges.every(edge => knownIds.has(edge.node.id));
      if (allKnown) {
        console.log(`   📝 All comments on this page already known, stopping early`);
        break;
      }
    }

    // Timestamp-based early exit: comments are sorted newest-first, so once
    // the oldest comment on this page is at or before sinceTimestamp, all
    // remaining pages are older — stop pagination.
    if (sinceTimestamp && edges.length > 0) {
      const oldestOnPage = edges[edges.length - 1].node.createdAt;
      if (oldestOnPage <= sinceTimestamp) {
        break;
      }
    }

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : undefined;
  } while (cursor);

  // Filter out comments at or before sinceTimestamp (handles the last page
  // which may contain a mix of old and new comments)
  if (sinceTimestamp) {
    const filtered = allComments.filter(c => c.createdAt > sinceTimestamp);
    console.log(`   📝 Found ${filtered.length} new comments (${allComments.length - filtered.length} older than last sync, skipped)`);
    return filtered;
  }

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

export const SINGLE_FILE_UPLOAD_MUTATION = `
mutation SingleFileUpload($input: SingleFileUploadInput!) {
  singleFileUpload(input: $input) {
    id
    path
  }
}
`;

/**
 * Upload a cover image to Matters by URL
 *
 * Uses the singleFileUpload mutation with a URL parameter so Matters
 * fetches the image from the published site directly.
 *
 * @param url - Full URL of the cover image on the published site
 * @param entityId - Draft ID to attach the cover to (required by Matters API)
 * @returns The Matters asset ID to pass as `cover` in putDraft
 */
export async function uploadCoverByUrl(url: string, entityId: string): Promise<string> {
  interface SingleFileUploadResponse {
    singleFileUpload: { id: string; path: string };
  }

  const data = await graphqlQuery<SingleFileUploadResponse>(SINGLE_FILE_UPLOAD_MUTATION, {
    input: {
      url,
      type: "cover",
      entityType: "draft",
      entityId,
    },
  });

  return data.singleFileUpload.id;
}

/**
 * Upload an embed image to Matters by URL
 *
 * Uses the singleFileUpload mutation with a URL parameter so Matters
 * fetches the image from the published site directly.
 *
 * @param url - Full URL of the image on the published site
 * @param entityId - Draft ID the embed is being uploaded into. Required by
 *   Matters: without it the mutation rejects with "Entity id needs to be
 *   specified." (same constraint as cover; see uploadCoverByUrl).
 * @returns The Matters CDN URL (path) of the uploaded image
 */
export async function uploadEmbedByUrl(url: string, entityId: string): Promise<string> {
  interface SingleFileUploadResponse {
    singleFileUpload: { id: string; path: string };
  }

  const data = await graphqlQuery<SingleFileUploadResponse>(SINGLE_FILE_UPLOAD_MUTATION, {
    input: {
      url,
      type: "embed",
      entityType: "draft",
      entityId,
    },
  });

  return data.singleFileUpload.path;
}

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
