/**
 * Unit tests for process hook functionality
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProcessContext, HookResult } from "../types";

// Mock the moss-api
vi.mock("@symbiosis-lab/moss-api", () => ({
  log: vi.fn(),
}));

describe("process hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createProcessContext = (
    overrides: Partial<ProcessContext> = {}
  ): ProcessContext => ({
    project_path: "/test/project",
    moss_dir: "/test/.moss",
    project_info: {
      content_folders: ["posts"],
      total_files: 1,
    },
    config: {
      relays: ["wss://relay.example.com"],
    },
    ...overrides,
  });

  describe("basic functionality", () => {
    it("should return success with interactions array", async () => {
      const ctx = createProcessContext();

      const { process } = await import("../main");
      const result = await process(ctx);

      expect(result.success).toBe(true);
      expect(result.interactions).toBeDefined();
      expect(Array.isArray(result.interactions)).toBe(true);
    });

    it("should include message in result", async () => {
      const ctx = createProcessContext();

      const { process } = await import("../main");
      const result = await process(ctx);

      expect(result.message).toBeDefined();
    });
  });

  describe("interaction format", () => {
    it("should return interactions with required fields", async () => {
      const ctx = createProcessContext();

      const { process } = await import("../main");
      const result = await process(ctx);

      // When there are interactions, they should have required fields
      if (result.interactions && result.interactions.length > 0) {
        result.interactions.forEach((interaction) => {
          expect(interaction.id).toBeDefined();
          expect(interaction.source).toBe("nostr");
          expect(interaction.interaction_type).toBeDefined();
          expect(interaction.author).toBeDefined();
          expect(interaction.target_url).toBeDefined();
        });
      }
    });

    it("should set source to 'nostr' for all interactions", async () => {
      const ctx = createProcessContext();

      const { process } = await import("../main");
      const result = await process(ctx);

      result.interactions?.forEach((interaction) => {
        expect(interaction.source).toBe("nostr");
      });
    });
  });

  describe("relay configuration", () => {
    it("should handle missing relays config gracefully", async () => {
      const ctx = createProcessContext({
        config: {},
      });

      const { process } = await import("../main");
      const result = await process(ctx);

      expect(result.success).toBe(true);
      expect(result.interactions).toEqual([]);
    });

    it("should handle empty relays array", async () => {
      const ctx = createProcessContext({
        config: { relays: [] },
      });

      const { process } = await import("../main");
      const result = await process(ctx);

      expect(result.success).toBe(true);
      expect(result.interactions).toEqual([]);
    });
  });
});
