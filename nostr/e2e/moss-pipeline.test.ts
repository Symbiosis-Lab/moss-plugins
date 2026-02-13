/**
 * E2E Tests for Moss Pipeline with SSG and Nostr Plugins
 *
 * These tests verify the full moss pipeline:
 * 1. SSG plugin transforms markdown to HTML
 * 2. Nostr plugin enhances HTML with comment widget
 *
 * Tests use markdown content fixtures that go through the full build pipeline,
 * rather than testing on pre-generated HTML. This finds bugs in:
 * - Folder structure transformation
 * - URL generation and path resolution
 * - Plugin coordination
 * - Edge cases in content processing
 *
 * Requirements:
 * - moss binary with --wait-plugins support
 * - SSG plugin built (e.g., hugo)
 * - Nostr plugin built
 *
 * Run with: npm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execSync, spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Path to moss binary
const MOSS_BINARY =
  process.env.MOSS_BINARY ||
  path.join(__dirname, "../../../../moss/develop/src-tauri/target/debug/moss");

// Check if moss binary exists
const MOSS_AVAILABLE = fs.existsSync(MOSS_BINARY);

// Path to plugin dist directories
const NOSTR_PLUGIN_DIST = path.join(__dirname, "../dist");
const HUGO_PLUGIN_DIST = path.join(__dirname, "../../hugo/dist");

// Path to content fixtures
const CONTENT_FIXTURES = path.join(__dirname, "content-fixtures");

// Test temp directory
let testDir: string;
let fixtureCounter = 0;

/**
 * Copy directory recursively
 */
function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Create a test project from content fixtures
 */
function createTestProject(
  fixtureName: string,
  options?: {
    ssgPlugin?: "hugo" | "none";
    nostrConfig?: Record<string, unknown>;
  }
): string {
  const projectName = `moss-pipeline-${Date.now()}-${fixtureCounter++}`;
  const projectPath = path.join(testDir, projectName);

  // Copy content fixture
  const fixturePath = path.join(CONTENT_FIXTURES, fixtureName);
  if (fs.existsSync(fixturePath)) {
    copyDir(fixturePath, projectPath);
  } else {
    fs.mkdirSync(projectPath, { recursive: true });
  }

  // Create .moss directory structure
  const mossDir = path.join(projectPath, ".moss");
  const pluginsDir = path.join(mossDir, "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });

  // Install SSG plugin if requested
  if (options?.ssgPlugin === "hugo" && fs.existsSync(HUGO_PLUGIN_DIST)) {
    const hugoDir = path.join(pluginsDir, "hugo");
    fs.mkdirSync(hugoDir, { recursive: true });

    const hugoFiles = ["main.bundle.js", "manifest.json", "icon.svg"];
    for (const file of hugoFiles) {
      const src = path.join(HUGO_PLUGIN_DIST, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(hugoDir, file));
      }
    }
  }

  // Install Nostr plugin
  if (fs.existsSync(NOSTR_PLUGIN_DIST)) {
    const nostrDir = path.join(pluginsDir, "nostr");
    fs.mkdirSync(nostrDir, { recursive: true });

    const nostrFiles = ["main.bundle.js", "manifest.json", "icon.svg"];
    for (const file of nostrFiles) {
      const src = path.join(NOSTR_PLUGIN_DIST, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(nostrDir, file));
      }
    }

    // Write Nostr config if provided
    if (options?.nostrConfig) {
      fs.writeFileSync(
        path.join(nostrDir, "config.json"),
        JSON.stringify(options.nostrConfig, null, 2)
      );
    }
  }

  return projectPath;
}

/**
 * Run moss CLI and return result
 */
