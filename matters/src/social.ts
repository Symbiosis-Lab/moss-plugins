/**
 * Social data storage module for Matters plugin
 *
 * Stores social interactions (comments, donations, appreciations) in
 * .moss/social/matters.json following the per-plugin file pattern.
 *
 * Schema Documentation:
 * ---------------------
 * The file stores a MattersSocialData object with:
 * - schemaVersion: "1.0.0" - Version for future migrations
 * - updatedAt: ISO timestamp of last update
 * - articles: Map of article shortHash to ArticleSocialData
 *
 * Each ArticleSocialData contains:
 * - comments: Array of MattersComment
 * - donations: Array of MattersDonation
 * - appreciations: Array of MattersAppreciation
 *
 * Merge Strategy:
 * ---------------
 * When syncing, we use upsert semantics:
 * - New items (by ID) are added
 * - Existing items (by ID) are updated
 * - Items are NEVER removed (to preserve data from different sync runs)
 *
 * This allows multiple plugins to write to separate files in .moss/social/
 * and Moss can aggregate them when rendering.
 */

import { writeFile, readFile } from "@symbiosis-lab/moss-api";
import type {
  MattersSocialData,
  ArticleSocialData,
  MattersComment,
  MattersDonation,
  MattersAppreciation,
} from "./types";

// ============================================================================
// Constants
// ============================================================================

const SOCIAL_FILE_PATH = ".moss/social/matters.json";
const SCHEMA_VERSION = "1.0.0";

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Create an empty social data structure
 */
function createEmptySocialData(): MattersSocialData {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    articles: {},
  };
}

/**
 * Create an empty article social data structure
 */
function createEmptyArticleSocialData(): ArticleSocialData {
  return {
    comments: [],
    donations: [],
    appreciations: [],
  };
}

/**
 * Load social data from .moss/social/matters.json
 *
 * Returns empty data structure if file doesn't exist or is invalid.
 */
export async function loadSocialData(): Promise<MattersSocialData> {
  try {
    const content = await readFile(SOCIAL_FILE_PATH);
    const data = JSON.parse(content) as MattersSocialData;

    // Validate schema version
    if (!data.schemaVersion || !data.articles) {
      console.warn("Invalid social data file, creating new one");
      return createEmptySocialData();
    }

    return data;
  } catch {
    // File doesn't exist or is invalid
    return createEmptySocialData();
  }
}

/**
 * Save social data to .moss/social/matters.json
 */
export async function saveSocialData(data: MattersSocialData): Promise<void> {
  data.updatedAt = new Date().toISOString();
  const content = JSON.stringify(data, null, 2);
  await writeFile(SOCIAL_FILE_PATH, content);
}

// ============================================================================
// Merge Functions
// ============================================================================

/**
 * Merge comments using upsert semantics (by ID)
 */
function mergeComments(
  existing: MattersComment[],
  incoming: MattersComment[]
): MattersComment[] {
  const commentMap = new Map<string, MattersComment>();

  // Add existing comments
  for (const comment of existing) {
    commentMap.set(comment.id, comment);
  }

  // Upsert incoming comments
  for (const comment of incoming) {
    commentMap.set(comment.id, comment);
  }

  return Array.from(commentMap.values());
}

/**
 * Merge donations using upsert semantics (by ID)
 */
function mergeDonations(
  existing: MattersDonation[],
  incoming: MattersDonation[]
): MattersDonation[] {
  const donationMap = new Map<string, MattersDonation>();

  for (const donation of existing) {
    donationMap.set(donation.id, donation);
  }

  for (const donation of incoming) {
    donationMap.set(donation.id, donation);
  }

  return Array.from(donationMap.values());
}

/**
 * Merge appreciations using upsert semantics
 * Note: Appreciations don't have unique IDs, so we use sender.id + createdAt as key
 */
function mergeAppreciations(
  existing: MattersAppreciation[],
  incoming: MattersAppreciation[]
): MattersAppreciation[] {
  const appreciationMap = new Map<string, MattersAppreciation>();

  const getKey = (a: MattersAppreciation) => `${a.sender.id}_${a.createdAt}`;

  for (const appreciation of existing) {
    appreciationMap.set(getKey(appreciation), appreciation);
  }

  for (const appreciation of incoming) {
    appreciationMap.set(getKey(appreciation), appreciation);
  }

  return Array.from(appreciationMap.values());
}

/**
 * Merge new social data into existing data for a specific article
 *
 * Uses upsert semantics: adds new items, updates existing, never removes.
 *
 * @param data - Existing social data structure (will be mutated)
 * @param shortHash - Article identifier
 * @param comments - New comments to merge
 * @param donations - New donations to merge
 * @param appreciations - New appreciations to merge
 * @returns The mutated data object
 */
export function mergeSocialData(
  data: MattersSocialData,
  shortHash: string,
  comments: MattersComment[],
  donations: MattersDonation[],
  appreciations: MattersAppreciation[]
): MattersSocialData {
  // Get or create article entry
  const existing = data.articles[shortHash] || createEmptyArticleSocialData();

  // Merge each type
  data.articles[shortHash] = {
    comments: mergeComments(existing.comments, comments),
    donations: mergeDonations(existing.donations, donations),
    appreciations: mergeAppreciations(existing.appreciations, appreciations),
  };

  return data;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get social data for a specific article
 */
export function getArticleSocialData(
  data: MattersSocialData,
  shortHash: string
): ArticleSocialData | undefined {
  return data.articles[shortHash];
}

/**
 * Get total counts for an article's social interactions
 */
export function getSocialCounts(
  data: MattersSocialData,
  shortHash: string
): { comments: number; donations: number; appreciations: number; totalClaps: number } {
  const articleData = data.articles[shortHash];

  if (!articleData) {
    return { comments: 0, donations: 0, appreciations: 0, totalClaps: 0 };
  }

  const totalClaps = articleData.appreciations.reduce(
    (sum, a) => sum + a.amount,
    0
  );

  return {
    comments: articleData.comments.length,
    donations: articleData.donations.length,
    appreciations: articleData.appreciations.length,
    totalClaps,
  };
}
