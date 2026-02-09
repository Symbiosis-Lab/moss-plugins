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

import type { OnDeployContext, HookResult, DnsTarget, DnsRecord } from "./types";
import { log, reportProgress, reportError, setCurrentHookName, showToast } from "./utils";
import { validateAll, isSSHRemote, isGitRepository, isGitAvailable, initGitRepository, ensureRemote } from "./validation";
import { detectBranch, extractGitHubPagesUrl, parseGitHubUrl, tryGetRemoteUrl, deployToGhPages, branchExists, checkForChanges } from "./git";
// Note: checkAuthentication and promptLogin removed - Bug 23 fix
// For existing HTTPS remotes, git handles push auth via credential helper
import { ensureGitHubRepo } from "./repo-setup";
import { checkPagesStatus } from "./github-api";
import { getToken } from "./token";

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

/**
 * Generate DNS records for GitHub Pages custom domain configuration
 *
 * @param owner - GitHub username (for CNAME target)
 * @returns DnsTarget with A records for apex and CNAME for www
 */
function generateDnsTarget(owner: string): DnsTarget {
  const records: DnsRecord[] = [
    // A records for apex domain (@)
    ...GITHUB_PAGES_IPS.map(ip => ({
      record_type: "A",
      name: "@",
      value: ip,
    })),
    // CNAME for www subdomain
    {
      record_type: "CNAME",
      name: "www",
      value: `${owner}.github.io`,
    },
  ];

  return { records };
}

// ============================================================================
// Pages Status Polling
// ============================================================================

/**
 * Poll GitHub Pages API until site is live (max 60s)
 *
 * Feature 21: Check if deployed site is accessible before returning.
 *
 * @param owner - GitHub username
 * @param repo - Repository name
 * @param token - GitHub OAuth token (optional - if not available, skips status check)
 * @param pagesUrl - The expected GitHub Pages URL
 * @returns Object with isLive status and URL
 */
