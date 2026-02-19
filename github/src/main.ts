/**
 * GitHub Deployer Plugin
 *
 * Deploys sites to GitHub Pages via git push to the gh-pages branch.
 * On first-time deploy, also pushes source files to the main branch.
 *
 * Authentication:
 * - Uses OAuth Device Flow for browser-based GitHub login
 * - Stores tokens in git credential helper for persistence
 */

import type { OnDeployContext, OnConfigureDomainContext, HookResult, DnsTarget, DnsRecord } from "./types";
import { getTauriCore } from "@symbiosis-lab/moss-api";
import { log, reportProgress, reportError, setCurrentHookName, showToast, closeBrowser } from "./utils";
import { buildPagesUrl, parseGitHubUrl } from "./git";
import { verifyRepoExists, getOriginOwnerRepo, deployViaGitPush } from "./github-deploy";
import { promptLogin, validateToken, hasRequiredScopes } from "./auth";
import { ensureGitHubRepo } from "./repo-setup";
import { checkPagesStatus, setCustomDomain } from "./github-api";
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
 * deploy hook - Deploy to GitHub Pages via git push
 *
 * This capability:
 * 0. Validates requirements (git repo, GitHub remote, compiled site)
 * 1. Ensures authentication (prompts login if needed)
 * 2. Pushes source files to main branch (first-time only, non-fatal)
 * 3. Force-pushes compiled site to gh-pages via git CLI
 * 4. Verifies deployment is live
 */
