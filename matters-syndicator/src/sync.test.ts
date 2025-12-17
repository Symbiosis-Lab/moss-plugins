import { describe, it, expect } from "vitest";
import { isRemoteNewer } from "./sync";

describe("isRemoteNewer", () => {
  it("returns true when local is undefined", () => {
    expect(isRemoteNewer(undefined, "2024-01-01")).toBe(true);
  });

  it("returns false when remote is undefined", () => {
    expect(isRemoteNewer("2024-01-01", undefined)).toBe(false);
  });

  it("returns true when remote is newer", () => {
    expect(isRemoteNewer("2024-01-01", "2024-01-02")).toBe(true);
  });

  it("returns false when local is newer", () => {
    expect(isRemoteNewer("2024-01-02", "2024-01-01")).toBe(false);
  });

  it("returns false when dates are equal", () => {
    expect(isRemoteNewer("2024-01-01", "2024-01-01")).toBe(false);
  });

  it("handles ISO date strings with time", () => {
    expect(isRemoteNewer("2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z")).toBe(true);
    expect(isRemoteNewer("2024-01-01T12:00:00Z", "2024-01-01T10:00:00Z")).toBe(false);
  });

  it("returns true when both are undefined (local missing means should update)", () => {
    // When local is undefined, we should update regardless of remote
    expect(isRemoteNewer(undefined, undefined)).toBe(true);
  });
});

describe("syncToLocalFiles", () => {
  it("exports syncToLocalFiles function", async () => {
    const module = await import("./sync");
    expect(typeof module.syncToLocalFiles).toBe("function");
  });
});

// Note: Full integration tests for syncToLocalFiles would require mocking:
// 1. window.__TAURI__ for file operations
// 2. downloadAsset and downloadAndRewriteMedia functions
// 3. The various converter functions
//
// These are better suited for integration tests with a proper test harness.
