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

import { fetchWalineComments, fetchArtalkComments, fetchAllArtalkComments, detectProvider, clearDetectionCache } from "../fetcher";

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

describe("fetchAllArtalkComments", () => {
  beforeEach(() => {
    mockHttpGet.mockReset();
  });

  it("uses stats/latest_comments endpoint and groups by page_key", async () => {
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        JSON.stringify({
          data: [
            {
              id: 1,
              content: "<p>Hello</p>",
              date: "2025-06-15T10:00:00Z",
              nick: "Alice",
              rid: 0,
              page_key: "/posts/hello/",
            },
            {
              id: 2,
              content: "<p>World</p>",
              date: "2025-06-15T11:00:00Z",
              nick: "Bob",
              rid: 0,
              page_key: "/posts/world/",
            },
            {
              id: 3,
              content: "<p>Reply</p>",
              date: "2025-06-15T12:00:00Z",
              nick: "Charlie",
              rid: 1,
              page_key: "/posts/hello/",
            },
          ],
        }),
    });

    const result = await fetchAllArtalkComments(
      "https://artalk.example.com",
      "My Site"
    );

    // Should use stats/latest_comments endpoint
    expect(mockHttpGet).toHaveBeenCalledTimes(1);
    expect(mockHttpGet).toHaveBeenCalledWith(
      expect.stringContaining("stats/latest_comments")
    );
    expect(mockHttpGet).toHaveBeenCalledWith(
      expect.stringContaining("site_name=My%20Site")
    );

    // Grouped by page_key
    expect(result.size).toBe(2);
    expect(result.get("/posts/hello/")).toHaveLength(2);
    expect(result.get("/posts/world/")).toHaveLength(1);

    // Normalized correctly
    const helloComments = result.get("/posts/hello/")!;
    expect(helloComments[0]).toEqual({
      id: "1",
      content: "<p>Hello</p>",
      createdAt: "2025-06-15T10:00:00Z",
      author: { displayName: "Alice", name: "Alice" },
      replyToId: undefined,
    });
    expect(helloComments[1].replyToId).toBe("1");
  });

  it("returns empty map on HTTP error", async () => {
    mockHttpGet.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => "Internal Server Error",
    });

    const result = await fetchAllArtalkComments(
      "https://artalk.example.com",
      "My Site"
    );

    expect(result.size).toBe(0);
  });

  it("returns empty map on network error", async () => {
    mockHttpGet.mockRejectedValue(new Error("Connection refused"));

    const result = await fetchAllArtalkComments(
      "https://artalk.example.com",
      "My Site"
    );

    expect(result.size).toBe(0);
  });

  it("handles empty response body gracefully", async () => {
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => "",
    });

    const result = await fetchAllArtalkComments(
      "https://artalk.example.com",
      "My Site"
    );

    expect(result.size).toBe(0);
  });

  it("handles empty data array", async () => {
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => JSON.stringify({ data: [] }),
    });

    const result = await fetchAllArtalkComments(
      "https://artalk.example.com",
      "My Site"
    );

    expect(result.size).toBe(0);
  });
});

describe("fetchArtalkComments — Artalk v2.9.1 response format (no data wrapper)", () => {
  beforeEach(() => {
    mockHttpGet.mockReset();
  });

  it("parses comments from top-level json.comments (v2.9.1 format)", async () => {
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        JSON.stringify({
          comments: [
            {
              id: 1,
              content: "<p>test</p>",
              date: "2026-03-09T01:41:43.000Z",
              nick: "tester",
              email: "",
              link: "",
              rid: 0,
              page_key: "e4cc2af9",
            },
          ],
          count: 1,
          roots_count: 1,
        }),
    });

    const comments = await fetchArtalkComments(
      "https://artalk.example.com",
      "e4cc2af9",
      "My Site"
    );

    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe("1");
    expect(comments[0].content).toBe("<p>test</p>");
    expect(comments[0].createdAt).toBe("2026-03-09T01:41:43.000Z");
  });
});


describe("fetchArtalkComments — empty response guard", () => {
  beforeEach(() => {
    mockHttpGet.mockReset();
  });

  it("returns empty array when response body is empty string", async () => {
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => "",
    });

    const comments = await fetchArtalkComments(
      "https://artalk.example.com",
      "posts/hello/",
      "My Site"
    );

    expect(comments).toEqual([]);
  });
});

describe("fetchWalineComments — empty response guard", () => {
  beforeEach(() => {
    mockHttpGet.mockReset();
  });

  it("returns empty array when response body is empty string", async () => {
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => "",
    });

    const comments = await fetchWalineComments(
      "https://waline.example.com",
      "posts/hello/"
    );

    expect(comments).toEqual([]);
  });
});

describe("detectProvider", () => {
  beforeEach(() => {
    mockHttpGet.mockReset();
    // Clear the detection cache between tests
    clearDetectionCache();
  });

  it('returns "artalk" when server responds to /api/v2/conf with 200', async () => {
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => JSON.stringify({ app_name: "Artalk" }),
    });

    const result = await detectProvider("https://comments.example.com");

    expect(result).toBe("artalk");
    expect(mockHttpGet).toHaveBeenCalledWith(
      "https://comments.example.com/api/v2/conf"
    );
  });

  it('returns "waline" when server responds with non-200', async () => {
    mockHttpGet.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => "Not Found",
    });

    const result = await detectProvider("https://comments.example.com");

    expect(result).toBe("waline");
  });

  it('returns "waline" when server throws network error', async () => {
    mockHttpGet.mockRejectedValue(new Error("Connection refused"));

    const result = await detectProvider("https://comments.example.com");

    expect(result).toBe("waline");
  });

  it("caches result (second call does not make HTTP request)", async () => {
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => JSON.stringify({ app_name: "Artalk" }),
    });

    const result1 = await detectProvider("https://comments.example.com");
    const result2 = await detectProvider("https://comments.example.com");

    expect(result1).toBe("artalk");
    expect(result2).toBe("artalk");
    expect(mockHttpGet).toHaveBeenCalledTimes(1);
  });

  it("uses different cache entries for different URLs", async () => {
    mockHttpGet.mockImplementation((url: string) => {
      if (url.includes("artalk-server")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => JSON.stringify({ app_name: "Artalk" }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        text: () => "Not Found",
      });
    });

    const result1 = await detectProvider("https://artalk-server.example.com");
    const result2 = await detectProvider("https://waline-server.example.com");

    expect(result1).toBe("artalk");
    expect(result2).toBe("waline");
    expect(mockHttpGet).toHaveBeenCalledTimes(2);
  });
});
