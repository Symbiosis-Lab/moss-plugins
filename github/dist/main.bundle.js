"use strict";
var GitHubDeployer = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // dist/main.js
  var main_exports = {};
  __export(main_exports, {
    default: () => main_default,
    on_deploy: () => on_deploy
  });

  // node_modules/@symbiosis-lab/moss-api/dist/index.mjs
  function getTauriCore() {
    const w = window;
    if (!w.__TAURI__?.core) throw new Error("Tauri core not available");
    return w.__TAURI__.core;
  }
  function isTauriAvailable() {
    return !!window.__TAURI__?.core;
  }
  var currentPluginName = "";
  var currentHookName = "";
  function setMessageContext(pluginName, hookName) {
    currentPluginName = pluginName;
    currentHookName = hookName;
  }
  async function sendMessage(message) {
    if (!isTauriAvailable()) return;
    try {
      await getTauriCore().invoke("plugin_message", {
        pluginName: currentPluginName,
        hookName: currentHookName,
        message
      });
    } catch {
    }
  }
  async function reportProgress(phase, current, total, message) {
    await sendMessage({
      type: "progress",
      phase,
      current,
      total,
      message
    });
  }
  async function reportError(error$1, context, fatal = false) {
    await sendMessage({
      type: "error",
      error: error$1,
      context,
      fatal
    });
  }
  async function openBrowser(url) {
    await getTauriCore().invoke("open_plugin_browser", { url });
  }
  async function closeBrowser() {
    await getTauriCore().invoke("close_plugin_browser", {});
  }
  async function readFile(projectPath, relativePath) {
    return getTauriCore().invoke("read_project_file", {
      projectPath,
      relativePath
    });
  }
  async function writeFile(projectPath, relativePath, content) {
    await getTauriCore().invoke("write_project_file", {
      projectPath,
      relativePath,
      data: content
    });
  }
  async function listFiles(projectPath) {
    return getTauriCore().invoke("list_project_files", { projectPath });
  }
  async function fileExists(projectPath, relativePath) {
    try {
      await readFile(projectPath, relativePath);
      return true;
    } catch {
      return false;
    }
  }
  async function executeBinary(options) {
    const { binaryPath, args, workingDir, timeoutMs = 6e4, env } = options;
    const result = await getTauriCore().invoke("execute_binary", {
      binaryPath,
      args,
      workingDir,
      timeoutMs,
      env
    });
    return {
      success: result.success,
      exitCode: result.exit_code,
      stdout: result.stdout,
      stderr: result.stderr
    };
  }
  async function getPluginCookie(pluginName, projectPath) {
    return getTauriCore().invoke("get_plugin_cookie", {
      pluginName,
      projectPath
    });
  }
  async function setPluginCookie(pluginName, projectPath, cookies) {
    await getTauriCore().invoke("set_plugin_cookie", {
      pluginName,
      projectPath,
      cookies
    });
  }

  // dist/utils.js
  var PLUGIN_NAME = "github-deployer";
  setMessageContext(PLUGIN_NAME, "on_deploy");
  function setCurrentHookName(name) {
    setMessageContext(PLUGIN_NAME, name);
  }
  async function log(level, message) {
    console[level](message);
    const sdkLevel = level === "info" ? "log" : level;
    await sendMessage({ type: "log", level: sdkLevel, message });
  }
  async function reportProgress2(phase, current, total, message) {
    await reportProgress(phase, current, total, message);
  }
  async function reportError2(error, context, fatal = false) {
    await reportError(error, context, fatal);
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // dist/git.js
  async function runGit(args, cwd) {
    await log("log", `   git ${args.join(" ")}`);
    const result = await executeBinary({
      binaryPath: "git",
      args,
      workingDir: cwd,
      timeoutMs: 6e4
    });
    if (!result.success) {
      const error = result.stderr || `Git command failed with exit code ${result.exitCode}`;
      throw new Error(error);
    }
    return result.stdout.trim();
  }
  async function getRemoteUrl(projectPath) {
    return runGit(["remote", "get-url", "origin"], projectPath);
  }
  async function detectBranch(projectPath) {
    try {
      const branch = await runGit(["branch", "--show-current"], projectPath);
      if (branch) {
        return branch;
      }
    } catch {
    }
    try {
      await runGit(["rev-parse", "--verify", "main"], projectPath);
      return "main";
    } catch {
    }
    try {
      await runGit(["rev-parse", "--verify", "master"], projectPath);
      return "master";
    } catch {
      return "main";
    }
  }
  async function isGitRepository(projectPath) {
    try {
      await runGit(["rev-parse", "--git-dir"], projectPath);
      return true;
    } catch {
      return false;
    }
  }
  async function hasGitRemote(projectPath) {
    try {
      await getRemoteUrl(projectPath);
      return true;
    } catch {
      return false;
    }
  }
  async function stageFiles(projectPath, files) {
    await runGit(["add", ...files], projectPath);
  }
  async function commit(projectPath, message) {
    await runGit(["commit", "-m", message], projectPath);
    return runGit(["rev-parse", "HEAD"], projectPath);
  }
  async function push(projectPath) {
    await runGit(["push"], projectPath);
  }
  async function commitAndPushWorkflow(projectPath) {
    await log("log", "   Staging workflow and gitignore...");
    await stageFiles(projectPath, [".github/workflows/moss-deploy.yml", ".gitignore"]);
    await log("log", "   Creating commit...");
    const sha = await commit(projectPath, "Add GitHub Pages deployment workflow\n\nGenerated by Moss");
    await log("log", "   Pushing to remote...");
    await push(projectPath);
    return sha;
  }
  function parseGitHubUrl(remoteUrl) {
    const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(\.git)?$/);
    if (httpsMatch) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }
    const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/([^/.]+)(\.git)?$/);
    if (sshMatch) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }
    return null;
  }
  function extractGitHubPagesUrl(remoteUrl) {
    const parsed = parseGitHubUrl(remoteUrl);
    if (!parsed) {
      throw new Error("Could not parse GitHub URL from remote");
    }
    return `https://${parsed.owner}.github.io/${parsed.repo}`;
  }

  // dist/validation.js
  function isSSHRemote(remoteUrl) {
    return remoteUrl.startsWith("git@") || remoteUrl.startsWith("ssh://");
  }
  async function validateGitRepository(projectPath) {
    const isRepo = await isGitRepository(projectPath);
    if (!isRepo) {
      throw new Error("This folder is not a git repository.\n\nTo publish to GitHub Pages, you need to:\n1. Run: git init\n2. Create a GitHub repository\n3. Add it as remote: git remote add origin <url>");
    }
  }
  async function validateSiteCompiled(projectPath, outputDir) {
    try {
      const allFiles = await listFiles(projectPath);
      const siteFiles = allFiles.filter((f) => f.startsWith(outputDir));
      if (siteFiles.length === 0) {
        throw new Error("Site directory is empty. Please compile your site first.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("empty")) {
        throw error;
      }
      throw new Error("Site not found at .moss/site\n\nPlease compile your site first.");
    }
  }
  async function validateGitHubRemote(projectPath) {
    const hasRemote = await hasGitRemote(projectPath);
    if (!hasRemote) {
      throw new Error("No git remote configured.\n\nTo publish, you need to:\n1. Create a GitHub repository\n2. Add it as remote: git remote add origin <url>");
    }
    const remoteUrl = await getRemoteUrl(projectPath);
    if (!remoteUrl.includes("github.com")) {
      throw new Error(`Remote '${remoteUrl}' is not a GitHub URL.

GitHub Pages deployment only works with GitHub repositories.
Please add a GitHub remote or use a different deployment method.`);
    }
    return remoteUrl;
  }
  async function validateAll(projectPath, outputDir) {
    await log("log", "   Validating git repository...");
    await validateGitRepository(projectPath);
    await log("log", "   Validating compiled site...");
    const relativeOutputDir = outputDir.startsWith(projectPath) ? outputDir.slice(projectPath.length).replace(/^\//, "") : outputDir;
    await validateSiteCompiled(projectPath, relativeOutputDir);
    await log("log", "   Validating GitHub remote...");
    const remoteUrl = await validateGitHubRemote(projectPath);
    await log("log", "   All validations passed");
    return remoteUrl;
  }

  // dist/workflow.js
  var WORKFLOW_TEMPLATE = `# Moss GitHub Pages Deployment
# This workflow deploys your pre-built site from .moss/site/ to GitHub Pages
# Generated by Moss - https://github.com/anthropics/moss

name: Deploy to GitHub Pages

on:
  push:
    branches: [BRANCH_PLACEHOLDER]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Pages
        uses: actions/configure-pages@v4

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: .moss/site

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
`;
  function generateWorkflowContent(branch) {
    return WORKFLOW_TEMPLATE.replace("BRANCH_PLACEHOLDER", branch);
  }
  async function createWorkflowFile(projectPath, branch) {
    await log("log", "   Creating .github/workflows/moss-deploy.yml...");
    const content = generateWorkflowContent(branch);
    await writeFile(projectPath, ".github/workflows/moss-deploy.yml", content);
    await log("log", "   Workflow file created");
  }
  async function updateGitignore(projectPath) {
    await log("log", "   Updating .gitignore...");
    let currentContent = "";
    try {
      currentContent = await readFile(projectPath, ".gitignore");
    } catch {
    }
    const hasMossIgnore = currentContent.split("\n").some((line) => {
      const trimmed = line.trim();
      return trimmed === ".moss/" || trimmed === ".moss" || trimmed === "/.moss/" || trimmed === "/.moss";
    });
    const hasSiteException = currentContent.split("\n").some((line) => {
      const trimmed = line.trim();
      return trimmed === "!.moss/site/" || trimmed === "!.moss/site";
    });
    if (hasMossIgnore && hasSiteException) {
      await log("log", "   .gitignore already configured correctly");
      return;
    }
    let newContent = currentContent;
    if (newContent && !newContent.endsWith("\n")) {
      newContent += "\n";
    }
    if (!hasMossIgnore) {
      newContent += "\n# Moss build artifacts (except site/)\n";
      newContent += ".moss/*\n";
    }
    if (!hasSiteException) {
      newContent += "!.moss/site/\n";
    }
    await writeFile(projectPath, ".gitignore", newContent);
    await log("log", "   .gitignore updated");
  }
  async function workflowExists(projectPath) {
    return fileExists(projectPath, ".github/workflows/moss-deploy.yml");
  }

  // dist/token.js
  var GITHUB_HOST = "github.com";
  var TOKEN_COOKIE_NAME = "__github_access_token";
  var PLUGIN_NAME2 = "github-deployer";
  var cachedToken = null;
  async function storeToken(token, projectPath) {
    try {
      await log("log", "   Storing GitHub access token...");
      try {
        await setPluginCookie(PLUGIN_NAME2, projectPath, [
          {
            name: TOKEN_COOKIE_NAME,
            value: token,
            domain: GITHUB_HOST
          }
        ]);
        await log("log", "   Token stored in plugin cookies");
      } catch (error) {
        await log("warn", `   Could not store in cookies: ${error}`);
      }
      cachedToken = token;
      await log("log", "   Token stored successfully");
      return true;
    } catch (error) {
      await log("error", `   Error storing token: ${error}`);
      return false;
    }
  }
  async function getToken(projectPath) {
    if (cachedToken) {
      return cachedToken;
    }
    try {
      const cookies = await getPluginCookie(PLUGIN_NAME2, projectPath);
      const tokenCookie = cookies.find((c) => c.name === TOKEN_COOKIE_NAME);
      if (tokenCookie) {
        cachedToken = tokenCookie.value;
        return cachedToken;
      }
    } catch {
    }
    return null;
  }
  async function clearToken(projectPath) {
    try {
      await log("log", "   Clearing GitHub access token...");
      try {
        await setPluginCookie(PLUGIN_NAME2, projectPath, []);
      } catch {
      }
      cachedToken = null;
      await log("log", "   Token cleared successfully");
      return true;
    } catch (error) {
      await log("error", `   Error clearing token: ${error}`);
      return false;
    }
  }

  // dist/auth.js
  var CLIENT_ID = "Ov23li8HTgRH8nuO16oK";
  var REQUIRED_SCOPES = ["repo", "workflow"];
  var GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
  var GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
  var GITHUB_API_USER_URL = "https://api.github.com/user";
  var MAX_POLL_TIME_MS = 3e5;
  async function requestDeviceCode() {
    await log("log", "   Requesting device code from GitHub...");
    const response = await fetch(GITHUB_DEVICE_CODE_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        scope: REQUIRED_SCOPES.join(" ")
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to request device code: ${response.status} ${errorText}`);
    }
    const data = await response.json();
    if (data.error) {
      throw new Error(`GitHub error: ${data.error_description || data.error}`);
    }
    await log("log", `   Device code received. User code: ${data.user_code}`);
    return data;
  }
  async function pollForToken(deviceCode, _interval) {
    const response = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to poll for token: ${response.status} ${errorText}`);
    }
    return await response.json();
  }
  async function validateToken(token) {
    try {
      const response = await fetch(GITHUB_API_USER_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Moss-GitHub-Deployer"
        }
      });
      if (!response.ok) {
        return { valid: false };
      }
      const user = await response.json();
      const scopeHeader = response.headers.get("X-OAuth-Scopes") || "";
      const scopes = scopeHeader.split(",").map((s) => s.trim()).filter(Boolean);
      return { valid: true, user, scopes };
    } catch {
      return { valid: false };
    }
  }
  function hasRequiredScopes(scopes) {
    return REQUIRED_SCOPES.every((required) => scopes.includes(required));
  }
  async function checkAuthentication(projectPath) {
    await log("log", "   Checking GitHub authentication...");
    const token = await getToken(projectPath);
    if (!token) {
      await log("log", "   No token found in credential helper");
      return { isAuthenticated: false };
    }
    const validation = await validateToken(token);
    if (!validation.valid) {
      await log("log", "   Token is invalid or expired");
      await clearToken(projectPath);
      return { isAuthenticated: false };
    }
    if (!hasRequiredScopes(validation.scopes || [])) {
      await log("warn", `   Token missing required scopes. Has: ${validation.scopes?.join(", ")}, needs: ${REQUIRED_SCOPES.join(", ")}`);
      return { isAuthenticated: false };
    }
    await log("log", `   Authenticated as ${validation.user?.login}`);
    return {
      isAuthenticated: true,
      username: validation.user?.login,
      scopes: validation.scopes
    };
  }
  async function promptLogin(projectPath) {
    try {
      await reportProgress2("authentication", 0, 4, "Requesting authorization...");
      const deviceCodeResponse = await requestDeviceCode();
      await reportProgress2("authentication", 1, 4, `Enter code: ${deviceCodeResponse.user_code}`);
      await log("log", `   Opening browser for GitHub authorization...`);
      await log("log", `   Enter code: ${deviceCodeResponse.user_code}`);
      await openBrowser(deviceCodeResponse.verification_uri);
      await reportProgress2("authentication", 2, 4, "Waiting for authorization...");
      const token = await waitForToken(deviceCodeResponse.device_code, deviceCodeResponse.interval, deviceCodeResponse.expires_in * 1e3);
      if (!token) {
        await log("warn", "   Authorization timed out or was denied");
        try {
          await closeBrowser();
        } catch {
        }
        return false;
      }
      await reportProgress2("authentication", 3, 4, "Storing credentials...");
      const stored = await storeToken(token, projectPath);
      if (!stored) {
        await log("warn", "   Failed to store token in credential helper");
      }
      try {
        await closeBrowser();
      } catch {
      }
      await reportProgress2("authentication", 4, 4, "Authenticated");
      await log("log", "   Successfully authenticated with GitHub");
      return true;
    } catch (error) {
      await log("error", `   Authentication failed: ${error}`);
      try {
        await closeBrowser();
      } catch {
      }
      return false;
    }
  }
  async function waitForToken(deviceCode, initialInterval, maxWaitMs) {
    const startTime = Date.now();
    let interval = initialInterval;
    while (Date.now() - startTime < Math.min(maxWaitMs, MAX_POLL_TIME_MS)) {
      await sleep(interval * 1e3);
      try {
        const response = await pollForToken(deviceCode, interval);
        if (response.access_token) {
          return response.access_token;
        }
        if (response.error === "authorization_pending") {
          continue;
        }
        if (response.error === "slow_down") {
          interval += 5;
          await log("log", `   Slowing down, new interval: ${interval}s`);
          continue;
        }
        if (response.error === "expired_token") {
          await log("warn", "   Device code expired");
          return null;
        }
        if (response.error === "access_denied") {
          await log("warn", "   User denied authorization");
          return null;
        }
        await log("error", `   Unexpected error: ${response.error}`);
        return null;
      } catch (error) {
        await log("error", `   Poll error: ${error}`);
      }
    }
    await log("warn", "   Authorization timeout");
    return null;
  }

  // dist/main.js
  async function on_deploy(context) {
    setCurrentHookName("on_deploy");
    await log("log", "GitHub Deployer: Starting deployment...");
    await log("log", `   Project: ${context.project_path}`);
    try {
      let remoteUrl;
      try {
        remoteUrl = await getRemoteUrl(context.project_path);
      } catch {
        remoteUrl = "";
      }
      const useSSH = remoteUrl ? isSSHRemote(remoteUrl) : false;
      if (!useSSH && remoteUrl) {
        await reportProgress2("authentication", 0, 6, "Checking GitHub authentication...");
        const authState = await checkAuthentication(context.project_path);
        if (!authState.isAuthenticated) {
          await log("log", "   HTTPS remote detected, authentication required");
          await reportProgress2("authentication", 0, 6, "GitHub login required...");
          const loginSuccess = await promptLogin(context.project_path);
          if (!loginSuccess) {
            await reportError2("GitHub authentication failed or was cancelled", "authentication", true);
            return {
              success: false,
              message: "GitHub authentication failed. Please try again."
            };
          }
          await log("log", "   Successfully authenticated with GitHub");
        } else {
          await log("log", `   Already authenticated as ${authState.username}`);
        }
        await reportProgress2("authentication", 1, 6, "Authenticated");
      } else if (useSSH) {
        await log("log", "   SSH remote detected, using SSH key authentication");
      }
      await reportProgress2("validating", useSSH ? 1 : 2, 6, "Validating requirements...");
      remoteUrl = await validateAll(context.project_path, context.output_dir);
      await reportProgress2("configuring", 2, 5, "Detecting default branch...");
      const branch = await detectBranch(context.project_path);
      await log("log", `   Default branch: ${branch}`);
      await reportProgress2("configuring", 3, 5, "Checking workflow status...");
      const alreadyConfigured = await workflowExists(context.project_path);
      let wasFirstSetup = false;
      let commitSha = "";
      if (!alreadyConfigured) {
        wasFirstSetup = true;
        await reportProgress2("configuring", 4, 5, "Creating GitHub Actions workflow...");
        await createWorkflowFile(context.project_path, branch);
        await updateGitignore(context.project_path);
        await reportProgress2("deploying", 5, 5, "Pushing workflow to GitHub...");
        commitSha = await commitAndPushWorkflow(context.project_path);
        await log("log", `   Committed: ${commitSha.substring(0, 7)}`);
      }
      const pagesUrl = extractGitHubPagesUrl(remoteUrl);
      const parsed = parseGitHubUrl(remoteUrl);
      const repoPath = parsed ? `${parsed.owner}/${parsed.repo}` : "";
      let message;
      if (wasFirstSetup) {
        message = `GitHub Pages deployment configured!

Your site will be available at: ${pagesUrl}

Next steps:
1. Go to https://github.com/${repoPath}/settings/pages
2. Under 'Build and deployment', select 'GitHub Actions'
3. Push any changes to trigger deployment`;
      } else {
        message = `GitHub Actions workflow already configured!

Your site: ${pagesUrl}

To deploy, just push your changes:
git add . && git commit -m "Update site" && git push`;
      }
      await reportProgress2("complete", 5, 5, wasFirstSetup ? "GitHub Pages configured!" : "Ready to deploy");
      await log("log", `GitHub Deployer: ${wasFirstSetup ? "Setup complete" : "Already configured"}`);
      return {
        success: true,
        message,
        deployment: {
          method: "github-pages",
          url: pagesUrl,
          deployed_at: (/* @__PURE__ */ new Date()).toISOString(),
          metadata: {
            branch,
            was_first_setup: String(wasFirstSetup),
            commit_sha: commitSha
          }
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await reportError2(errorMessage, "on_deploy", true);
      await log("error", `GitHub Deployer: Failed - ${errorMessage}`);
      return {
        success: false,
        message: errorMessage
      };
    }
  }
  var GitHubDeployer = {
    on_deploy
  };
  window.GitHubDeployer = GitHubDeployer;
  var main_default = GitHubDeployer;
  return __toCommonJS(main_exports);
})();
