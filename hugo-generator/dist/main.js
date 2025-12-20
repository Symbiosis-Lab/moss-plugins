/**
 * Hugo Generator Plugin for Moss
 *
 * Runs Hugo as a subprocess to generate static sites.
 * Uses moss's existing zero-flicker preview and smart-diff infrastructure.
 */
import { executeBinary, reportProgress } from "@symbiosis-lab/moss-api";
/**
 * Build hook - runs Hugo to generate the static site.
 *
 * Hugo writes output to context.output_dir (typically .moss/site-stage/).
 * Moss handles the zero-flicker staging pattern after this hook completes.
 *
 * @param context - Build context from moss
 * @returns Hook result indicating success or failure
 */
export async function on_build(context) {
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
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            message: `Failed to execute Hugo: ${errorMessage}`,
        };
    }
}
// Register as global for moss plugin runtime
const HugoGenerator = { on_build };
window.HugoGenerator =
    HugoGenerator;
export default HugoGenerator;
//# sourceMappingURL=main.js.map