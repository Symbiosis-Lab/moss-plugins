/**
 * Hugo Generator Plugin for Moss
 *
 * This plugin runs Hugo as a subprocess to generate static sites.
 * It integrates with moss's plugin system and leverages the existing
 * zero-flicker preview and smart-diff infrastructure.
 *
 * ## Architecture
 *
 * The plugin follows the **Moss scans → Plugin translates → Hugo builds** pattern:
 *
 * 1. **Moss scans** the project folder and detects the structure (homepage, collections, etc.)
 * 2. **Plugin receives** OnBuildContext with parsed project_info
 * 3. **Plugin translates** moss's structure to Hugo-compatible layout via symlinks
 * 4. **Hugo builds** from the translated structure, outputs to staging directory
 * 5. **Moss handles** the zero-flicker staging pattern (atomic swap)
 *
 * ## Configuration
 *
 * Configure in `.moss/config.toml`:
 *
 * ```toml
 * [hooks]
 * build = "hugo-generator"
 *
 * [plugins.hugo-generator]
 * hugo_path = "/usr/local/bin/hugo"  # Optional: custom Hugo path
 * build_args = ["--minify", "--gc"]   # Optional: custom build args
 * ```
 *
 * ## Folder Structure Translation (Phase 10)
 *
 * The plugin creates a `.runtime/` folder under the plugin directory:
 *
 * ```
 * .moss/plugins/hugo-generator/.runtime/
 * ├── content/       # Symlinks to user's markdown files
 * │   ├── _index.md  # Homepage (symlink to project's index.md)
 * │   ├── posts/     # Collection folder (symlink)
 * │   └── about.md   # Root page (symlink)
 * ├── layouts/       # Default Hugo templates
 * └── hugo.toml      # Generated Hugo config
 * ```
 *
 * ### Translation Rules:
 * - `index.md` (homepage) → `content/_index.md` (Hugo's homepage convention)
 * - Collection folders → `content/{folder}/` (direct symlink)
 * - `{folder}/index.md` → `content/{folder}/_index.md` (Hugo section index)
 * - Root markdown files → `content/{file}.md` (symlinks)
 * - `assets/` folder → `static/assets/` (for images, CSS, JS)
 *
 * ### Project Type Detection:
 * Plugins derive structure from `content_folders.is_empty()`:
 * - Empty = flat site (only root-level markdown)
 * - Non-empty = site with collections
 */

import { executeBinary, reportProgress } from "@symbiosis-lab/moss-api";

/**
 * Project information passed from moss to the plugin.
 *
 * Note: `project_type` was removed in PR #15. Plugins should derive
 * structure type from `content_folders.is_empty()` if needed.
 */
interface ProjectInfo {
  /** Content folder names (e.g., ["posts", "projects"]). Empty for flat sites. */
  content_folders: string[];

  /** Total number of content files detected */
  total_files: number;

  /** Homepage file path relative to project root (e.g., "index.md") */
  homepage_file?: string;
}

/**
 * Source files categorized by type.
 */
interface SourceFiles {
  markdown: string[];
  pages: string[];
  docx: string[];
  other: string[];
}

/**
 * Site configuration from .moss/config.toml.
 */
interface SiteConfig {
  site_name?: string;
  base_url?: string;
  [key: string]: unknown;
}

/**
 * Plugin-specific configuration.
 */
interface PluginConfig {
  /** Path to Hugo binary (default: "hugo") */
  hugo_path?: string;

  /** Additional build arguments for Hugo */
  build_args?: string[];
}

/**
 * Context provided by moss for the on_build hook.
 *
 * This is the complete context passed to generator plugins during the build phase.
 */
interface OnBuildContext {
  /** Absolute path to the project folder */
  project_path: string;

  /** Path to .moss directory */
  moss_dir: string;

  /** Output directory for generated site (typically .moss/site-stage/) */
  output_dir: string;

  /** Parsed project structure information */
  project_info: ProjectInfo;

  /** Categorized source files */
  source_files: SourceFiles;

  /** Site configuration from .moss/config.toml */
  site_config: SiteConfig;

  /** Plugin-specific configuration from [plugins.hugo-generator] */
  config: PluginConfig;
}

/**
 * Result returned from hooks
 */
interface HookResult {
  success: boolean;
  message?: string;
}

/**
 * Build hook - runs Hugo to generate the static site.
 *
 * This is the main entry point called by moss during the build phase.
 * Hugo writes output to context.output_dir (typically .moss/site-stage/).
 * Moss handles the zero-flicker staging pattern after this hook completes.
 *
 * ## Current Implementation (Direct Hugo)
 *
 * Currently runs Hugo directly on the project folder. This requires the
 * project to already be in Hugo-compatible structure.
 *
 * ## Phase 10 Implementation (Folder Translation)
 *
 * Will be updated to:
 * 1. Create .runtime/ folder with Hugo-compatible structure via symlinks
 * 2. Generate hugo.toml config
 * 3. Create default layouts
 * 4. Run Hugo on the translated structure
 * 5. Cleanup .runtime/ after build
 *
 * @param context - Build context from moss containing project info and config
 * @returns Hook result indicating success or failure
 */
export async function on_build(context: OnBuildContext): Promise<HookResult> {
  const hugoPath = context.config.hugo_path || "hugo";
  const buildArgs = context.config.build_args || ["--minify"];

  reportProgress("building", 0, 1, "Running Hugo...");

  try {
    const result = await executeBinary({
      binaryPath: hugoPath,
      args: [
        "--source",
        context.project_path,
        "--destination",
        context.output_dir,
        "--quiet",
        ...buildArgs,
      ],
      workingDir: context.project_path,
      timeoutMs: 300000, // 5 minutes for large sites
    });

    if (!result.success) {
      const errorMessage =
        result.stderr || `Hugo exited with code ${result.exitCode}`;
      return {
        success: false,
        message: `Hugo build failed: ${errorMessage}`,
      };
    }

    reportProgress("complete", 1, 1, "Hugo build complete");
    return { success: true, message: "Hugo build complete" };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to execute Hugo: ${errorMessage}`,
    };
  }
}

// Register as global for moss plugin runtime
const HugoGenerator = { on_build };
(window as unknown as { HugoGenerator: typeof HugoGenerator }).HugoGenerator =
  HugoGenerator;

export default HugoGenerator;
