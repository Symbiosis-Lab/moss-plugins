/**
 * Tests for Artalk hydration comment ordering
 *
 * The Artalk API returns comments in date_desc order (newest first).
 * When hydrating, we need parents inserted before their children so that
 * reply nesting works correctly. This test validates the sortForInsertion
 * helper that reorders comments for correct DOM insertion.
 */

import { describe, it, expect } from "vitest";
import { sortForInsertion } from "../../providers/artalk";

describe("sortForInsertion", () => {
  it("returns empty array for empty input", () => {
    expect(sortForInsertion([])).toEqual([]);
  });

  it("returns top-level comments in oldest-first order", () => {
    const comments = [
      { id: 3, rid: 0, date: "2025-03-03" },
      { id: 2, rid: 0, date: "2025-03-02" },
      { id: 1, rid: 0, date: "2025-03-01" },
    ];
    const result = sortForInsertion(comments);
    expect(result.map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it("places reply after its parent even when reply is newer", () => {
    // API returns: reply(id=5, rid=3), then parent(id=3, rid=0)
    const comments = [
      { id: 5, rid: 3, date: "2025-03-05" },
      { id: 3, rid: 0, date: "2025-03-03" },
    ];
    const result = sortForInsertion(comments);
    const ids = result.map((c) => c.id);
    expect(ids.indexOf(3)).toBeLessThan(ids.indexOf(5));
  });

  it("handles multiple replies to the same parent", () => {
    // API returns newest-first: reply6, reply5, parent3
    const comments = [
      { id: 6, rid: 3, date: "2025-03-06" },
      { id: 5, rid: 3, date: "2025-03-05" },
      { id: 3, rid: 0, date: "2025-03-03" },
    ];
    const result = sortForInsertion(comments);
    const ids = result.map((c) => c.id);
    expect(ids.indexOf(3)).toBeLessThan(ids.indexOf(5));
    expect(ids.indexOf(3)).toBeLessThan(ids.indexOf(6));
  });

  it("handles replies to already-existing comments (rid not in list)", () => {
    // Comment 4 replies to comment 2 which is already in static HTML (not in this list)
    const comments = [
      { id: 4, rid: 2, date: "2025-03-04" },
      { id: 3, rid: 0, date: "2025-03-03" },
    ];
    const result = sortForInsertion(comments);
    // Both should be present; order doesn't matter much since parent 2 is in DOM already
    expect(result).toHaveLength(2);
  });

  it("handles the exact 蓝海螺 bug scenario", () => {
    // Real data: API returns date_desc
    // comment 6 (rid=3), comment 5 (rid=3), comment 4 (rid=2), comment 3 (rid=0)
    // Comments 1 and 2 are in static HTML (not in this list)
    const comments = [
      { id: 6, rid: 3, date: "2025-03-06" },
      { id: 5, rid: 3, date: "2025-03-05" },
      { id: 4, rid: 2, date: "2025-03-04" },
      { id: 3, rid: 0, date: "2025-03-03" },
    ];
    const result = sortForInsertion(comments);
    const ids = result.map((c) => c.id);

    // Parent 3 must come before its children 5 and 6
    expect(ids.indexOf(3)).toBeLessThan(ids.indexOf(5));
    expect(ids.indexOf(3)).toBeLessThan(ids.indexOf(6));
  });

  it("preserves all comments without dropping any", () => {
    const comments = [
      { id: 6, rid: 3, date: "2025-03-06" },
      { id: 5, rid: 3, date: "2025-03-05" },
      { id: 4, rid: 2, date: "2025-03-04" },
      { id: 3, rid: 0, date: "2025-03-03" },
    ];
    const result = sortForInsertion(comments);
    expect(result).toHaveLength(4);
    expect(new Set(result.map((c) => c.id))).toEqual(new Set([3, 4, 5, 6]));
  });
});