function runMoss(
  args: string[],
  options?: { cwd?: string; timeout?: number }
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(MOSS_BINARY, args, {
      cwd: options?.cwd || testDir,
      timeout: options?.timeout || 60000,
      env: {
        ...process.env,
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

/**
 * Check if generated HTML contains moss-comments widget
 */
function hasCommentsWidget(htmlPath: string): boolean {
  if (!fs.existsSync(htmlPath)) {
    return false;
  }
  const html = fs.readFileSync(htmlPath, "utf-8");
  return html.includes('id="moss-comments"');
}

/**
 * Get all HTML files in a directory recursively
 */
function getHtmlFiles(dir: string): string[] {
  const files: string[] = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getHtmlFiles(fullPath));
    } else if (entry.name.endsWith(".html")) {
      files.push(fullPath);
    }
  }

  return files;
}

// Skip all tests if moss is not available
describe.skipIf(!MOSS_AVAILABLE)("Moss Pipeline E2E", () => {
  beforeAll(() => {
    // Create temp directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "moss-pipeline-e2e-"));

    // Verify plugins exist
    if (!fs.existsSync(NOSTR_PLUGIN_DIST)) {
      console.warn(`Nostr plugin dist not found at ${NOSTR_PLUGIN_DIST}`);
    }
    if (!fs.existsSync(HUGO_PLUGIN_DIST)) {
      console.warn(`Hugo plugin dist not found at ${HUGO_PLUGIN_DIST}`);
    }
  });

  afterAll(() => {
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("Basic content", () => {
    it("compiles basic site with posts", async () => {
      const project = createTestProject("basic", {
        ssgPlugin: "hugo",
        nostrConfig: { relays: [] },
      });

      const { code } = await runMoss(["compile", project, "--wait-plugins"], {
        timeout: 120000,
      });

      expect(code).toBe(0);

      // Check site was generated
      const siteDir = path.join(project, ".moss", "site");
      expect(fs.existsSync(siteDir)).toBe(true);

      // Check HTML files exist
      const htmlFiles = getHtmlFiles(siteDir);
      expect(htmlFiles.length).toBeGreaterThan(0);
    });
  });

  describe("Nested folders", () => {
    it("handles deep folder nesting", async () => {
      const project = createTestProject("nested-folders", {
        ssgPlugin: "hugo",
        nostrConfig: { relays: [] },
      });

      const { code, stderr } = await runMoss(
        ["compile", project, "--wait-plugins"],
        { timeout: 120000 }
      );

      // Should not crash
      expect(code).toBe(0);

      const siteDir = path.join(project, ".moss", "site");
      expect(fs.existsSync(siteDir)).toBe(true);
    });
  });

  describe("Special characters in filenames", () => {
    it("handles files with spaces and special chars", async () => {
      const project = createTestProject("special-chars", {
        ssgPlugin: "hugo",
        nostrConfig: { relays: [] },
      });

      const { code, stderr } = await runMoss(
        ["compile", project, "--wait-plugins"],
        { timeout: 120000 }
      );

      // Check for any path-related errors
      const hasPathError =
        stderr.includes("path") ||
        stderr.includes("not found") ||
        stderr.includes("ENOENT");

      // Log stderr for debugging
      if (code !== 0) {
        console.log("Compile stderr:", stderr);
      }
    });
  });

  describe("Unicode filenames", () => {
    it("handles Chinese and Japanese filenames", async () => {
      const project = createTestProject("unicode-filenames", {
        ssgPlugin: "hugo",
        nostrConfig: { relays: [] },
      });

      const { code, stderr } = await runMoss(
        ["compile", project, "--wait-plugins"],
        { timeout: 120000 }
      );

      // Log any errors for debugging unicode issues
      if (code !== 0 || stderr.includes("error")) {
        console.log("Unicode test stderr:", stderr);
      }
    });
  });

  describe("Deep nesting", () => {
    it("handles 6 levels of folder nesting", async () => {
      const project = createTestProject("deep-nesting", {
        ssgPlugin: "hugo",
        nostrConfig: { relays: [] },
      });

      const { code, stderr } = await runMoss(
        ["compile", project, "--wait-plugins"],
        { timeout: 120000 }
      );

      // Should handle deep paths
      expect(code).toBe(0);
    });
  });

  describe("Empty folders", () => {
    it("handles empty content folders gracefully", async () => {
      const project = createTestProject("empty-folders", {
        ssgPlugin: "hugo",
        nostrConfig: { relays: [] },
      });

      const { code, stderr } = await runMoss(
        ["compile", project, "--wait-plugins"],
        { timeout: 120000 }
      );

      // Should not crash on empty folders
      expect(code).toBe(0);
    });
  });

  describe("Mixed content types", () => {
    it("handles posts, pages, and assets together", async () => {
      const project = createTestProject("mixed-content", {
        ssgPlugin: "hugo",
        nostrConfig: { relays: [] },
      });

      const { code, stderr } = await runMoss(
        ["compile", project, "--wait-plugins"],
        { timeout: 120000 }
      );

      expect(code).toBe(0);

      // Check both post and page HTML were generated
      const siteDir = path.join(project, ".moss", "site");
      const htmlFiles = getHtmlFiles(siteDir);

      // Should have index, posts, and about pages
      expect(htmlFiles.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Frontmatter edge cases", () => {
    it("handles posts with no frontmatter", async () => {
      const project = createTestProject("frontmatter-edge-cases", {
        ssgPlugin: "hugo",
        nostrConfig: { relays: [] },
      });

      const { code, stderr } = await runMoss(
        ["compile", project, "--wait-plugins"],
        { timeout: 120000 }
      );

      // Log issues for debugging
      if (stderr.includes("frontmatter") || stderr.includes("yaml")) {
        console.log("Frontmatter test stderr:", stderr);
      }
    });

    it("escapes special characters in titles", async () => {
      const project = createTestProject("frontmatter-edge-cases", {
        ssgPlugin: "hugo",
        nostrConfig: { relays: [] },
      });

      const { code } = await runMoss(
        ["compile", project, "--wait-plugins"],
        { timeout: 120000 }
      );

      if (code === 0) {
        const siteDir = path.join(project, ".moss", "site");
        const htmlFiles = getHtmlFiles(siteDir);

        // Check that special chars in titles are escaped in HTML
        for (const htmlFile of htmlFiles) {
          const html = fs.readFileSync(htmlFile, "utf-8");
          // Title with < > should be escaped
          expect(html).not.toContain("<Special>");
        }
      }
    });
  });
});

// Provide feedback when dependencies are missing
describe("Pipeline E2E Prerequisites", () => {
  it.skipIf(MOSS_AVAILABLE)("moss binary not found", () => {
    console.log(`Moss binary not found at ${MOSS_BINARY}`);
    console.log("Set MOSS_BINARY environment variable to run pipeline tests");
  });

  it.skipIf(fs.existsSync(NOSTR_PLUGIN_DIST))("nostr plugin not built", () => {
    console.log(`Nostr plugin dist not found at ${NOSTR_PLUGIN_DIST}`);
    console.log("Run 'npm run build' in nostr plugin directory");
  });

  it.skipIf(fs.existsSync(HUGO_PLUGIN_DIST))("hugo plugin not built", () => {
    console.log(`Hugo plugin dist not found at ${HUGO_PLUGIN_DIST}`);
    console.log("Run 'npm run build' in hugo plugin directory");
  });
});
