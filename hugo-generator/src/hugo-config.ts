/**
 * Hugo binary configuration for auto-download
 *
 * This configuration enables automatic detection and download of Hugo
 * when it's not already installed on the user's system.
 *
 * IMPORTANT: Hugo v0.153+ removed tar.gz archives for macOS, only providing .pkg installers.
 * For macOS auto-download, we use v0.152.2 (the last version with tar.gz).
 * Users who want the latest Hugo on macOS should install it via Homebrew: `brew install hugo`
 */

import type { BinaryConfig } from "@symbiosis-lab/moss-api";

/**
 * Pinned version for macOS auto-download
 * This is the last Hugo version that provides tar.gz archives for macOS.
 * Hugo v0.153+ only provides .pkg installer files which we cannot extract.
 */
const MACOS_PINNED_VERSION = "0.152.2";

/**
 * Hugo binary configuration for resolveBinary()
 *
 * Download sources:
 * - Uses Hugo extended version (includes SCSS/SASS support)
 * - Downloads from official GitHub releases
 * - Supports macOS (ARM64, x64), Linux (x64), Windows (x64)
 *
 * Note: macOS uses a pinned version due to Hugo v0.153+ removing tar.gz archives.
 * Linux and Windows use the latest release.
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
   * Note: macOS uses direct URLs to a pinned version since Hugo v0.153+
   * removed tar.gz archives for macOS.
   *
   * See: https://github.com/gohugoio/hugo/releases
   */
  sources: {
    // macOS uses pinned version with direct URL (Hugo v0.153+ only has .pkg)
    "darwin-arm64": {
      directUrl: `https://github.com/gohugoio/hugo/releases/download/v${MACOS_PINNED_VERSION}/hugo_extended_${MACOS_PINNED_VERSION}_darwin-universal.tar.gz`,
    },
    "darwin-x64": {
      directUrl: `https://github.com/gohugoio/hugo/releases/download/v${MACOS_PINNED_VERSION}/hugo_extended_${MACOS_PINNED_VERSION}_darwin-universal.tar.gz`,
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
