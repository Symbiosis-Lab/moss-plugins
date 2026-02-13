/**
 * Provider registry
 *
 * Currently only supports Waline. Returns the submit script builder
 * for the named provider, or null if not found.
 */

import { buildWalineSubmitScript } from "./waline";

type SubmitScriptBuilder = (serverUrl: string, pagePath: string) => string;

const providers: Record<string, SubmitScriptBuilder> = {
  waline: buildWalineSubmitScript,
};

/**
 * Get a submit script builder by provider name.
 */
export function getSubmitScriptBuilder(name: string): SubmitScriptBuilder | null {
  return providers[name] || null;
}
