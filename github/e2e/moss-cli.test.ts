/**
 * E2E Tests for GitHub Deployer Plugin using Moss CLI
 *
 * These tests verify the plugin works correctly when invoked through
 * the moss CLI, testing real-world scenarios.
 *
 * Requirements:
 * - moss binary built and available (set MOSS_BINARY env var or build locally)
 * - Plugin built (npm run build)
 * - Tests create temporary directories for fixtures
 *
 * Limitations:
 * - CLI/headless mode cannot run webview-based plugins
 * - Full plugin execution tests require GUI mode or integration testing
 *
 * CI Setup:
 * - The workflow downloads moss-linux-x64 from releases before running tests
 * - Set MOSS_BINARY environment variable to the binary path
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync, spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Path to moss binary - check env var first, then fallback to local dev path
const MOSS_BINARY = process.env.MOSS_BINARY || path.join(
  __dirname,
  "../../../../moss/develop/src-tauri/target/debug/moss"
);

// Check if we're using a release binary (from CI) vs local dev build
const IS_CI_BINARY = !!process.env.MOSS_BINARY;

// Path to plugin dist
const PLUGIN_DIST = path.join(__dirname, "../dist");

// Test fixture directory
let testDir: string;
let fixtureCounter = 0;

/**
 * Create a test fixture directory with optional git initialization
 */
function createFixture(options: {
  withGit?: boolean;
  withRemote?: string;
  withPlugin?: boolean;
  content?: Record<string, string>;
}): string {
  const fixtureName = `moss-e2e-${Date.now()}-${fixtureCounter++}`;
  const fixturePath = path.join(testDir, fixtureName);
  fs.mkdirSync(fixturePath, { recursive: true });

  // Create content files
  const defaultContent = {
    "index.md": "# Hello World\n\nThis is a test site.",
    "about.md": "# About\n\nAbout page content.",
  };

  const content = options.content || defaultContent;
  for (const [filename, fileContent] of Object.entries(content)) {
    const filePath = path.join(fixturePath, filename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, fileContent);
  }

  // Initialize git if requested
  if (options.withGit) {
    execSync("git init", { cwd: fixturePath, stdio: "pipe" });
    execSync("git config user.email 'test@example.com'", {
      cwd: fixturePath,
      stdio: "pipe",
    });
    execSync("git config user.name 'Test User'", {
      cwd: fixturePath,
      stdio: "pipe",
    });
    execSync("git add .", { cwd: fixturePath, stdio: "pipe" });
    execSync('git commit -m "Initial commit"', {
      cwd: fixturePath,
      stdio: "pipe",
    });

    // Add remote if requested
    if (options.withRemote) {
      execSync(`git remote add origin ${options.withRemote}`, {
        cwd: fixturePath,
        stdio: "pipe",
      });
    }
  }

  // Link plugin if requested
  if (options.withPlugin) {
    const mossDir = path.join(fixturePath, ".moss");
    const pluginsDir = path.join(mossDir, "plugins");
    const githubPluginDir = path.join(pluginsDir, "github");

    fs.mkdirSync(pluginsDir, { recursive: true });

    // Copy plugin files (symlink might not work on all systems)
    const pluginFiles = ["main.bundle.js", "manifest.json", "icon.svg"];
    fs.mkdirSync(githubPluginDir, { recursive: true });

    for (const file of pluginFiles) {
      const src = path.join(PLUGIN_DIST, file);
      const dest = path.join(githubPluginDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      }
    }
  }

  return fixturePath;
}

/**
 * Run moss CLI and return stdout/stderr
 */
function runMoss(
  args: string[],
  options?: { cwd?: string; timeout?: number }
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(MOSS_BINARY, args, {
      cwd: options?.cwd || testDir,
      timeout: options?.timeout || 30000,
      env: {
        ...process.env,
        // Disable interactive prompts
        CI: "true",
      },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });

    proc.on("error", (err) => {
      stderr += err.message;
      resolve({ stdout, stderr, code: 1 });
    });
  });
}

