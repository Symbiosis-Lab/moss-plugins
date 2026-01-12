/**
 * Jekyll Generator Plugin for Moss
 *
 * This plugin runs Jekyll as a subprocess to generate static sites.
 * It integrates with moss's plugin system and leverages the existing
 * zero-flicker preview and smart-diff infrastructure.
 *
 * ## Architecture
 *
 * The plugin follows the **Moss scans → Plugin translates → Jekyll builds** pattern:
 *
 * 1. **Moss scans** the project folder and detects the structure (homepage, collections, etc.)
 * 2. **Plugin receives** OnBuildContext with parsed project_info
 * 3. **Plugin translates** moss's structure to Jekyll-compatible layout by copying files
 * 4. **Jekyll builds** from the translated structure, outputs to staging directory
 * 5. **Moss handles** the zero-flicker staging pattern (atomic swap)
 *
 * ## Configuration
 *
 * Configure in `.moss/config.toml`:
 *
 * ```toml
 * [hooks]
 * build = "jekyll-generator"
 *
 * [plugins.jekyll-generator]
 * jekyll_path = "/usr/local/bin/jekyll"  # Optional: custom Jekyll path
 * build_args = ["--verbose"]              # Optional: custom build args
 * ```
 *
 * ## Folder Structure Translation
 *
 * The plugin creates a `.runtime/` folder under the plugin directory:
 *
 * ```
 * .moss/plugins/jekyll-generator/.runtime/
 * ├── index.md       # Homepage
 * ├── _posts/        # Blog posts (from posts/ folder)
 * ├── _layouts/      # Default Jekyll templates
 * ├── _config.yml    # Generated Jekyll config
 * └── assets/        # Copied assets
 * ```
 *
 * ### Translation Rules:
 * - `index.md` (homepage) → `index.md` (Jekyll's homepage)
 * - `posts/` folder → `_posts/` (Jekyll's blog convention)
 * - Other collections → same directory names
 * - `assets/` folder → `assets/` (copied as-is)
 */

import {
  executeBinary,
  reportProgress,
  resolveBinary,
  BinaryResolutionError,
} from "@symbiosis-lab/moss-api";
import {
  createJekyllStructure,
  createJekyllConfig,
  cleanupRuntime,
  type ProjectInfo,
  type SourceFiles,
  type SiteConfig,
} from "./structure";
import { createDefaultLayouts } from "./templates";
import { JEKYLL_BINARY_CONFIG } from "./jekyll-config";

/**
 * Plugin-specific configuration.
 */
interface PluginConfig {
  /** Path to Jekyll binary (default: "jekyll") */
  jekyll_path?: string;

  /** Additional build arguments for Jekyll */
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

  /** Plugin-specific configuration from [plugins.jekyll-generator] */
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
 * Build hook - runs Jekyll to generate the static site.
 *
 * This is the main entry point called by moss during the build phase.
 * Jekyll writes output to context.output_dir (typically .moss/site-stage/).
 * Moss handles the zero-flicker staging pattern after this hook completes.
 *
 * ## Build Flow
 *
 * 1. Resolve Jekyll binary (from PATH or configured path)
 * 2. Clean and prepare .runtime directory
 * 3. Create Jekyll structure from moss's parsed project info (copy files)
 * 4. Generate _config.yml config
 * 5. Create default layouts
 * 6. Run Jekyll on the translated structure
 * 7. Cleanup .runtime directory
 *
 * @param context - Build context from moss containing project info and config
 * @returns Hook result indicating success or failure
 */
export async function on_build(context: OnBuildContext): Promise<HookResult> {
  const buildArgs = context.config.build_args || [];

  // Runtime directory under plugin's .moss location
  const runtimeDir = `${context.moss_dir}/plugins/jekyll-generator/.runtime`;

  try {
    // Step 1: Resolve Jekyll binary (uses configured path or system PATH)
    reportProgress("setup", 0, 4, "Resolving Jekyll binary...");
    let jekyllPath: string;

    try {
      const jekyllResolution = await resolveBinary(JEKYLL_BINARY_CONFIG, {
        configuredPath: context.config.jekyll_path,
        autoDownload: false, // Jekyll cannot be auto-downloaded (Ruby gem)
        onProgress: (phase, message) => {
          reportProgress(phase, 0, 4, message);
        },
      });

      jekyllPath = jekyllResolution.path;

      if (jekyllResolution.version) {
        reportProgress(
          "setup",
          0,
          4,
          `Using Jekyll ${jekyllResolution.version} from ${jekyllResolution.source}`
        );
      }
    } catch (error) {
      if (error instanceof BinaryResolutionError) {
        return {
          success: false,
          message: `Jekyll setup failed: ${error.message}. Install with: gem install jekyll bundler`,
        };
      }
      throw error;
    }

    // Step 2: Clean and prepare runtime directory
    await cleanupRuntime(runtimeDir);

    // Step 3: Create Jekyll structure from moss's parsed project info
    reportProgress("scaffolding", 1, 4, "Creating Jekyll structure...");
    await createJekyllStructure(
      context.project_path,
      context.project_info,
      runtimeDir,
      context.moss_dir
    );

    // Step 4: Generate Jekyll config
    await createJekyllConfig(
      context.site_config,
      runtimeDir,
      context.project_path
    );

    // Step 5: Create default layouts
    await createDefaultLayouts(runtimeDir, context.project_path);

    // Step 6: Run Jekyll
    reportProgress("building", 2, 4, "Running Jekyll...");
    const result = await executeBinary({
      binaryPath: jekyllPath,
      args: [
        "build",
        "--source",
        runtimeDir,
        "--destination",
        context.output_dir,
        "--quiet",
        ...buildArgs,
      ],
      timeoutMs: 300000, // 5 minutes for large sites
    });

    if (!result.success) {
      const errorMessage =
        result.stderr || `Jekyll exited with code ${result.exitCode}`;
      return {
        success: false,
        message: `Jekyll build failed: ${errorMessage}`,
      };
    }

    reportProgress("complete", 4, 4, "Jekyll build complete");
    return { success: true, message: "Jekyll build complete" };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to execute Jekyll: ${errorMessage}`,
    };
  } finally {
    // Step 7: Cleanup runtime directory
    await cleanupRuntime(runtimeDir);
  }
}

// Register as global for moss plugin runtime
const JekyllGenerator = { on_build };
(window as unknown as { JekyllGenerator: typeof JekyllGenerator }).JekyllGenerator =
  JekyllGenerator;

export default JekyllGenerator;

// Re-export types for testing
export type { OnBuildContext, HookResult, PluginConfig };
