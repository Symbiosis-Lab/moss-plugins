"use strict";
var GitHubDeployer = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
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

  // ../../../moss-api/main/dist/index.mjs
  var dist_exports = {};
  __export(dist_exports, {
    cancelDialog: () => cancelDialog,
    closeBrowser: () => closeBrowser,
    downloadAsset: () => downloadAsset,
    emitEvent: () => emitEvent,
    error: () => error,
    executeBinary: () => executeBinary,
    fetchUrl: () => fetchUrl,
    fileExists: () => fileExists,
    getMessageContext: () => getMessageContext,
    getPluginCookie: () => getPluginCookie,
    getTauriCore: () => getTauriCore,
    isEventApiAvailable: () => isEventApiAvailable,
    isTauriAvailable: () => isTauriAvailable,
    listFiles: () => listFiles,
    listPluginFiles: () => listPluginFiles,
    log: () => log,
    onEvent: () => onEvent,
    openBrowser: () => openBrowser,
    pluginFileExists: () => pluginFileExists,
    readFile: () => readFile,
    readPluginFile: () => readPluginFile,
    reportComplete: () => reportComplete,
    reportError: () => reportError,
    reportProgress: () => reportProgress,
    sendMessage: () => sendMessage,
    setMessageContext: () => setMessageContext,
    setPluginCookie: () => setPluginCookie,
    showPluginDialog: () => showPluginDialog,
    submitDialogResult: () => submitDialogResult,
    waitForEvent: () => waitForEvent,
    warn: () => warn,
    writeFile: () => writeFile,
    writePluginFile: () => writePluginFile
  });
  function getTauriCore() {
    const w = window;
    if (!w.__TAURI__?.core) throw new Error("Tauri core not available");
    return w.__TAURI__.core;
  }
  function isTauriAvailable() {
    return !!window.__TAURI__?.core;
  }
  function setMessageContext(pluginName, hookName) {
    currentPluginName = pluginName;
    currentHookName = hookName;
  }
  function getMessageContext() {
    return {
      pluginName: currentPluginName,
      hookName: currentHookName
    };
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
  async function reportComplete(result) {
    await sendMessage({
      type: "complete",
      result
    });
  }
  async function log(message) {
    await sendMessage({
      type: "log",
      level: "log",
      message
    });
  }
  async function warn(message) {
    await sendMessage({
      type: "log",
      level: "warn",
      message
    });
  }
  async function error(message) {
    await sendMessage({
      type: "log",
      level: "error",
      message
    });
  }
  async function openBrowser(url) {
    await getTauriCore().invoke("open_plugin_browser", { url });
  }
  async function closeBrowser() {
    await getTauriCore().invoke("close_plugin_browser", {});
  }
  function getInternalContext() {
    const context = window.__MOSS_INTERNAL_CONTEXT__;
    if (!context) throw new Error("This function must be called from within a plugin hook. Ensure you're calling this from process(), generate(), deploy(), or syndicate().");
    return context;
  }
  async function readFile(relativePath) {
    const ctx = getInternalContext();
    return getTauriCore().invoke("read_project_file", {
      projectPath: ctx.project_path,
      relativePath
    });
  }
  async function writeFile(relativePath, content) {
    const ctx = getInternalContext();
    await getTauriCore().invoke("write_project_file", {
      projectPath: ctx.project_path,
      relativePath,
      data: content
    });
  }
  async function listFiles() {
    const ctx = getInternalContext();
    return getTauriCore().invoke("list_project_files", { projectPath: ctx.project_path });
  }
  async function fileExists(relativePath) {
    getInternalContext();
    try {
      await readFile(relativePath);
      return true;
    } catch {
      return false;
    }
  }
  async function readPluginFile(relativePath) {
    const ctx = getInternalContext();
    return getTauriCore().invoke("read_plugin_file", {
      pluginName: ctx.plugin_name,
      projectPath: ctx.project_path,
      relativePath
    });
  }
  async function writePluginFile(relativePath, content) {
    const ctx = getInternalContext();
    await getTauriCore().invoke("write_plugin_file", {
      pluginName: ctx.plugin_name,
      projectPath: ctx.project_path,
      relativePath,
      content
    });
  }
  async function listPluginFiles() {
    const ctx = getInternalContext();
    return getTauriCore().invoke("list_plugin_files", {
      pluginName: ctx.plugin_name,
      projectPath: ctx.project_path
    });
  }
  async function pluginFileExists(relativePath) {
    const ctx = getInternalContext();
    return getTauriCore().invoke("plugin_file_exists", {
      pluginName: ctx.plugin_name,
      projectPath: ctx.project_path,
      relativePath
    });
  }
  async function fetchUrl(url, options = {}) {
    const { timeoutMs = 3e4 } = options;
    const result = await getTauriCore().invoke("fetch_url", {
      url,
      timeoutMs
    });
    const binaryString = atob(result.body_base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    return {
      status: result.status,
      ok: result.ok,
      contentType: result.content_type,
      body: bytes,
      text() {
        return new TextDecoder().decode(bytes);
      }
    };
  }
  async function downloadAsset(url, targetDir, options = {}) {
    const ctx = getInternalContext();
    const { timeoutMs = 3e4 } = options;
    const result = await getTauriCore().invoke("download_asset", {
      url,
      projectPath: ctx.project_path,
      targetDir,
      timeoutMs
    });
    return {
      status: result.status,
      ok: result.ok,
      contentType: result.content_type,
      bytesWritten: result.bytes_written,
      actualPath: result.actual_path
    };
  }
  async function executeBinary(options) {
    const ctx = getInternalContext();
    const { binaryPath, args, timeoutMs = 6e4, env } = options;
    const result = await getTauriCore().invoke("execute_binary", {
      binaryPath,
      args,
      workingDir: ctx.project_path,
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
  async function getPluginCookie() {
    const ctx = getInternalContext();
    return getTauriCore().invoke("get_plugin_cookie", {
      pluginName: ctx.plugin_name,
      projectPath: ctx.project_path
    });
  }
  async function setPluginCookie(cookies) {
    const ctx = getInternalContext();
    await getTauriCore().invoke("set_plugin_cookie", {
      pluginName: ctx.plugin_name,
      projectPath: ctx.project_path,
      cookies
    });
  }
  async function showPluginDialog(options) {
    return await getTauriCore().invoke("show_plugin_dialog", {
      url: options.url,
      title: options.title,
      width: options.width ?? 500,
      height: options.height ?? 400,
      timeoutMs: options.timeoutMs ?? 3e5
    });
  }
  async function submitDialogResult(dialogId, value) {
    return getTauriCore().invoke("submit_dialog_result", {
      dialogId,
      result: {
        type: "submitted",
        value
      }
    });
  }
  async function cancelDialog(dialogId) {
    return getTauriCore().invoke("submit_dialog_result", {
      dialogId,
      result: { type: "cancelled" }
    });
  }
  function getTauriEvent() {
    const w = window;
    if (!w.__TAURI__?.event) throw new Error("Tauri event API not available");
    return w.__TAURI__.event;
  }
  function isEventApiAvailable() {
    return !!window.__TAURI__?.event;
  }
  async function emitEvent(event, payload) {
    await getTauriEvent().emit(event, payload);
  }
  async function onEvent(event, handler) {
    return await getTauriEvent().listen(event, (e) => {
      handler(e.payload);
    });
  }
  async function waitForEvent(event, timeoutMs = 3e4) {
    return new Promise((resolve, reject) => {
      let unlisten = null;
      let timeoutId;
      const cleanup = () => {
        if (unlisten) unlisten();
        clearTimeout(timeoutId);
      };
      timeoutId = setTimeout(() => {
        cleanup();
        reject(/* @__PURE__ */ new Error(`Timeout waiting for event: ${event}`));
      }, timeoutMs);
      onEvent(event, (payload) => {
        cleanup();
        resolve(payload);
      }).then((unlistenFn) => {
        unlisten = unlistenFn;
      });
    });
  }
  var currentPluginName, currentHookName;
  var init_dist = __esm({
    "../../../moss-api/main/dist/index.mjs"() {
      "use strict";
      currentPluginName = "";
      currentHookName = "";
    }
  });

  // dist/main.js
  var main_exports = {};
  __export(main_exports, {
    default: () => main_default,
    deploy: () => deploy,
    on_deploy: () => deploy
  });

  // dist/utils.js
  init_dist();
  var PLUGIN_NAME = "github";
  setMessageContext(PLUGIN_NAME, "deploy");
  function setCurrentHookName(name) {
    setMessageContext(PLUGIN_NAME, name);
  }
  async function log2(level, message) {
    console[level](message);
    const sdkLevel = level === "info" ? "log" : level;
    await sendMessage({ type: "log", level: sdkLevel, message });
  }
  async function reportProgress2(phase, current, total, message) {
    await reportProgress(phase, current, total, message);
  }
  async function reportError2(error2, context, fatal = false) {
    await reportError(error2, context, fatal);
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // dist/validation.js
  init_dist();

  // dist/git.js
  init_dist();
  async function runGit(args) {
    await log2("log", `   git ${args.join(" ")}`);
    const result = await executeBinary({
      binaryPath: "git",
      args,
      timeoutMs: 6e4
    });
    if (!result.success) {
      const error2 = result.stderr || `Git command failed with exit code ${result.exitCode}`;
      throw new Error(error2);
    }
    return result.stdout.trim();
  }
  async function getRemoteUrl() {
    return runGit(["remote", "get-url", "origin"]);
  }
  async function detectBranch() {
    try {
      const branch = await runGit(["branch", "--show-current"]);
      if (branch) {
        return branch;
      }
    } catch {
    }
    try {
      await runGit(["rev-parse", "--verify", "main"]);
      return "main";
    } catch {
    }
    try {
      await runGit(["rev-parse", "--verify", "master"]);
      return "master";
    } catch {
      return "main";
    }
  }
  async function isGitRepository() {
    try {
      await runGit(["rev-parse", "--git-dir"]);
      return true;
    } catch {
      return false;
    }
  }
  async function hasGitRemote() {
    try {
      await getRemoteUrl();
      return true;
    } catch {
      return false;
    }
  }
  async function stageFiles(files) {
    await runGit(["add", ...files]);
  }
  async function commit(message) {
    await runGit(["commit", "-m", message]);
    return runGit(["rev-parse", "HEAD"]);
  }
  async function push() {
    await runGit(["push"]);
  }
  async function commitAndPushWorkflow() {
    await log2("log", "   Staging workflow and gitignore...");
    await stageFiles([".github/workflows/moss-deploy.yml", ".gitignore"]);
    await log2("log", "   Creating commit...");
    const sha = await commit("Add GitHub Pages deployment workflow\n\nGenerated by Moss");
    await log2("log", "   Pushing to remote...");
    await push();
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
  async function validateGitRepository() {
    const isRepo = await isGitRepository();
    if (!isRepo) {
      throw new Error("This folder is not a git repository.\n\nTo publish to GitHub Pages, you need to:\n1. Run: git init\n2. Create a GitHub repository\n3. Add it as remote: git remote add origin <url>");
    }
  }
  async function validateSiteCompiled(outputDir) {
    try {
      const allFiles = await listFiles();
      const siteFiles = allFiles.filter((f) => f.startsWith(outputDir));
      if (siteFiles.length === 0) {
        throw new Error("Site directory is empty. Please compile your site first.");
      }
    } catch (error2) {
      if (error2 instanceof Error && error2.message.includes("empty")) {
        throw error2;
      }
      throw new Error("Site not found at .moss/site\n\nPlease compile your site first.");
    }
  }
  async function validateGitHubRemote() {
    const hasRemote = await hasGitRemote();
    if (!hasRemote) {
      throw new Error("No git remote configured.\n\nTo publish, you need to:\n1. Create a GitHub repository\n2. Add it as remote: git remote add origin <url>");
    }
    const remoteUrl = await getRemoteUrl();
    if (!remoteUrl.includes("github.com")) {
      throw new Error(`Remote '${remoteUrl}' is not a GitHub URL.

GitHub Pages deployment only works with GitHub repositories.
Please add a GitHub remote or use a different deployment method.`);
    }
    return remoteUrl;
  }
  async function validateAll(outputDir) {
    await log2("log", "   Validating git repository...");
    await validateGitRepository();
    await log2("log", "   Validating compiled site...");
    await validateSiteCompiled(outputDir);
    await log2("log", "   Validating GitHub remote...");
    const remoteUrl = await validateGitHubRemote();
    await log2("log", "   All validations passed");
    return remoteUrl;
  }

  // dist/workflow.js
  init_dist();
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
  async function createWorkflowFile(branch) {
    await log2("log", "   Creating .github/workflows/moss-deploy.yml...");
    const content = generateWorkflowContent(branch);
    await writeFile(".github/workflows/moss-deploy.yml", content);
    await log2("log", "   Workflow file created");
  }
  async function updateGitignore() {
    await log2("log", "   Updating .gitignore...");
    let currentContent = "";
    try {
      currentContent = await readFile(".gitignore");
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
      await log2("log", "   .gitignore already configured correctly");
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
    await writeFile(".gitignore", newContent);
    await log2("log", "   .gitignore updated");
  }
  async function workflowExists() {
    return fileExists(".github/workflows/moss-deploy.yml");
  }

  // dist/auth.js
  init_dist();

  // dist/token.js
  init_dist();
  var GITHUB_HOST = "github.com";
  var TOKEN_COOKIE_NAME = "__github_access_token";
  var cachedToken = null;
  async function storeToken(token) {
    try {
      await log2("log", "   Storing GitHub access token...");
      try {
        await setPluginCookie([
          {
            name: TOKEN_COOKIE_NAME,
            value: token,
            domain: GITHUB_HOST
          }
        ]);
        await log2("log", "   Token stored in plugin cookies");
      } catch (error2) {
        await log2("warn", `   Could not store in cookies: ${error2}`);
      }
      cachedToken = token;
      await log2("log", "   Token stored successfully");
      return true;
    } catch (error2) {
      await log2("error", `   Error storing token: ${error2}`);
      return false;
    }
  }
  async function getToken() {
    if (cachedToken) {
      return cachedToken;
    }
    try {
      const cookies = await getPluginCookie();
      const tokenCookie = cookies.find((c) => c.name === TOKEN_COOKIE_NAME);
      if (tokenCookie) {
        cachedToken = tokenCookie.value;
        return cachedToken;
      }
    } catch {
    }
    return null;
  }
  async function clearToken() {
    try {
      await log2("log", "   Clearing GitHub access token...");
      try {
        await setPluginCookie([]);
      } catch {
      }
      cachedToken = null;
      await log2("log", "   Token cleared successfully");
      return true;
    } catch (error2) {
      await log2("error", `   Error clearing token: ${error2}`);
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
    await log2("log", "   Requesting device code from GitHub...");
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
    await log2("log", `   Device code received. User code: ${data.user_code}`);
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
  async function checkAuthentication() {
    await log2("log", "   Checking GitHub authentication...");
    const token = await getToken();
    if (!token) {
      await log2("log", "   No token found in credential helper");
      return { isAuthenticated: false };
    }
    const validation = await validateToken(token);
    if (!validation.valid) {
      await log2("log", "   Token is invalid or expired");
      await clearToken();
      return { isAuthenticated: false };
    }
    if (!hasRequiredScopes(validation.scopes || [])) {
      await log2("warn", `   Token missing required scopes. Has: ${validation.scopes?.join(", ")}, needs: ${REQUIRED_SCOPES.join(", ")}`);
      return { isAuthenticated: false };
    }
    await log2("log", `   Authenticated as ${validation.user?.login}`);
    return {
      isAuthenticated: true,
      username: validation.user?.login,
      scopes: validation.scopes
    };
  }
  async function promptLogin() {
    try {
      await reportProgress2("authentication", 0, 4, "Requesting authorization...");
      const deviceCodeResponse = await requestDeviceCode();
      await reportProgress2("authentication", 1, 4, `Enter code: ${deviceCodeResponse.user_code}`);
      await log2("log", `   Opening browser for GitHub authorization...`);
      await log2("log", `   Enter code: ${deviceCodeResponse.user_code}`);
      await openBrowser(deviceCodeResponse.verification_uri);
      await reportProgress2("authentication", 2, 4, "Waiting for authorization...");
      const token = await waitForToken(deviceCodeResponse.device_code, deviceCodeResponse.interval, deviceCodeResponse.expires_in * 1e3);
      if (!token) {
        await log2("warn", "   Authorization timed out or was denied");
        try {
          await closeBrowser();
        } catch {
        }
        return false;
      }
      await reportProgress2("authentication", 3, 4, "Storing credentials...");
      const stored = await storeToken(token);
      if (!stored) {
        await log2("warn", "   Failed to store token in credential helper");
      }
      try {
        await closeBrowser();
      } catch {
      }
      await reportProgress2("authentication", 4, 4, "Authenticated");
      await log2("log", "   Successfully authenticated with GitHub");
      return true;
    } catch (error2) {
      await log2("error", `   Authentication failed: ${error2}`);
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
          await log2("log", `   Slowing down, new interval: ${interval}s`);
          continue;
        }
        if (response.error === "expired_token") {
          await log2("warn", "   Device code expired");
          return null;
        }
        if (response.error === "access_denied") {
          await log2("warn", "   User denied authorization");
          return null;
        }
        await log2("error", `   Unexpected error: ${response.error}`);
        return null;
      } catch (error2) {
        await log2("error", `   Poll error: ${error2}`);
      }
    }
    await log2("warn", "   Authorization timeout");
    return null;
  }

  // dist/repo-create.js
  init_dist();

  // dist/github-api.js
  var GITHUB_API_BASE = "https://api.github.com";
  var GITHUB_API_HEADERS = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "Moss-GitHub-Deployer"
  };
  async function getAuthenticatedUser(token) {
    const response = await fetch(`${GITHUB_API_BASE}/user`, {
      headers: {
        ...GITHUB_API_HEADERS,
        Authorization: `Bearer ${token}`
      }
    });
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Invalid or expired token");
      }
      throw new Error(`Failed to get user: ${response.status}`);
    }
    return response.json();
  }
  async function createRepository(name, token, description) {
    await log2("log", `Creating repository: ${name}`);
    const response = await fetch(`${GITHUB_API_BASE}/user/repos`, {
      method: "POST",
      headers: {
        ...GITHUB_API_HEADERS,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name,
        description: description ?? "Created with Moss",
        private: false,
        // Always public for GitHub Pages
        auto_init: false
        // We'll push our own content
      })
    });
    if (!response.ok) {
      const error2 = await response.json().catch(() => ({}));
      const message = error2.message || `Failed to create repository: ${response.status}`;
      throw new Error(message);
    }
    const repo = await response.json();
    await log2("log", `Repository created: ${repo.html_url}`);
    return {
      name: repo.name,
      fullName: repo.full_name,
      htmlUrl: repo.html_url,
      sshUrl: repo.ssh_url,
      cloneUrl: repo.clone_url
    };
  }
  async function addGitRemote(remoteName, url) {
    const { executeBinary: executeBinary2 } = await Promise.resolve().then(() => (init_dist(), dist_exports));
    const result = await executeBinary2({
      binaryPath: "git",
      args: ["remote", "add", remoteName, url]
    });
    if (!result.success) {
      throw new Error(`Failed to add remote: ${result.stderr}`);
    }
  }

  // dist/repo-dialog.js
  function createRepoDialogHtml(username, token) {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Create GitHub Repository</title>
  <style>
    :root {
      --bg: #1a1a1a;
      --surface: #252525;
      --text: #e0e0e0;
      --text-muted: #888;
      --primary: #58a6ff;
      --success: #3fb950;
      --error: #f85149;
      --border: #333;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 24px;
      min-height: 100vh;
    }

    h1 {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .subtitle {
      color: var(--text-muted);
      font-size: 13px;
      margin-bottom: 24px;
    }

    .form-group {
      margin-bottom: 20px;
    }

    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 8px;
    }

    .input-wrapper {
      position: relative;
    }

    .prefix {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
      font-size: 14px;
    }

    input[type="text"] {
      width: 100%;
      padding: 10px 12px 10px 140px;
      font-size: 14px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      outline: none;
      transition: border-color 0.15s;
    }

    input[type="text"]:focus {
      border-color: var(--primary);
    }

    input[type="text"].error {
      border-color: var(--error);
    }

    input[type="text"].success {
      border-color: var(--success);
    }

    .status {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      font-size: 12px;
      min-height: 18px;
    }

    .status.checking {
      color: var(--text-muted);
    }

    .status.available {
      color: var(--success);
    }

    .status.taken {
      color: var(--error);
    }

    .status.invalid {
      color: var(--error);
    }

    .spinner {
      width: 12px;
      height: 12px;
      border: 2px solid var(--border);
      border-top-color: var(--primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .buttons {
      display: flex;
      gap: 12px;
      margin-top: 32px;
    }

    button {
      flex: 1;
      padding: 10px 16px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      transition: opacity 0.15s;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-primary {
      background: var(--primary);
      color: white;
    }

    .btn-primary:hover:not(:disabled) {
      opacity: 0.9;
    }

    .btn-secondary {
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
    }

    .btn-secondary:hover:not(:disabled) {
      background: #333;
    }

    .note {
      margin-top: 16px;
      padding: 12px;
      background: var(--surface);
      border-radius: 6px;
      font-size: 12px;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <h1>Create GitHub Repository</h1>
  <p class="subtitle">Create a new public repository for your website</p>

  <div class="form-group">
    <label for="repo-name">Repository name</label>
    <div class="input-wrapper">
      <span class="prefix">github.com/${username}/</span>
      <input type="text" id="repo-name" placeholder="my-website" autocomplete="off" autofocus>
    </div>
    <div class="status" id="status"></div>
  </div>

  <div class="note">
    The repository will be created as public, which is required for GitHub Pages.
  </div>

  <div class="buttons">
    <button class="btn-secondary" id="cancel-btn">Cancel</button>
    <button class="btn-primary" id="create-btn" disabled>Create Repository</button>
  </div>

  <script>
    const { invoke } = window.__TAURI__.core;
    const dialogId = new URLSearchParams(location.search).get('dialogId');
    const token = '${token}';

    const input = document.getElementById('repo-name');
    const status = document.getElementById('status');
    const createBtn = document.getElementById('create-btn');
    const cancelBtn = document.getElementById('cancel-btn');

    let checkTimeout = null;
    let isAvailable = false;
    let currentName = '';

    // Validation regex
    const validNameRegex = /^[a-zA-Z0-9._-]+$/;

    function setStatus(type, message) {
      status.className = 'status ' + type;

      if (type === 'checking') {
        status.innerHTML = '<div class="spinner"></div>' + message;
      } else if (type === 'available') {
        status.innerHTML = '<span>\u2713</span>' + message;
      } else if (type === 'taken' || type === 'invalid') {
        status.innerHTML = '<span>\u2717</span>' + message;
      } else {
        status.innerHTML = message;
      }

      // Update input style
      input.className = type === 'available' ? 'success' :
                        (type === 'taken' || type === 'invalid') ? 'error' : '';

      // Update button state
      createBtn.disabled = type !== 'available';
      isAvailable = type === 'available';
    }

    function validateName(name) {
      if (!name) {
        setStatus('', '');
        return false;
      }

      if (name.startsWith('.')) {
        setStatus('invalid', 'Name cannot start with a period');
        return false;
      }

      if (!validNameRegex.test(name)) {
        setStatus('invalid', 'Only letters, numbers, hyphens, underscores, and periods allowed');
        return false;
      }

      if (name.length > 100) {
        setStatus('invalid', 'Name is too long (max 100 characters)');
        return false;
      }

      return true;
    }

    async function checkAvailability(name) {
      if (!validateName(name)) return;

      currentName = name;
      setStatus('checking', 'Checking availability...');

      try {
        const response = await fetch('https://api.github.com/repos/${username}/' + name, {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': 'Bearer ' + token
          }
        });

        // If we got a different name while waiting, ignore this result
        if (name !== currentName) return;

        if (response.status === 404) {
          setStatus('available', 'Name is available');
        } else if (response.ok) {
          setStatus('taken', 'Repository already exists');
        } else {
          setStatus('invalid', 'Error checking availability');
        }
      } catch (error) {
        if (name !== currentName) return;
        setStatus('invalid', 'Error checking availability');
      }
    }

    input.addEventListener('input', (e) => {
      const name = e.target.value.trim();

      // Clear previous timeout
      if (checkTimeout) {
        clearTimeout(checkTimeout);
      }

      // Basic validation
      if (!validateName(name)) return;

      // Debounce API check
      checkTimeout = setTimeout(() => {
        checkAvailability(name);
      }, 300);
    });

    cancelBtn.addEventListener('click', async () => {
      await invoke('submit_dialog_result', {
        dialogId: dialogId,
        result: { type: 'cancelled' }
      });
    });

    createBtn.addEventListener('click', async () => {
      if (!isAvailable) return;

      const name = input.value.trim();
      createBtn.disabled = true;
      createBtn.textContent = 'Creating...';

      await invoke('submit_dialog_result', {
        dialogId: dialogId,
        result: { type: 'submitted', value: { name: name } }
      });
    });

    // Focus input on load
    input.focus();
  <\/script>
</body>
</html>`;
    return html;
  }
  function createRepoDialogUrl(username, token) {
    const html = createRepoDialogHtml(username, token);
    const base64 = btoa(unescape(encodeURIComponent(html)));
    return `data:text/html;base64,${base64}`;
  }

  // dist/repo-create.js
  async function promptAndCreateRepo() {
    await log2("log", "Starting repository creation flow...");
    const token = await getToken();
    if (!token) {
      await log2("warn", "No authentication token found");
      return null;
    }
    let username;
    try {
      const user = await getAuthenticatedUser(token);
      username = user.login;
      await log2("log", `   Authenticated as ${username}`);
    } catch (error2) {
      await log2("error", `   Failed to get user info: ${error2}`);
      return null;
    }
    await log2("log", "   Showing repository creation dialog...");
    const dialogUrl = createRepoDialogUrl(username, token);
    let dialogResult;
    try {
      dialogResult = await showPluginDialog({
        url: dialogUrl,
        title: "Create GitHub Repository",
        width: 420,
        height: 340,
        timeoutMs: 3e5
        // 5 minutes
      });
    } catch (error2) {
      await log2("error", `   Dialog error: ${error2}`);
      return null;
    }
    if (dialogResult.type === "cancelled") {
      await log2("log", "   User cancelled repository creation");
      return null;
    }
    const value = dialogResult.value;
    if (!value?.name) {
      await log2("error", "   Invalid dialog result: missing repo name");
      return null;
    }
    const repoName = value.name;
    await log2("log", `   Creating repository: ${repoName}`);
    let createdRepo;
    try {
      createdRepo = await createRepository(repoName, token, "Created with Moss");
      await log2("log", `   Repository created: ${createdRepo.htmlUrl}`);
    } catch (error2) {
      await log2("error", `   Failed to create repository: ${error2}`);
      return null;
    }
    try {
      await addGitRemote("origin", createdRepo.sshUrl);
      await log2("log", `   Added remote: ${createdRepo.sshUrl}`);
    } catch (error2) {
      await log2("warn", `   Could not add remote automatically: ${error2}`);
      await log2("log", `   You may need to run: git remote add origin ${createdRepo.sshUrl}`);
    }
    return {
      name: createdRepo.name,
      url: createdRepo.htmlUrl,
      sshUrl: createdRepo.sshUrl,
      fullName: createdRepo.fullName
    };
  }

  // dist/main.js
  async function deploy(_context) {
    setCurrentHookName("deploy");
    await log2("log", "GitHub Deployer: Starting deployment...");
    try {
      let remoteUrl;
      if (!await isGitRepository()) {
        await reportError2("Not a git repository. Run 'git init' first.", "validation", true);
        return {
          success: false,
          message: "Not a git repository. Please run 'git init' to initialize git."
        };
      }
      if (!await hasGitRemote()) {
        await log2("log", "   No git remote configured");
        await reportProgress2("setup", 0, 6, "No GitHub repository configured...");
        const created = await promptAndCreateRepo();
        if (!created) {
          await reportError2("No GitHub repository configured", "validation", true);
          return {
            success: false,
            message: "No GitHub repository configured. Please create a repository or add a remote."
          };
        }
        await log2("log", `   Repository created: ${created.fullName}`);
        remoteUrl = created.sshUrl;
      } else {
        try {
          remoteUrl = await getRemoteUrl();
        } catch {
          remoteUrl = "";
        }
      }
      const useSSH = remoteUrl ? isSSHRemote(remoteUrl) : false;
      if (!useSSH && remoteUrl) {
        await reportProgress2("authentication", 0, 6, "Checking GitHub authentication...");
        const authState = await checkAuthentication();
        if (!authState.isAuthenticated) {
          await log2("log", "   HTTPS remote detected, authentication required");
          await reportProgress2("authentication", 0, 6, "GitHub login required...");
          const loginSuccess = await promptLogin();
          if (!loginSuccess) {
            await reportError2("GitHub authentication failed or was cancelled", "authentication", true);
            return {
              success: false,
              message: "GitHub authentication failed. Please try again."
            };
          }
          await log2("log", "   Successfully authenticated with GitHub");
        } else {
          await log2("log", `   Already authenticated as ${authState.username}`);
        }
        await reportProgress2("authentication", 1, 6, "Authenticated");
      } else if (useSSH) {
        await log2("log", "   SSH remote detected, using SSH key authentication");
      }
      await reportProgress2("validating", useSSH ? 1 : 2, 6, "Validating requirements...");
      remoteUrl = await validateAll(".moss/site");
      await reportProgress2("configuring", 2, 5, "Detecting default branch...");
      const branch = await detectBranch();
      await log2("log", `   Default branch: ${branch}`);
      await reportProgress2("configuring", 3, 5, "Checking workflow status...");
      const alreadyConfigured = await workflowExists();
      let wasFirstSetup = false;
      let commitSha = "";
      if (!alreadyConfigured) {
        wasFirstSetup = true;
        await reportProgress2("configuring", 4, 5, "Creating GitHub Actions workflow...");
        await createWorkflowFile(branch);
        await updateGitignore();
        await reportProgress2("deploying", 5, 5, "Pushing workflow to GitHub...");
        commitSha = await commitAndPushWorkflow();
        await log2("log", `   Committed: ${commitSha.substring(0, 7)}`);
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
      await log2("log", `GitHub Deployer: ${wasFirstSetup ? "Setup complete" : "Already configured"}`);
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
    } catch (error2) {
      const errorMessage = error2 instanceof Error ? error2.message : String(error2);
      await reportError2(errorMessage, "deploy", true);
      await log2("error", `GitHub Deployer: Failed - ${errorMessage}`);
      return {
        success: false,
        message: errorMessage
      };
    }
  }
  var GitHubDeployer = {
    deploy
  };
  window.GitHubDeployer = GitHubDeployer;
  var main_default = GitHubDeployer;
  return __toCommonJS(main_exports);
})();
