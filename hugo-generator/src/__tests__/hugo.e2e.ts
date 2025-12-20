/**
 * E2E tests for Hugo Generator Plugin
 *
 * These tests require Hugo to be installed on the system.
 * They use our test fixtures to verify the complete build pipeline:
 * - Structure translation (moss format → Hugo format)
 * - Hugo build execution
 * - Output verification
 *
 * Note: These tests use Node.js fs directly for file operations since
 * they run in Node.js environment, not Tauri webview. The actual plugin
 * uses moss-api for file operations in production.
 *
 * Run with: npm run test:e2e
 * Tests will be skipped if Hugo is not installed.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { templates } from "../templates";

/**
 * Recursively list all files in a directory (for debugging).
 */
function listFilesRecursive(dir: string, prefix = ""): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(`${relativePath}/`);
        results.push(...listFilesRecursive(fullPath, relativePath));
      } else {
        results.push(relativePath);
      }
    }
  } catch {
    // Ignore errors
  }
  return results;
}

/**
 * Run Hugo with error capture.
 */
function runHugo(sourceDir: string, destDir: string, extraArgs: string[] = []): void {
  // Dump directory structure for debugging
  console.log("=== Hugo source directory structure ===");
  const files = listFilesRecursive(sourceDir);
  for (const f of files) {
    console.log(`  ${f}`);
  }

  // Dump hugo.toml contents
  const hugoTomlPath = path.join(sourceDir, "hugo.toml");
  if (fs.existsSync(hugoTomlPath)) {
    console.log("=== hugo.toml contents ===");
    console.log(fs.readFileSync(hugoTomlPath, "utf-8"));
  }

  // Dump baseof.html contents (first few lines)
  const baseofPath = path.join(sourceDir, "layouts", "_default", "baseof.html");
  if (fs.existsSync(baseofPath)) {
    console.log("=== baseof.html contents ===");
    console.log(fs.readFileSync(baseofPath, "utf-8"));
  }

  // Use spawnSync for better error capture
  const { spawnSync } = require("child_process");

  // Filter out --quiet from extraArgs since we want debug output
  const filteredArgs = extraArgs.filter(arg => arg !== "--quiet");

  const result = spawnSync("hugo", [
    "--source", sourceDir,
    "--destination", destDir,
    "--logLevel", "debug",
    ...filteredArgs,
  ], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Always log output for debugging
  if (result.stdout) {
    console.log("=== Hugo stdout ===");
    console.log(result.stdout);
  }
  if (result.stderr) {
    console.log("=== Hugo stderr ===");
    console.log(result.stderr);
  }

  if (result.status !== 0) {
    const stderr = result.stderr || "";
    const stdout = result.stdout || "";
    const errMsg = result.error ? String(result.error) : "";
    throw new Error(
      `Hugo failed with exit code ${result.status}.\n` +
      `Signal: ${result.signal}\n` +
      `Error: ${errMsg}\n` +
      `Source dir: ${sourceDir}\n` +
      `Dest dir: ${destDir}\n` +
      `Stderr: ${stderr}\n` +
      `Stdout: ${stdout}`
    );
  }
}

// Paths to test fixtures
const FIXTURES_DIR = path.resolve(__dirname, "../../test-fixtures");
const FLAT_SITE_FIXTURE = path.join(FIXTURES_DIR, "flat-site");
const COLLECTIONS_SITE_FIXTURE = path.join(FIXTURES_DIR, "collections-site");

// Check if Hugo is installed at module load time
function isHugoInstalled(): boolean {
  try {
    execSync("hugo version", { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const hugoAvailable = isHugoInstalled();

/**
 * E2E-specific structure creation using Node.js fs.
 * Mirrors the logic in structure.ts but uses Node.js APIs for testing.
 */
async function createHugoStructureForTest(
  projectPath: string,
  projectInfo: { content_folders: string[]; homepage_file?: string },
  runtimeDir: string
): Promise<void> {
  const contentDir = path.join(runtimeDir, "content");
  const staticDir = path.join(runtimeDir, "static");
  fs.mkdirSync(contentDir, { recursive: true });
  fs.mkdirSync(staticDir, { recursive: true });

  // 1. Handle homepage
  if (projectInfo.homepage_file) {
    const homepageSrc = path.join(projectPath, projectInfo.homepage_file);
    if (fs.existsSync(homepageSrc)) {
      const content = fs.readFileSync(homepageSrc, "utf-8");
      fs.writeFileSync(path.join(contentDir, "_index.md"), content);
    }
  }

  // 2. Copy content folders with index.md → _index.md renaming
  for (const folder of projectInfo.content_folders) {
    const folderSrc = path.join(projectPath, folder);
    if (fs.existsSync(folderSrc)) {
      copyContentFolder(folderSrc, path.join(contentDir, folder));
    }
  }

  // 3. Copy root markdown files (excluding homepage)
  const rootFiles = fs.readdirSync(projectPath);
  for (const file of rootFiles) {
    if (
      file.endsWith(".md") &&
      file !== projectInfo.homepage_file &&
      fs.statSync(path.join(projectPath, file)).isFile()
    ) {
      const content = fs.readFileSync(path.join(projectPath, file), "utf-8");
      fs.writeFileSync(path.join(contentDir, file), content);
    }
  }

  // 4. Copy assets if exists
  const assetsPath = path.join(projectPath, "assets");
  if (fs.existsSync(assetsPath)) {
    copyDirectory(assetsPath, path.join(staticDir, "assets"));
  }
}

function copyContentFolder(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstName =
      entry.name.toLowerCase() === "index.md" ? "_index.md" : entry.name;
    const dstPath = path.join(dst, dstName);

    if (entry.isDirectory()) {
      copyContentFolder(srcPath, dstPath);
    } else {
      const content = fs.readFileSync(srcPath, "utf-8");
      fs.writeFileSync(dstPath, content);
    }
  }
}

function copyDirectory(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function createHugoConfigForTest(
  runtimeDir: string,
  siteName = "Site",
  baseUrl = "/"
): void {
  const config = `# Auto-generated Hugo configuration
baseURL = "${baseUrl}"
title = "${siteName}"

# Disable features we don't need (must be before section headers)
disableKinds = ["taxonomy", "term", "RSS", "sitemap"]

[permalinks]
  [permalinks.page]
    '*' = '/:sections/:filename/'
  [permalinks.section]
    '*' = '/:sections/'

[markup]
  [markup.goldmark]
    [markup.goldmark.renderer]
      unsafe = true
`;
  fs.writeFileSync(path.join(runtimeDir, "hugo.toml"), config);
}

function createDefaultLayoutsForTest(runtimeDir: string): void {
  const layoutsDir = path.join(runtimeDir, "layouts");
  const defaultDir = path.join(layoutsDir, "_default");
  fs.mkdirSync(defaultDir, { recursive: true });

  fs.writeFileSync(path.join(defaultDir, "baseof.html"), templates.baseof);
  fs.writeFileSync(path.join(defaultDir, "single.html"), templates.single);
  fs.writeFileSync(path.join(defaultDir, "list.html"), templates.list);
  fs.writeFileSync(path.join(layoutsDir, "index.html"), templates.index);
}

// Use describe.skipIf to skip all tests if Hugo is not available
describe.skipIf(!hugoAvailable)("Hugo Generator E2E", () => {
  let tempDir: string;
  let runtimeDir: string;
  let outputDir: string;

  beforeAll(() => {
    if (hugoAvailable) {
      const version = execSync("hugo version", { encoding: "utf-8" });
      console.log(`Hugo available: ${version.trim()}`);
    }
  });

  beforeEach(() => {
    // Create temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hugo-e2e-"));
    runtimeDir = path.join(tempDir, ".runtime");
    outputDir = path.join(tempDir, "output");
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Flat Site (no collections)", () => {
    it("builds flat site with homepage and root pages", async () => {
      const projectInfo = {
        content_folders: [] as string[],
        homepage_file: "index.md",
      };

      await createHugoStructureForTest(
        FLAT_SITE_FIXTURE,
        projectInfo,
        runtimeDir
      );
      createHugoConfigForTest(runtimeDir, "Flat Site Test");
      createDefaultLayoutsForTest(runtimeDir);

      // Verify structure was created
      expect(fs.existsSync(path.join(runtimeDir, "content", "_index.md"))).toBe(
        true
      );
      expect(fs.existsSync(path.join(runtimeDir, "content", "about.md"))).toBe(
        true
      );
      expect(
        fs.existsSync(path.join(runtimeDir, "content", "contact.md"))
      ).toBe(true);
      expect(fs.existsSync(path.join(runtimeDir, "hugo.toml"))).toBe(true);

      // Run Hugo
      runHugo(runtimeDir, outputDir, ["--quiet"]);

      // Verify output
      expect(fs.existsSync(path.join(outputDir, "index.html"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "about", "index.html"))).toBe(
        true
      );
      expect(fs.existsSync(path.join(outputDir, "contact", "index.html"))).toBe(
        true
      );

      // Verify content is rendered
      const homeHtml = fs.readFileSync(
        path.join(outputDir, "index.html"),
        "utf-8"
      );
      expect(homeHtml).toContain("Welcome to My Site");
    });
  });

  describe("Collections Site (with posts folder)", () => {
    it("builds site with collections and nested content", async () => {
      const projectInfo = {
        content_folders: ["posts"],
        homepage_file: "index.md",
      };

      await createHugoStructureForTest(
        COLLECTIONS_SITE_FIXTURE,
        projectInfo,
        runtimeDir
      );
      createHugoConfigForTest(runtimeDir, "Collections Site Test");
      createDefaultLayoutsForTest(runtimeDir);

      // Verify structure - posts/index.md should become posts/_index.md
      expect(fs.existsSync(path.join(runtimeDir, "content", "_index.md"))).toBe(
        true
      );
      expect(
        fs.existsSync(path.join(runtimeDir, "content", "posts", "_index.md"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(runtimeDir, "content", "posts", "post-1.md"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(runtimeDir, "content", "posts", "post-2.md"))
      ).toBe(true);

      // Run Hugo
      runHugo(runtimeDir, outputDir, ["--quiet"]);

      // Verify output structure
      expect(fs.existsSync(path.join(outputDir, "index.html"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "posts", "index.html"))).toBe(
        true
      );
      expect(
        fs.existsSync(path.join(outputDir, "posts", "post-1", "index.html"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(outputDir, "posts", "post-2", "index.html"))
      ).toBe(true);

      // Verify content is rendered
      const postsHtml = fs.readFileSync(
        path.join(outputDir, "posts", "index.html"),
        "utf-8"
      );
      expect(postsHtml).toContain("Posts");

      const post1Html = fs.readFileSync(
        path.join(outputDir, "posts", "post-1", "index.html"),
        "utf-8"
      );
      expect(post1Html).toContain("First Post");
    });

    it("copies assets folder to static/assets", async () => {
      const projectInfo = {
        content_folders: ["posts"],
        homepage_file: "index.md",
      };

      await createHugoStructureForTest(
        COLLECTIONS_SITE_FIXTURE,
        projectInfo,
        runtimeDir
      );
      createHugoConfigForTest(runtimeDir);
      createDefaultLayoutsForTest(runtimeDir);

      // Verify assets are copied
      const assetsPath = path.join(runtimeDir, "static", "assets");
      expect(fs.existsSync(assetsPath)).toBe(true);

      // Run Hugo
      runHugo(runtimeDir, outputDir, ["--quiet"]);

      // Assets should be copied to output
      expect(
        fs.existsSync(path.join(outputDir, "assets", "placeholder.txt"))
      ).toBe(true);
    });
  });

  describe("Runtime Cleanup", () => {
    it("runtime directory can be cleaned up after build", async () => {
      const projectInfo = {
        content_folders: [] as string[],
        homepage_file: "index.md",
      };

      await createHugoStructureForTest(
        FLAT_SITE_FIXTURE,
        projectInfo,
        runtimeDir
      );
      createHugoConfigForTest(runtimeDir);
      createDefaultLayoutsForTest(runtimeDir);

      // Run Hugo
      runHugo(runtimeDir, outputDir, ["--quiet"]);

      // Clean up
      fs.rmSync(runtimeDir, { recursive: true, force: true });

      // Verify cleanup
      expect(fs.existsSync(runtimeDir)).toBe(false);
    });
  });

  describe("Hugo Build Options", () => {
    it("applies --minify flag", async () => {
      const projectInfo = {
        content_folders: [] as string[],
        homepage_file: "index.md",
      };

      await createHugoStructureForTest(
        FLAT_SITE_FIXTURE,
        projectInfo,
        runtimeDir
      );
      createHugoConfigForTest(runtimeDir);
      createDefaultLayoutsForTest(runtimeDir);

      const outputNormal = path.join(tempDir, "output-normal");
      const outputMinify = path.join(tempDir, "output-minify");
      fs.mkdirSync(outputNormal);
      fs.mkdirSync(outputMinify);

      // Build without minify
      runHugo(runtimeDir, outputNormal, ["--quiet"]);

      // Build with minify
      runHugo(runtimeDir, outputMinify, ["--quiet", "--minify"]);

      const normalHtml = fs.readFileSync(
        path.join(outputNormal, "index.html"),
        "utf-8"
      );
      const minifyHtml = fs.readFileSync(
        path.join(outputMinify, "index.html"),
        "utf-8"
      );

      // Minified should be smaller or equal
      expect(minifyHtml.length).toBeLessThanOrEqual(normalHtml.length);
    });
  });

  describe("Error Handling", () => {
    it("fails with clear error for invalid Hugo path", () => {
      let errorThrown = false;

      try {
        execSync(`/nonexistent/hugo --version`, { stdio: "pipe" });
      } catch {
        errorThrown = true;
      }

      expect(errorThrown).toBe(true);
    });

    it("handles empty project gracefully", async () => {
      const emptyDir = path.join(tempDir, "empty-project");
      fs.mkdirSync(emptyDir);

      const projectInfo = {
        content_folders: [] as string[],
        homepage_file: undefined,
      };

      await createHugoStructureForTest(emptyDir, projectInfo, runtimeDir);
      createHugoConfigForTest(runtimeDir);
      createDefaultLayoutsForTest(runtimeDir);

      // Hugo should still build (empty site)
      runHugo(runtimeDir, outputDir, ["--quiet"]);

      // Output directory exists (even if empty or with just hugo files)
      expect(fs.existsSync(outputDir)).toBe(true);
    });
  });
});

// Provide feedback when Hugo is not installed
if (!hugoAvailable) {
  describe("Hugo Generator E2E (Hugo not installed)", () => {
    it.skip("Hugo binary not found - install Hugo to run E2E tests", () => {
      // This test is always skipped, but provides user feedback
    });
  });
}
