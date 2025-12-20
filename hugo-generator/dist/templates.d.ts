/**
 * Default Hugo Templates
 *
 * Provides minimal, semantic HTML templates for Hugo builds.
 * These templates are used when the user hasn't provided custom layouts.
 *
 * ## Template Hierarchy
 *
 * - `baseof.html` - Base template with HTML structure
 * - `single.html` - Individual content pages
 * - `list.html` - Section/collection list pages
 * - `index.html` - Homepage
 */
/**
 * Creates default Hugo layouts in the runtime directory.
 *
 * These layouts provide a minimal but functional template set that works
 * with any content structure. Users can override by providing their own
 * layouts in the project.
 *
 * @param runtimeDir - Path to the plugin's .runtime directory
 * @param projectPath - Absolute path to the project folder
 */
export declare function createDefaultLayouts(runtimeDir: string, projectPath: string): Promise<void>;
/**
 * Template content exports for testing.
 */
export declare const templates: {
    baseof: string;
    single: string;
    list: string;
    index: string;
};
//# sourceMappingURL=templates.d.ts.map