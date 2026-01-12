/**
 * Eleventy Generator Plugin for Moss
 *
 * This plugin runs Eleventy via npx to generate static sites.
 */

import {
  executeBinary,
  reportProgress,
  resolveBinary,
  BinaryResolutionError,
} from "@symbiosis-lab/moss-api";
import {
  createEleventyStructure,
  createEleventyConfig,
  cleanupRuntime,
  type ProjectInfo,
  type SourceFiles,
  type SiteConfig,
} from "./structure";
import { createDefaultLayouts, createCollectionData } from "./templates";
import { ELEVENTY_BINARY_CONFIG } from "./eleventy-config";

interface PluginConfig {
  build_args?: string[];
}

interface OnBuildContext {
  project_path: string;
  moss_dir: string;
  output_dir: string;
  project_info: ProjectInfo;
  source_files: SourceFiles;
  site_config: SiteConfig;
  config: PluginConfig;
}

interface HookResult {
  success: boolean;
  message?: string;
}

/**
 * Build hook - runs Eleventy to generate the static site.
 */
export async function on_build(context: OnBuildContext): Promise<HookResult> {
  const buildArgs = context.config.build_args || [];
  const runtimeDir = `${context.moss_dir}/plugins/eleventy-generator/.runtime`;

  try {
    // Step 1: Resolve npx binary
    reportProgress("setup", 0, 4, "Resolving npx binary...");
    let npxPath: string;

    try {
      const npxResolution = await resolveBinary(ELEVENTY_BINARY_CONFIG, {
        autoDownload: false,
        onProgress: (phase, message) => {
          reportProgress(phase, 0, 4, message);
        },
      });

      npxPath = npxResolution.path;

      if (npxResolution.version) {
        reportProgress(
          "setup",
          0,
          4,
          `Using npx ${npxResolution.version}`
        );
      }
    } catch (error) {
      if (error instanceof BinaryResolutionError) {
        return {
          success: false,
          message: `Eleventy setup failed: ${error.message}. Install Node.js from nodejs.org`,
        };
      }
      throw error;
    }

    // Step 2: Clean and prepare runtime directory
    await cleanupRuntime(runtimeDir);

    // Step 3: Create Eleventy structure
    reportProgress("scaffolding", 1, 4, "Creating Eleventy structure...");
    await createEleventyStructure(
      context.project_path,
      context.project_info,
      runtimeDir,
      context.moss_dir
    );

    // Step 4: Generate Eleventy config
    await createEleventyConfig(
      context.site_config,
      runtimeDir,
      context.project_path
    );

    // Step 5: Create default layouts
    await createDefaultLayouts(runtimeDir, context.project_path);

    // Step 6: Create collection data files for each content folder
    for (const folder of context.project_info.content_folders) {
      await createCollectionData(runtimeDir, context.project_path, folder);
    }

    // Step 7: Install dependencies
    reportProgress("building", 2, 4, "Installing Eleventy dependencies...");
    const installResult = await executeBinary({
      binaryPath: "npm",
      args: ["install", "--prefix", runtimeDir],
      timeoutMs: 300000,
    });

    if (!installResult.success) {
      return {
        success: false,
        message: `Failed to install Eleventy dependencies: ${installResult.stderr}`,
      };
    }

    // Step 8: Run Eleventy build
    reportProgress("building", 3, 4, "Running Eleventy build...");
    const result = await executeBinary({
      binaryPath: npxPath,
      args: [
        "--prefix",
        runtimeDir,
        "@11ty/eleventy",
        "--input",
        `${runtimeDir}/src`,
        "--output",
        context.output_dir,
        ...buildArgs,
      ],
      timeoutMs: 300000,
    });

    if (!result.success) {
      const errorMessage =
        result.stderr || `Eleventy exited with code ${result.exitCode}`;
      return {
        success: false,
        message: `Eleventy build failed: ${errorMessage}`,
      };
    }

    reportProgress("complete", 4, 4, "Eleventy build complete");
    return { success: true, message: "Eleventy build complete" };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to execute Eleventy: ${errorMessage}`,
    };
  } finally {
    await cleanupRuntime(runtimeDir);
  }
}

const EleventyGenerator = { on_build };
(window as unknown as { EleventyGenerator: typeof EleventyGenerator }).EleventyGenerator =
  EleventyGenerator;

export default EleventyGenerator;

export type { OnBuildContext, HookResult, PluginConfig };
