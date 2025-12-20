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
 * 3. **Plugin translates** moss's structure to Hugo-compatible layout by copying files
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
 * ## Folder Structure Translation
 *
 * The plugin creates a `.runtime/` folder under the plugin directory:
 *
 * ```
 * .moss/plugins/hugo-generator/.runtime/
 * ├── content/       # Copied markdown files
 * │   ├── _index.md  # Homepage (copied from project's index.md)
 * │   ├── posts/     # Collection folder (copied files)
 * │   └── about.md   # Root page (copied)
 * ├── layouts/       # Default Hugo templates
 * └── hugo.toml      # Generated Hugo config
 * ```
 *
 * ### Translation Rules:
 * - `index.md` (homepage) → `content/_index.md` (Hugo's homepage convention)
 * - Collection folders → `content/{folder}/` (copied with index.md → _index.md rename)
 * - `{folder}/index.md` → `content/{folder}/_index.md` (Hugo section index)
 * - Root markdown files → `content/{file}.md` (copied)
 * - `assets/` folder → `static/assets/` (for images, CSS, JS)
 *
 * ### Project Type Detection:
 * Plugins derive structure from `content_folders.is_empty()`:
 * - Empty = flat site (only root-level markdown)
 * - Non-empty = site with collections
 */

import { executeBinary, reportProgress } from "@symbiosis-lab/moss-api";
import {
  createHugoStructure,
  createHugoConfig,
  cleanupRuntime,
  type ProjectInfo,
  type SourceFiles,
  type SiteConfig,
} from "./structure";
import { createDefaultLayouts } from "./templates";

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
 * ## Build Flow
 *
 * 1. Clean and prepare .runtime directory
 * 2. Create Hugo structure from moss's parsed project info (copy files)
 * 3. Generate hugo.toml config
 * 4. Create default layouts
 * 5. Run Hugo on the translated structure
 * 6. Cleanup .runtime directory
 *
 * @param context - Build context from moss containing project info and config
 * @returns Hook result indicating success or failure
 */
export async function on_build(context: OnBuildContext): Promise<HookResult> {
  const hugoPath = context.config.hugo_path || "hugo";
  const buildArgs = context.config.build_args || ["--minify"];

  // Runtime directory under plugin's .moss location
  // Using string concatenation since we can't use Node.js path module
  const runtimeDir = `${context.moss_dir}/plugins/hugo-generator/.runtime`;

  try {
    // Step 1: Clean and prepare runtime directory
    await cleanupRuntime(runtimeDir);

    // Step 2: Create Hugo structure from moss's parsed project info
    reportProgress("scaffolding", 0, 3, "Creating Hugo structure...");
    await createHugoStructure(
      context.project_path,
      context.project_info,
      runtimeDir,
      context.moss_dir
    );

    // Step 3: Generate Hugo config
    await createHugoConfig(
      context.site_config,
      runtimeDir,
      context.project_path
    );

    // Step 4: Create default layouts
    await createDefaultLayouts(runtimeDir, context.project_path);

    // Step 5: Run Hugo
    reportProgress("building", 1, 3, "Running Hugo...");
    const result = await executeBinary({
      binaryPath: hugoPath,
      args: [
        "--source",
        runtimeDir,
        "--destination",
        context.output_dir,
        "--quiet",
        ...buildArgs,
      ],
      workingDir: runtimeDir,
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

    reportProgress("complete", 3, 3, "Hugo build complete");
    return { success: true, message: "Hugo build complete" };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to execute Hugo: ${errorMessage}`,
    };
  } finally {
    // Step 6: Cleanup runtime directory
    await cleanupRuntime(runtimeDir);
  }
}

// Register as global for moss plugin runtime
const HugoGenerator = { on_build };
(window as unknown as { HugoGenerator: typeof HugoGenerator }).HugoGenerator =
  HugoGenerator;

export default HugoGenerator;

// Re-export types for testing
export type { OnBuildContext, HookResult, PluginConfig };
