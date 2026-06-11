/**
 * Substack API client.
 *
 * Substack exposes a REST API at {publication_url}/api/v1/
 * Authentication is via the `substack.sid` cookie on `.substack.com`.
 */

import { fetchUrl } from "@symbiosis-lab/moss-api";
import type { SubstackPost } from "./types";

let publicationUrl = "";

/**
 * Initialize the API with a publication URL.
 */
export function initApi(url: string): void {
  // Normalize: remove trailing slash
  publicationUrl = url.replace(/\/$/, "");
}

/**
 * Get the configured publication URL.
 */
export function getPublicationUrl(): string {
  return publicationUrl;
}

/**
 * Fetch all published posts from the Substack API.
 * Returns newest first.
 */
export async function fetchAllPosts(
  limit = 50,
  offset = 0
): Promise<SubstackPost[]> {
  if (!publicationUrl) throw new Error("Publication URL not configured");

  const url = `${publicationUrl}/api/v1/posts?limit=${limit}&offset=${offset}`;
  const response = await fetchUrl(url);
  const data = JSON.parse(response);

  if (!Array.isArray(data)) {
    throw new Error(`Unexpected API response: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return data;
}

/**
 * Fetch a single post by ID, including body_html.
 */
export async function fetchPost(postId: number): Promise<SubstackPost> {
  if (!publicationUrl) throw new Error("Publication URL not configured");

  const url = `${publicationUrl}/api/v1/posts/${postId}`;
  const response = await fetchUrl(url);
  return JSON.parse(response);
}

/**
 * Build the public URL for a post.
 */
export function postUrl(slug: string): string {
  return `${publicationUrl}/p/${slug}`;
}
