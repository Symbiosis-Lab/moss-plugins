/**
 * Hugo Generator Plugin for Moss
 *
 * Runs Hugo as a subprocess to generate static sites.
 * Uses moss's existing zero-flicker preview and smart-diff infrastructure.
 */
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
export declare function on_build(context: OnBuildContext): Promise<HookResult>;
declare const HugoGenerator: {
    on_build: typeof on_build;
};
export default HugoGenerator;
//# sourceMappingURL=main.d.ts.map