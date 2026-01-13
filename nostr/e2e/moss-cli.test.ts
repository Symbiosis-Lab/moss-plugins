/**
 * E2E Tests for Nostr Plugin using Moss CLI
 *
 * These tests verify the Nostr plugin works correctly when invoked through
 * the moss CLI, testing real-world scenarios.
 *
 * The Nostr plugin has capabilities:
 * - process: Fetches social interactions from Nostr relays
 * - enhance: Injects interaction data into generated HTML
 * - syndicate: Publishes articles to Nostr as NIP-23 long-form content
 *
 * Requirements:
 * - moss binary with --wait-plugins support (v0.3.1+)
 * - Plugin built (npm run build)
 * - Display server available (xvfb-run on Linux CI)
 *
 * Note: Tests connect to real Nostr relays but handle network errors gracefully.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Path to moss binary
const MOSS_BINARY =
  process.env.MOSS_BINARY ||
  path.join(__dirname, "../../../../moss/develop/src-tauri/target/debug/moss");

// Check if --wait-plugins is supported
let HAS_WAIT_PLUGINS = false;

// Path to plugin dist
const PLUGIN_DIST = path.join(__dirname, "../dist");

// Test fixture directory
let testDir: string;
let fixtureCounter = 0;

/**
 * Create a test fixture directory
 */
