/**
 * Unit tests for Hugo Generator Plugin
 *
 * Uses mock-tauri to test plugin logic without requiring Tauri runtime.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setupMockTauri,
  type MockTauriContext,
} from "@symbiosis-lab/moss-api/testing";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock the moss-api module before importing the plugin
vi.mock("@symbiosis-lab/moss-api", async () => {
  const actual = await vi.importActual("@symbiosis-lab/moss-api");
  return {
    ...actual,
    reportProgress: vi.fn(),
  };
});

describe("Hugo Generator Plugin", () => {
  let ctx: MockTauriContext;
  let tempDir: string;
  let projectPath: string;
  let mossDir: string;
  let outputDir: string;

  beforeEach(() => {
    ctx = setupMockTauri();
    vi.clearAllMocks();

    // Create temp directory structure for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hugo-main-test-"));
    projectPath = path.join(tempDir, "project");
    mossDir = path.join(projectPath, ".moss");
    outputDir = path.join(mossDir, "site-stage");
    fs.mkdirSync(projectPath, { recursive: true });
    fs.mkdirSync(mossDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    // Create a sample index.md
    fs.writeFileSync(path.join(projectPath, "index.md"), "# Home");
  });

  afterEach(() => {
    ctx.cleanup();
    vi.resetModules();
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const createContext = (overrides: Record<string, unknown> = {}) => ({
    project_path: projectPath,
    moss_dir: mossDir,
    output_dir: outputDir,
    project_info: {
      content_folders: [],
      total_files: 1,
      homepage_file: "index.md",
    },
    source_files: {
      markdown: ["index.md"],
      pages: [],
      docx: [],
      other: [],
    },
    site_config: {},
    config: {
      hugo_path: "hugo",
      build_args: ["--minify"],
    },
    ...overrides,
  });

  describe("on_build", () => {
    it("calls Hugo with correct arguments", async () => {
      ctx.binaryConfig.setResult("hugo", {
        success: true,
        exitCode: 0,
        stdout: "Building sites...\nTotal in 50 ms",
        stderr: "",
      });

      const { on_build } = await import("../main");
      const result = await on_build(createContext());

      expect(result.success).toBe(true);
      expect(result.message).toBe("Hugo build complete");
    });

    it("uses custom hugo_path from config", async () => {
      ctx.binaryConfig.setResult("/custom/hugo", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const { on_build } = await import("../main");
      const result = await on_build(
        createContext({
          config: { hugo_path: "/custom/hugo" },
        })
      );

      expect(result.success).toBe(true);
    });

    it("uses custom build_args from config", async () => {
      ctx.binaryConfig.setResult("hugo", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const { on_build } = await import("../main");
      const result = await on_build(
        createContext({
          config: { build_args: ["--gc", "--minify", "--cleanDestinationDir"] },
        })
      );

      expect(result.success).toBe(true);
    });

    it("returns failure when Hugo fails with error output", async () => {
      ctx.binaryConfig.setResult("hugo", {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "Error: config.toml not found",
      });

      const { on_build } = await import("../main");
      const result = await on_build(createContext());

      expect(result.success).toBe(false);
      expect(result.message).toContain("Hugo build failed");
      expect(result.message).toContain("config.toml not found");
    });

    it("returns failure when Hugo exits with non-zero code but no stderr", async () => {
      ctx.binaryConfig.setResult("hugo", {
        success: false,
        exitCode: 127,
        stdout: "",
        stderr: "",
      });

      const { on_build } = await import("../main");
      const result = await on_build(createContext());

      expect(result.success).toBe(false);
      expect(result.message).toContain("Hugo build failed");
      expect(result.message).toContain("exited with code 127");
    });

    it("defaults to 'hugo' when hugo_path not specified", async () => {
      ctx.binaryConfig.setResult("hugo", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const { on_build } = await import("../main");
      const result = await on_build(
        createContext({
          config: {}, // No hugo_path specified
        })
      );

      expect(result.success).toBe(true);
    });

    it("defaults to --minify when build_args not specified", async () => {
      ctx.binaryConfig.setResult("hugo", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const { on_build } = await import("../main");
      const result = await on_build(
        createContext({
          config: { hugo_path: "hugo" }, // No build_args specified
        })
      );

      expect(result.success).toBe(true);
    });

    it("reports progress during build", async () => {
      const { reportProgress } = await import("@symbiosis-lab/moss-api");
      ctx.binaryConfig.setResult("hugo", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const { on_build } = await import("../main");
      await on_build(createContext());

      // Check scaffolding phase
      expect(reportProgress).toHaveBeenCalledWith(
        "scaffolding",
        0,
        3,
        "Creating Hugo structure..."
      );
      // Check building phase
      expect(reportProgress).toHaveBeenCalledWith(
        "building",
        1,
        3,
        "Running Hugo..."
      );
      // Check completion phase
      expect(reportProgress).toHaveBeenCalledWith(
        "complete",
        3,
        3,
        "Hugo build complete"
      );
    });

    it("does not report completion progress on failure", async () => {
      const { reportProgress } = await import("@symbiosis-lab/moss-api");
      ctx.binaryConfig.setResult("hugo", {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "Error",
      });

      const { on_build } = await import("../main");
      await on_build(createContext());

      expect(reportProgress).toHaveBeenCalledWith(
        "scaffolding",
        0,
        3,
        "Creating Hugo structure..."
      );
      expect(reportProgress).toHaveBeenCalledWith(
        "building",
        1,
        3,
        "Running Hugo..."
      );
      expect(reportProgress).not.toHaveBeenCalledWith(
        "complete",
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });

    it("cleans up runtime directory after build", async () => {
      ctx.binaryConfig.setResult("hugo", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const { on_build } = await import("../main");
      await on_build(createContext());

      // Runtime directory should be cleaned up
      const runtimeDir = path.join(
        mossDir,
        "plugins/hugo-generator/.runtime"
      );
      expect(fs.existsSync(runtimeDir)).toBe(false);
    });

    it("cleans up runtime directory even on failure", async () => {
      ctx.binaryConfig.setResult("hugo", {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "Error",
      });

      const { on_build } = await import("../main");
      await on_build(createContext());

      // Runtime directory should still be cleaned up
      const runtimeDir = path.join(
        mossDir,
        "plugins/hugo-generator/.runtime"
      );
      expect(fs.existsSync(runtimeDir)).toBe(false);
    });
  });

  describe("plugin registration", () => {
    it("exports on_build function", async () => {
      const module = await import("../main");
      expect(typeof module.on_build).toBe("function");
    });

    it("exports default HugoGenerator object", async () => {
      const module = await import("../main");
      expect(module.default).toBeDefined();
      expect(typeof module.default.on_build).toBe("function");
    });
  });
});
