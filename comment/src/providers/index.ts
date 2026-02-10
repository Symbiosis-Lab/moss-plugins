/**
 * Provider registry
 *
 * Adapter pattern for different comment backends.
 * Currently supports Waline; other providers can be added here.
 */

import type { CommentProvider } from "../types";
import { walineProvider } from "./waline";

const providers: Record<string, CommentProvider> = {
  waline: walineProvider,
};

/**
 * Get a comment provider by name.
 *
 * @param name - Provider name (e.g., "waline")
 * @returns The provider, or null if not found
 */
export function getProvider(name: string): CommentProvider | null {
  return providers[name] || null;
}
