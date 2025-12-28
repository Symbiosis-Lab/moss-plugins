/**
 * Repository Creation Dialog
 *
 * Generates an embedded HTML dialog for creating new GitHub repositories.
 * Uses data: URL to avoid needing external files.
 */

/**
 * Generate the HTML for the repo creation dialog
 *
 * @param username - The authenticated GitHub username
 * @param token - The access token for API calls
 * @returns Data URL containing the dialog HTML
 */
export function createRepoDialogHtml(username: string, token: string): string {
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
        status.innerHTML = '<span>✓</span>' + message;
      } else if (type === 'taken' || type === 'invalid') {
        status.innerHTML = '<span>✗</span>' + message;
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
  </script>
</body>
</html>`;

  return html;
}

/**
 * Create a data URL from the dialog HTML
 *
 * @param username - The authenticated GitHub username
 * @param token - The access token for API calls
 * @returns Data URL that can be loaded in a webview
 */
export function createRepoDialogUrl(username: string, token: string): string {
  const html = createRepoDialogHtml(username, token);
  const base64 = btoa(unescape(encodeURIComponent(html)));
  return `data:text/html;base64,${base64}`;
}
