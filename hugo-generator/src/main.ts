/**
 * Hugo Generator Plugin for Moss
 *
 * Runs Hugo as a subprocess to generate static sites.
 * Uses moss's existing zero-flicker preview and smart-diff infrastructure.
 */

import { executeBinary, reportProgress } from "@symbiosis-lab/moss-api";

/**
 * Context provided by moss for the on_build hook.
 * Note: This extends the base moss-api types with output_dir which
 * is provided by the Rust backend for generator plugins.
 */
interface OnBuildContext {
  project_path: string;
  moss_dir: string;
  output_dir: string;
  project_info: {
    project_type: string;
    content_folders: string[];
    total_files: number;
    homepage_file?: string;
  };
  source_files: {
    markdown: string[];
    pages: string[];
    docx: string[];
    other: string[];
  };
  site_config: Record<string, unknown>;
  config: {
    hugo_path?: string;
    build_args?: string[];
  };
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
 * Hugo writes output to context.output_dir (typically .moss/site-stage/).
 * Moss handles the zero-flicker staging pattern after this hook completes.
 *
 * @param context - Build context from moss
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
      const errorMessage = result.stderr || `Hugo exited with code ${result.exitCode}`;
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
