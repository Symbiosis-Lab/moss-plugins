/**
 * Tests for social-writer
 *
 * Validates loading, saving, and merging of comment social data
 * in .moss/social/comment.json.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());

vi.mock("@symbiosis-lab/moss-api", () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
}));

import {
  loadCommentSocialData,
  saveCommentSocialData,
  mergeCommentSocialData,
} from "../social-writer";
import type { GenericSocialComment, GenericSocialFile } from "../types";

describe("loadCommentSocialData", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
  });

  it("loads existing social data file", async () => {
    const existing: GenericSocialFile = {
      schemaVersion: "1.0.0",
      updatedAt: "2025-06-15T10:00:00.000Z",
      articles: {
        "abc123": {
          comments: [
            {
              id: "c1",
              content: "Hello",
              createdAt: "2025-06-15T09:00:00.000Z",
              author: { displayName: "Alice" },
            },
          ],
        },
      },
    };

    mockReadFile.mockResolvedValue(JSON.stringify(existing));

    const data = await loadCommentSocialData();

    expect(mockReadFile).toHaveBeenCalledWith(".moss/social/comment.json");
    expect(data.articles["abc123"].comments).toHaveLength(1);
    expect(data.articles["abc123"].comments![0].id).toBe("c1");
  });

  it("returns empty structure when file does not exist", async () => {
    mockReadFile.mockRejectedValue(new Error("File not found"));

    const data = await loadCommentSocialData();

    expect(data.schemaVersion).toBe("1.0.0");
    expect(data.articles).toEqual({});
  });

  it("returns empty structure when file has invalid JSON", async () => {
    mockReadFile.mockResolvedValue("not valid json");

    const data = await loadCommentSocialData();

    expect(data.schemaVersion).toBe("1.0.0");
    expect(data.articles).toEqual({});
  });

  it("returns empty structure when file has missing articles field", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ schemaVersion: "1.0.0" }));

    const data = await loadCommentSocialData();

    expect(data.articles).toEqual({});
  });
});

describe("saveCommentSocialData", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
  });

  it("writes data to .moss/social/comment.json", async () => {
    mockWriteFile.mockResolvedValue(undefined);

    const data: GenericSocialFile = {
      schemaVersion: "1.0.0",
      updatedAt: "2025-06-15T10:00:00.000Z",
      articles: {
        "abc123": {
          comments: [
            {
              id: "c1",
              content: "Hello",
              createdAt: "2025-06-15T09:00:00.000Z",
              author: { displayName: "Alice" },
            },
          ],
        },
      },
    };

    await saveCommentSocialData(data);

    expect(mockWriteFile).toHaveBeenCalledWith(
      ".moss/social/comment.json",
      expect.any(String)
    );

    // Verify the written content is valid JSON with updated timestamp
    const writtenContent = mockWriteFile.mock.calls[0][1];
    const parsed = JSON.parse(writtenContent);
    expect(parsed.schemaVersion).toBe("1.0.0");
    expect(parsed.articles["abc123"].comments).toHaveLength(1);
    // updatedAt should have been refreshed
    expect(parsed.updatedAt).toBeDefined();
  });

  it("propagates write errors", async () => {
    mockWriteFile.mockRejectedValue(new Error("Disk full"));

    const data: GenericSocialFile = {
      schemaVersion: "1.0.0",
      articles: {},
    };

    await expect(saveCommentSocialData(data)).rejects.toThrow("Disk full");
  });
});

describe("mergeCommentSocialData", () => {
  it("adds comments for a new uid", () => {
    const data: GenericSocialFile = {
      schemaVersion: "1.0.0",
      articles: {},
    };

    const newComments: GenericSocialComment[] = [
      {
        id: "c1",
        content: "First comment",
        createdAt: "2025-06-15T09:00:00.000Z",
        author: { displayName: "Alice" },
      },
      {
        id: "c2",
        content: "Second comment",
        createdAt: "2025-06-15T10:00:00.000Z",
        author: { displayName: "Bob" },
      },
    ];

    mergeCommentSocialData(data, "uid-abc", newComments);

    expect(data.articles["uid-abc"].comments).toHaveLength(2);
    expect(data.articles["uid-abc"].comments![0].id).toBe("c1");
    expect(data.articles["uid-abc"].comments![1].id).toBe("c2");
  });

  it("upserts existing comments by ID", () => {
    const data: GenericSocialFile = {
      schemaVersion: "1.0.0",
      articles: {
        "uid-abc": {
          comments: [
            {
              id: "c1",
              content: "Original content",
              createdAt: "2025-06-15T09:00:00.000Z",
              author: { displayName: "Alice" },
            },
            {
              id: "c2",
              content: "Existing comment",
              createdAt: "2025-06-15T09:30:00.000Z",
              author: { displayName: "Bob" },
            },
          ],
        },
      },
    };

    const incoming: GenericSocialComment[] = [
      {
        id: "c1",
        content: "Updated content",
        createdAt: "2025-06-15T09:00:00.000Z",
        author: { displayName: "Alice (updated)" },
      },
      {
        id: "c3",
        content: "New comment",
        createdAt: "2025-06-15T11:00:00.000Z",
        author: { displayName: "Charlie" },
      },
    ];

    mergeCommentSocialData(data, "uid-abc", incoming);

    const comments = data.articles["uid-abc"].comments!;
    expect(comments).toHaveLength(3);

    // c1 should be updated
    const c1 = comments.find((c) => c.id === "c1")!;
    expect(c1.content).toBe("Updated content");
    expect(c1.author.displayName).toBe("Alice (updated)");

    // c2 should be preserved
    const c2 = comments.find((c) => c.id === "c2")!;
    expect(c2.content).toBe("Existing comment");

    // c3 should be added
    const c3 = comments.find((c) => c.id === "c3")!;
    expect(c3.content).toBe("New comment");
  });

  it("preserves existing data for other uids", () => {
    const data: GenericSocialFile = {
      schemaVersion: "1.0.0",
      articles: {
        "uid-existing": {
          comments: [
            {
              id: "c0",
              content: "Keep me",
              createdAt: "2025-06-01T00:00:00.000Z",
              author: { displayName: "Existing" },
            },
          ],
        },
      },
    };

    const newComments: GenericSocialComment[] = [
      {
        id: "c1",
        content: "New article comment",
        createdAt: "2025-06-15T09:00:00.000Z",
        author: { displayName: "Alice" },
      },
    ];

    mergeCommentSocialData(data, "uid-new", newComments);

    // Existing uid data should be preserved
    expect(data.articles["uid-existing"].comments).toHaveLength(1);
    expect(data.articles["uid-existing"].comments![0].id).toBe("c0");

    // New uid data should be added
    expect(data.articles["uid-new"].comments).toHaveLength(1);
    expect(data.articles["uid-new"].comments![0].id).toBe("c1");
  });

  it("handles empty incoming comments (no-op)", () => {
    const data: GenericSocialFile = {
      schemaVersion: "1.0.0",
      articles: {
        "uid-abc": {
          comments: [
            {
              id: "c1",
              content: "Existing",
              createdAt: "2025-06-15T09:00:00.000Z",
              author: { displayName: "Alice" },
            },
          ],
        },
      },
    };

    mergeCommentSocialData(data, "uid-abc", []);

    // Existing comments should be preserved
    expect(data.articles["uid-abc"].comments).toHaveLength(1);
  });

  it("preserves non-comment fields in article data", () => {
    const data: GenericSocialFile = {
      schemaVersion: "1.0.0",
      articles: {
        "uid-abc": {
          comments: [],
          donations: [{ id: "d1", sender: "Alice" }],
        },
      },
    };

    const newComments: GenericSocialComment[] = [
      {
        id: "c1",
        content: "New comment",
        createdAt: "2025-06-15T09:00:00.000Z",
        author: { displayName: "Bob" },
      },
    ];

    mergeCommentSocialData(data, "uid-abc", newComments);

    // Non-comment fields should be preserved
    expect((data.articles["uid-abc"] as any).donations).toHaveLength(1);
    // Comments should be updated
    expect(data.articles["uid-abc"].comments).toHaveLength(1);
  });
});
