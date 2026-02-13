import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupMockTauri, type MockTauriContext } from "@symbiosis-lab/moss-api/testing";
import { apiConfig } from "../api";

// We'll import these after creating domain.ts
import {
  initializeDomain,
  getDomain,
  loginUrl,
  draftUrl,
  articleUrl,
  isMattersUrl,
  isInternalMattersLink,
  resetDomain,
} from "../domain";

const PLUGIN_NAME = "matters-syndicator";

describe("Domain Module", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ pluginName: PLUGIN_NAME });
    resetDomain(); // Reset to default before each test
  });

  afterEach(() => {
    ctx.cleanup();
    resetDomain();
  });

  describe("initializeDomain", () => {
    it("defaults to matters.town when no config", async () => {
      // No config file → defaults
      await initializeDomain();

      expect(getDomain()).toBe("matters.town");
      expect(apiConfig.endpoint).toBe("https://server.matters.town/graphql");
    });

    it("uses configured domain from config.json", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );

      await initializeDomain();

      expect(getDomain()).toBe("matters.icu");
      expect(apiConfig.endpoint).toBe("https://server.matters.icu/graphql");
    });

    it("updates manifest.json domain when different from config", async () => {
      // Set up existing manifest with matters.town
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/manifest.json`,
        JSON.stringify({
          name: "matters",
          version: "1.0.0",
          domain: "matters.town",
          entry: "main.bundle.js",
          capabilities: ["process", "syndicate"],
        })
      );

      // Set config to matters.icu
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );

      await initializeDomain();

      // Manifest should be updated
      const manifestContent = ctx.filesystem.getFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/manifest.json`
      );
      expect(manifestContent).toBeDefined();
      const manifest = JSON.parse(manifestContent!.content);
      expect(manifest.domain).toBe("matters.icu");
    });

    it("does not update manifest when domain already matches", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/manifest.json`,
        JSON.stringify({
          name: "matters",
          version: "1.0.0",
          domain: "matters.icu",
          entry: "main.bundle.js",
          capabilities: ["process", "syndicate"],
        })
      );

      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );

      await initializeDomain();

      // Domain should be set correctly
      expect(getDomain()).toBe("matters.icu");
    });

    it("preserves other manifest fields when updating domain", async () => {
      const originalManifest = {
        name: "matters",
        version: "1.0.0",
        description: "Syndicate to Matters.town",
        domain: "matters.town",
        entry: "main.bundle.js",
        capabilities: ["process", "syndicate"],
        config: { auto_publish: false },
      };

      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/manifest.json`,
        JSON.stringify(originalManifest)
      );

      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );

      await initializeDomain();

      const manifestContent = ctx.filesystem.getFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/manifest.json`
      );
      const manifest = JSON.parse(manifestContent!.content);

      expect(manifest.name).toBe("matters");
      expect(manifest.version).toBe("1.0.0");
      expect(manifest.description).toBe("Syndicate to Matters.town");
      expect(manifest.domain).toBe("matters.icu");
      expect(manifest.entry).toBe("main.bundle.js");
      expect(manifest.capabilities).toEqual(["process", "syndicate"]);
      expect(manifest.config).toEqual({ auto_publish: false });
    });
  });

  describe("URL builders", () => {
    it("loginUrl uses current domain", async () => {
      await initializeDomain(); // defaults to matters.town
      expect(loginUrl()).toBe("https://matters.town/login");
    });

    it("loginUrl uses configured domain", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );
      await initializeDomain();
      expect(loginUrl()).toBe("https://matters.icu/login");
    });

    it("draftUrl constructs correct URL", async () => {
      await initializeDomain();
      expect(draftUrl("draft-123")).toBe(
        "https://matters.town/me/drafts/draft-123"
      );
    });

    it("draftUrl uses configured domain", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );
      await initializeDomain();
      expect(draftUrl("draft-456")).toBe(
        "https://matters.icu/me/drafts/draft-456"
      );
    });

    it("articleUrl constructs correct URL", async () => {
      await initializeDomain();
      expect(articleUrl("alice", "my-article", "abc123")).toBe(
        "https://matters.town/@alice/my-article-abc123"
      );
    });

    it("articleUrl uses configured domain", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );
      await initializeDomain();
      expect(articleUrl("bob", "test-post", "xyz789")).toBe(
        "https://matters.icu/@bob/test-post-xyz789"
      );
    });
  });

  describe("isMattersUrl", () => {
    it("matches default domain", async () => {
      await initializeDomain();
      expect(isMattersUrl("https://matters.town/@alice/post-abc123")).toBe(true);
      expect(isMattersUrl("https://example.com/article")).toBe(false);
    });

    it("matches configured domain", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );
      await initializeDomain();

      expect(isMattersUrl("https://matters.icu/@alice/post-abc123")).toBe(true);
      // Should NOT match matters.town when configured to matters.icu
      expect(isMattersUrl("https://matters.town/@alice/post-abc123")).toBe(
        false
      );
    });

    it("handles edge cases", async () => {
      await initializeDomain();
      expect(isMattersUrl("")).toBe(false);
      expect(isMattersUrl("matters.town")).toBe(true); // contains domain
    });
  });

  describe("isInternalMattersLink", () => {
    it("matches user's own content on default domain", async () => {
      await initializeDomain();
      expect(
        isInternalMattersLink(
          "https://matters.town/@alice/my-post-abc",
          "alice"
        )
      ).toBe(true);
      expect(
        isInternalMattersLink(
          "https://matters.town/@bob/other-post-abc",
          "alice"
        )
      ).toBe(false);
    });

    it("matches user's own content on configured domain", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );
      await initializeDomain();

      expect(
        isInternalMattersLink(
          "https://matters.icu/@alice/my-post-abc",
          "alice"
        )
      ).toBe(true);
      // Should NOT match matters.town when configured to matters.icu
      expect(
        isInternalMattersLink(
          "https://matters.town/@alice/my-post-abc",
          "alice"
        )
      ).toBe(false);
    });
  });

  describe("getDomain", () => {
    it("returns default before initialization", () => {
      expect(getDomain()).toBe("matters.town");
    });

    it("returns configured domain after initialization", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );
      await initializeDomain();
      expect(getDomain()).toBe("matters.icu");
    });
  });

  describe("resetDomain", () => {
    it("resets to default", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.moss/plugins/${PLUGIN_NAME}/config.json`,
        JSON.stringify({ domain: "matters.icu" })
      );
      await initializeDomain();
      expect(getDomain()).toBe("matters.icu");

      resetDomain();
      expect(getDomain()).toBe("matters.town");
    });
  });
});
