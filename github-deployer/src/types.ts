/**
 * Plugin-specific type definitions for the GitHub Pages Deployer Plugin
 *
 * Common types (OnDeployContext, HookResult, PluginMessage, etc.) are imported
 * from @moss/api.
 */

// Re-export SDK types for convenience
export type {
  OnDeployContext,
  HookResult,
  DeploymentInfo,
  ProjectInfo,
  PluginMessage,
} from "moss-api";

// ============================================================================
// Plugin-Specific Types
// ============================================================================

/**
 * Result from executing a binary command via Tauri
 */
export interface BinaryResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number;
}
