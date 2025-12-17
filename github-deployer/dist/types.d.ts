/**
 * Plugin-specific type definitions for the GitHub Pages Deployer Plugin
 *
 * Common types (OnDeployContext, HookResult, PluginMessage, etc.) are imported
 * from moss-plugin-sdk.
 */
export type { OnDeployContext, HookResult, DeploymentInfo, ProjectInfo, PluginMessage, } from "moss-plugin-sdk";
/**
 * Result from executing a binary command via Tauri
 */
export interface BinaryResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exit_code: number;
}
//# sourceMappingURL=types.d.ts.map