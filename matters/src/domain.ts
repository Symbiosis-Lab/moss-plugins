/**
 * Domain configuration module for the Matters plugin
 *
 * Centralizes all domain-dependent URL construction and domain state.
 * The domain defaults to "matters.town" but can be overridden via
 * plugin config (config.json: { "domain": "matters.icu" }).
 *
 * Call initializeDomain() at the start of each hook (process, syndicate)
 * to load the configured domain and update the API endpoint + manifest.
 */

import { readPluginFile, writePluginFile } from "@symbiosis-lab/moss-api";
import { getConfig } from "./config";
import { apiConfig } from "./api";

// ============================================================================
// State
// ============================================================================

const DEFAULT_DOMAIN = "matters.town";
let currentDomain = DEFAULT_DOMAIN;

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize domain configuration from plugin config.
 *
 * Must be called at the start of each hook (process, syndicate).
 * Reads `domain` from config.json, updates:
 * - Module-level currentDomain state
 * - apiConfig.endpoint for GraphQL requests
 * - manifest.json domain field (so Rust cookie filtering uses the correct domain)
 *
 * @returns The configured domain
 */
export async function initializeDomain(): Promise<string> {
  const config = await getConfig();
  currentDomain = config.domain || DEFAULT_DOMAIN;

  // Update API endpoint
  apiConfig.endpoint = `https://server.${currentDomain}/graphql`;

  // Update manifest.json domain if it differs (for Rust cookie filtering)
  try {
    const manifestContent = await readPluginFile("manifest.json");
    const manifest = JSON.parse(manifestContent);

    if (manifest.domain !== currentDomain) {
      manifest.domain = currentDomain;
      await writePluginFile("manifest.json", JSON.stringify(manifest, null, 2));
      console.log(
        `📍 Updated manifest domain to ${currentDomain}`
      );
    }
  } catch {
    // Manifest read/write failure is non-fatal
    console.warn(
      `⚠️ Could not update manifest domain to ${currentDomain}`
    );
  }

  console.log(`📍 Matters domain: ${currentDomain}`);
  return currentDomain;
}

/**
 * Reset domain to default (for testing)
 */
export function resetDomain(): void {
  currentDomain = DEFAULT_DOMAIN;
  apiConfig.endpoint = `https://server.${DEFAULT_DOMAIN}/graphql`;
}

// ============================================================================
// Getters
// ============================================================================

/**
 * Get the current configured domain
 */
export function getDomain(): string {
  return currentDomain;
}

// ============================================================================
// URL Builders
// ============================================================================

/**
 * Get the login page URL
 */
export function loginUrl(): string {
  return `https://${currentDomain}/login`;
}

/**
 * Get the draft editor URL
 */
export function draftUrl(draftId: string): string {
  return `https://${currentDomain}/me/drafts/${draftId}`;
}

/**
 * Get the published article URL
 */
export function articleUrl(
  userName: string,
  slug: string,
  shortHash: string
): string {
  return `https://${currentDomain}/@${userName}/${slug}-${shortHash}`;
}

// ============================================================================
// URL Matchers
// ============================================================================

/**
 * Check if a URL belongs to the configured Matters domain
 */
export function isMattersUrl(url: string): boolean {
  return url.includes(currentDomain);
}

/**
 * Check if a URL points to the current user's content on the configured domain
 */
export function isInternalMattersLink(
  url: string,
  userName: string
): boolean {
  const pattern = new RegExp(
    `^https?://${currentDomain.replace(/\./g, "\\.")}/@${userName}/`
  );
  return pattern.test(url);
}
