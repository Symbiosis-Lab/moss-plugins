/**
 * Hugo binary configuration for auto-download
 *
 * This configuration enables automatic detection and download of Hugo
 * when it's not already installed on the user's system.
 */

import type { BinaryConfig } from "@symbiosis-lab/moss-api";

/**
 * Hugo binary configuration for resolveBinary()
 *
 * Download sources:
 * - Uses Hugo extended version (includes SCSS/SASS support)
 * - Downloads from official GitHub releases
 * - Supports macOS (ARM64, x64), Linux (x64), Windows (x64)
 *
 * @example
 * ```typescript
 * const hugo = await resolveBinary(HUGO_BINARY_CONFIG, {
 *   configuredPath: context.config.hugo_path,
 *   onProgress: (phase, msg) => reportProgress(phase, 0, 1, msg),
 * });
 * ```
 */
export const HUGO_BINARY_CONFIG: BinaryConfig = {
  name: "hugo",

  /**
   * Minimum required Hugo version
   * Note: Not enforced during resolution, only for documentation
   */
  minVersion: "0.100.0",

  /**
   * Command to check Hugo version
   * {name} is replaced with the binary path
   */
  versionCommand: "{name} version",

  /**
   * Regex to extract version from Hugo's version output
   * Example output: "hugo v0.139.0+extended darwin/arm64 BuildDate=unknown"
   */
  versionPattern: /hugo v(\d+\.\d+\.\d+)/i,

  /**
   * Download sources per platform
   *
   * Hugo release assets follow this naming pattern:
   * hugo_extended_{version}_{os}-{arch}.{ext}
   *
   * See: https://github.com/gohugoio/hugo/releases
   */
  sources: {
    // macOS uses universal binaries (single binary for both arm64 and x64)
    "darwin-arm64": {
      github: {
        owner: "gohugoio",
        repo: "hugo",
        assetPattern: "hugo_extended_{version}_darwin-universal.tar.gz",
      },
    },
    "darwin-x64": {
      github: {
        owner: "gohugoio",
        repo: "hugo",
        assetPattern: "hugo_extended_{version}_darwin-universal.tar.gz",
      },
    },
    "linux-x64": {
      github: {
        owner: "gohugoio",
        repo: "hugo",
        assetPattern: "hugo_extended_{version}_linux-amd64.tar.gz",
      },
    },
    "windows-x64": {
      github: {
        owner: "gohugoio",
        repo: "hugo",
        assetPattern: "hugo_extended_{version}_windows-amd64.zip",
      },
    },
  },

  /**
   * Binary name inside the archive
   * - Unix: "hugo"
   * - Windows: "hugo.exe" (auto-appended by resolveBinary)
   */
  binaryName: "hugo",
};
