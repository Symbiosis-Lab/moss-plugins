import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock moss-api filesystem functions
vi.mock("@symbiosis-lab/moss-api", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  fileExists: vi.fn(),
}));

import { readFile, writeFile, fileExists } from "@symbiosis-lab/moss-api";
import {
  getConfig,
  saveConfig,
  getConfigPath,
  type MattersPluginConfig,
} from "../config";

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockFileExists = vi.mocked(fileExists);

describe("Config Module", () => {
  const projectPath = "/test/project";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getConfigPath", () => {
    it("returns the correct config path", () => {
      expect(getConfigPath()).toBe(".moss/plugins/matters-syndicator/config.json");
    });
  });

  describe("getConfig", () => {
    it("returns default config when file does not exist", async () => {
      mockFileExists.mockResolvedValue(false);

      const config = await getConfig(projectPath);

      expect(mockFileExists).toHaveBeenCalledWith(
        projectPath,
        ".moss/plugins/matters-syndicator/config.json"
      );
      expect(config).toEqual({});
    });

    it("returns parsed config when file exists", async () => {
      const savedConfig: MattersPluginConfig = {
        userName: "testuser",
        language: "zh_hant",
      };
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue(JSON.stringify(savedConfig));

      const config = await getConfig(projectPath);

      expect(mockReadFile).toHaveBeenCalledWith(
        projectPath,
        ".moss/plugins/matters-syndicator/config.json"
      );
      expect(config).toEqual(savedConfig);
    });

    it("returns empty config on parse error", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue("invalid json {{{");

      const config = await getConfig(projectPath);

      expect(config).toEqual({});
    });

    it("returns empty config on read error", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockRejectedValue(new Error("Read error"));

      const config = await getConfig(projectPath);

      expect(config).toEqual({});
    });
  });

  describe("saveConfig", () => {
    it("writes config to correct path", async () => {
      const config: MattersPluginConfig = {
        userName: "testuser",
        language: "en",
      };
      mockWriteFile.mockResolvedValue(undefined);

      await saveConfig(projectPath, config);

      expect(mockWriteFile).toHaveBeenCalledWith(
        projectPath,
        ".moss/plugins/matters-syndicator/config.json",
        JSON.stringify(config, null, 2)
      );
    });

    it("preserves existing fields when updating", async () => {
      const existingConfig: MattersPluginConfig = {
        userName: "olduser",
        language: "zh_hant",
      };
      const newConfig: MattersPluginConfig = {
        userName: "newuser",
      };

      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue(JSON.stringify(existingConfig));
      mockWriteFile.mockResolvedValue(undefined);

      // First get existing config, then merge and save
      const existing = await getConfig(projectPath);
      const merged = { ...existing, ...newConfig };
      await saveConfig(projectPath, merged);

      expect(mockWriteFile).toHaveBeenCalledWith(
        projectPath,
        ".moss/plugins/matters-syndicator/config.json",
        JSON.stringify({ userName: "newuser", language: "zh_hant" }, null, 2)
      );
    });

    it("handles write errors gracefully", async () => {
      mockWriteFile.mockRejectedValue(new Error("Write error"));

      // Should throw the error so caller can handle it
      await expect(saveConfig(projectPath, { userName: "test" }))
        .rejects.toThrow("Write error");
    });
  });

  describe("Config schema", () => {
    it("supports userName field", async () => {
      const config: MattersPluginConfig = { userName: "Matty" };
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue(JSON.stringify(config));

      const result = await getConfig(projectPath);
      expect(result.userName).toBe("Matty");
    });

    it("supports language field", async () => {
      const config: MattersPluginConfig = { language: "zh_hans" };
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue(JSON.stringify(config));

      const result = await getConfig(projectPath);
      expect(result.language).toBe("zh_hans");
    });

    it("supports both userName and language", async () => {
      const config: MattersPluginConfig = {
        userName: "刘果",
        language: "zh_hant",
      };
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue(JSON.stringify(config));

      const result = await getConfig(projectPath);
      expect(result.userName).toBe("刘果");
      expect(result.language).toBe("zh_hant");
    });

    it("handles empty config object", async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue("{}");

      const result = await getConfig(projectPath);
      expect(result).toEqual({});
      expect(result.userName).toBeUndefined();
      expect(result.language).toBeUndefined();
    });
  });
});
