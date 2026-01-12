/**
 * Unit tests for Gatsby Generator Plugin
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setupMockTauri,
  type MockTauriContext,
} from "@symbiosis-lab/moss-api/testing";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

vi.mock("@symbiosis-lab/moss-api", async () => {
  const actual = await vi.importActual("@symbiosis-lab/moss-api");
  return {
    ...actual,
    reportProgress: vi.fn(),
    resolveBinary: vi.fn().mockImplementation(async (_config, _options) => ({
      path: "npx",
      version: "10.0.0",
      source: "path" as const,
    })),
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

describe("Gatsby Generator Plugin", () => {
  let ctx: MockTauriContext;
  let tempDir: string;
  let projectPath: string;
  let mossDir: string;
  let outputDir: string;

  beforeEach(() => {
    ctx = setupMockTauri();
    vi.clearAllMocks();

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gatsby-main-test-"));
    projectPath = path.join(tempDir, "project");
    mossDir = path.join(projectPath, ".moss");
    outputDir = path.join(mossDir, "site-stage");
    fs.mkdirSync(projectPath, { recursive: true });
    fs.mkdirSync(mossDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(path.join(projectPath, "index.md"), "# Home");
  });

  afterEach(() => {
    ctx.cleanup();
    vi.resetModules();
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
      build_args: [],
    },
    ...overrides,
  });

  describe("on_build", () => {
    it("calls Gatsby with correct arguments", async () => {
      // Mock npm install
      ctx.binaryConfig.setResult("npm", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
      // Mock npx gatsby build
      ctx.binaryConfig.setResult("npx", {
        success: true,
        exitCode: 0,
        stdout: "Building...\nDone!",
        stderr: "",
      });

      const { on_build } = await import("../main");
      const result = await on_build(createContext());

      expect(result.success).toBe(true);
      expect(result.message).toBe("Gatsby build complete");
    });

    it("uses custom build_args from config", async () => {
      ctx.binaryConfig.setResult("npm", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
      ctx.binaryConfig.setResult("npx", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const { on_build } = await import("../main");
      const result = await on_build(
        createContext({
          config: { build_args: ["--verbose"] },
        })
      );

      expect(result.success).toBe(true);
    });

    it("returns failure when Gatsby fails with error output", async () => {
      ctx.binaryConfig.setResult("npm", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
      ctx.binaryConfig.setResult("npx", {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "Error: Cannot find module 'gatsby'",
      });

      const { on_build } = await import("../main");
      const result = await on_build(createContext());

      expect(result.success).toBe(false);
      expect(result.message).toContain("Gatsby build failed");
    });

    it("returns failure when npm install fails", async () => {
      ctx.binaryConfig.setResult("npm", {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "npm ERR! code ENOENT",
      });

      const { on_build } = await import("../main");
      const result = await on_build(createContext());

      expect(result.success).toBe(false);
      expect(result.message).toContain("Failed to install Gatsby dependencies");
    });

    it("reports progress during build", async () => {
      const { reportProgress } = await import("@symbiosis-lab/moss-api");
      ctx.binaryConfig.setResult("npm", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
      ctx.binaryConfig.setResult("npx", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const { on_build } = await import("../main");
      await on_build(createContext());

      expect(reportProgress).toHaveBeenCalledWith(
        "setup",
        0,
        4,
        "Resolving npx binary..."
      );
      expect(reportProgress).toHaveBeenCalledWith(
        "scaffolding",
        1,
        4,
        "Creating Gatsby structure..."
      );
      expect(reportProgress).toHaveBeenCalledWith(
        "building",
        2,
        4,
        "Installing Gatsby dependencies..."
      );
      expect(reportProgress).toHaveBeenCalledWith(
        "complete",
        4,
        4,
        "Gatsby build complete"
      );
    });

    it("cleans up runtime directory after build", async () => {
      ctx.binaryConfig.setResult("npm", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
      ctx.binaryConfig.setResult("npx", {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      const { on_build } = await import("../main");
      await on_build(createContext());

      const runtimeDir = path.join(
        mossDir,
        "plugins/gatsby-generator/.runtime"
      );
      expect(fs.existsSync(runtimeDir)).toBe(false);
    });
  });

  describe("plugin registration", () => {
    it("exports on_build function", async () => {
      const module = await import("../main");
      expect(typeof module.on_build).toBe("function");
    });

    it("exports default GatsbyGenerator object", async () => {
      const module = await import("../main");
      expect(module.default).toBeDefined();
      expect(typeof module.default.on_build).toBe("function");
    });
  });
});
