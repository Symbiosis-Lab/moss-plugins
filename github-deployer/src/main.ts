/**
 * GitHub Deployer Plugin
 *
 * Deploys sites to GitHub Pages via GitHub Actions.
 * This plugin extracts the deployment logic from the original Rust implementation
 * (src-tauri/src/preview/deploy.rs) into a TypeScript plugin.
 */

import type { OnDeployContext, HookResult } from "./types";
import { log, reportProgress, reportError, setCurrentHookName } from "./utils";
import { validateAll } from "./validation";
import { detectBranch, extractGitHubPagesUrl, commitAndPushWorkflow, parseGitHubUrl } from "./git";
import { createWorkflowFile, updateGitignore, workflowExists } from "./workflow";

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * deploy hook - Deploy to GitHub Pages via GitHub Actions
 *
 * This capability:
 * 1. Validates requirements (git repo, GitHub remote, compiled site)
 * 2. Creates GitHub Actions workflow if it doesn't exist
 * 3. Updates .gitignore to track .moss/site/
 * 4. Commits and pushes the workflow
 *
 * The actual deployment happens on GitHub when changes are pushed.
 */
async function deploy(context: OnDeployContext): Promise<HookResult> {
  setCurrentHookName("deploy");

  await log("log", "GitHub Deployer: Starting deployment...");
  await log("log", `   Project: ${context.project_path}`);

  try {
    // Phase 1: Validate requirements
    await reportProgress("validating", 1, 5, "Validating requirements...");
    const remoteUrl = await validateAll(context.project_path, context.output_dir);

    // Phase 2: Detect default branch
    await reportProgress("configuring", 2, 5, "Detecting default branch...");
    const branch = await detectBranch(context.project_path);
    await log("log", `   Default branch: ${branch}`);

    // Phase 3: Check if workflow already exists
    await reportProgress("configuring", 3, 5, "Checking workflow status...");
    const alreadyConfigured = await workflowExists(context.project_path);

    let wasFirstSetup = false;
    let commitSha = "";

    if (!alreadyConfigured) {
      wasFirstSetup = true;

      // Phase 4: Create workflow
      await reportProgress("configuring", 4, 5, "Creating GitHub Actions workflow...");
      await createWorkflowFile(context.project_path, branch);
      await updateGitignore(context.project_path);

      // Phase 5: Commit and push
      await reportProgress("deploying", 5, 5, "Pushing workflow to GitHub...");
      commitSha = await commitAndPushWorkflow(context.project_path);
      await log("log", `   Committed: ${commitSha.substring(0, 7)}`);
    }

    // Generate pages URL
    const pagesUrl = extractGitHubPagesUrl(remoteUrl);
    const parsed = parseGitHubUrl(remoteUrl);
    const repoPath = parsed ? `${parsed.owner}/${parsed.repo}` : "";

    // Build result message
    let message: string;
    if (wasFirstSetup) {
      message =
        `GitHub Pages deployment configured!\n\n` +
        `Your site will be available at: ${pagesUrl}\n\n` +
        `Next steps:\n` +
        `1. Go to https://github.com/${repoPath}/settings/pages\n` +
        `2. Under 'Build and deployment', select 'GitHub Actions'\n` +
        `3. Push any changes to trigger deployment`;
    } else {
      message =
        `GitHub Actions workflow already configured!\n\n` +
        `Your site: ${pagesUrl}\n\n` +
        `To deploy, just push your changes:\n` +
        `git add . && git commit -m "Update site" && git push`;
    }

    await reportProgress("complete", 5, 5, wasFirstSetup ? "GitHub Pages configured!" : "Ready to deploy");
    await log("log", `GitHub Deployer: ${wasFirstSetup ? "Setup complete" : "Already configured"}`);

    return {
      success: true,
      message,
      deployment: {
        method: "github-pages",
        url: pagesUrl,
        deployed_at: new Date().toISOString(),
        metadata: {
          branch,
          was_first_setup: String(wasFirstSetup),
          commit_sha: commitSha,
        },
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await reportError(errorMessage, "deploy", true);
    await log("error", `GitHub Deployer: Failed - ${errorMessage}`);

    return {
      success: false,
      message: errorMessage,
    };
  }
}

// ============================================================================
// Plugin Export
// ============================================================================

/**
 * Plugin object exported as global for the moss plugin runtime
 */
const GitHubDeployer = {
  deploy,
};

// Register plugin globally for the plugin runtime
(window as unknown as { GitHubDeployer: typeof GitHubDeployer }).GitHubDeployer = GitHubDeployer;

// Also export for module usage
export { deploy };
export default GitHubDeployer;
