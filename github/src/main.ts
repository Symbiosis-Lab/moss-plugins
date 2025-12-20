/**
 * GitHub Deployer Plugin
 *
 * Deploys sites to GitHub Pages via GitHub Actions.
 * This plugin extracts the deployment logic from the original Rust implementation
 * (src-tauri/src/preview/deploy.rs) into a TypeScript plugin.
 *
 * Authentication:
 * - Uses OAuth Device Flow for browser-based GitHub login
 * - Stores tokens in git credential helper for persistence
 */

import type { OnDeployContext, HookResult } from "./types";
import { log, reportProgress, reportError, setCurrentHookName } from "./utils";
import { validateAll, isSSHRemote } from "./validation";
import { detectBranch, extractGitHubPagesUrl, commitAndPushWorkflow, parseGitHubUrl, getRemoteUrl } from "./git";
import { createWorkflowFile, updateGitignore, workflowExists } from "./workflow";
import { checkAuthentication, promptLogin } from "./auth";

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * deploy hook - Deploy to GitHub Pages via GitHub Actions
 *
 * This capability:
 * 0. Checks authentication (prompts login if needed for HTTPS remotes)
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

  try {
    // Phase 0: Check authentication for HTTPS remotes
    // SSH remotes use SSH keys, so we skip auth check for them
    let remoteUrl: string;
    try {
      remoteUrl = await getRemoteUrl(context.project_path);
    } catch {
      // Will be handled by validateAll
      remoteUrl = "";
    }

    const useSSH = remoteUrl ? isSSHRemote(remoteUrl) : false;

    if (!useSSH && remoteUrl) {
      await reportProgress("authentication", 0, 6, "Checking GitHub authentication...");
      const authState = await checkAuthentication(context.project_path);

      if (!authState.isAuthenticated) {
        await log("log", "   HTTPS remote detected, authentication required");
        await reportProgress("authentication", 0, 6, "GitHub login required...");

        const loginSuccess = await promptLogin(context.project_path);

        if (!loginSuccess) {
          await reportError("GitHub authentication failed or was cancelled", "authentication", true);
          return {
            success: false,
            message: "GitHub authentication failed. Please try again.",
          };
        }

        await log("log", "   Successfully authenticated with GitHub");
      } else {
        await log("log", `   Already authenticated as ${authState.username}`);
      }

      await reportProgress("authentication", 1, 6, "Authenticated");
    } else if (useSSH) {
      await log("log", "   SSH remote detected, using SSH key authentication");
    }

    // Phase 1: Validate requirements
    await reportProgress("validating", useSSH ? 1 : 2, 6, "Validating requirements...");
    remoteUrl = await validateAll(context.project_path, context.output_dir);

    // Phase 2: Detect default branch
    await reportProgress("configuring", 2, 5, "Detecting default branch...");
    const branch = await detectBranch();
    await log("log", `   Default branch: ${branch}`);

    // Phase 3: Check if workflow already exists
    await reportProgress("configuring", 3, 5, "Checking workflow status...");
    const alreadyConfigured = await workflowExists();

    let wasFirstSetup = false;
    let commitSha = "";

    if (!alreadyConfigured) {
      wasFirstSetup = true;

      // Phase 4: Create workflow
      await reportProgress("configuring", 4, 5, "Creating GitHub Actions workflow...");
      await createWorkflowFile(branch);
      await updateGitignore();

      // Phase 5: Commit and push
      await reportProgress("deploying", 5, 5, "Pushing workflow to GitHub...");
      commitSha = await commitAndPushWorkflow();
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
