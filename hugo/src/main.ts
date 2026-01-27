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

import {
  executeBinary,
  reportProgress,
  resolveBinary,
  BinaryResolutionError,
} from "@symbiosis-lab/moss-api";
import type { OnBuildContext, HookResult } from "@symbiosis-lab/moss-api";
import {
  createHugoStructure,
  translatePageTree,
  createHugoConfig,
  cleanupRuntime,
} from "./structure";
import { createDefaultLayouts } from "./templates";
import { HUGO_BINARY_CONFIG } from "./hugo-config";

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
 * Build hook - runs Hugo to generate the static site.
 *
 * This is the main entry point called by moss during the build phase.
 * Hugo writes output to context.output_dir (typically .moss/site-stage/).
 * Moss handles the zero-flicker staging pattern after this hook completes.
 *
 * ## Build Flow
 *
 * 1. Resolve Hugo binary (auto-download if needed)
 * 2. Clean and prepare .runtime directory
 * 3. Create Hugo structure from moss's parsed project info (copy files)
 * 4. Generate hugo.toml config
 * 5. Create default layouts
 * 6. Run Hugo on the translated structure
 * 7. Cleanup .runtime directory
 *
 * @param context - Build context from moss containing project info and config
 * @returns Hook result indicating success or failure
 */
export async function on_build(context: OnBuildContext & { config: PluginConfig }): Promise<HookResult> {
  const buildArgs = context.config.build_args || ["--minify"];

  // Runtime directory under plugin's .moss location
  // Using string concatenation since we can't use Node.js path module
  const runtimeDir = `${context.moss_dir}/plugins/hugo-generator/.runtime`;

  try {
    // Step 1: Resolve Hugo binary (uses configured path, system PATH, or downloads)
    reportProgress("setup", 0, 4, "Resolving Hugo binary...");
    let hugoPath: string;

    try {
      const hugoResolution = await resolveBinary(HUGO_BINARY_CONFIG, {
        configuredPath: context.config.hugo_path,
        autoDownload: true,
        onProgress: (phase, message) => {
          reportProgress(phase, 0, 4, message);
        },
      });

      hugoPath = hugoResolution.path;

      if (hugoResolution.source === "downloaded") {
        reportProgress(
          "setup",
          0,
          4,
          `Hugo ${hugoResolution.version ?? ""} downloaded and ready`
        );
      } else if (hugoResolution.version) {
        reportProgress(
          "setup",
          0,
          4,
          `Using Hugo ${hugoResolution.version} from ${hugoResolution.source}`
        );
      }
    } catch (error) {
      if (error instanceof BinaryResolutionError) {
        return {
          success: false,
          message: `Hugo setup failed: ${error.message}`,
        };
      }
      throw error;
    }

    // Step 2: Clean and prepare runtime directory
    await cleanupRuntime(runtimeDir);

    // Step 3: Translate page tree (or fall back to legacy structure scan)
    reportProgress("scaffolding", 1, 4, "Creating Hugo structure...");
    if (context.page_tree) {
      const contentDir = `${runtimeDir}/content`;
      await translatePageTree(context.page_tree, contentDir);
    } else {
      await createHugoStructure(
        context.project_path,
        context.project_info,
        runtimeDir,
        context.moss_dir
      );
    }

    // Step 4: Generate Hugo config
    await createHugoConfig(
      context.site_config,
      runtimeDir,
      context.project_path
    );

    // Step 5: Create default layouts
    await createDefaultLayouts(runtimeDir, context.project_path);

    // Step 6: Run Hugo
    reportProgress("building", 2, 4, "Running Hugo...");
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

    reportProgress("complete", 4, 4, "Hugo build complete");
    return { success: true, message: "Hugo build complete" };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to execute Hugo: ${errorMessage}`,
    };
  } finally {
    // Step 7: Cleanup runtime directory
    await cleanupRuntime(runtimeDir);
  }
}

// Register as global for moss plugin runtime
const HugoGenerator = { on_build };
(window as unknown as { HugoGenerator: typeof HugoGenerator }).HugoGenerator =
  HugoGenerator;

export default HugoGenerator;

// Re-export types for testing
export type { OnBuildContext, HookResult };
export type { PluginConfig };
