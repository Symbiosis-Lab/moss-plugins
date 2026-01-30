/**
 * Repository Setup Module (Consolidated)
 *
 * Feature 20: Smart Repo Setup
 * - Auto-creates {username}.github.io when available (no UI needed)
 * - Shows UI only when root is already taken
 *
 * This module replaces:
 * - repo-setup-browser.ts
 * - repo-create.ts
 * - repo-dialog.ts
 */

import { showPluginDialog, type DialogResult } from "@symbiosis-lab/moss-api";
import { log } from "./utils";
import { getToken, getTokenFromGit, storeToken } from "./token";
import { getAuthenticatedUser, checkRepoExists, createRepository } from "./github-api";
import { promptLogin, validateToken, hasRequiredScopes } from "./auth";

/**
 * Result from the repo setup flow
 */
export interface RepoSetupResult {
  /** Repository name */
  name: string;
  /** SSH URL for git remote */
  sshUrl: string;
  /** Full name (owner/repo) */
  fullName: string;
}

/**
 * Value returned when user submits the dialog
 */
interface RepoSetupValue {
  name: string;
}

/**
 * Ensure a GitHub repository exists for deployment
 *
 * This function:
 * 1. Ensures user is authenticated with GitHub
 * 2. Checks if {username}.github.io exists
 * 3. If available, auto-creates it (no UI needed)
 * 4. If taken, shows UI for user to enter custom repo name
 * 5. Returns the repo info
 *
 * @returns Repository info, or null if cancelled/failed
 */
export async function ensureGitHubRepo(): Promise<RepoSetupResult | null> {
  await log("log", "   Ensuring GitHub repository...");

  // Step 1: Ensure authentication
  const token = await ensureAuthenticated();
  if (!token) {
    return null;
  }

  // Step 2: Get authenticated user info
  let username: string;
  try {
    const user = await getAuthenticatedUser(token);
    username = user.login;
    await log("log", `   Authenticated as ${username}`);
  } catch (error) {
    await log("error", `   Failed to get user info: ${error}`);
    return null;
  }

  // Step 3: Check if {username}.github.io exists
  const rootRepoName = `${username}.github.io`;
  const rootExists = await checkRepoExists(username, rootRepoName, token);

  // Step 4: Auto-create or show UI
  if (!rootExists) {
    // Root is available - auto-create (no UI needed!)
    return await createRootRepo(username, rootRepoName, token);
  } else {
    // Root is taken - show UI for custom repo name
    return await showRepoNameUI(username, token);
  }
}

/**
 * Ensure user is authenticated, trying various sources
 */
async function ensureAuthenticated(): Promise<string | null> {
  // Try 1: Cached token
  let token = await getToken();
  if (token) {
    return token;
  }

  // Try 2: Git credential helper
  await log("log", "   No cached token, checking git credentials...");
  token = await getTokenFromGit();
  if (token) {
    const validation = await validateToken(token);
    if (validation.valid && hasRequiredScopes(validation.scopes || [])) {
      await log("log", `   Using token from git credentials (${validation.user?.login})`);
      await storeToken(token);
      return token;
    } else {
      await log("log", "   Git credential token invalid or missing scopes");
    }
  }

  // Try 3: OAuth login
  await log("log", "   No valid credentials found, prompting login...");
  const loginSuccess = await promptLogin();
  if (!loginSuccess) {
    await log("warn", "   GitHub login cancelled or failed");
    return null;
  }

  token = await getToken();
  if (!token) {
    await log("error", "   Failed to get token after login");
    return null;
  }

  return token;
}

/**
 * Auto-create the root repo (no UI needed)
 */
async function createRootRepo(
  _username: string,
  repoName: string,
  token: string
): Promise<RepoSetupResult | null> {
  await log("log", `   Auto-creating ${repoName} (will deploy to root URL)...`);

  try {
    const createdRepo = await createRepository(repoName, token, "Created with Moss");
    await log("log", `   Repository created: ${createdRepo.htmlUrl}`);

    return {
      name: createdRepo.name,
      sshUrl: createdRepo.sshUrl,
      fullName: createdRepo.fullName,
    };
  } catch (error) {
    await log("error", `   Failed to create repository: ${error}`);
    return null;
  }
}

