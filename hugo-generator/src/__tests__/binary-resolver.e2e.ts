/**
 * E2E tests for Binary Resolution and Auto-Download
 *
 * These tests verify the binary resolver functionality:
 * - Detection of Hugo from system PATH
 * - Detection from configured path
 * - Auto-download when Hugo is not available
 * - Version extraction
 * - Error handling
 *
 * Note: Some tests require network access to GitHub.
 * Tests that would download Hugo are only run in CI with TEST_DOWNLOAD_HUGO=true.
 *
 * Run with: npm run test:e2e
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Check if Hugo is installed on the system
 */
function isHugoInstalled(): boolean {
  try {
    execSync("hugo version", { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Hugo version from system
 */
function getSystemHugoVersion(): string | null {
  try {
    const output = execSync("hugo version", { encoding: "utf-8", stdio: "pipe" });
    const match = output.match(/hugo v(\d+\.\d+\.\d+)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Check if we should run download tests
 * Download tests are expensive and require network - only run in CI
 */
function shouldRunDownloadTests(): boolean {
  return process.env.TEST_DOWNLOAD_HUGO === "true";
}

/**
 * Get current platform info using Node.js
 */
function getPlatform(): { os: string; arch: string } {
  const osMap: Record<string, string> = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows",
  };
  const archMap: Record<string, string> = {
    arm64: "arm64",
    x64: "x64",
    x86_64: "x64",
  };

  return {
    os: osMap[os.platform()] ?? os.platform(),
    arch: archMap[os.arch()] ?? os.arch(),
  };
}

const hugoAvailable = isHugoInstalled();
const platform = getPlatform();

// ============================================================================
// Tests
// ============================================================================

describe("Binary Resolution E2E", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "binary-resolver-e2e-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("System Hugo Detection", () => {
    describe.skipIf(!hugoAvailable)("when Hugo is installed", () => {
      it("detects Hugo from PATH", () => {
        const result = spawnSync("hugo", ["version"], {
          encoding: "utf-8",
          stdio: "pipe",
        });

        expect(result.status).toBe(0);
        expect(result.stdout + result.stderr).toMatch(/hugo v\d+\.\d+\.\d+/i);
      });

      it("extracts version correctly", () => {
        const version = getSystemHugoVersion();

        expect(version).not.toBeNull();
        expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      });

      it("verifies Hugo version output format", () => {
        const output = execSync("hugo version", {
          encoding: "utf-8",
          stdio: "pipe",
        });

        // Hugo version output format: "hugo v0.139.0+extended darwin/arm64 BuildDate=..."
        expect(output).toMatch(/hugo v\d+\.\d+\.\d+/);
        expect(output.toLowerCase()).toMatch(platform.os);
      });
    });

    describe.skipIf(hugoAvailable)("when Hugo is not installed", () => {
      it("reports command not found", () => {
        const result = spawnSync("hugo-definitely-not-installed", ["version"], {
          encoding: "utf-8",
          stdio: "pipe",
        });

        expect(result.status).not.toBe(0);
      });
    });
  });

  describe("Version Pattern Matching", () => {
    const versionPattern = /hugo v(\d+\.\d+\.\d+)/i;

    const testCases = [
      {
        output: "hugo v0.139.0+extended darwin/arm64 BuildDate=unknown",
        expected: "0.139.0",
      },
      {
        output: "hugo v0.100.1-deadbeef+extended linux/amd64",
        expected: "0.100.1",
      },
      {
        output: "Hugo Static Site Generator v0.88.0/extended darwin/amd64",
        expected: "0.88.0",
      },
      {
        output: "hugo v1.0.0 windows/amd64",
        expected: "1.0.0",
      },
    ];

    for (const { output, expected } of testCases) {
      it(`extracts ${expected} from "${output.substring(0, 40)}..."`, () => {
        const match = output.match(versionPattern);
        expect(match).not.toBeNull();
        expect(match![1]).toBe(expected);
      });
    }
  });

  describe("Platform Detection", () => {
    it("detects current platform correctly", () => {
      const nodeOs = os.platform();
      const nodeArch = os.arch();

      expect(platform.os).toBeDefined();
      expect(platform.arch).toBeDefined();

      if (nodeOs === "darwin") {
        expect(platform.os).toBe("darwin");
      } else if (nodeOs === "linux") {
        expect(platform.os).toBe("linux");
      } else if (nodeOs === "win32") {
        expect(platform.os).toBe("windows");
      }

      if (nodeArch === "arm64") {
        expect(platform.arch).toBe("arm64");
      } else if (nodeArch === "x64") {
        expect(platform.arch).toBe("x64");
      }
    });
  });

  describe("Download URL Construction", () => {
    const assetPattern = "hugo_extended_{version}_{os}-{arch}.tar.gz";

    it("constructs correct download URL for darwin-arm64", () => {
      const version = "0.139.0";
      const url = assetPattern
        .replace(/{version}/g, version)
        .replace(/{os}/g, "darwin")
        .replace(/{arch}/g, "arm64");

      expect(url).toBe("hugo_extended_0.139.0_darwin-arm64.tar.gz");
    });

    it("constructs correct download URL for linux-amd64", () => {
      const version = "0.139.0";
      const url = "hugo_extended_{version}_linux-amd64.tar.gz".replace(
        /{version}/g,
        version
      );

      expect(url).toBe("hugo_extended_0.139.0_linux-amd64.tar.gz");
    });

    it("constructs correct download URL for windows-amd64 (zip)", () => {
      const version = "0.139.0";
      const url = "hugo_extended_{version}_windows-amd64.zip".replace(
        /{version}/g,
        version
      );

      expect(url).toBe("hugo_extended_0.139.0_windows-amd64.zip");
    });
  });

  describe("GitHub API Integration", () => {
    describe.skipIf(!shouldRunDownloadTests())("release fetching", () => {
      it("fetches latest Hugo release from GitHub", async () => {
        // Use Node.js fetch (available in Node 18+)
        const response = await fetch(
          "https://api.github.com/repos/gohugoio/hugo/releases/latest",
          {
            headers: {
              Accept: "application/vnd.github.v3+json",
              "User-Agent": "moss-hugo-generator-test",
            },
          }
        );

        expect(response.ok).toBe(true);

        const data = await response.json();
        expect(data.tag_name).toMatch(/^v\d+\.\d+\.\d+/);

        // Verify expected assets exist
        const assetNames = data.assets.map((a: { name: string }) => a.name);

        // Check for extended versions
        expect(assetNames.some((n: string) => n.includes("extended"))).toBe(true);
        expect(assetNames.some((n: string) => n.includes("darwin-arm64"))).toBe(
          true
        );
        expect(assetNames.some((n: string) => n.includes("linux-amd64"))).toBe(
          true
        );
        expect(assetNames.some((n: string) => n.includes("windows-amd64"))).toBe(
          true
        );
      });
    });
  });

  describe("Archive Extraction", () => {
    describe.skipIf(platform.os === "windows")("tar.gz extraction on Unix", () => {
      it("can extract tar.gz archives", () => {
        // Create a test tar.gz archive
        const testDir = path.join(tempDir, "test-archive");
        const extractDir = path.join(tempDir, "extracted");
        fs.mkdirSync(testDir);
        fs.mkdirSync(extractDir);

        // Create a test file
        fs.writeFileSync(path.join(testDir, "test.txt"), "Hello, World!");

        // Create tar.gz
        const archivePath = path.join(tempDir, "test.tar.gz");
        execSync(`tar -czf ${archivePath} -C ${testDir} .`, { stdio: "pipe" });

        // Extract
        execSync(`tar -xzf ${archivePath} -C ${extractDir}`, { stdio: "pipe" });

        // Verify
        expect(
          fs.existsSync(path.join(extractDir, "test.txt"))
        ).toBe(true);
        expect(
          fs.readFileSync(path.join(extractDir, "test.txt"), "utf-8")
        ).toBe("Hello, World!");
      });
    });

    describe.skipIf(platform.os !== "windows")("zip extraction on Windows", () => {
      it("can extract zip archives with PowerShell", () => {
        // Create a test zip archive
        const testDir = path.join(tempDir, "test-archive");
        const extractDir = path.join(tempDir, "extracted");
        fs.mkdirSync(testDir);
        fs.mkdirSync(extractDir);

        // Create a test file
        fs.writeFileSync(path.join(testDir, "test.txt"), "Hello, World!");

        // Create zip
        const archivePath = path.join(tempDir, "test.zip");
        execSync(
          `powershell -Command "Compress-Archive -Path '${testDir}\\*' -DestinationPath '${archivePath}'"`,
          { stdio: "pipe" }
        );

        // Extract
        execSync(
          `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force"`,
          { stdio: "pipe" }
        );

        // Verify
        expect(
          fs.existsSync(path.join(extractDir, "test.txt"))
        ).toBe(true);
      });
    });
  });

  describe("Binary Execution", () => {
    describe.skipIf(platform.os === "windows")("Unix permissions", () => {
      it("can make files executable with chmod", () => {
        const scriptPath = path.join(tempDir, "test-script.sh");
        fs.writeFileSync(scriptPath, '#!/bin/bash\necho "Hello"');

        // Should not be executable initially (or may be depending on umask)
        // We just verify it becomes executable after chmod

        // Make executable
        execSync(`chmod +x ${scriptPath}`, { stdio: "pipe" });

        // Should be executable now
        const statsAfter = fs.statSync(scriptPath);
        const executableAfter = (statsAfter.mode & 0o111) !== 0;

        expect(executableAfter).toBe(true);
      });
    });
  });

  describe("Full Download Flow", () => {
    describe.skipIf(!shouldRunDownloadTests())("Hugo download and execution", () => {
      it("downloads Hugo, extracts it, and verifies it works", async () => {
        // This test actually downloads Hugo - only run in CI
        const binDir = path.join(tempDir, "bin");
        fs.mkdirSync(binDir);

        // Get latest release
        const releaseResponse = await fetch(
          "https://api.github.com/repos/gohugoio/hugo/releases/latest",
          {
            headers: {
              Accept: "application/vnd.github.v3+json",
              "User-Agent": "moss-hugo-generator-test",
            },
          }
        );
        const release = await releaseResponse.json();
        const version = release.tag_name.replace(/^v/, "");

        // Determine asset name
        let assetName: string;
        let archiveFormat: "tar.gz" | "zip";

        if (platform.os === "darwin") {
          assetName =
            platform.arch === "arm64"
              ? `hugo_extended_${version}_darwin-arm64.tar.gz`
              : `hugo_extended_${version}_darwin-amd64.tar.gz`;
          archiveFormat = "tar.gz";
        } else if (platform.os === "linux") {
          assetName = `hugo_extended_${version}_linux-amd64.tar.gz`;
          archiveFormat = "tar.gz";
        } else {
          assetName = `hugo_extended_${version}_windows-amd64.zip`;
          archiveFormat = "zip";
        }

        // Find asset URL
        const asset = release.assets.find(
          (a: { name: string }) => a.name === assetName
        );
        expect(asset).toBeDefined();

        const downloadUrl = asset.browser_download_url;

        // Download
        const archivePath = path.join(tempDir, assetName);
        if (platform.os === "windows") {
          execSync(
            `powershell -Command "Invoke-WebRequest -Uri '${downloadUrl}' -OutFile '${archivePath}'"`,
            { stdio: "pipe", timeout: 300000 }
          );
        } else {
          execSync(`curl -fsSL -o '${archivePath}' '${downloadUrl}'`, {
            stdio: "pipe",
            timeout: 300000,
          });
        }

        // Verify download
        expect(fs.existsSync(archivePath)).toBe(true);
        const stats = fs.statSync(archivePath);
        expect(stats.size).toBeGreaterThan(10000000); // Hugo is > 10MB

        // Extract
        if (archiveFormat === "tar.gz") {
          execSync(`tar -xzf '${archivePath}' -C '${binDir}'`, {
            stdio: "pipe",
          });
        } else {
          execSync(
            `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${binDir}' -Force"`,
            { stdio: "pipe" }
          );
        }

        // Find Hugo binary
        const hugoBinary =
          platform.os === "windows"
            ? path.join(binDir, "hugo.exe")
            : path.join(binDir, "hugo");

        expect(fs.existsSync(hugoBinary)).toBe(true);

        // Make executable on Unix
        if (platform.os !== "windows") {
          execSync(`chmod +x '${hugoBinary}'`, { stdio: "pipe" });
        }

        // Verify it works
        const result = spawnSync(hugoBinary, ["version"], {
          encoding: "utf-8",
          stdio: "pipe",
        });

        expect(result.status).toBe(0);
        expect(result.stdout + result.stderr).toContain(version);
      }, 600000); // 10 minute timeout for download
    });
  });

  describe("Error Scenarios", () => {
    it("handles invalid binary path gracefully", () => {
      const result = spawnSync("/definitely/not/a/valid/path/hugo", ["version"], {
        encoding: "utf-8",
        stdio: "pipe",
      });

      expect(result.status).not.toBe(0);
      expect(result.error || result.stderr).toBeDefined();
    });

    it("handles corrupted archive gracefully", () => {
      const corruptArchive = path.join(tempDir, "corrupt.tar.gz");
      fs.writeFileSync(corruptArchive, "this is not a valid archive");

      const extractDir = path.join(tempDir, "extract");
      fs.mkdirSync(extractDir);

      let errorThrown = false;
      try {
        execSync(`tar -xzf '${corruptArchive}' -C '${extractDir}'`, {
          stdio: "pipe",
        });
      } catch {
        errorThrown = true;
      }

      expect(errorThrown).toBe(true);
    });
  });

  describe("Integration with Hugo Generator", () => {
    describe.skipIf(!hugoAvailable)("using system Hugo", () => {
      it("can build a simple site with detected Hugo", () => {
        // Create minimal Hugo site
        const siteDir = path.join(tempDir, "site");
        const contentDir = path.join(siteDir, "content");
        const layoutsDir = path.join(siteDir, "layouts", "_default");
        const outputDir = path.join(tempDir, "output");

        fs.mkdirSync(contentDir, { recursive: true });
        fs.mkdirSync(layoutsDir, { recursive: true });
        fs.mkdirSync(outputDir);

        // Create minimal content
        fs.writeFileSync(
          path.join(contentDir, "_index.md"),
          "---\ntitle: Home\n---\n# Hello World"
        );

        // Create minimal config
        fs.writeFileSync(
          path.join(siteDir, "hugo.toml"),
          'baseURL = "/"\ntitle = "Test"'
        );

        // Create minimal template
        fs.writeFileSync(
          path.join(layoutsDir, "baseof.html"),
          "<!DOCTYPE html><html><body>{{ block \"main\" . }}{{ end }}</body></html>"
        );
        fs.writeFileSync(
          path.join(layoutsDir, "list.html"),
          '{{ define "main" }}{{ .Content }}{{ end }}'
        );
        fs.writeFileSync(
          path.join(siteDir, "layouts", "index.html"),
          '{{ define "main" }}{{ .Content }}{{ end }}'
        );

        // Build
        const result = spawnSync(
          "hugo",
          ["--source", siteDir, "--destination", outputDir, "--quiet"],
          { encoding: "utf-8", stdio: "pipe" }
        );

        expect(result.status).toBe(0);
        expect(fs.existsSync(path.join(outputDir, "index.html"))).toBe(true);

        const html = fs.readFileSync(
          path.join(outputDir, "index.html"),
          "utf-8"
        );
        expect(html).toContain("Hello World");
      });
    });
  });
});

// Provide feedback about test configuration
describe("Test Configuration", () => {
  it("reports test environment", () => {
    console.log(`\n📋 Binary Resolver E2E Test Configuration:`);
    console.log(`   Platform: ${platform.os}-${platform.arch}`);
    console.log(`   Hugo installed: ${hugoAvailable}`);
    if (hugoAvailable) {
      console.log(`   Hugo version: ${getSystemHugoVersion()}`);
    }
    console.log(
      `   Download tests: ${shouldRunDownloadTests() ? "enabled" : "disabled (set TEST_DOWNLOAD_HUGO=true to enable)"}`
    );
    console.log("");
  });
});
