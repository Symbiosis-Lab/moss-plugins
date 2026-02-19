/**
 * Astro Binary Configuration
 *
 * Astro is an npm package, so we use npx to run it.
 * This allows Astro to work without global installation.
 */

import type { BinaryConfig } from "@symbiosis-lab/moss-api";

/**
 * Astro binary configuration for resolveBinary.
 * Astro is run via npx, so we check for npx availability.
 */
export const ASTRO_BINARY_CONFIG: BinaryConfig = {
  name: "npx",
  binary_name: "npx",
  version_check: {
    args: ["--version"],
    pattern: "(\\d+\\.\\d+\\.\\d+)",
  },
  sources: {},
};

/**
 * Get the Astro build command arguments.
 */
export function getAstroBuildArgs(outputDir: string): string[] {
  return [
    "astro",
    "build",
    "--outDir",
    outputDir,
  ];
}
