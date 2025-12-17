/**
 * Plugin-specific type definitions for the GitHub Pages Deployer Plugin
 *
 * Common types (OnDeployContext, HookResult, PluginMessage, etc.) are imported
 * from @symbiosis-lab/moss-api.
 */

// Re-export SDK types for convenience
export type {
  OnDeployContext,
  HookResult,
  DeploymentInfo,
  ProjectInfo,
  PluginMessage,
} from "@symbiosis-lab/moss-api";
