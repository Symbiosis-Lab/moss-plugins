/**
 * Tests for comment fetcher
 *
 * Validates that fetchWalineComments and fetchArtalkComments correctly
 * call the API, normalize responses to GenericSocialComment[], and
 * handle errors gracefully.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted to define mock variables before vi.mock hoisting
const mockHttpGet = vi.hoisted(() => vi.fn());

vi.mock("@symbiosis-lab/moss-api", () => ({
  httpGet: mockHttpGet,
}));

import { fetchWalineComments, fetchArtalkComments } from "../fetcher";

describe("fetchWalineComments", () => {
  beforeEach(() => {
    mockHttpGet.mockReset();
  });

  it("fetches and normalizes Waline comments", async () => {
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        JSON.stringify({
          data: [
            {
              objectId: "waline-001",
              comment: "<p>Great article!</p>",
              insertedAt: "2025-06-15T10:30:00.000Z",
              nick: "Alice",
              link: "https://alice.example.com",
              mail: "alice@example.com",
              pid: null,
              rid: null,
              status: "approved",
            },
            {
              objectId: "waline-002",
              comment: "<p>Thanks Alice!</p>",
              insertedAt: "2025-06-15T11:00:00.000Z",
              nick: "Bob",
              link: "",
              mail: "",
              pid: "waline-001",
              rid: "waline-001",
              status: "approved",
            },
          ],
        }),
    });

    const comments = await fetchWalineComments(
      "https://waline.example.com",
      "posts/hello/"
    );

    expect(mockHttpGet).toHaveBeenCalledWith(
      "https://waline.example.com/api/comment?path=posts/hello/&pageSize=100"
    );

    expect(comments).toHaveLength(2);

    expect(comments[0]).toEqual({
      id: "waline-001",
      content: "<p>Great article!</p>",
      createdAt: "2025-06-15T10:30:00.000Z",
      author: {
        displayName: "Alice",
        name: "Alice",
      },
      replyToId: undefined,
    });

    expect(comments[1]).toEqual({
      id: "waline-002",
      content: "<p>Thanks Alice!</p>",
      createdAt: "2025-06-15T11:00:00.000Z",
      author: {
        displayName: "Bob",
        name: "Bob",
      },
      replyToId: "waline-001",
    });
  });

  it("returns empty array when response has no data", async () => {
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => JSON.stringify({}),
    });

    const comments = await fetchWalineComments(
      "https://waline.example.com",
      "posts/hello/"
    );

    expect(comments).toEqual([]);
  });

  it("returns empty array when data is empty array", async () => {
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => JSON.stringify({ data: [] }),
    });

    const comments = await fetchWalineComments(
      "https://waline.example.com",
      "posts/hello/"
    );

    expect(comments).toEqual([]);
  });

  it("returns empty array on HTTP error", async () => {
    mockHttpGet.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => "Internal Server Error",
    });

    const comments = await fetchWalineComments(
      "https://waline.example.com",
      "posts/hello/"
    );

    expect(comments).toEqual([]);
  });

  it("returns empty array on network error", async () => {
    mockHttpGet.mockRejectedValue(new Error("Network error"));

    const comments = await fetchWalineComments(
      "https://waline.example.com",
      "posts/hello/"
    );

    expect(comments).toEqual([]);
  });

  it("returns empty array on malformed JSON", async () => {
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => "not valid json",
    });

    const comments = await fetchWalineComments(
      "https://waline.example.com",
      "posts/hello/"
    );

    expect(comments).toEqual([]);
  });

  it("handles comments with missing nick gracefully", async () => {
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        JSON.stringify({
          data: [
            {
              objectId: "waline-003",
              comment: "<p>Anonymous comment</p>",
              insertedAt: "2025-06-15T12:00:00.000Z",
              nick: "",
              link: "",
              mail: "",
              pid: null,
              rid: null,
              status: "approved",
            },
          ],
        }),
    });

    const comments = await fetchWalineComments(
      "https://waline.example.com",
      "posts/hello/"
    );

    expect(comments).toHaveLength(1);
    expect(comments[0].author.displayName).toBe("");
    expect(comments[0].author.name).toBe("");
  });
});

describe("fetchArtalkComments", () => {
  beforeEach(() => {
    mockHttpGet.mockReset();
  });

  it("fetches and normalizes Artalk comments", async () => {
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        JSON.stringify({
          data: {
            comments: [
              {
                id: 101,
                content: "<p>Nice post!</p>",
                date: "2025-06-15T10:30:00.000Z",
                nick: "Charlie",
                email: "charlie@example.com",
                link: "https://charlie.example.com",
                rid: 0,
                is_collapsed: false,
                is_pending: false,
              },
              {
                id: 102,
                content: "<p>I agree!</p>",
                date: "2025-06-15T11:00:00.000Z",
                nick: "Diana",
                email: "",
                link: "",
                rid: 101,
                is_collapsed: false,
                is_pending: false,
              },
            ],
          },
        }),
    });

    const comments = await fetchArtalkComments(
      "https://artalk.example.com",
      "posts/hello/",
      "My Site"
    );

    expect(mockHttpGet).toHaveBeenCalledWith(
      "https://artalk.example.com/api/v2/comments?page_key=posts/hello/&site_name=My%20Site&limit=100"
    );

    expect(comments).toHaveLength(2);

    expect(comments[0]).toEqual({
      id: "101",
      content: "<p>Nice post!</p>",
      createdAt: "2025-06-15T10:30:00.000Z",
      author: {
        displayName: "Charlie",
        name: "Charlie",
      },
      replyToId: undefined,
    });

    expect(comments[1]).toEqual({
      id: "102",
      content: "<p>I agree!</p>",
      createdAt: "2025-06-15T11:00:00.000Z",
      author: {
        displayName: "Diana",
        name: "Diana",
      },
      replyToId: "101",
    });
  });

  it("returns empty array when response has no comments", async () => {
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        JSON.stringify({
          data: {
            comments: [],
          },
        }),
    });

    const comments = await fetchArtalkComments(
      "https://artalk.example.com",
      "posts/hello/",
      "My Site"
    );

    expect(comments).toEqual([]);
  });

  it("returns empty array when data.comments is missing", async () => {
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => JSON.stringify({ data: {} }),
    });

    const comments = await fetchArtalkComments(
      "https://artalk.example.com",
      "posts/hello/",
      "My Site"
    );

    expect(comments).toEqual([]);
  });

  it("returns empty array on HTTP error", async () => {
    mockHttpGet.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => "Not Found",
    });

    const comments = await fetchArtalkComments(
      "https://artalk.example.com",
      "posts/hello/",
      "My Site"
    );

    expect(comments).toEqual([]);
  });

  it("returns empty array on network error", async () => {
    mockHttpGet.mockRejectedValue(new Error("Connection refused"));

    const comments = await fetchArtalkComments(
      "https://artalk.example.com",
      "posts/hello/",
      "My Site"
    );

    expect(comments).toEqual([]);
  });

  it("treats rid=0 as no reply (top-level comment)", async () => {
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        JSON.stringify({
          data: {
            comments: [
              {
                id: 200,
                content: "<p>Top-level</p>",
                date: "2025-06-15T10:30:00.000Z",
                nick: "Eve",
                email: "",
                link: "",
                rid: 0,
                is_collapsed: false,
                is_pending: false,
              },
            ],
          },
        }),
    });

    const comments = await fetchArtalkComments(
      "https://artalk.example.com",
      "posts/hello/",
      "My Site"
    );

    expect(comments[0].replyToId).toBeUndefined();
  });

  it("encodes site_name in URL", async () => {
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => JSON.stringify({ data: { comments: [] } }),
    });

    await fetchArtalkComments(
      "https://artalk.example.com",
      "posts/hello/",
      "My Site Name"
    );

    expect(mockHttpGet).toHaveBeenCalledWith(
      "https://artalk.example.com/api/v2/comments?page_key=posts/hello/&site_name=My%20Site%20Name&limit=100"
    );
  });
});