describe("Moss CLI E2E Tests", () => {
  beforeAll(() => {
    // Verify moss binary exists - fail if not available
    if (!fs.existsSync(MOSS_BINARY)) {
      throw new Error(
        `Moss binary not found at ${MOSS_BINARY}. ` +
        `Either build moss locally, or set MOSS_BINARY environment variable. ` +
        `In CI, the binary should be downloaded from releases.`
      );
    }

    // Verify plugin dist exists - fail if not built
    if (!fs.existsSync(PLUGIN_DIST)) {
      throw new Error(
        `Plugin dist not found at ${PLUGIN_DIST}. Please build the plugin first with 'npm run build'.`
      );
    }

    // Create temp directory for test fixtures
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "moss-e2e-"));
  });

  afterAll(() => {
    // Cleanup test directory
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("moss --help", () => {
    it("shows help message with compile command", async () => {
      const { stdout, code } = await runMoss(["--help"]);

      expect(code).toBe(0);
      expect(stdout).toContain("moss");
      expect(stdout).toContain("compile");
    });

    it("shows help message with deploy command", async () => {
      const { stdout, code } = await runMoss(["--help"]);

      expect(code).toBe(0);
      expect(stdout).toContain("deploy");
      expect(stdout).toContain("GitHub Pages");
    });
  });

  describe("Basic compilation (no plugins)", () => {
    it("compiles a folder with markdown files", async () => {
      const fixture = createFixture({ content: { "index.md": "# Hello" } });

      const { stdout, stderr, code } = await runMoss([
        "compile",
        fixture,
        "--no-plugins",
      ]);

      // Should succeed
      expect(code).toBe(0);
      expect(stdout + stderr).toContain("Compiling");

      // Should create .moss/site directory
      const siteDir = path.join(fixture, ".moss", "site");
      expect(fs.existsSync(siteDir)).toBe(true);
    });
  });

  describe("Deploy command", () => {
    // This test verifies exit code 1 when no deploy plugin is installed.
    // The behavior was fixed in moss v0.3.0 (Bug 5).
    // Only runs in CI with release binary - local dev builds may have different behavior.
    it.skipIf(!IS_CI_BINARY)("shows 'no plugin' message when no deploy plugin installed", async () => {
      const fixture = createFixture({
        withGit: true,
        withRemote: "git@github.com:user/test-repo.git",
        withPlugin: false, // No plugin installed
      });

      const { stdout, stderr, code } = await runMoss(["deploy", fixture]);

      // Should exit with error (no plugin)
      expect(code).toBe(1);
      const output = stdout + stderr;
      expect(output).toMatch(/no.*plugin|install.*plugin/i);
    });

    it("compiles before deploying", async () => {
      const fixture = createFixture({
        withGit: true,
        withRemote: "git@github.com:user/test-repo.git",
      });

      const { stdout, stderr } = await runMoss(["deploy", fixture]);

      // Should show compilation step
      const output = stdout + stderr;
      expect(output).toContain("Compiling");

      // Should create .moss/site directory
      const siteDir = path.join(fixture, ".moss", "site");
      expect(fs.existsSync(siteDir)).toBe(true);
    });

    it("shows progress messages", async () => {
      const fixture = createFixture({
        withGit: true,
        withRemote: "git@github.com:user/test-repo.git",
      });

      const { stdout, stderr } = await runMoss(["deploy", fixture]);
      const output = stdout + stderr;

      // Should show deploy step
      expect(output).toContain("Deploying");
    });
  });

  describe("Plugin discovery", () => {
    it("creates plugin directory structure correctly", async () => {
      const fixture = createFixture({
        withPlugin: true,
      });

      // Verify plugin files were copied
      const pluginsDir = path.join(fixture, ".moss", "plugins", "github");
      expect(fs.existsSync(pluginsDir)).toBe(true);
      expect(fs.existsSync(path.join(pluginsDir, "manifest.json"))).toBe(true);
      expect(fs.existsSync(path.join(pluginsDir, "main.bundle.js"))).toBe(true);
    });

    it("manifest.json has correct structure", async () => {
      const fixture = createFixture({
        withPlugin: true,
      });

      const manifestPath = path.join(fixture, ".moss", "plugins", "github", "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

      expect(manifest.name).toBe("github");
      expect(manifest.capabilities).toContain("deploy");
      expect(manifest.entry).toBe("main.bundle.js");
      expect(manifest.global_name).toBe("GitHubDeployer");
    });
  });

  /**
   * NOTE: Full plugin execution tests are skipped in CLI mode.
   *
   * The moss CLI runs in headless mode without webview windows.
   * Plugin execution requires a webview to run JavaScript plugins.
   *
   * To test plugin execution:
   * 1. Use the existing unit/integration tests (npm run test)
   * 2. Run manual testing in GUI mode
   * 3. Or implement a Node.js-based plugin runtime for CLI
   */
  describe.skip("Plugin execution (requires GUI mode)", () => {
    it("reports validation errors for non-git repos", async () => {
      // This test requires GUI mode to execute plugin JavaScript
    });

    it("reports errors for missing remote", async () => {
      // This test requires GUI mode to execute plugin JavaScript
    });

    it("detects SSH remotes", async () => {
      // This test requires GUI mode to execute plugin JavaScript
    });

    it("creates workflow file", async () => {
      // This test requires GUI mode to execute plugin JavaScript
    });
  });
});
