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
  binary_name: "npx",
  version_check: {
    args: ["--version"],
    pattern: "(\\d+\\.\\d+\\.\\d+)",
  },
  sources: {},
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
