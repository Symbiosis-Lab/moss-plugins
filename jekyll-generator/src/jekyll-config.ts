/**
 * Jekyll Binary Configuration
 *
 * Defines how to locate and resolve the Jekyll binary.
 * Jekyll is a Ruby gem, so it requires Ruby to be installed.
 * Unlike Hugo, we cannot auto-download Jekyll easily.
 *
 * Resolution order:
 * 1. User-configured path (jekyll_path in config)
 * 2. System PATH lookup
 * 3. Bundler (bundle exec jekyll)
 *
 * Note: Jekyll cannot be auto-downloaded like Hugo because it requires
 * Ruby and gem dependencies. Users must install Jekyll manually:
 * - macOS: `gem install jekyll bundler`
 * - Linux: `gem install jekyll bundler` or `apt install jekyll`
 * - Windows: Use RubyInstaller then `gem install jekyll bundler`
 */

import type { BinaryConfig } from "@symbiosis-lab/moss-api";

/**
 * Jekyll binary configuration for resolveBinary.
 *
 * Since Jekyll is a Ruby gem and cannot be easily auto-downloaded,
 * we disable auto-download and rely on system installation.
 */
export const JEKYLL_BINARY_CONFIG: BinaryConfig = {
  name: "jekyll",
  displayName: "Jekyll",
  versionCommand: ["--version"],
  versionPattern: /jekyll\s+(\d+\.\d+\.\d+)/i,

  // No auto-download for Jekyll (requires Ruby ecosystem)
  platforms: {},

  // Installation instructions
  installInstructions: {
    darwin: "Install with: gem install jekyll bundler",
    linux: "Install with: gem install jekyll bundler",
    win32: "Install Ruby from rubyinstaller.org, then: gem install jekyll bundler",
  },
};

/**
 * Bundler configuration for running Jekyll via bundle exec.
 */
export const BUNDLER_CONFIG: BinaryConfig = {
  name: "bundle",
  displayName: "Bundler",
  versionCommand: ["--version"],
  versionPattern: /Bundler version (\d+\.\d+\.\d+)/i,
  platforms: {},
};
