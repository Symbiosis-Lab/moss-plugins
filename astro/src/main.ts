/**
 * Astro Generator Plugin for Moss
 *
 * This plugin runs Astro via npx to generate static sites.
 */

import {
  executeBinary,
  reportProgress,
  resolveBinary,
  BinaryResolutionError,
} from "@symbiosis-lab/moss-api";
import {
  createAstroStructure,
  createAstroConfig,
  cleanupRuntime,
  type ProjectInfo,
  type SourceFiles,
  type SiteConfig,
} from "./structure";
import { createDefaultLayouts } from "./templates";
import { ASTRO_BINARY_CONFIG } from "./astro-config";

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
 * Build hook - runs Astro to generate the static site.
 */
export async function on_build(context: OnBuildContext): Promise<HookResult> {
  const buildArgs = context.config.build_args || [];
  const runtimeDir = `${context.moss_dir}/plugins/astro-generator/.runtime`;

  try {
    // Step 1: Resolve npx binary
    reportProgress("setup", 0, 4, "Resolving npx binary...");
    let npxPath: string;

    try {
      const npxResolution = await resolveBinary(ASTRO_BINARY_CONFIG, {
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
          message: `Astro setup failed: ${error.message}. Install Node.js from nodejs.org`,
        };
      }
      throw error;
    }

    // Step 2: Clean and prepare runtime directory
    await cleanupRuntime(runtimeDir);

    // Step 3: Create Astro structure
    reportProgress("scaffolding", 1, 4, "Creating Astro structure...");
    await createAstroStructure(
      context.project_path,
      context.project_info,
      runtimeDir,
      context.moss_dir
    );

    // Step 4: Generate Astro config
    await createAstroConfig(
      context.site_config,
      runtimeDir,
      context.project_path
    );

    // Step 5: Create default layouts
    await createDefaultLayouts(runtimeDir, context.project_path);

    // Step 6: Install dependencies
    reportProgress("building", 2, 4, "Installing Astro dependencies...");
    const installResult = await executeBinary({
      binaryPath: "npm",
      args: ["install", "--prefix", runtimeDir],
      timeoutMs: 300000,
    });

    if (!installResult.success) {
      return {
        success: false,
        message: `Failed to install Astro dependencies: ${installResult.stderr}`,
      };
    }

    // Step 7: Run Astro build
    reportProgress("building", 3, 4, "Running Astro build...");
    const result = await executeBinary({
      binaryPath: npxPath,
      args: [
        "--prefix",
        runtimeDir,
        "astro",
        "build",
        "--outDir",
        context.output_dir,
        ...buildArgs,
      ],
      timeoutMs: 300000,
    });

    if (!result.success) {
      const errorMessage =
        result.stderr || `Astro exited with code ${result.exitCode}`;
      return {
        success: false,
        message: `Astro build failed: ${errorMessage}`,
      };
    }

    reportProgress("complete", 4, 4, "Astro build complete");
    return { success: true, message: "Astro build complete" };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to execute Astro: ${errorMessage}`,
    };
  } finally {
    await cleanupRuntime(runtimeDir);
  }
}

const AstroGenerator = { on_build };
(window as unknown as { AstroGenerator: typeof AstroGenerator }).AstroGenerator =
  AstroGenerator;

export default AstroGenerator;

export type { OnBuildContext, HookResult, PluginConfig };
