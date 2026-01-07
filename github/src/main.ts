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

import type { OnDeployContext, HookResult, DnsTarget } from "./types";
import { log, reportProgress, reportError, setCurrentHookName } from "./utils";
import { validateAll, isSSHRemote, isGitRepository, hasRemote, isGitAvailable, initGitRepository, ensureRemote } from "./validation";
import { detectBranch, extractGitHubPagesUrl, parseGitHubUrl, getRemoteUrl, deployToGhPages, branchExists } from "./git";
import { checkAuthentication, promptLogin } from "./auth";
import { promptAndCreateRepo } from "./repo-create";
import { showRepoSetupBrowser } from "./repo-setup-browser";

// ============================================================================
// GitHub Pages DNS Configuration
// ============================================================================

/**
 * GitHub Pages A record IP addresses
 * These are the official GitHub Pages IPs for apex domain configuration
 * @see https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site#configuring-an-apex-domain
 */
const GITHUB_PAGES_IPS = [
  "185.199.108.153",
  "185.199.109.153",
  "185.199.110.153",
  "185.199.111.153",
];

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
    // Phase 0.5: Early validation using context.site_files (Bug 13 fix)
    // The plugin trusts moss to provide site_files - no need to call listFiles()
    if (!context.site_files || context.site_files.length === 0) {
      const msg = "Site directory is empty. Please compile your site first.";
      await reportError(msg, "validation", true);
      return {
        success: false,
        message: msg,
      };
    }
    await log("log", `   Site files: ${context.site_files.length} files ready`);

    // Phase 0: Check if we have a git repo and remote
    // If not, offer to create a repository
    let remoteUrl: string;

    let wasFirstSetup = false;

    // First check if this is a git repository
    if (!await isGitRepository()) {
      await log("log", "   Not a git repository");

      // Check if git CLI is available
      if (!await isGitAvailable()) {
        await reportError("Git is not installed. Please install git to continue.", "validation", true);
        return {
          success: false,
          message: "Git is not installed. Please install git first.",
        };
      }

      // Show plugin browser UI for repo setup
      await reportProgress("setup", 0, 6, "No GitHub repository configured...");
      const repoInfo = await showRepoSetupBrowser();

      if (!repoInfo) {
        // User cancelled
        return {
          success: false,
          message: "Repository setup cancelled.",
        };
      }

      // Initialize git and add remote
      await log("log", "   Initializing git repository...");
      await reportProgress("setup", 1, 6, "Initializing git...");
      await initGitRepository();

      await log("log", `   Configuring remote: ${repoInfo.sshUrl}`);
      await reportProgress("setup", 2, 6, "Configuring remote...");
      await ensureRemote("origin", repoInfo.sshUrl);

      await log("log", `   Repository configured: ${repoInfo.fullName}`);
      remoteUrl = repoInfo.sshUrl;
      wasFirstSetup = true;
    } else if (!await hasRemote()) {
      // Git repo exists but no remote - use existing dialog flow
      await log("log", "   No git remote configured");
      await reportProgress("setup", 0, 6, "No GitHub repository configured...");

      // Offer to create a repository
      const created = await promptAndCreateRepo();

      if (!created) {
        await reportError("No GitHub repository configured", "validation", true);
        return {
          success: false,
          message: "No GitHub repository configured. Please create a repository or add a remote.",
        };
      }

      await log("log", `   Repository created: ${created.fullName}`);
      remoteUrl = created.sshUrl;
      wasFirstSetup = true;
    } else {
      try {
        remoteUrl = await getRemoteUrl();
      } catch {
        remoteUrl = "";
      }
    }

    const useSSH = remoteUrl ? isSSHRemote(remoteUrl) : false;

    if (!useSSH && remoteUrl) {
      await reportProgress("authentication", 0, 6, "Checking GitHub authentication...");
      const authState = await checkAuthentication();

      if (!authState.isAuthenticated) {
        await log("log", "   HTTPS remote detected, authentication required");
        await reportProgress("authentication", 0, 6, "GitHub login required...");

        const loginSuccess = await promptLogin();

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

    // Phase 1: Validate requirements (git repo and GitHub remote)
    // Note: Site validation already done early using context.site_files (Bug 13 fix)
    await reportProgress("validating", useSSH ? 1 : 2, 6, "Validating requirements...");
    // Bug 17 fix: Pass existing remoteUrl to avoid duplicate git calls
    remoteUrl = await validateAll(remoteUrl);

    // Phase 2: Detect default branch (for logging)
    await reportProgress("configuring", 2, 5, "Detecting default branch...");
    const branch = await detectBranch();
    await log("log", `   Default branch: ${branch}`);

    // Phase 3: Check if gh-pages branch exists (first deploy or returning user)
    await reportProgress("configuring", 3, 5, "Checking deployment status...");
    const ghPagesExisted = await branchExists("gh-pages");
    wasFirstSetup = !ghPagesExisted;

    // Phase 4 & 5: Deploy to gh-pages branch using worktree (zero-config approach)
    // Bug 16 fix: Use git worktree to deploy without switching current branch
    await reportProgress("deploying", 4, 5, "Deploying to gh-pages...");
    let commitSha = await deployToGhPages();

    if (commitSha) {
      await log("log", `   Deployed: ${commitSha.substring(0, 7)}`);
    }

    // Generate pages URL and DNS target
    const pagesUrl = extractGitHubPagesUrl(remoteUrl);
    const parsed = parseGitHubUrl(remoteUrl);

    // Extract the GitHub Pages hostname for CNAME (e.g., "user.github.io")
    const pagesHostname = parsed ? `${parsed.owner}.github.io` : "";

    // Build DNS target for custom domain configuration
    const dnsTarget: DnsTarget = {
      type: "github-pages",
      a_records: GITHUB_PAGES_IPS,
      cname_target: pagesHostname,
    };

    // Build result message based on scenario
    // Bug 16: Zero-config deployment - no manual steps needed
    let message: string;
    if (wasFirstSetup && commitSha) {
      // Scenario 1: First-time deployment (gh-pages branch created)
      message =
        `Your site is being deployed to GitHub Pages!\n\n` +
        `Your site will be available at: ${pagesUrl}\n\n` +
        `GitHub Pages is automatically enabled for the gh-pages branch.\n` +
        `It may take a few minutes for your site to appear.`;
    } else if (commitSha) {
      // Scenario 2: Subsequent deploy with changes pushed
      message =
        `Site deployed to GitHub Pages!\n\n` +
        `Your site: ${pagesUrl}\n\n` +
        `Changes have been pushed to gh-pages branch.`;
    } else {
      // Scenario 3: No changes to push
      message =
        `No changes to deploy.\n\n` +
        `Your site: ${pagesUrl}\n\n` +
        `Your local site is already up to date.`;
    }

    // Final progress message based on scenario
    const progressMsg = wasFirstSetup
      ? "GitHub Pages configured!"
      : commitSha
        ? "Deployed!"
        : "No changes to deploy";
    await reportProgress("complete", 5, 5, progressMsg);

    const logMsg = wasFirstSetup
      ? "Setup complete"
      : commitSha
        ? "Changes pushed"
        : "No changes";
    await log("log", `GitHub Deployer: ${logMsg}`);

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
        dns_target: dnsTarget,
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
export { deploy, deploy as on_deploy };
export default GitHubDeployer;
