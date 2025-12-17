/**
 * GitHub Deployer Plugin
 *
 * Deploys sites to GitHub Pages via GitHub Actions.
 * This plugin extracts the deployment logic from the original Rust implementation
 * (src-tauri/src/preview/deploy.rs) into a TypeScript plugin.
 */
import type { OnDeployContext, HookResult } from "./types";
/**
 * on_deploy hook - Deploy to GitHub Pages via GitHub Actions
 *
 * This hook:
 * 1. Validates requirements (git repo, GitHub remote, compiled site)
 * 2. Creates GitHub Actions workflow if it doesn't exist
 * 3. Updates .gitignore to track .moss/site/
 * 4. Commits and pushes the workflow
 *
 * The actual deployment happens on GitHub when changes are pushed.
 */
declare function on_deploy(context: OnDeployContext): Promise<HookResult>;
/**
 * Plugin object exported as global for the moss plugin runtime
 */
declare const GitHubDeployer: {
    on_deploy: typeof on_deploy;
};
export { on_deploy };
export default GitHubDeployer;
//# sourceMappingURL=main.d.ts.map