async function deploy(context: OnDeployContext): Promise<HookResult> {
  setCurrentHookName("deploy");

  await log("log", "GitHub Deployer: Starting deployment...");

  // Pre-flight: resolve git binary (downloads if needed)
  await reportProgress("configuring", 1, 10, "Checking git...");
  let gitPath: string;
  try {
    gitPath = await getTauriCore().invoke<string>("resolve_git_path");
  } catch (e) {
    const msg = `Git is required for deployment. ${e instanceof Error ? e.message : String(e)}\n\nInstall git by running: xcode-select --install`;
    await reportError(msg, "validation", true);
    return { success: false, message: msg };
  }
  await log("log", `   Using git: ${gitPath}`);

  try {
    // Phase 0.5: Early validation using context.site_files (Bug 13 fix)
    // The plugin trusts moss to provide site_files - no need to call listFiles()
    if (!context.site_files || context.site_files.length === 0) {
      const msg = "Site directory is empty. Please compile your site first.";
      await reportError(msg, "validation", true);
      return { success: false, message: msg };
    }
    await log("log", `   Site files: ${context.site_files.length} files ready`);

    // Phase 0: Determine deploy target from git state (single source of truth)
    let owner: string;
    let repoName: string;
    let wasFirstSetup = false;

    const existing = await getOriginOwnerRepo(gitPath);

    if (existing) {
      // .git origin already points to a GitHub repo — use it
      owner = existing.owner;
      repoName = existing.repo;
      await log("log", `   Deploy target: ${owner}/${repoName} (from git origin)`);
    } else {
      // No .git or no GitHub origin — run setup flow
      await reportProgress("setup", 0, 10, "Setting up GitHub repository...");
      const repoInfo = await ensureGitHubRepo();

      if (!repoInfo) {
        return { success: false, message: "Repository setup cancelled." };
      }

      const parsed = parseGitHubUrl(repoInfo.sshUrl);
      if (!parsed) {
        throw new Error("Could not parse GitHub URL from setup result: " + repoInfo.sshUrl);
      }

      owner = parsed.owner;
      repoName = parsed.repo;
      wasFirstSetup = true;

      await log("log", `   Repository configured: ${repoInfo.fullName}`);
      await closeBrowser();
      await log("log", "   Browser closed - continuing deployment in background");
    }

    // Phase 1: Ensure authentication (mandatory for GitHub API + push)
    await reportProgress("configuring", 3, 10, "Checking authentication...");
    let token = await getToken();
    if (!token) {
      const gitToken = await getTokenFromGit(gitPath);
      if (gitToken) {
        const validation = await validateToken(gitToken);
        if (validation.valid && hasRequiredScopes(validation.scopes || [])) {
          await storeToken(gitToken);
          token = gitToken;
        } else {
          await log("log", "   Git credential token invalid or lacks required scopes");
        }
      }
      if (!token) {
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

    // Phase 2: Verify repository exists (fail fast with clear error)
    await verifyRepoExists(owner, repoName, token);

    // Heartbeat safety net: report progress every 30s to prevent inactivity timeout
    // Tracks current phase so heartbeat message is informative, not generic
    let commitSha = "";
    let currentPhase = "Deploying...";
    const heartbeat = setInterval(() => {
      reportProgress("deploying", 5, 10, currentPhase);
    }, 30_000);

    try {
      // Single deploy: commits source + .moss/site/, pushes to main,
      // then extracts .moss/site/ tree as orphan commit → gh-pages
      commitSha = await deployViaGitPush({
        owner,
        repo: repoName,
        token,
        gitPath,
        onProgress: (percent, message) => {
          currentPhase = message;
          // Map 0-100% to steps 5-9 of overall 10-step progress
          const step = 5 + Math.floor((percent / 100) * 4);
          reportProgress("deploying", Math.min(step, 9), 10, message);
        },
      });
    } finally {
      clearInterval(heartbeat);
    }

    // Generate pages URL for logging and response
    const pagesUrl = buildPagesUrl(owner, repoName);

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
      const liveStatus = await waitForPagesLive(owner, repoName, token, pagesUrl);
      isLive = liveStatus.isLive;
    }

    // Build DNS target for custom domain configuration
    const dnsTarget = generateDnsTarget(owner);

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
    if (lowerError.includes("timed out") || lowerError.includes("timeout")) {
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
// configure_domain Hook Implementation
// ============================================================================

/**
 * configure_domain hook - Set custom domain on GitHub Pages via API
 *
 * Called after moss-oracle configures DNS records. This hook tells GitHub
 * about the custom domain so GitHub Pages serves content on it.
 *
 * Uses the GitHub Pages API: PUT /repos/{owner}/{repo}/pages { cname: domain }
 *
 * This is NON-FATAL from moss's perspective - DNS is already configured.
 * If this fails, the user can retry or set the domain manually in GitHub settings.
 */
async function configure_domain(context: OnConfigureDomainContext): Promise<HookResult> {
  setCurrentHookName("configure_domain");

  const { domain } = context;

  await log("log", `GitHub Deployer: Configuring custom domain "${domain}"...`);

  try {
    // Get deploy target from git origin
    const repoConfig = await getOriginOwnerRepo();
    if (!repoConfig) {
      return {
        success: false,
        message: "No GitHub repository configured. Deploy first.",
      };
    }

    const { owner, repo } = repoConfig;

    // Get authentication token (should already be stored from deploy)
    let token = await getToken();
    if (!token) {
      // Try git credential helper as fallback
      token = await getTokenFromGit();
      if (token) {
        await storeToken(token);
      }
    }

    if (!token) {
      return {
        success: false,
        message: "No GitHub authentication token available. Please deploy first to authenticate.",
      };
    }

    // Call GitHub Pages API to set the custom domain
    await log("log", `   Setting CNAME to "${domain}" on ${owner}/${repo}...`);
    await setCustomDomain(owner, repo, token, domain);

    await log("log", `   Custom domain "${domain}" configured on GitHub Pages`);

    return {
      success: true,
      message: `Custom domain "${domain}" configured on GitHub Pages for ${owner}/${repo}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await log("error", `GitHub Deployer: Failed to configure domain - ${errorMessage}`);

    return {
      success: false,
      message: `Failed to set custom domain on GitHub Pages: ${errorMessage}`,
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
  configure_domain,
};

// Register plugin globally for the plugin runtime
(window as unknown as { GitHubDeployer: typeof GitHubDeployer }).GitHubDeployer = GitHubDeployer;

// Also export for module usage
export { deploy, deploy as on_deploy, configure_domain, configure_domain as on_configure_domain };
export default GitHubDeployer;
