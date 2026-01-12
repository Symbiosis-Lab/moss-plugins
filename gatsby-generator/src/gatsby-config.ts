/**
 * Gatsby Binary Configuration
 *
 * Gatsby is an npm package, so we use npx to run it.
 * This allows Gatsby to work without global installation.
 */

import type { BinaryConfig } from "@symbiosis-lab/moss-api";

/**
 * Gatsby binary configuration for resolveBinary.
 * Gatsby is run via npx, so we check for npx availability.
 */
export const GATSBY_BINARY_CONFIG: BinaryConfig = {
  name: "npx",
  versionCommand: "{name} --version",
  versionPattern: /(\d+\.\d+\.\d+)/,
  sources: {},
  binaryName: "npx",
};

/**
 * Get the Gatsby build command arguments.
 */
export function getGatsbyBuildArgs(): string[] {
  return [
    "gatsby",
    "build",
    "--prefix-paths",
  ];
}
