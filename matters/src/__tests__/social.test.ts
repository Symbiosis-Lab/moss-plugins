import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupMockTauri, type MockTauriContext } from "@symbiosis-lab/moss-api/testing";
import {
  loadSocialData,
  saveSocialData,
  mergeSocialData,
  getArticleSocialData,
  getSocialCounts,
} from "../social";
import type {
  MattersSocialData,
  MattersComment,
  MattersDonation,
  MattersAppreciation,
} from "../types";

describe("Social Module", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ pluginName: "matters-syndicator" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("loadSocialData", () => {
    it("returns empty data structure when file does not exist", async () => {
      const data = await loadSocialData();

      expect(data.schemaVersion).toBe("1.0.0");
      expect(data.articles).toEqual({});
      expect(data.updatedAt).toBeDefined();
    });

    it("returns parsed data when file exists", async () => {
      const existingData: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "2024-01-01T00:00:00.000Z",
        articles: {
          "abc123": {
            comments: [],
            donations: [],
            appreciations: [],
          },
        },
      };
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/social/matters.json`,
        JSON.stringify(existingData)
      );

      const data = await loadSocialData();

      expect(data.schemaVersion).toBe("1.0.0");
      expect(data.articles["abc123"]).toBeDefined();
    });

    it("returns empty data on invalid JSON", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/social/matters.json`,
        "invalid json {{{"
      );

      const data = await loadSocialData();

      expect(data.schemaVersion).toBe("1.0.0");
      expect(data.articles).toEqual({});
    });

    it("returns empty data when schemaVersion is missing", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/social/matters.json`,
        JSON.stringify({ articles: {} })
      );

      const data = await loadSocialData();

      expect(data.schemaVersion).toBe("1.0.0");
      expect(data.articles).toEqual({});
    });

    it("returns empty data when articles field is missing", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/social/matters.json`,
        JSON.stringify({ schemaVersion: "1.0.0" })
      );

      const data = await loadSocialData();

      expect(data.schemaVersion).toBe("1.0.0");
      expect(data.articles).toEqual({});
    });
  });

  describe("saveSocialData", () => {
    it("saves social data to correct path", async () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "2024-01-01T00:00:00.000Z",
        articles: {
          "abc123": {
            comments: [],
            donations: [],
            appreciations: [],
          },
        },
      };

      await saveSocialData(data);

      const savedContent = ctx.filesystem.getFile(
        `${ctx.projectPath}/.moss/social/matters.json`
      );
      expect(savedContent).toBeDefined();

      const parsed = JSON.parse(savedContent!.content);
      expect(parsed.schemaVersion).toBe("1.0.0");
      expect(parsed.articles["abc123"]).toBeDefined();
    });

    it("updates updatedAt timestamp on save", async () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "2024-01-01T00:00:00.000Z",
        articles: {},
      };

      const beforeSave = new Date().toISOString();
      await saveSocialData(data);

      const savedContent = ctx.filesystem.getFile(
        `${ctx.projectPath}/.moss/social/matters.json`
      );
      const parsed = JSON.parse(savedContent!.content);

      // updatedAt should be after or equal to beforeSave
      expect(new Date(parsed.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(beforeSave).getTime() - 1000 // Allow 1 second tolerance
      );
    });
  });

  describe("mergeSocialData", () => {
    const createComment = (id: string, content: string): MattersComment => ({
      id,
      content,
      createdAt: "2024-01-01T00:00:00.000Z",
      state: "active",
      upvotes: 0,
      author: {
        id: "author-1",
        userName: "testuser",
        displayName: "Test User",
      },
    });

    const createDonation = (id: string): MattersDonation => ({
      id,
      sender: {
        id: "sender-1",
        userName: "donor",
        displayName: "Donor",
      },
    });

    const createAppreciation = (senderId: string, createdAt: string): MattersAppreciation => ({
      amount: 5,
      createdAt,
      sender: {
        id: senderId,
        userName: "appreciator",
        displayName: "Appreciator",
      },
    });

    it("adds new article data to empty structure", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {},
      };

      const comments = [createComment("c1", "Comment 1")];
      const donations = [createDonation("d1")];
      const appreciations = [createAppreciation("s1", "2024-01-01T00:00:00.000Z")];

      mergeSocialData(data, "abc123", comments, donations, appreciations);

      expect(data.articles["abc123"]).toBeDefined();
      expect(data.articles["abc123"].comments).toHaveLength(1);
      expect(data.articles["abc123"].donations).toHaveLength(1);
      expect(data.articles["abc123"].appreciations).toHaveLength(1);
    });

    it("merges new comments without duplicates", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {
          "abc123": {
            comments: [createComment("c1", "Original")],
            donations: [],
            appreciations: [],
          },
        },
      };

      const newComments = [
        createComment("c1", "Updated"), // Same ID, should update
        createComment("c2", "New"),     // New ID, should add
      ];

      mergeSocialData(data, "abc123", newComments, [], []);

      expect(data.articles["abc123"].comments).toHaveLength(2);
      const c1 = data.articles["abc123"].comments.find(c => c.id === "c1");
      expect(c1?.content).toBe("Updated");
    });

    it("merges new donations without duplicates", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {
          "abc123": {
            comments: [],
            donations: [createDonation("d1")],
            appreciations: [],
          },
        },
      };

      const newDonations = [
        createDonation("d1"), // Same ID, should update
        createDonation("d2"), // New ID, should add
      ];

      mergeSocialData(data, "abc123", [], newDonations, []);

      expect(data.articles["abc123"].donations).toHaveLength(2);
    });

    it("merges appreciations using sender.id + createdAt as key", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {
          "abc123": {
            comments: [],
            donations: [],
            appreciations: [createAppreciation("s1", "2024-01-01T00:00:00.000Z")],
          },
        },
      };

      const newAppreciations = [
        createAppreciation("s1", "2024-01-01T00:00:00.000Z"), // Same key, should update
        createAppreciation("s1", "2024-01-02T00:00:00.000Z"), // Same sender, different time
        createAppreciation("s2", "2024-01-01T00:00:00.000Z"), // Different sender
      ];

      mergeSocialData(data, "abc123", [], [], newAppreciations);

      expect(data.articles["abc123"].appreciations).toHaveLength(3);
    });

    it("preserves existing data when merging empty arrays", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {
          "abc123": {
            comments: [createComment("c1", "Existing")],
            donations: [createDonation("d1")],
            appreciations: [createAppreciation("s1", "2024-01-01T00:00:00.000Z")],
          },
        },
      };

      mergeSocialData(data, "abc123", [], [], []);

      expect(data.articles["abc123"].comments).toHaveLength(1);
      expect(data.articles["abc123"].donations).toHaveLength(1);
      expect(data.articles["abc123"].appreciations).toHaveLength(1);
    });

    it("handles multiple articles independently", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {
          "abc123": {
            comments: [createComment("c1", "Article 1")],
            donations: [],
            appreciations: [],
          },
        },
      };

      mergeSocialData(data, "xyz789", [createComment("c2", "Article 2")], [], []);

      expect(data.articles["abc123"].comments).toHaveLength(1);
      expect(data.articles["xyz789"].comments).toHaveLength(1);
      expect(data.articles["abc123"].comments[0].content).toBe("Article 1");
      expect(data.articles["xyz789"].comments[0].content).toBe("Article 2");
    });
  });

  describe("getArticleSocialData", () => {
    it("returns article data when it exists", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {
          "abc123": {
            comments: [],
            donations: [],
            appreciations: [],
          },
        },
      };

      const result = getArticleSocialData(data, "abc123");

      expect(result).toBeDefined();
      expect(result?.comments).toEqual([]);
    });

    it("returns undefined when article does not exist", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {},
      };

      const result = getArticleSocialData(data, "nonexistent");

      expect(result).toBeUndefined();
    });
  });

  describe("getSocialCounts", () => {
    it("returns zero counts for nonexistent article", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {},
      };

      const counts = getSocialCounts(data, "nonexistent");

      expect(counts.comments).toBe(0);
      expect(counts.donations).toBe(0);
      expect(counts.appreciations).toBe(0);
      expect(counts.totalClaps).toBe(0);
    });

    it("returns correct counts for existing article", () => {
      const data: MattersSocialData = {
        schemaVersion: "1.0.0",
        updatedAt: "",
        articles: {
          "abc123": {
            comments: [
              {
                id: "c1",
                content: "Comment",
                createdAt: "",
                state: "active",
                upvotes: 0,
                author: { id: "a1", userName: "u1", displayName: "U1" },
              },
              {
                id: "c2",
                content: "Comment 2",
                createdAt: "",
                state: "active",
                upvotes: 0,
                author: { id: "a2", userName: "u2", displayName: "U2" },
              },
            ],
            donations: [
              {
                id: "d1",
                sender: { id: "s1", userName: "donor", displayName: "Donor" },
              },
            ],
            appreciations: [
              {
                amount: 5,
                createdAt: "",
                sender: { id: "s1", userName: "ap1", displayName: "AP1" },
              },
              {
                amount: 10,
                createdAt: "",
                sender: { id: "s2", userName: "ap2", displayName: "AP2" },
              },
            ],
          },
        },
      };

      const counts = getSocialCounts(data, "abc123");

      expect(counts.comments).toBe(2);
      expect(counts.donations).toBe(1);
      expect(counts.appreciations).toBe(2);
      expect(counts.totalClaps).toBe(15);
    });
  });
});
