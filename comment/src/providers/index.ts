/**
 * Provider registry
 *
 * Supports Waline and Artalk comment providers. Returns the submit script
 * builder for the named provider, or null if not found.
 */

import { buildWalineSubmitScript } from "./waline";
import { buildArtalkClientScript } from "./artalk";

export type SubmitScriptBuilder = (serverUrl: string, pagePath: string, siteName?: string) => string;

const providers: Record<string, SubmitScriptBuilder> = {
  waline: buildWalineSubmitScript,
  artalk: buildArtalkClientScript,
};

/**
 * Get a submit script builder by provider name.
 */
export function getSubmitScriptBuilder(name: string): SubmitScriptBuilder | null {
  return providers[name] || null;
}
