/**
 * Unit tests for Jekyll Generator Plugin
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
    // Mock resolveBinary to return the configured path or "jekyll"
    resolveBinary: vi.fn().mockImplementation(async (_config, options) => {
      const path = options?.configuredPath ?? "jekyll";
      return {
        path,
        version: "4.3.0",
        source: "path" as const,
      };
    }),
    // Include BinaryResolutionError class for error handling
    BinaryResolutionError: class BinaryResolutionError extends Error {
      phase: string;
      constructor(message: string, phase: string) {
        super(message);
        this.name = "BinaryResolutionError";
        this.phase = phase;
      }
    },
  };
});

describe("Jekyll Generator Plugin", () => {
  let ctx: MockTauriContext;
  let tempDir: string;
  let projectPath: string;
  let mossDir: string;
  let outputDir: string;

  beforeEach(() => {
    ctx = setupMockTauri();
    vi.clearAllMocks();

    // Create temp directory structure for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jekyll-main-test-"));
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
      jekyll_path: "jekyll",
      build_args: [],
    },
    ...overrides,
  });

  describe("on_build", () => {
    it("calls Jekyll with correct arguments", async () => {
      ctx.binaryConfig.setResult("jekyll", {
        success: true,
        exitCode: 0,
        stdout: "Configuration file: _config.yml\nBuilding site...\ndone in 0.5 seconds.",
        stderr: "",
      });

      const { on_build } = await import("../main");
      const result = await on_build(createContext());

      expect(result.success).toBe(true);
      expect(result.message).toBe("Jekyll build complete");
    });

    it("uses custom jekyll_path from config", async () => {
      ctx.binaryConfig.setResult("/custom/jekyll", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const { on_build } = await import("../main");
      const result = await on_build(
        createContext({
          config: { jekyll_path: "/custom/jekyll" },
        })
      );

      expect(result.success).toBe(true);
    });

    it("uses custom build_args from config", async () => {
      ctx.binaryConfig.setResult("jekyll", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const { on_build } = await import("../main");
      const result = await on_build(
        createContext({
          config: { build_args: ["--verbose", "--safe"] },
        })
      );

      expect(result.success).toBe(true);
    });

    it("returns failure when Jekyll fails with error output", async () => {
      ctx.binaryConfig.setResult("jekyll", {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "Liquid Exception: undefined method",
      });

      const { on_build } = await import("../main");
      const result = await on_build(createContext());

      expect(result.success).toBe(false);
      expect(result.message).toContain("Jekyll build failed");
      expect(result.message).toContain("Liquid Exception");
    });

    it("returns failure when Jekyll exits with non-zero code but no stderr", async () => {
      ctx.binaryConfig.setResult("jekyll", {
        success: false,
        exitCode: 127,
        stdout: "",
        stderr: "",
      });

      const { on_build } = await import("../main");
      const result = await on_build(createContext());

      expect(result.success).toBe(false);
      expect(result.message).toContain("Jekyll build failed");
      expect(result.message).toContain("exited with code 127");
    });

    it("defaults to 'jekyll' when jekyll_path not specified", async () => {
      ctx.binaryConfig.setResult("jekyll", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const { on_build } = await import("../main");
      const result = await on_build(
        createContext({
          config: {}, // No jekyll_path specified
        })
      );

      expect(result.success).toBe(true);
    });

    it("defaults to empty array when build_args not specified", async () => {
      ctx.binaryConfig.setResult("jekyll", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const { on_build } = await import("../main");
      const result = await on_build(
        createContext({
          config: { jekyll_path: "jekyll" }, // No build_args specified
        })
      );

      expect(result.success).toBe(true);
    });

    it("reports progress during build", async () => {
      const { reportProgress } = await import("@symbiosis-lab/moss-api");
      ctx.binaryConfig.setResult("jekyll", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const { on_build } = await import("../main");
      await on_build(createContext());

      // Check setup phase (resolving Jekyll binary)
      expect(reportProgress).toHaveBeenCalledWith(
        "setup",
        0,
        4,
        "Resolving Jekyll binary..."
      );
      // Check scaffolding phase
      expect(reportProgress).toHaveBeenCalledWith(
        "scaffolding",
        1,
        4,
        "Creating Jekyll structure..."
      );
      // Check building phase
      expect(reportProgress).toHaveBeenCalledWith(
        "building",
        2,
        4,
        "Running Jekyll..."
      );
      // Check completion phase
      expect(reportProgress).toHaveBeenCalledWith(
        "complete",
        4,
        4,
        "Jekyll build complete"
      );
    });

    it("does not report completion progress on failure", async () => {
      const { reportProgress } = await import("@symbiosis-lab/moss-api");
      ctx.binaryConfig.setResult("jekyll", {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "Error",
      });

      const { on_build } = await import("../main");
      await on_build(createContext());

      expect(reportProgress).toHaveBeenCalledWith(
        "setup",
        0,
        4,
        "Resolving Jekyll binary..."
      );
      expect(reportProgress).toHaveBeenCalledWith(
        "scaffolding",
        1,
        4,
        "Creating Jekyll structure..."
      );
      expect(reportProgress).toHaveBeenCalledWith(
        "building",
        2,
        4,
        "Running Jekyll..."
      );
      expect(reportProgress).not.toHaveBeenCalledWith(
        "complete",
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });

    it("cleans up runtime directory after build", async () => {
      ctx.binaryConfig.setResult("jekyll", {
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
        "plugins/jekyll-generator/.runtime"
      );
      expect(fs.existsSync(runtimeDir)).toBe(false);
    });

    it("cleans up runtime directory even on failure", async () => {
      ctx.binaryConfig.setResult("jekyll", {
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
        "plugins/jekyll-generator/.runtime"
      );
      expect(fs.existsSync(runtimeDir)).toBe(false);
    });
  });

  describe("plugin registration", () => {
    it("exports on_build function", async () => {
      const module = await import("../main");
      expect(typeof module.on_build).toBe("function");
    });

    it("exports default JekyllGenerator object", async () => {
      const module = await import("../main");
      expect(module.default).toBeDefined();
      expect(typeof module.default.on_build).toBe("function");
    });
  });
});