function createFixture(options: {
  withPlugin?: boolean;
  withNostrConfig?: Record<string, unknown>;
  content?: Record<string, string>;
}): string {
  const fixtureName = `moss-nostr-e2e-${Date.now()}-${fixtureCounter++}`;
  const fixturePath = path.join(testDir, fixtureName);
  fs.mkdirSync(fixturePath, { recursive: true });

  // Create content files
  const defaultContent = {
    "index.md": "# Hello World\n\nThis is a test site.",
    "posts/article1.md": `---
title: Test Article
date: 2024-01-01
nostr_event_id: ""
tags:
  - nostr
  - test
---

# Test Article for Nostr

This article will be tested with the Nostr plugin.
`,
  };

  const content = options.content || defaultContent;
  for (const [filename, fileContent] of Object.entries(content)) {
    const filePath = path.join(fixturePath, filename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, fileContent);
  }

  // Install plugin if requested
  if (options.withPlugin) {
    const mossDir = path.join(fixturePath, ".moss");
    const pluginsDir = path.join(mossDir, "plugins");
    const nostrPluginDir = path.join(pluginsDir, "nostr");

    fs.mkdirSync(nostrPluginDir, { recursive: true });

    // Copy plugin files
    const pluginFiles = ["main.bundle.js", "manifest.json", "icon.svg"];
    for (const file of pluginFiles) {
      const src = path.join(PLUGIN_DIST, file);
      const dest = path.join(nostrPluginDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      }
    }

    // Write plugin config if provided
    if (options.withNostrConfig) {
      const configPath = path.join(nostrPluginDir, "config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify(options.withNostrConfig, null, 2)
      );
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

describe("Nostr Plugin E2E Tests", () => {
  beforeAll(async () => {
    // Verify moss binary exists
    if (!fs.existsSync(MOSS_BINARY)) {
      throw new Error(
        `Moss binary not found at ${MOSS_BINARY}. ` +
          `Set MOSS_BINARY environment variable or build moss locally.`
      );
    }

    // Verify plugin dist exists
    if (!fs.existsSync(PLUGIN_DIST)) {
      throw new Error(
        `Plugin dist not found at ${PLUGIN_DIST}. Run 'npm run build' first.`
      );
    }

    // Create temp directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "moss-nostr-e2e-"));

    // Check if --wait-plugins is supported
    const { stdout } = await runMoss(["--help"]);
    HAS_WAIT_PLUGINS = stdout.includes("--wait-plugins");
  });

  afterAll(() => {
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("Plugin discovery", () => {
    it("has correct manifest structure", () => {
      const fixture = createFixture({ withPlugin: true });

      const manifestPath = path.join(
        fixture,
        ".moss",
        "plugins",
        "nostr",
        "manifest.json"
      );
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

      expect(manifest.name).toBe("nostr");
      expect(manifest.capabilities).toContain("process");
      expect(manifest.capabilities).toContain("enhance");
      expect(manifest.capabilities).toContain("syndicate");
      expect(manifest.entry).toBe("main.bundle.js");
    });

    it("has default relay configuration", () => {
      const fixture = createFixture({ withPlugin: true });

      const manifestPath = path.join(
        fixture,
        ".moss",
        "plugins",
        "nostr",
        "manifest.json"
      );
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

      expect(manifest.config.relays).toContain("wss://relay.damus.io");
      expect(manifest.config.relays).toContain("wss://nos.lol");
    });
  });

  /**
   * Process Hook Tests
   *
   * The process hook fetches social interactions from Nostr relays.
   * Without a pubkey configured, it should handle this gracefully.
   */
  describe("Process hook (with --wait-plugins)", () => {
    it.skipIf(!HAS_WAIT_PLUGINS)(
      "compiles with nostr plugin - handles missing pubkey gracefully",
      async () => {
        const fixture = createFixture({
          withPlugin: true,
          withNostrConfig: {
            // No pubkey - plugin should handle gracefully
            relays: ["wss://relay.damus.io"],
            fetch_interactions: true,
          },
          content: {
            "index.md": "# My Nostr Blog\n\nWelcome!",
          },
        });

        // Compile with plugins
        const { stdout, stderr, code } = await runMoss(
          ["compile", fixture, "--wait-plugins"],
          { timeout: 90000 } // Longer timeout for relay connections
        );

        const output = stdout + stderr;

        // Compilation should succeed (plugin handles missing config gracefully)
        expect(code).toBe(0);

        // Site should be created
        const siteDir = path.join(fixture, ".moss", "site");
        expect(fs.existsSync(siteDir)).toBe(true);
      }
    );

    it.skipIf(!HAS_WAIT_PLUGINS)(
      "handles relay connection errors gracefully",
      async () => {
        const fixture = createFixture({
          withPlugin: true,
          withNostrConfig: {
            // Use a fake relay that won't connect
            relays: ["wss://fake-relay-that-does-not-exist.invalid"],
            pubkey: "npub1test",
            fetch_interactions: true,
          },
          content: {
            "index.md": "# Test\n\nContent",
          },
        });

        const { stdout, stderr, code } = await runMoss(
          ["compile", fixture, "--wait-plugins"],
          { timeout: 90000 }
        );

        // Build should still complete (plugin handles network errors)
        expect(code).toBe(0);

        // Site should be generated despite relay errors
        const siteDir = path.join(fixture, ".moss", "site");
        expect(fs.existsSync(siteDir)).toBe(true);
      }
    );
  });

  /**
   * Enhance Hook Tests
   *
   * The enhance hook injects interaction data into HTML.
   */
  describe("Enhance hook (with --wait-plugins)", () => {
    it.skipIf(!HAS_WAIT_PLUGINS)(
      "generates HTML with nostr plugin active",
      async () => {
        const fixture = createFixture({
          withPlugin: true,
          content: {
            "index.md": "# Hello Nostr\n\nThis is a test.",
          },
        });

        const { stdout, stderr, code } = await runMoss(
          ["compile", fixture, "--wait-plugins"],
          { timeout: 90000 }
        );

        expect(code).toBe(0);

        // Check HTML was generated
        const indexHtml = path.join(fixture, ".moss", "site", "index.html");
        expect(fs.existsSync(indexHtml)).toBe(true);

        const htmlContent = fs.readFileSync(indexHtml, "utf-8");
        expect(htmlContent).toContain("Hello Nostr");
      }
    );
  });

  /**
   * Build Integration Tests
   */
  describe("Build integration", () => {
    it.skipIf(!HAS_WAIT_PLUGINS)(
      "build completes with disabled interactions",
      async () => {
        const fixture = createFixture({
          withPlugin: true,
          withNostrConfig: {
            relays: [],
            pubkey: "",
            fetch_interactions: false, // Disabled
          },
          content: {
            "index.md": "# Blog\n\nContent here.",
          },
        });

        const { stdout, stderr, code } = await runMoss(
          ["compile", fixture, "--wait-plugins"],
          { timeout: 60000 }
        );

        expect(code).toBe(0);

        const siteDir = path.join(fixture, ".moss", "site");
        expect(fs.existsSync(siteDir)).toBe(true);
      }
    );
  });
});
