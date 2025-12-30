/**
 * Step definitions for process hook feature tests
 */

import { loadFeature, describeFeature } from "@amiceli/vitest-cucumber";
import { expect, vi } from "vitest";
import {
  MockRelay,
  createMockComment,
  createMockZap,
  createMockLike,
} from "../../test-helpers/mock-relay";
import type { HookResult, Interaction } from "../../src/types";
import { createProcessContext } from "../../test-helpers/test-utils";

const feature = await loadFeature("features/process/fetch-interactions.feature");

describeFeature(feature, ({ Scenario }) => {
  // Shared state across scenarios
  let mockRelay: MockRelay;
  let mockRelays: Map<string, MockRelay>;
  let processResult: HookResult;
  let processContext: ReturnType<typeof createProcessContext>;

  Scenario("Fetch comments for an article", ({ Given, When, Then, And }) => {
    Given("a mock Tauri environment", () => {
      mockRelay = new MockRelay();
      mockRelays = new Map();
      processResult = { success: false };
      processContext = createProcessContext();
    });

    Given(
      "a mock relay with 3 comments referencing \"https://example.com/posts/hello\"",
      () => {
        const events = Array.from({ length: 3 }, (_, i) =>
          createMockComment("https://example.com/posts/hello", i)
        );
        mockRelay.setEvents(events);
      }
    );

    Given("the plugin is configured with the mock relay", () => {
      processContext = createProcessContext({
        config: { relays: ["wss://mock.relay"] },
      });
    });

    When("the process hook runs", async () => {
      const { process } = await import("../../src/main");
      processResult = await process(processContext);
    });

    Then("the result should be successful", () => {
      expect(processResult.success).toBe(true);
    });

    And("I should receive 3 interactions", () => {
      expect(processResult.interactions).toHaveLength(3);
    });

    And("each interaction should have source \"nostr\"", () => {
      processResult.interactions?.forEach((i) => {
        expect(i.source).toBe("nostr");
      });
    });

    And("each interaction should have interaction_type \"comment\"", () => {
      processResult.interactions?.forEach((i) => {
        expect(i.interaction_type).toBe("comment");
      });
    });

    And("each interaction should have an author identifier", () => {
      processResult.interactions?.forEach((i) => {
        expect(i.author.identifier).toBeDefined();
        expect(i.author.identifier).not.toBe("");
      });
    });
  });

  Scenario("Fetch zaps for an article", ({ Given, When, Then, And }) => {
    Given("a mock Tauri environment", () => {
      mockRelay = new MockRelay();
      mockRelays = new Map();
      processResult = { success: false };
      processContext = createProcessContext();
    });

    Given(
      "a mock relay with zaps totaling 50000 sats for \"https://example.com/posts/hello\"",
      () => {
        const amounts = [21000, 10000, 19000];
        const events = amounts.map((amount, i) =>
          createMockZap("https://example.com/posts/hello", amount, i)
        );
        mockRelay.setEvents(events);
      }
    );

    Given("the plugin is configured with the mock relay", () => {
      processContext = createProcessContext({
        config: { relays: ["wss://mock.relay"] },
      });
    });

    When("the process hook runs", async () => {
      const { process } = await import("../../src/main");
      processResult = await process(processContext);
    });

    Then("the result should be successful", () => {
      expect(processResult.success).toBe(true);
    });

    And("I should receive interactions of type \"zap\"", () => {
      const zaps = processResult.interactions?.filter((i) => i.interaction_type === "zap");
      expect(zaps?.length).toBeGreaterThan(0);
    });

    And("the zap metadata should include amount", () => {
      const zaps = processResult.interactions?.filter((i) => i.interaction_type === "zap");
      zaps?.forEach((zap) => {
        expect(zap.meta?.amount).toBeDefined();
      });
    });
  });

  Scenario("Fetch likes for an article", ({ Given, When, Then, And }) => {
    Given("a mock Tauri environment", () => {
      mockRelay = new MockRelay();
      processResult = { success: false };
      processContext = createProcessContext();
    });

    Given(
      "a mock relay with 5 likes for \"https://example.com/posts/hello\"",
      () => {
        const events = Array.from({ length: 5 }, (_, i) =>
          createMockLike("https://example.com/posts/hello", i)
        );
        mockRelay.setEvents(events);
      }
    );

    Given("the plugin is configured with the mock relay", () => {
      processContext = createProcessContext({
        config: { relays: ["wss://mock.relay"] },
      });
    });

    When("the process hook runs", async () => {
      const { process } = await import("../../src/main");
      processResult = await process(processContext);
    });

    Then("the result should be successful", () => {
      expect(processResult.success).toBe(true);
    });

    And("I should receive 5 interactions", () => {
      expect(processResult.interactions).toHaveLength(5);
    });

    And("each interaction should have interaction_type \"like\"", () => {
      processResult.interactions?.forEach((i) => {
        expect(i.interaction_type).toBe("like");
      });
    });
  });

  Scenario("Handle relay timeout gracefully", ({ Given, When, Then, And }) => {
    Given("a mock Tauri environment", () => {
      mockRelay = new MockRelay();
      processResult = { success: false };
      processContext = createProcessContext();
    });

    Given("a relay that times out after 100ms", () => {
      mockRelay.setTimeout(100);
    });

    Given("the plugin is configured with the mock relay", () => {
      processContext = createProcessContext({
        config: { relays: ["wss://mock.relay"] },
      });
    });

    When("the process hook runs", async () => {
      const { process } = await import("../../src/main");
      processResult = await process(processContext);
    });

    Then("it should return success with empty interactions", () => {
      expect(processResult.success).toBe(true);
      expect(processResult.interactions?.length ?? 0).toBe(0);
    });

    And("the result message should mention timeout", () => {
      expect(processResult.message?.toLowerCase()).toMatch(/timeout|fail|error/);
    });
  });

  Scenario("Handle empty relay response", ({ Given, When, Then }) => {
    Given("a mock Tauri environment", () => {
      mockRelay = new MockRelay();
      processResult = { success: false };
      processContext = createProcessContext();
    });

    Given("a mock relay with no events", () => {
      mockRelay.setEvents([]);
    });

    Given("the plugin is configured with the mock relay", () => {
      processContext = createProcessContext({
        config: { relays: ["wss://mock.relay"] },
      });
    });

    When("the process hook runs with project info", async () => {
      const { process } = await import("../../src/main");
      processResult = await process(processContext);
    });

    Then("it should return success with empty interactions", () => {
      expect(processResult.success).toBe(true);
      expect(processResult.interactions?.length ?? 0).toBe(0);
    });
  });
});
