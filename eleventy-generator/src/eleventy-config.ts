/**
 * Eleventy Binary Configuration
 *
 * Eleventy is an npm package, so we use npx to run it.
 * This allows Eleventy to work without global installation.
 */

import type { BinaryConfig } from "@symbiosis-lab/moss-api";

/**
 * Eleventy binary configuration for resolveBinary.
 * Eleventy is run via npx, so we check for npx availability.
 */
export const ELEVENTY_BINARY_CONFIG: BinaryConfig = {
  name: "npx",
  displayName: "npx (for Eleventy)",
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
 * Get the Eleventy build command arguments.
 */
export function getEleventyBuildArgs(
  inputDir: string,
  outputDir: string
): string[] {
  return [
    "@11ty/eleventy",
    "--input",
    inputDir,
    "--output",
    outputDir,
  ];
}
