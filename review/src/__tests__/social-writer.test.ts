import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());

vi.mock("@symbiosis-lab/moss-api", () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
}));

import {
  loadReviewSocialData,
  saveReviewSocialData,
  upsertReviewEntry,
} from "../social-writer";
import type { ReviewSocialFile, ReviewSocialEntry } from "../types";

const makeEntry = (overrides: Partial<ReviewSocialEntry> = {}): ReviewSocialEntry => ({
  neodb_url: "https://neodb.social/book/abc",
  category: "book",
  title: "Test Book",
  creator: ["Author"],
  year: 2020,
  publisher: "Publisher",
  pages: 300,
  isbn: "978-0-000-00000-0",
  community_rating: 8.0,
  community_rating_count: 100,
  cover_downloaded: false,
  cover_path: null,
  external_urls: { neodb: "https://neodb.social/book/abc" },
  writer_rating: 4,
  fetched_at: "2026-03-10T00:00:00.000Z",
  ...overrides,
});

describe("loadReviewSocialData", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
  });

  it("loads existing data", async () => {
    const existing: ReviewSocialFile = {
      schemaVersion: "1.0.0",
      updatedAt: "2026-03-10T00:00:00.000Z",
      articles: { uid1: makeEntry() },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(existing));

    const data = await loadReviewSocialData();
    expect(data.articles["uid1"].title).toBe("Test Book");
  });

  it("returns empty when file missing", async () => {
    mockReadFile.mockRejectedValue(new Error("Not found"));
    const data = await loadReviewSocialData();
    expect(data.articles).toEqual({});
  });

  it("returns empty on invalid JSON", async () => {
    mockReadFile.mockResolvedValue("not json");
    const data = await loadReviewSocialData();
    expect(data.articles).toEqual({});
  });
});

describe("saveReviewSocialData", () => {
  beforeEach(() => {
    mockWriteFile.mockReset();
  });

  it("writes to .moss/social/review.json", async () => {
    mockWriteFile.mockResolvedValue(undefined);
    const data: ReviewSocialFile = {
      schemaVersion: "1.0.0",
      updatedAt: "",
      articles: { uid1: makeEntry() },
    };

    await saveReviewSocialData(data);

    expect(mockWriteFile).toHaveBeenCalledWith(
      ".moss/social/review.json",
      expect.any(String)
    );
    const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
    expect(written.updatedAt).toBeTruthy();
  });
});

describe("upsertReviewEntry", () => {
  it("adds new entry", () => {
    const data: ReviewSocialFile = { schemaVersion: "1.0.0", updatedAt: "", articles: {} };
    upsertReviewEntry(data, "uid1", makeEntry());
    expect(data.articles["uid1"].title).toBe("Test Book");
  });

  it("updates existing entry", () => {
    const data: ReviewSocialFile = {
      schemaVersion: "1.0.0",
      updatedAt: "",
      articles: { uid1: makeEntry({ title: "Old" }) },
    };
    upsertReviewEntry(data, "uid1", makeEntry({ title: "New" }));
    expect(data.articles["uid1"].title).toBe("New");
  });

  it("preserves other uids", () => {
    const data: ReviewSocialFile = {
      schemaVersion: "1.0.0",
      updatedAt: "",
      articles: { uid1: makeEntry({ title: "Keep" }) },
    };
    upsertReviewEntry(data, "uid2", makeEntry({ title: "New" }));
    expect(data.articles["uid1"].title).toBe("Keep");
    expect(data.articles["uid2"].title).toBe("New");
  });
});
