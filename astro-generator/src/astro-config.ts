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
  displayName: "npx (for Astro)",
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
