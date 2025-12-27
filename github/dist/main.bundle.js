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
    deploy: () => deploy
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

  // dist/utils.js
  var PLUGIN_NAME = "github";
  setMessageContext(PLUGIN_NAME, "deploy");
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

  // dist/git.js
  async function runGit(args) {
    await log("log", `   git ${args.join(" ")}`);
    const result = await executeBinary({
      binaryPath: "git",
      args,
      timeoutMs: 6e4
    });
    if (!result.success) {
      const error = result.stderr || `Git command failed with exit code ${result.exitCode}`;
      throw new Error(error);
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
    await log("log", "   Staging workflow and gitignore...");
    await stageFiles([".github/workflows/moss-deploy.yml", ".gitignore"]);
    await log("log", "   Creating commit...");
    const sha = await commit("Add GitHub Pages deployment workflow\n\nGenerated by Moss");
    await log("log", "   Pushing to remote...");
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
    } catch (error) {
      if (error instanceof Error && error.message.includes("empty")) {
        throw error;
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
    await log("log", "   Validating git repository...");
    await validateGitRepository();
    await log("log", "   Validating compiled site...");
    await validateSiteCompiled(outputDir);
    await log("log", "   Validating GitHub remote...");
    const remoteUrl = await validateGitHubRemote();
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
  async function createWorkflowFile(branch) {
    await log("log", "   Creating .github/workflows/moss-deploy.yml...");
    const content = generateWorkflowContent(branch);
    await writeFile(".github/workflows/moss-deploy.yml", content);
    await log("log", "   Workflow file created");
  }
  async function updateGitignore() {
    await log("log", "   Updating .gitignore...");
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
    await writeFile(".gitignore", newContent);
    await log("log", "   .gitignore updated");
  }
  async function workflowExists() {
    return fileExists(".github/workflows/moss-deploy.yml");
  }

  // dist/main.js
  async function deploy(_context) {
    setCurrentHookName("deploy");
    await log("log", "GitHub Deployer: Starting deployment...");
    try {
      await reportProgress2("validating", 1, 5, "Validating requirements...");
      const remoteUrl = await validateAll(".moss/site");
      await reportProgress2("configuring", 2, 5, "Detecting default branch...");
      const branch = await detectBranch();
      await log("log", `   Default branch: ${branch}`);
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
      await reportError2(errorMessage, "deploy", true);
      await log("error", `GitHub Deployer: Failed - ${errorMessage}`);
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
