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
export declare const HUGO_BINARY_CONFIG: BinaryConfig;
//# sourceMappingURL=hugo-config.d.ts.map