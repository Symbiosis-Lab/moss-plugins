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
  displayName: "npx (for Gatsby)",
  versionCommand: ["--version"],
  versionPattern: /(\d+\.\d+\.\d+)/,

  platforms: {},

  installInstructions: {
    darwin: "Install Node.js from nodejs.org or via: brew install node",
    linux: "Install Node.js from nodejs.org or via: apt install nodejs npm",
    win32: "Install Node.js from nodejs.org",
  },
};

/**
 * Get the Gatsby build command arguments.
 */
export function getGatsbyBuildArgs(outputDir: string): string[] {
  return [
    "gatsby",
    "build",
    "--prefix-paths",
  ];
}
