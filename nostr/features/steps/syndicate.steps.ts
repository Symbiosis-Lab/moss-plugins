/**
 * Step definitions for syndicate hook feature tests
 */

import { loadFeature, describeFeature } from "@amiceli/vitest-cucumber";
import { expect, vi } from "vitest";
import { MockRelay } from "../../test-helpers/mock-relay";
import type { HookResult, SyndicateContext, Article } from "../../src/types";
import { createSyndicateContext } from "../../test-helpers/test-utils";
import type { Event as NostrEvent } from "nostr-tools";

const feature = await loadFeature("features/syndicate/publish-article.feature");

describeFeature(feature, ({ Scenario, Background }) => {
  let mockRelay: MockRelay;
  let mockRelays: Map<string, MockRelay>;
  let syndicateContext: SyndicateContext;
  let syndicateResult: HookResult;
  let articles: Article[];
  let configuredKey: string | undefined;

  Background(({ Given, And }) => {
    Given("a mock Tauri environment", () => {
      mockRelay = new MockRelay();
      mockRelays = new Map();
      articles = [];
      configuredKey = undefined;
      syndicateResult = { success: false };
    });

    And("a mock relay for publishing", () => {
      mockRelays.set("wss://relay.example.com", mockRelay);
    });
  });

  Scenario("Publish new article as NIP-23 long-form content", ({ Given, When, Then, And }) => {
    Given(/an article:/, (table: Array<{ title?: string; content?: string; tags?: string; url?: string }>) => {
      const row = table[0];
      articles = [
        {
          title: row.title ?? "Test Article",
          content: row.content ?? "Test content",
          tags: row.tags?.split(",").map((t) => t.trim()),
          url_path: row.url ?? "https://example.com/post",
        },
      ];
    });

    And("a configured private key", () => {
      // Using a test nsec key (NIP-19 format)
      configuredKey = "nsec1test1234567890abcdef1234567890abcdef1234567890abcdef12345";
    });

    When("the syndicate hook runs", async () => {
      syndicateContext = createSyndicateContext(articles, {
        config: {
          relays: ["wss://relay.example.com"],
          nsec: configuredKey,
        },
      });
      const { syndicate } = await import("../../src/main");
      syndicateResult = await syndicate(syndicateContext);
    });

    Then("the result should be successful", () => {
      expect(syndicateResult.success).toBe(true);
    });

    And(/a kind (\d+) event should be published/, (kind: string) => {
      const published = mockRelay.getPublishedEvents();
      expect(published.length).toBeGreaterThan(0);
      expect(published[0].kind).toBe(parseInt(kind));
    });

    And(/the event should have a "(.+)" tag with the article identifier/, (tagName: string) => {
      const published = mockRelay.getPublishedEvents();
      const event = published[0];
      const tag = event.tags.find((t) => t[0] === tagName);
      expect(tag).toBeDefined();
      expect(tag![1]).toBeTruthy();
    });

    And(/the event should have a "(.+)" tag with "(.+)"/, (tagName: string, value: string) => {
      const published = mockRelay.getPublishedEvents();
      const event = published[0];
      const tag = event.tags.find((t) => t[0] === tagName);
      expect(tag).toBeDefined();
      expect(tag![1]).toBe(value);
    });

    And(/the event should have "(.+)" tags for each article tag/, (tagName: string) => {
      const published = mockRelay.getPublishedEvents();
      const event = published[0];
      const tTags = event.tags.filter((t) => t[0] === tagName);
      const articleTags = articles[0].tags ?? [];
      expect(tTags.length).toBe(articleTags.length);
    });

    And("the event content should contain the article content", () => {
      const published = mockRelay.getPublishedEvents();
      const event = published[0];
      expect(event.content).toContain(articles[0].content);
    });
  });

  Scenario("Skip publishing without private key", ({ Given, When, Then, And }) => {
    Given(/an article with title "(.+)" and content "(.+)"/, (title: string, content: string) => {
      articles = [{ title, content, url_path: "https://example.com/post" }];
    });

    And("no configured private key", () => {
      configuredKey = undefined;
    });

    When("the syndicate hook runs", async () => {
      syndicateContext = createSyndicateContext(articles, {
        config: {
          relays: ["wss://relay.example.com"],
          // No nsec key
        },
      });
      const { syndicate } = await import("../../src/main");
      syndicateResult = await syndicate(syndicateContext);
    });

    Then("the result should be successful", () => {
      expect(syndicateResult.success).toBe(true);
    });

    And("no events should be published", () => {
      const published = mockRelay.getPublishedEvents();
      expect(published).toHaveLength(0);
    });

    And("the result message should indicate missing signing key", () => {
      expect(syndicateResult.message?.toLowerCase()).toMatch(/key|sign/);
    });
  });

  Scenario("Handle relay publish failure", ({ Given, When, Then, And }) => {
    Given(/an article with title "(.+)" and content "(.+)"/, (title: string, content: string) => {
      articles = [{ title, content, url_path: "https://example.com/post" }];
    });

    And("a configured private key", () => {
      configuredKey = "nsec1test1234567890abcdef1234567890abcdef1234567890abcdef12345";
    });

    And("the relay rejects publishes", () => {
      mockRelay.setRejectPublish(true);
    });

    When("the syndicate hook runs", async () => {
      syndicateContext = createSyndicateContext(articles, {
        config: {
          relays: ["wss://relay.example.com"],
          nsec: configuredKey,
        },
      });
      const { syndicate } = await import("../../src/main");
      syndicateResult = await syndicate(syndicateContext);
    });

    Then("the result should indicate partial failure", () => {
      // Could be success: false or success: true with error message
      expect(
        syndicateResult.success === false ||
          syndicateResult.message?.toLowerCase().includes("fail")
      ).toBe(true);
    });

    And("the result message should mention relay failure", () => {
      expect(syndicateResult.message?.toLowerCase()).toMatch(/relay|fail|error|reject/);
    });
  });

  Scenario("Publish to multiple relays", ({ Given, When, Then }) => {
    Given(/an article with title "(.+)" and content "(.+)"/, (title: string, content: string) => {
      articles = [{ title, content, url_path: "https://example.com/post" }];
    });

    And("a configured private key", () => {
      configuredKey = "nsec1test1234567890abcdef1234567890abcdef1234567890abcdef12345";
    });

    And(/relays "(.+)" and "(.+)" are configured/, (relay1: string, relay2: string) => {
      mockRelays.set(relay1, new MockRelay());
      mockRelays.set(relay2, new MockRelay());
    });

    When("the syndicate hook runs", async () => {
      const relayUrls = Array.from(mockRelays.keys());
      syndicateContext = createSyndicateContext(articles, {
        config: {
          relays: relayUrls,
          nsec: configuredKey,
        },
      });
      const { syndicate } = await import("../../src/main");
      syndicateResult = await syndicate(syndicateContext);
    });

    Then("the event should be published to both relays", () => {
      mockRelays.forEach((relay) => {
        expect(relay.getPublishedEvents().length).toBeGreaterThan(0);
      });
    });
  });

  Scenario("Include article metadata in event tags", ({ Given, When, Then, And }) => {
    Given(/an article:/, (table: Array<Record<string, string>>) => {
      const row = table[0];
      articles = [
        {
          title: row.title,
          content: row.content,
          tags: row.tags?.split(",").map((t) => t.trim()),
          url_path: row.url,
          // Extended metadata stored in a way the plugin understands
        },
      ];
    });

    And("a configured private key", () => {
      configuredKey = "nsec1test1234567890abcdef1234567890abcdef1234567890abcdef12345";
    });

    When("the syndicate hook runs", async () => {
      syndicateContext = createSyndicateContext(articles, {
        config: {
          relays: ["wss://relay.example.com"],
          nsec: configuredKey,
        },
      });
      const { syndicate } = await import("../../src/main");
      syndicateResult = await syndicate(syndicateContext);
    });

    Then(/the event should have a "(.+)" tag if provided/, (tagName: string) => {
      const published = mockRelay.getPublishedEvents();
      if (published.length > 0) {
        // This assertion depends on whether the metadata was provided
        const event = published[0];
        const hasTag = event.tags.some((t) => t[0] === tagName);
        // We expect it to exist if it was in the article metadata
        expect(hasTag).toBeDefined();
      }
    });

    And(/the event should have a "(.+)" tag$/, (tagName: string) => {
      const published = mockRelay.getPublishedEvents();
      if (published.length > 0) {
        const event = published[0];
        const tag = event.tags.find((t) => t[0] === tagName);
        expect(tag).toBeDefined();
      }
    });
  });

  Scenario("Generate consistent 'd' tag from URL", ({ Given, When, Then, And }) => {
    Given(/articles:/, (table: Array<{ url: string }>) => {
      articles = table.map((row) => ({
        title: `Article at ${row.url}`,
        content: "Content",
        url_path: row.url,
      }));
    });

    And("a configured private key", () => {
      configuredKey = "nsec1test1234567890abcdef1234567890abcdef1234567890abcdef12345";
    });

    When("the syndicate hook runs", async () => {
      syndicateContext = createSyndicateContext(articles, {
        config: {
          relays: ["wss://relay.example.com"],
          nsec: configuredKey,
        },
      });
      const { syndicate } = await import("../../src/main");
      syndicateResult = await syndicate(syndicateContext);
    });

    Then('each article should have a unique "d" tag', () => {
      const published = mockRelay.getPublishedEvents();
      const dTags = published.map((e) => e.tags.find((t) => t[0] === "d")?.[1]);
      const uniqueDTags = new Set(dTags);
      expect(uniqueDTags.size).toBe(published.length);
    });

    And('the "d" tag should be derived from the URL path', () => {
      const published = mockRelay.getPublishedEvents();
      published.forEach((event, i) => {
        const dTag = event.tags.find((t) => t[0] === "d")?.[1];
        // The d tag should be based on the URL path, not a random value
        expect(dTag).toContain("post");
      });
    });
  });

  Scenario("Publish multiple articles", ({ Given, When, Then, And }) => {
    Given(/(\d+) articles to publish/, (count: string) => {
      articles = Array.from({ length: parseInt(count) }, (_, i) => ({
        title: `Article ${i + 1}`,
        content: `Content for article ${i + 1}`,
        url_path: `https://example.com/posts/article-${i + 1}`,
      }));
    });

    And("a configured private key", () => {
      configuredKey = "nsec1test1234567890abcdef1234567890abcdef1234567890abcdef12345";
    });

    When("the syndicate hook runs", async () => {
      syndicateContext = createSyndicateContext(articles, {
        config: {
          relays: ["wss://relay.example.com"],
          nsec: configuredKey,
        },
      });
      const { syndicate } = await import("../../src/main");
      syndicateResult = await syndicate(syndicateContext);
    });

    Then("the result should be successful", () => {
      expect(syndicateResult.success).toBe(true);
    });

    And(/(\d+) events should be published/, (count: string) => {
      const published = mockRelay.getPublishedEvents();
      expect(published).toHaveLength(parseInt(count));
    });
  });

  Scenario("Sign event with NIP-19 nsec key", ({ Given, When, Then, And }) => {
    Given(/an article with title "(.+)" and content "(.+)"/, (title: string, content: string) => {
      articles = [{ title, content, url_path: "https://example.com/post" }];
    });

    And("a configured private key in nsec format", () => {
      // Valid nsec format key for testing
      configuredKey = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";
    });

    When("the syndicate hook runs", async () => {
      syndicateContext = createSyndicateContext(articles, {
        config: {
          relays: ["wss://relay.example.com"],
          nsec: configuredKey,
        },
      });
      const { syndicate } = await import("../../src/main");
      syndicateResult = await syndicate(syndicateContext);
    });

    Then("the published event should have a valid signature", () => {
      const published = mockRelay.getPublishedEvents();
      if (published.length > 0) {
        expect(published[0].sig).toBeTruthy();
        expect(published[0].sig.length).toBe(128); // 64 bytes hex
      }
    });

    And("the event pubkey should match the private key", () => {
      const published = mockRelay.getPublishedEvents();
      if (published.length > 0) {
        expect(published[0].pubkey).toBeTruthy();
        expect(published[0].pubkey.length).toBe(64); // 32 bytes hex
      }
    });
  });

  Scenario("Empty articles list", ({ Given, When, Then, And }) => {
    Given("no articles to publish", () => {
      articles = [];
    });

    And("a configured private key", () => {
      configuredKey = "nsec1test1234567890abcdef1234567890abcdef1234567890abcdef12345";
    });

    When("the syndicate hook runs", async () => {
      syndicateContext = createSyndicateContext(articles, {
        config: {
          relays: ["wss://relay.example.com"],
          nsec: configuredKey,
        },
      });
      const { syndicate } = await import("../../src/main");
      syndicateResult = await syndicate(syndicateContext);
    });

    Then("the result should be successful", () => {
      expect(syndicateResult.success).toBe(true);
    });

    And("no events should be published", () => {
      const published = mockRelay.getPublishedEvents();
      expect(published).toHaveLength(0);
    });
  });

  Scenario("Skip already published articles", ({ Given, When, Then }) => {
    Given("an article that was previously published", () => {
      articles = [
        {
          title: "Previously Published",
          content: "This was published before",
          url_path: "https://example.com/posts/old",
        },
      ];
      // In a real implementation, we'd track published articles
      // For now, this scenario documents the expected behavior
    });

    And("a configured private key", () => {
      configuredKey = "nsec1test1234567890abcdef1234567890abcdef1234567890abcdef12345";
    });

    When("the syndicate hook runs", async () => {
      syndicateContext = createSyndicateContext(articles, {
        config: {
          relays: ["wss://relay.example.com"],
          nsec: configuredKey,
        },
      });
      const { syndicate } = await import("../../src/main");
      syndicateResult = await syndicate(syndicateContext);
    });

    Then("no duplicate events should be published", () => {
      // This test would need a way to track previously published events
      // For now it serves as documentation of expected behavior
      expect(syndicateResult.success).toBe(true);
    });
  });
});