/**
 * Encode HTML as a data URL for use with showPluginDialog
 */
function createDataUrl(html: string): string {
  const base64 = btoa(unescape(encodeURIComponent(html)));
  return `data:text/html;base64,${base64}`;
}

/**
 * Show UI for custom repo name (when root is taken)
 */
async function showRepoNameUI(
  username: string,
  token: string
): Promise<RepoSetupResult | null> {
  await log("log", "   Root repo already exists, showing UI for custom name...");

  const html = createRepoSetupHtml(username, token);
  const dataUrl = createDataUrl(html);

  // Show dialog and wait for user response (auto-closes when done)
  let dialogResult: DialogResult;
  try {
    dialogResult = await showPluginDialog({
      url: dataUrl,
      title: "GitHub Repository Setup",
      width: 440,
      height: 420,
      timeoutMs: 300000, // 5 minutes
    });
  } catch {
    await log("warn", "   Repository setup timed out or failed");
    return null;
  }

  // Check if user cancelled
  if (dialogResult.type === "cancelled") {
    await log("log", "   User cancelled repository setup");
    return null;
  }

  // Extract repo name from dialog result
  const value = dialogResult.value as RepoSetupValue | undefined;
  if (!value?.name) {
    await log("log", "   No repository name provided");
    return null;
  }

  // Create the custom repo
  const repoName = value.name;
  await log("log", `   Creating repository: ${repoName}`);

  try {
    const createdRepo = await createRepository(repoName, token, "Created with Moss");
    await log("log", `   Repository created: ${createdRepo.htmlUrl}`);

    return {
      name: createdRepo.name,
      sshUrl: createdRepo.sshUrl,
      fullName: createdRepo.fullName,
    };
  } catch (error) {
    await log("error", `   Failed to create repository: ${error}`);
    return null;
  }
}

/**
 * Generate the HTML for the repo setup browser UI
 * Shows explanation that root is already taken
 */
