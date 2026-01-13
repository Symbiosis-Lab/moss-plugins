/**
 * Unit tests for utils.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as mossApi from "@symbiosis-lab/moss-api";

// Mock the moss-api module
vi.mock("@symbiosis-lab/moss-api", () => ({
  setMessageContext: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  reportProgress: vi.fn().mockResolvedValue(undefined),
  reportError: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocking
import {
  setCurrentHookName,
  sendMessage,
  log,
  reportProgress,
  reportError,
  sleep,
} from "../utils";

describe("utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("setCurrentHookName", () => {
    it("calls setMessageContext with plugin name and hook name", () => {
      setCurrentHookName("testHook");

      expect(mossApi.setMessageContext).toHaveBeenCalledWith("github", "testHook");
    });
  });

  describe("sendMessage", () => {
    it("forwards message to SDK sendMessage", async () => {
      const message = { type: "log" as const, level: "log" as const, message: "test" };

      await sendMessage(message);

      expect(mossApi.sendMessage).toHaveBeenCalledWith(message);
    });
  });

  describe("log", () => {
    it("logs to console and sends message for log level", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await log("log", "test message");

      expect(consoleSpy).toHaveBeenCalledWith("test message");
      expect(mossApi.sendMessage).toHaveBeenCalledWith({
        type: "log",
        level: "log",
        message: "test message",
      });

      consoleSpy.mockRestore();
    });

    it("logs to console and sends message for error level", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await log("error", "error message");

      expect(consoleSpy).toHaveBeenCalledWith("error message");
      expect(mossApi.sendMessage).toHaveBeenCalledWith({
        type: "log",
        level: "error",
        message: "error message",
      });

      consoleSpy.mockRestore();
    });

    it("logs to console and sends message for warn level", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await log("warn", "warning message");

      expect(consoleSpy).toHaveBeenCalledWith("warning message");
      expect(mossApi.sendMessage).toHaveBeenCalledWith({
        type: "log",
        level: "warn",
        message: "warning message",
      });

      consoleSpy.mockRestore();
    });

    it("maps info level to log for SDK compatibility", async () => {
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

      await log("info", "info message");

      expect(consoleSpy).toHaveBeenCalledWith("info message");
      expect(mossApi.sendMessage).toHaveBeenCalledWith({
        type: "log",
        level: "log", // info mapped to log for SDK
        message: "info message",
      });

      consoleSpy.mockRestore();
    });
  });

  describe("reportProgress", () => {
    it("forwards to SDK reportProgress", async () => {
      await reportProgress("building", 5, 10, "Processing files...");

      expect(mossApi.reportProgress).toHaveBeenCalledWith(
        "building",
        5,
        10,
        "Processing files..."
      );
    });

    it("works without optional message", async () => {
      await reportProgress("uploading", 3, 5);

      expect(mossApi.reportProgress).toHaveBeenCalledWith(
        "uploading",
        3,
        5,
        undefined
      );
    });
  });

  describe("reportError", () => {
    it("forwards to SDK reportError", async () => {
      await reportError("Something went wrong", "deployment");

      expect(mossApi.reportError).toHaveBeenCalledWith(
        "Something went wrong",
        "deployment",
        false
      );
    });

    it("handles fatal errors", async () => {
      await reportError("Critical failure", "authentication", true);

      expect(mossApi.reportError).toHaveBeenCalledWith(
        "Critical failure",
        "authentication",
        true
      );
    });

    it("works without optional context", async () => {
      await reportError("Error occurred");

      expect(mossApi.reportError).toHaveBeenCalledWith(
        "Error occurred",
        undefined,
        false
      );
    });
  });

  describe("sleep", () => {
    it("resolves after specified time", async () => {
      vi.useFakeTimers();

      const promise = sleep(100);

      // Fast-forward time
      vi.advanceTimersByTime(100);

      await expect(promise).resolves.toBeUndefined();

      vi.useRealTimers();
    });

    it("delays execution for the correct duration", async () => {
      vi.useFakeTimers();

      let resolved = false;
      sleep(50).then(() => { resolved = true; });

      // Not resolved yet
      expect(resolved).toBe(false);

      // Advance 49ms - still not resolved
      vi.advanceTimersByTime(49);
      await Promise.resolve(); // flush microtasks
      expect(resolved).toBe(false);

      // Advance 1 more ms - now resolved
      vi.advanceTimersByTime(1);
      await Promise.resolve(); // flush microtasks
      expect(resolved).toBe(true);

      vi.useRealTimers();
    });
  });
});
