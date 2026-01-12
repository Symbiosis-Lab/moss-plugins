/**
 * Gatsby Generator Plugin for Moss
 *
 * This plugin runs Gatsby via npx to generate static sites.
 */

import {
  executeBinary,
  reportProgress,
  resolveBinary,
  BinaryResolutionError,
} from "@symbiosis-lab/moss-api";
import {
  createGatsbyStructure,
  createGatsbyConfig,
  cleanupRuntime,
  type ProjectInfo,
  type SourceFiles,
  type SiteConfig,
} from "./structure";
import { createDefaultLayouts } from "./templates";
import { GATSBY_BINARY_CONFIG } from "./gatsby-config";

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
 * Build hook - runs Gatsby to generate the static site.
 */
export async function on_build(context: OnBuildContext): Promise<HookResult> {
  const buildArgs = context.config.build_args || [];
  const runtimeDir = `${context.moss_dir}/plugins/gatsby-generator/.runtime`;

  try {
    // Step 1: Resolve npx binary
    reportProgress("setup", 0, 4, "Resolving npx binary...");
    let npxPath: string;

    try {
      const npxResolution = await resolveBinary(GATSBY_BINARY_CONFIG, {
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
          message: `Gatsby setup failed: ${error.message}. Install Node.js from nodejs.org`,
        };
      }
      throw error;
    }

    // Step 2: Clean and prepare runtime directory
    await cleanupRuntime(runtimeDir);

    // Step 3: Create Gatsby structure
    reportProgress("scaffolding", 1, 4, "Creating Gatsby structure...");
    await createGatsbyStructure(
      context.project_path,
      context.project_info,
      runtimeDir,
      context.moss_dir
    );

    // Step 4: Generate Gatsby config
    await createGatsbyConfig(
      context.site_config,
      runtimeDir,
      context.project_path
    );

    // Step 5: Create default layouts
    await createDefaultLayouts(runtimeDir, context.project_path);

    // Step 6: Install dependencies
    reportProgress("building", 2, 4, "Installing Gatsby dependencies...");
    const installResult = await executeBinary({
      binaryPath: "npm",
      args: ["install", "--prefix", runtimeDir],
      timeoutMs: 300000,
    });

    if (!installResult.success) {
      return {
        success: false,
        message: `Failed to install Gatsby dependencies: ${installResult.stderr}`,
      };
    }

    // Step 7: Run Gatsby build
    reportProgress("building", 3, 4, "Running Gatsby build...");

    // Gatsby outputs to public/ by default, we need to copy to output_dir
    // or use GATSBY_BUILD_OUTPUT_DIR env variable
    const result = await executeBinary({
      binaryPath: npxPath,
      args: [
        "--prefix",
        runtimeDir,
        "gatsby",
        "build",
        "--prefix-paths",
        ...buildArgs,
      ],
      timeoutMs: 300000,
      env: {
        // Gatsby 5+ respects this env var for output directory
        GATSBY_BUILD_OUTPUT_DIR: context.output_dir,
      },
    });

    if (!result.success) {
      const errorMessage =
        result.stderr || `Gatsby exited with code ${result.exitCode}`;
      return {
        success: false,
        message: `Gatsby build failed: ${errorMessage}`,
      };
    }

    reportProgress("complete", 4, 4, "Gatsby build complete");
    return { success: true, message: "Gatsby build complete" };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to execute Gatsby: ${errorMessage}`,
    };
  } finally {
    await cleanupRuntime(runtimeDir);
  }
}

const GatsbyGenerator = { on_build };
(window as unknown as { GatsbyGenerator: typeof GatsbyGenerator }).GatsbyGenerator =
  GatsbyGenerator;

export default GatsbyGenerator;

export type { OnBuildContext, HookResult, PluginConfig };
