/**
 * Tests for the provider registry
 *
 * Validates that the registry correctly resolves provider names
 * to their submit script builder functions.
 */

import { describe, it, expect } from "vitest";
import { getSubmitScriptBuilder } from "../../providers/index";

describe("getSubmitScriptBuilder", () => {
  it('returns a function for "artalk"', () => {
    const builder = getSubmitScriptBuilder("artalk");
    expect(builder).not.toBeNull();
    expect(typeof builder).toBe("function");
  });

  it('returns a function for "waline"', () => {
    const builder = getSubmitScriptBuilder("waline");
    expect(builder).not.toBeNull();
    expect(typeof builder).toBe("function");
  });

  it('returns null for "unknown"', () => {
    const builder = getSubmitScriptBuilder("unknown");
    expect(builder).toBeNull();
  });
});