function createRepoSetupHtml(username: string, token: string): string {
  const rootRepoName = `${username}.github.io`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GitHub Repository Setup</title>
  <style>
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --surface-hover: #21262d;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --primary: #238636;
      --primary-hover: #2ea043;
      --success: #3fb950;
      --error: #f85149;
      --warning: #d29922;
      --border: #30363d;
      --link: #58a6ff;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 24px;
    }

    .container {
      width: 100%;
      max-width: 440px;
    }

    .icon {
      width: 48px;
      height: 48px;
      margin-bottom: 16px;
    }

    h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .subtitle {
      color: var(--text-muted);
      font-size: 14px;
      margin-bottom: 24px;
      line-height: 1.5;
    }

    .info-box {
      padding: 12px 16px;
      background: rgba(210, 153, 34, 0.1);
      border: 1px solid var(--warning);
      border-radius: 6px;
      font-size: 13px;
      color: var(--warning);
      margin-bottom: 24px;
      line-height: 1.5;
    }

    .info-box code {
      background: rgba(210, 153, 34, 0.2);
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
    }

    .form-group {
      margin-bottom: 24px;
    }

    label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 8px;
    }

    .input-wrapper {
      display: flex;
      align-items: center;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      transition: border-color 0.15s;
    }

    .input-wrapper:focus-within {
      border-color: var(--link);
    }

    .input-wrapper.error {
      border-color: var(--error);
    }

    .input-wrapper.success {
      border-color: var(--success);
    }

    .prefix {
      padding: 10px 0 10px 12px;
      color: var(--text-muted);
      font-size: 14px;
      white-space: nowrap;
    }

    input[type="text"] {
      flex: 1;
      padding: 10px 12px 10px 4px;
      font-size: 14px;
      background: transparent;
      border: none;
      color: var(--text);
      outline: none;
    }

    input[type="text"]::placeholder {
      color: var(--text-muted);
    }

    .status {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      font-size: 13px;
      min-height: 20px;
    }

    .status.checking {
      color: var(--text-muted);
    }

    .status.available {
      color: var(--success);
    }

    .status.taken,
    .status.invalid {
      color: var(--error);
    }

    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid var(--border);
      border-top-color: var(--link);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .url-preview {
      padding: 12px 16px;
      background: var(--surface);
      border-radius: 6px;
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 24px;
      line-height: 1.5;
    }

    .url-preview strong {
      color: var(--text);
    }

    .buttons {
      display: flex;
      gap: 12px;
    }

    button {
      flex: 1;
      padding: 12px 20px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      transition: background-color 0.15s;
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
      background: var(--primary-hover);
    }

    .btn-secondary {
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
    }

    .btn-secondary:hover:not(:disabled) {
      background: var(--surface-hover);
    }

    .creating {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  </style>
</head>
<body>
  <div class="container">
    <svg class="icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.475 2 2 6.475 2 12c0 4.42 2.865 8.17 6.84 9.49.5.09.68-.22.68-.48v-1.69c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02.8-.22 1.65-.33 2.5-.33.85 0 1.7.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48C19.14 20.17 22 16.42 22 12c0-5.525-4.475-10-10-10z" fill="#8b949e"/>
    </svg>

    <h1>Choose a repository name</h1>
    <p class="subtitle">
      Create a repository for your site.
    </p>

    <div class="info-box">
      <strong>Note:</strong> <code>${rootRepoName}</code> is already in use.
      Your site will be deployed to <strong>${username}.github.io/<em>repo-name</em>/</strong>
    </div>

    <div class="form-group">
      <label for="repo-name">Repository name</label>
      <div class="input-wrapper" id="input-wrapper">
        <span class="prefix">github.com/${username}/</span>
        <input type="text" id="repo-name" placeholder="my-website" autocomplete="off" autofocus>
      </div>
      <div class="status" id="status"></div>
    </div>

    <div class="url-preview" id="url-preview">
      Your site URL: <strong>https://${username}.github.io/<span id="preview-name">my-website</span>/</strong>
    </div>

    <div class="buttons">
      <button class="btn-secondary" id="cancel-btn">Cancel</button>
      <button class="btn-primary" id="create-btn" disabled>
        <span id="btn-text">Create & Deploy</span>
      </button>
    </div>
  </div>

  <script>
    const { invoke } = window.__TAURI__.core;
    const token = '${token}';

    // Get dialogId from query string (added by showPluginDialog)
    const dialogId = new URLSearchParams(location.search).get('dialogId');

    const input = document.getElementById('repo-name');
    const inputWrapper = document.getElementById('input-wrapper');
    const status = document.getElementById('status');
    const createBtn = document.getElementById('create-btn');
    const btnText = document.getElementById('btn-text');
    const cancelBtn = document.getElementById('cancel-btn');
    const previewName = document.getElementById('preview-name');

    let checkTimeout = null;
    let isAvailable = false;
    let currentName = '';

    const validNameRegex = /^[a-zA-Z0-9._-]+$/;

    function setStatus(type, message) {
      status.className = 'status ' + type;

      if (type === 'checking') {
        status.innerHTML = '<div class="spinner"></div>' + message;
      } else if (type === 'available') {
        status.innerHTML = '<span>✓</span> ' + message;
      } else if (type === 'taken' || type === 'invalid') {
        status.innerHTML = '<span>✗</span> ' + message;
      } else {
        status.innerHTML = message;
      }

      inputWrapper.className = 'input-wrapper ' +
        (type === 'available' ? 'success' :
         (type === 'taken' || type === 'invalid') ? 'error' : '');

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
      previewName.textContent = name || 'my-website';

      if (checkTimeout) {
        clearTimeout(checkTimeout);
      }

      if (!validateName(name)) return;

      checkTimeout = setTimeout(() => {
        checkAvailability(name);
      }, 300);
    });

    cancelBtn.addEventListener('click', async () => {
      // Submit cancellation via dialog result
      await invoke('submit_dialog_result', {
        dialogId: dialogId,
        result: { type: 'cancelled' }
      });
    });

    createBtn.addEventListener('click', async () => {
      if (!isAvailable) return;

      const name = input.value.trim();
      createBtn.disabled = true;
      btnText.innerHTML = '<span class="creating"><div class="spinner"></div>Creating...</span>';

      // Submit repo name via dialog result
      await invoke('submit_dialog_result', {
        dialogId: dialogId,
        result: { type: 'submitted', value: { name: name } }
      });
    });

    input.focus();
  </script>
</body>
</html>`;
}
