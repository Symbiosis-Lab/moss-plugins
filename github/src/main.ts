/**
 * GitHub Deployer Plugin
 *
 * Deploys sites to GitHub Pages via the GitHub REST API (Git Data API).
 * Uses per-file blob uploads instead of git CLI worktree+push for
 * fine-grained progress reporting and elimination of git CLI as a
 * runtime dependency for the deploy phase.
 *
 * Authentication:
 * - Uses OAuth Device Flow for browser-based GitHub login
 * - Stores tokens in git credential helper for persistence
 */

import type { OnDeployContext, HookResult, DnsTarget, DnsRecord } from "./types";
import { log, reportProgress, reportError, setCurrentHookName, showToast, closeBrowser } from "./utils";
import { validateAll, isSSHRemote, isGitRepository, isGitAvailable, initGitRepository, ensureRemote } from "./validation";
import { extractGitHubPagesUrl, parseGitHubUrl, tryGetRemoteUrl, getLocalSiteFingerprint, getLocalSourceFingerprint } from "./git";
import { getGhPagesState, getRemoteTree, diffFiles, deployViaAPI, pushSourceToMain } from "./github-deploy";
import { promptLogin } from "./auth";
import { ensureGitHubRepo } from "./repo-setup";
import { checkPagesStatus } from "./github-api";
import { getToken, getTokenFromGit, storeToken } from "./token";

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
    // Report progress FIRST to reset the 60-second inactivity timer
    // This must happen BEFORE sleep() to prevent timeout
    await reportProgress("verifying", 9, 10, `Waiting for GitHub Pages... (${i + 1}/${maxAttempts})`);

    const status = await checkPagesStatus(owner, repo, token);

    if (status.status === "built") {
      await log("log", "   Site is live!");
      return { isLive: true, url: pagesUrl };
    }

    if (status.status === "errored") {
      await log("log", "   Build failed on GitHub");
      return { isLive: false, url: pagesUrl };
    }

    // Still building - sleep before next check
    if (i < maxAttempts - 1) {
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
 * deploy hook - Deploy to GitHub Pages via REST API
 *
 * This capability:
 * 0. Validates requirements (git repo, GitHub remote, compiled site)
 * 1. Ensures authentication (prompts login if needed)
 * 2. Checks gh-pages branch state via REST API
 * 3. Compares local files against remote tree
 * 4. Uploads changed files as blobs via REST API
 * 5. Creates tree, commit, and updates gh-pages ref
 * 6. Verifies deployment is live
 */
async function deploy(context: OnDeployContext): Promise<HookResult> {
  setCurrentHookName("deploy");

  await log("log", "GitHub Deployer: Starting deployment...");

  // Site directory path from context (e.g., ".moss/site")
  const siteDir = context.output_dir;

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
      await reportProgress("setup", 0, 10, "Setting up GitHub repository...");
      const repoInfo = await ensureGitHubRepo();

      if (!repoInfo) {
        // User cancelled or error
        return { success: false, message: "Repository setup cancelled." };
      }

      // Initialize git if needed
      if (needsGitInit) {
        await log("log", "   Initializing git repository...");
        await reportProgress("setup", 1, 10, "Initializing git...");
        await initGitRepository();
      }

      // Add remote
      await log("log", `   Configuring remote: ${repoInfo.sshUrl}`);
      await reportProgress("setup", 2, 10, "Configuring remote...");
      await ensureRemote("origin", repoInfo.sshUrl);

      await log("log", `   Repository configured: ${repoInfo.fullName}`);
      remoteUrl = repoInfo.sshUrl;

      // Close the plugin browser after repo setup completes
      // The browser was used to show the repo creation form (if needed)
      // Now that setup is done, close it and continue deployment in background
      await closeBrowser();
      await log("log", "   Browser closed - continuing deployment in background");
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
    await reportProgress("validating", useSSH ? 1 : 2, 10, "Validating requirements...");
    // Bug 17 fix: Pass existing remoteUrl to avoid duplicate git calls
    remoteUrl = await validateAll(remoteUrl);

    // Phase 2: Parse URL + ensure authentication (mandatory for REST API)
    await reportProgress("configuring", 3, 10, "Checking repository...");
    const parsed = parseGitHubUrl(remoteUrl);
    if (!parsed) {
      throw new Error("Could not parse GitHub URL from remote: " + remoteUrl);
    }

    // Ensure we have a valid token (mandatory for REST API)
    let token = await getToken();
    if (!token) {
      // Try git credential helper
      const gitToken = await getTokenFromGit();
      if (gitToken) {
        await storeToken(gitToken);
        token = gitToken;
      } else {
        // Must authenticate via OAuth
        await reportProgress("authenticating", 3, 10, "Authentication required...");
        const authResult = await promptLogin();
        if (!authResult) {
          return { success: false, message: "Authentication required for deployment. Please try again." };
        }
        token = await getToken();
        if (!token) {
          return { success: false, message: "Authentication failed. No valid token available." };
        }
      }
    }

    // Phase 3: Check gh-pages state via REST API
    await reportProgress("detecting", 4, 10, "Checking deployment status...");
    const ghPagesState = await getGhPagesState(parsed.owner, parsed.repo, token);
    // First deploy = no gh-pages branch yet (includes brand-new repos)
    wasFirstSetup = !ghPagesState.exists;

    // Phase 4: Compare local vs remote
    await reportProgress("detecting", 5, 10, "Comparing files...");
    const localFingerprint = await getLocalSiteFingerprint(siteDir);
    if (!localFingerprint || localFingerprint.size === 0) {
      throw new Error("No site files found in " + siteDir);
    }

    let remoteTree: Map<string, { sha: string; mode: string }> | null = null;
    if (ghPagesState.exists) {
      remoteTree = await getRemoteTree(parsed.owner, parsed.repo, ghPagesState.treeSha, token);
    }

    const { changed, deleted } = diffFiles(localFingerprint, remoteTree);

    // No changes - early exit
    let commitSha = "";
    if (changed.length === 0 && deleted.length === 0) {
      await reportProgress("complete", 10, 10, "No changes to deploy");
      const pagesUrl = extractGitHubPagesUrl(remoteUrl);
      await log("log", "   No changes to deploy");
      await log("log", `   Site URL: ${pagesUrl}`);

      const dnsTarget = generateDnsTarget(parsed.owner);

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
            branch: "gh-pages",
            was_first_setup: "false",
            commit_sha: "", // Empty = no changes
            is_live: "true", // Already deployed, should be live
          },
          dns_target: dnsTarget,
        },
      };
    }

    // Phase 5-8: Deploy via REST API
    await reportProgress("deploying", 6, 10, "Uploading files...");
    await log("log", `   Deploying ${changed.length} changed, ${deleted.length} deleted files via REST API...`);
    commitSha = await deployViaAPI({
      owner: parsed.owner,
      repo: parsed.repo,
      token,
      siteDir,
      changed,
      deleted,
      ghPagesState,
      onProgress: (current, total, message) => {
        // Map upload progress to steps 6-8 out of 10
        const step = 6 + Math.floor((current / total) * 2);
        reportProgress("deploying", Math.min(step, 8), 10, message);
      },
    });

    // Push source files to main (first-time deploy only)
    // When needsGitInit was true, the repo was just created with auto_init=false
    // (completely empty - no branches). Source push backs up the user's markdown files.
    if (needsGitInit && commitSha) {
      try {
        await reportProgress("deploying", 8, 10, "Backing up source files...");
        const sourceFingerprint = await getLocalSourceFingerprint(context.project_path);
        if (sourceFingerprint && sourceFingerprint.size > 0) {
          await pushSourceToMain({
            owner: parsed.owner,
            repo: parsed.repo,
            token,
            projectRoot: context.project_path,
            sourceFingerprint,
            onProgress: (_current, _total, message) => {
              reportProgress("deploying", 8, 10, message);
            },
          });
          await log("log", `   Source files pushed to main (${sourceFingerprint.size} files)`);
        }
      } catch (error) {
        // Non-fatal: gh-pages deploy already succeeded
        await log("warn", `   Source push to main failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Generate pages URL for logging and response
    const pagesUrl = extractGitHubPagesUrl(remoteUrl);

    // Log the deployment result with URL immediately
    if (commitSha) {
      await log("log", `   Deployed: ${commitSha.substring(0, 7)}`);
      await log("log", `   Site URL: ${pagesUrl}`);
    } else {
      await log("log", "   No changes to deploy");
      await log("log", `   Site URL: ${pagesUrl}`);
    }

    // Phase 9: Check if deployment is live (only if we pushed changes)
    let isLive = false;
    if (commitSha) {
      const liveStatus = await waitForPagesLive(parsed.owner, parsed.repo, token, pagesUrl);
      isLive = liveStatus.isLive;
    }

    // Build DNS target for custom domain configuration
    const dnsTarget = generateDnsTarget(parsed.owner);

    // Build result message based on scenario
    // Zero-config deployment - no manual steps needed
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

    // Phase 10: Final progress message based on scenario
    const progressMsg = wasFirstSetup
      ? "GitHub Pages configured!"
      : commitSha
        ? "Deployed!"
        : "No changes to deploy";
    await reportProgress("complete", 10, 10, progressMsg);

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

    // Return result - runtime handles completion
    return {
      success: true,
      message,
      deployment: {
        method: "github-pages",
        url: pagesUrl,
        deployed_at: new Date().toISOString(),
        metadata: {
          branch: "gh-pages",
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
