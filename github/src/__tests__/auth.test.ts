/**
 * Unit tests for authentication module
 */

import { describe, it, expect } from "vitest";
import { hasRequiredScopes, CLIENT_ID, REQUIRED_SCOPES } from "../auth";

describe("auth", () => {
  describe("configuration", () => {
    it("has a valid client ID", () => {
      expect(CLIENT_ID).toBeDefined();
      expect(CLIENT_ID.length).toBeGreaterThan(10);
      // GitHub OAuth client IDs start with "Ov23"
      expect(CLIENT_ID).toMatch(/^Ov/);
    });

    it("requires repo scope for gh-pages deployment", () => {
      // gh-pages deployment pushes directly - no GitHub Actions needed
      expect(REQUIRED_SCOPES).toContain("repo");
      expect(REQUIRED_SCOPES).not.toContain("workflow");
    });
  });

  describe("hasRequiredScopes", () => {
    it("returns true when all required scopes are present", () => {
      const scopes = ["repo", "user"];
      expect(hasRequiredScopes(scopes)).toBe(true);
    });

    it("returns true with exact required scopes", () => {
      const scopes = ["repo"];
      expect(hasRequiredScopes(scopes)).toBe(true);
    });

    it("returns false when repo scope is missing", () => {
      const scopes = ["user", "gist"];
      expect(hasRequiredScopes(scopes)).toBe(false);
    });

    it("returns true with additional scopes beyond repo", () => {
      const scopes = ["repo", "workflow", "user"];
      expect(hasRequiredScopes(scopes)).toBe(true);
    });

    it("returns false with empty scopes", () => {
      expect(hasRequiredScopes([])).toBe(false);
    });

    it("returns false with unrelated scopes only", () => {
      const scopes = ["user", "read:org", "gist"];
      expect(hasRequiredScopes(scopes)).toBe(false);
    });
  });
});
