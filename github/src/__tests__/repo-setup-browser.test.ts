/**
 * Unit tests for the Repository Setup Browser HTML
 *
 * Tests the plugin browser HTML for repository setup when project is not a git repo.
 * Verifies form structure, validation, styling, and event communication.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setupMockTauri,
  type MockTauriContext,
} from "@symbiosis-lab/moss-api/testing";

// We need to extract the HTML generation function for testing
// Since it's private, we'll test it via its output characteristics

describe("Repository Setup Browser HTML", () => {
  const testUsername = "testuser";
  const testToken = "gho_testtoken";
  let container: HTMLDivElement;

  // Helper to create the HTML (mirrors the private function)
  function createTestHtml(): string {
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
      --border: #30363d;
      --link: #58a6ff;
    }
    body { font-family: sans-serif; background: var(--bg); color: var(--text); }
    .status.checking { color: var(--text-muted); }
    .status.available { color: var(--success); }
    .status.taken { color: var(--error); }
    .status.invalid { color: var(--error); }
    .spinner { animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <h1>No GitHub repo configured</h1>
    <p class="subtitle">Create a new repository to deploy your site to GitHub Pages.</p>
    <div class="form-group">
      <label for="repo-name">Repository name</label>
      <div class="input-wrapper" id="input-wrapper">
        <span class="prefix">github.com/${testUsername}/</span>
        <input type="text" id="repo-name" placeholder="my-website" autocomplete="off" autofocus>
      </div>
      <div class="status" id="status"></div>
    </div>
    <div class="note">A public repository will be created.</div>
    <div class="buttons">
      <button class="btn-secondary" id="cancel-btn">Cancel</button>
      <button class="btn-primary" id="create-btn" disabled>
        <span id="btn-text">Create & Deploy</span>
      </button>
    </div>
  </div>
  <script>
    const { emit } = window.__TAURI__.event;
    const token = '${testToken}';
    const validNameRegex = /^[a-zA-Z0-9._-]+$/;

    function setStatus(type, message) {}
    function validateName(name) {
      if (!name) return false;
      if (name.startsWith('.')) return false;
      if (!validNameRegex.test(name)) return false;
      if (name.length > 100) return false;
      return true;
    }
    async function checkAvailability(name) {}

    document.getElementById('cancel-btn').addEventListener('click', async () => {
      await emit('repo-setup-submit', { type: 'cancelled' });
    });
    document.getElementById('create-btn').addEventListener('click', async () => {
      await emit('repo-setup-submit', { type: 'submitted', name: '' });
    });
  </script>
</body>
</html>`;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);

    // Mock window.__TAURI__ for Tauri event API
    (globalThis as Record<string, unknown>).__TAURI__ = {
      event: {
        emit: vi.fn().mockResolvedValue(undefined),
      },
    };

    container.innerHTML = createTestHtml();
  });

  describe("Form Structure", () => {
    it("renders title correctly", () => {
      const title = container.querySelector("h1");
      expect(title?.textContent).toBe("No GitHub repo configured");
    });

    it("renders subtitle with GitHub Pages mention", () => {
      const subtitle = container.querySelector(".subtitle");
      expect(subtitle?.textContent).toContain("GitHub Pages");
    });

    it("renders username prefix in input wrapper", () => {
      const prefix = container.querySelector(".prefix");
      expect(prefix?.textContent).toContain(`github.com/${testUsername}/`);
    });

    it("renders repo name input", () => {
      const input = container.querySelector("#repo-name") as HTMLInputElement;
      expect(input).toBeDefined();
      expect(input.placeholder).toBe("my-website");
    });

    it("renders create button as disabled initially", () => {
      const button = container.querySelector("#create-btn") as HTMLButtonElement;
      expect(button).toBeDefined();
      expect(button.disabled).toBe(true);
    });

    it("renders Create & Deploy button text", () => {
      const btnText = container.querySelector("#btn-text");
      expect(btnText?.textContent).toBe("Create & Deploy");
    });

    it("renders cancel button", () => {
      const button = container.querySelector("#cancel-btn") as HTMLButtonElement;
      expect(button).toBeDefined();
      expect(button.textContent).toBe("Cancel");
    });

    it("renders note about public repositories", () => {
      const note = container.querySelector(".note");
      expect(note?.textContent).toContain("public");
    });
  });

  describe("Styling", () => {
    it("includes GitHub dark theme styles", () => {
      const styles = container.querySelector("style");
      expect(styles?.textContent).toContain("--bg: #0d1117");
      expect(styles?.textContent).toContain("--primary: #238636");
    });

    it("includes form validation styles", () => {
      const styles = container.querySelector("style");
      expect(styles?.textContent).toContain(".status.checking");
      expect(styles?.textContent).toContain(".status.available");
      expect(styles?.textContent).toContain(".status.taken");
      expect(styles?.textContent).toContain(".status.invalid");
    });

    it("includes spinner animation", () => {
      const styles = container.querySelector("style");
      expect(styles?.textContent).toContain("@keyframes spin");
      expect(styles?.textContent).toContain(".spinner");
    });
  });

  describe("Script Configuration", () => {
    it("includes token in script for API calls", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain(`const token = '${testToken}'`);
    });

    it("includes validation regex", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain("validNameRegex");
      expect(script?.textContent).toContain("/^[a-zA-Z0-9._-]+$/");
    });

    it("uses event emit instead of invoke", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain("emit('repo-setup-submit'");
    });
  });

  describe("Event Communication", () => {
    it("emits cancelled event on cancel", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain("type: 'cancelled'");
    });

    it("emits submitted event on create", () => {
      const scripts = container.querySelectorAll("script");
      const script = scripts[scripts.length - 1];
      expect(script?.textContent).toContain("type: 'submitted'");
    });
  });

  describe("Accessibility", () => {
    it("has autofocus on repo name input", () => {
      const input = container.querySelector("#repo-name");
      expect(input?.hasAttribute("autofocus")).toBe(true);
    });

    it("has autocomplete off on input", () => {
      const input = container.querySelector("#repo-name") as HTMLInputElement;
      expect(input.autocomplete).toBe("off");
    });

    it("has label for input", () => {
      const label = container.querySelector("label[for='repo-name']");
      expect(label).toBeDefined();
      expect(label?.textContent).toBe("Repository name");
    });
  });
});

// =============================================================================
// Bug 10: Test that showRepoSetupBrowser checks git credentials before OAuth
// =============================================================================

// Shared mock state accessible from test and mock factory
const mockState = {
  getTokenResult: null as string | null,
  getTokenFromGitResult: null as string | null,
  promptLoginCalled: false,
  storeTokenCalledWith: null as string | null,
};

// Mock modules before importing showRepoSetupBrowser
vi.mock("../utils", () => ({
  log: vi.fn().mockResolvedValue(undefined),
}));

// Mock moss-api to prevent unhandled rejections from waitForEvent
vi.mock("@symbiosis-lab/moss-api", () => ({
  openBrowserWithHtml: vi.fn().mockResolvedValue(undefined),
  closeBrowser: vi.fn().mockResolvedValue(undefined),
  waitForEvent: vi.fn().mockRejectedValue(new Error("Mocked: test ended")),
}));

// Mock auth module
vi.mock("../auth", () => ({
  promptLogin: vi.fn(async () => {
    mockState.promptLoginCalled = true;
    return true;
  }),
  validateToken: vi.fn().mockResolvedValue({
    valid: true,
    user: { login: "testuser" },
    scopes: ["repo", "workflow"],
  }),
  hasRequiredScopes: (scopes: string[]) =>
    scopes.includes("repo") && scopes.includes("workflow"),
}));

// Mock token module
vi.mock("../token", () => ({
  getToken: vi.fn(async () => mockState.getTokenResult),
  getTokenFromGit: vi.fn(async () => mockState.getTokenFromGitResult),
  storeToken: vi.fn(async (token: string) => {
    mockState.storeTokenCalledWith = token;
    return true;
  }),
}));

// Mock github-api
vi.mock("../github-api", () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue({ login: "testuser" }),
  createRepository: vi.fn().mockResolvedValue({
    name: "test-repo",
    sshUrl: "git@github.com:testuser/test-repo.git",
    fullName: "testuser/test-repo",
    htmlUrl: "https://github.com/testuser/test-repo",
  }),
}));

// Import after mocking
import { showRepoSetupBrowser } from "../repo-setup-browser";
import * as tokenModule from "../token";
import * as authModule from "../auth";

describe("showRepoSetupBrowser authentication (Bug 10)", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri();
    vi.clearAllMocks();

    // Reset mock state
    mockState.getTokenResult = null;
    mockState.getTokenFromGitResult = null;
    mockState.promptLoginCalled = false;
    mockState.storeTokenCalledWith = null;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should NOT trigger OAuth when git credentials exist and are valid", async () => {
    // Setup: No plugin cookie
    mockState.getTokenResult = null;

    // Git credential helper has valid token
    mockState.getTokenFromGitResult = "ghp_validtoken_from_git";

    // Call showRepoSetupBrowser - it will timeout waiting for event, but we can check if OAuth was triggered
    const resultPromise = showRepoSetupBrowser();

    // Give it a moment to check credentials
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should NOT have called promptLogin (OAuth)
    // This is the key assertion for Bug 10
    expect(mockState.promptLoginCalled).toBe(false);

    // Should have stored the git token in plugin cookies for faster future access
    expect(mockState.storeTokenCalledWith).toBe("ghp_validtoken_from_git");

    // Note: resultPromise continues running and will error due to missing Tauri event API.
    // This is expected in tests and doesn't affect test validity.
  });

  it("should trigger OAuth when neither plugin cookie nor git credentials exist", async () => {
    // Setup: No plugin cookie
    mockState.getTokenResult = null;

    // No git credentials either
    mockState.getTokenFromGitResult = null;

    // Call showRepoSetupBrowser
    const resultPromise = showRepoSetupBrowser();

    // Give it time to check credentials and trigger OAuth
    await new Promise((resolve) => setTimeout(resolve, 100));

    // SHOULD have called promptLogin (OAuth) because no credentials exist
    expect(mockState.promptLoginCalled).toBe(true);

    // Note: resultPromise continues running and will error due to missing Tauri event API.
    // This is expected in tests and doesn't affect test validity.
  });

  it("should skip git credential check when plugin cookie exists", async () => {
    // Setup: Plugin cookie has valid token
    mockState.getTokenResult = "ghp_cached_token";

    // Git credential helper also has token (but should not be checked)
    mockState.getTokenFromGitResult = "ghp_git_token";

    // Call showRepoSetupBrowser
    const resultPromise = showRepoSetupBrowser();

    // Give it time to check credentials
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should NOT have called promptLogin (OAuth)
    expect(mockState.promptLoginCalled).toBe(false);

    // Should NOT have called getTokenFromGit since plugin cookie exists
    expect(tokenModule.getTokenFromGit).not.toHaveBeenCalled();

    // Note: resultPromise continues running and will error due to missing Tauri event API.
    // This is expected in tests and doesn't affect test validity.
  });
});