async function waitForPagesLive(
  owner: string,
  repo: string,
  token: string | null,
  pagesUrl: string
): Promise<{ isLive: boolean; url: string }> {
  // If no token available, skip status check
  if (!token) {
    await log("log", "   Status check skipped (no token available)");
    return { isLive: false, url: pagesUrl };
  }

  const maxAttempts = 6; // 6 attempts × 5s = 30s max
  const pollInterval = 5000;

  await log("log", "   Checking deployment status...");

  for (let i = 0; i < maxAttempts; i++) {
    const status = await checkPagesStatus(owner, repo, token);

    if (status.status === "built") {
      await log("log", "   Site is live!");
      return { isLive: true, url: pagesUrl };
    }

    if (status.status === "errored") {
      await log("log", "   Build failed on GitHub");
      return { isLive: false, url: pagesUrl };
    }

    // Still building - wait and retry
    if (i < maxAttempts - 1) {
      await reportProgress("deploying", 4, 5, `Building on GitHub... (${i + 1}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  // Timeout - return URL anyway with isLive: false
  await log("log", "   Status check timed out (site may still be building)");
  return { isLive: false, url: pagesUrl };
}

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
      return { success: false, message: msg };
    }
    await log("log", `   Site files: ${context.site_files.length} files ready`);

    // Phase 0: Check if we have a git repo and remote
    // If not, automatically create a repository (Feature 20)
    let remoteUrl: string;

    let wasFirstSetup = false;

    // Check if we need to set up a repository
    // Use tryGetRemoteUrl to check and get URL in one call (avoids duplicate git calls)
    const needsGitInit = !await isGitRepository();
    const existingRemoteUrl = needsGitInit ? null : await tryGetRemoteUrl();
    const needsRemote = !needsGitInit && !existingRemoteUrl;

    if (needsGitInit || needsRemote) {
      // Check if git CLI is available
      if (!await isGitAvailable()) {
        await reportError("Git is not installed. Please install git to continue.", "validation", true);
        return { success: false, message: "Git is not installed. Please install git first." };
      }

      // Feature 20: Smart repo setup - auto-create or show UI
      await reportProgress("setup", 0, 6, "Setting up GitHub repository...");
      const repoInfo = await ensureGitHubRepo();

      if (!repoInfo) {
        // User cancelled or error
        return { success: false, message: "Repository setup cancelled." };
      }

      // Initialize git if needed
      if (needsGitInit) {
        await log("log", "   Initializing git repository...");
        await reportProgress("setup", 1, 6, "Initializing git...");
        await initGitRepository();
      }

      // Add remote
      await log("log", `   Configuring remote: ${repoInfo.sshUrl}`);
      await reportProgress("setup", 2, 6, "Configuring remote...");
      await ensureRemote("origin", repoInfo.sshUrl);

      await log("log", `   Repository configured: ${repoInfo.fullName}`);
      remoteUrl = repoInfo.sshUrl;
      wasFirstSetup = true;
    } else {
      // Use the URL we already fetched
      remoteUrl = existingRemoteUrl || "";
    }

    const useSSH = remoteUrl ? isSSHRemote(remoteUrl) : false;

    if (!useSSH && remoteUrl) {
      // Bug 23 fix: Skip OAuth for existing HTTPS remotes
      // Git handles push authentication via credential helper - no OAuth needed
      // OAuth is only required when creating new repos (no remote yet)
      await log("log", "   HTTPS remote detected, git will handle push authentication");
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

    // Early change detection: If gh-pages exists, check if content has changed
    // This avoids expensive worktree operations when there are no changes to deploy
    let commitSha = "";
    if (ghPagesExisted) {
      const changeCheck = await checkForChanges();
      if (!changeCheck.hasChanges) {
        // No changes detected - skip worktree operations entirely
        await reportProgress("complete", 5, 5, "No changes to deploy");
        const pagesUrl = extractGitHubPagesUrl(remoteUrl);
        await log("log", `   No changes to deploy`);
        await log("log", `   🌐 Site URL: ${pagesUrl}`);

        const parsed = parseGitHubUrl(remoteUrl);

        const dnsTarget = parsed ? generateDnsTarget(parsed.owner) : { records: [] };

        // Show toast with clickable URL (8s duration for clickable link)
        await showToast({
          message: "No changes to deploy",
          variant: "info",
          actions: [{ label: "View site", url: pagesUrl }],
          duration: 8000,
        });

        // Return result - runtime handles completion
        return {
          success: true,
          message: `No changes to deploy.\n\nYour site: ${pagesUrl}\n\nYour local site is already up to date.`,
          deployment: {
            method: "github-pages",
            url: pagesUrl,
            deployed_at: new Date().toISOString(),
            metadata: {
              branch,
              was_first_setup: "false",
              commit_sha: "", // Empty = no changes
              is_live: "true", // Already deployed, should be live
            },
            dns_target: dnsTarget,
          },
        };
      }
    }

    // Phase 4 & 5: Deploy to gh-pages branch using worktree (zero-config approach)
    // Bug 16 fix: Use git worktree to deploy without switching current branch
    await reportProgress("deploying", 4, 5, "Deploying to gh-pages...");
    const deployResult = await deployToGhPages();
    commitSha = deployResult.commitSha;

    // Generate pages URL for logging and response
    const pagesUrl = extractGitHubPagesUrl(remoteUrl);

    // Bug 19 fix: Log the deployment result with URL immediately
    if (commitSha) {
      await log("log", `   Deployed: ${commitSha.substring(0, 7)}`);
      await log("log", `   🌐 Site URL: ${pagesUrl}`);
    } else {
      await log("log", `   No changes to deploy`);
      await log("log", `   🌐 Site URL: ${pagesUrl}`);
    }
    const parsed = parseGitHubUrl(remoteUrl);

    // Feature 21: Check if deployment is live (only if we pushed changes)
    let isLive = false;
    if (commitSha && parsed) {
      const token = await getToken();
      const liveStatus = await waitForPagesLive(parsed.owner, parsed.repo, token, pagesUrl);
      isLive = liveStatus.isLive;
    }

    // Build DNS target for custom domain configuration
    const dnsTarget = parsed ? generateDnsTarget(parsed.owner) : { records: [] };

    // Build result message based on scenario
    // Bug 16: Zero-config deployment - no manual steps needed
    // Determine toast message based on scenario
    let message: string;
    let toastMessage: string;
    let toastVariant: "success" | "info" | "error";

    if (wasFirstSetup && commitSha) {
      // Scenario 1: First-time deployment (gh-pages branch created)
      message =
        `Your site is being deployed to GitHub Pages!\n\n` +
        `Your site will be available at: ${pagesUrl}\n\n` +
        `GitHub Pages is automatically enabled for the gh-pages branch.\n` +
        `It may take a few minutes for your site to appear.`;
      toastMessage = "Deploy configured!";
      toastVariant = "success";
    } else if (commitSha) {
      // Scenario 2: Subsequent deploy with changes pushed
      message =
        `Site deployed to GitHub Pages!\n\n` +
        `Your site: ${pagesUrl}\n\n` +
        `Changes have been pushed to gh-pages branch.`;
      // Use is_live to determine if site is confirmed live
      toastMessage = isLive ? "Site is live!" : "Deploying...";
      toastVariant = "success";
    } else {
      // Scenario 3: No changes to push
      message =
        `No changes to deploy.\n\n` +
        `Your site: ${pagesUrl}\n\n` +
        `Your local site is already up to date.`;
      toastMessage = "No changes to deploy";
      toastVariant = "info";
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

    // Show toast with clickable URL (8s duration for clickable link)
    await showToast({
      message: toastMessage,
      variant: toastVariant,
      actions: [{ label: "View site", url: pagesUrl }],
      duration: 8000,
    });

    // Cleanup worktree before returning
    await deployResult.cleanup().catch(() => {
      // Silent cleanup failure is OK - temp directory will be cleaned up eventually
    });

    // Return result - runtime handles completion
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
          is_live: String(isLive),
        },
        dns_target: dnsTarget,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await reportError(errorMessage, "deploy", true);
    await log("error", `GitHub Deployer: Failed - ${errorMessage}`);

    // Categorize error for toast display
    const lowerError = errorMessage.toLowerCase();
    let toastMessage: string;
    if (lowerError.includes("permission denied") || lowerError.includes("publickey")) {
      toastMessage = "SSH key not loaded. Run ssh-add in terminal and retry.";
    } else if (lowerError.includes("timed out") || lowerError.includes("timeout")) {
      toastMessage = "Push may still be running. Check GitHub in a few minutes.";
    } else if (lowerError.includes("authentication") || lowerError.includes("auth") || lowerError.includes("token")) {
      toastMessage = "Authentication failed";
    } else if (lowerError.includes("network") || lowerError.includes("connection")) {
      toastMessage = "Network error";
    } else if (lowerError.includes("not a git repository") || lowerError.includes("no remote")) {
      toastMessage = "Git not configured";
    } else if (errorMessage.length > 50) {
      toastMessage = errorMessage.slice(0, 50) + "...";
    } else {
      toastMessage = errorMessage;
    }

    // Show error toast (5s duration, no actions needed for errors)
    await showToast({
      message: toastMessage,
      variant: "error",
      duration: 5000,
    });

    // Return result - runtime handles completion
    return { success: false, message: errorMessage };
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
