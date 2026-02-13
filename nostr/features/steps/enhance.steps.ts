/**
 * Step definitions for enhance hook feature tests
 */

import { loadFeature, describeFeature } from "@amiceli/vitest-cucumber";
import { expect, vi } from "vitest";
import type { HookResult, Interaction, EnhanceContext } from "../../src/types";
import {
  createInteraction,
  createInteractions,
  createEnhanceContext,
} from "../../test-helpers/test-utils";
import {
  hasInteractionInjection,
  extractInteractionData,
  hasLoaderBeforeBodyEnd,
} from "../../src/__tests__/fixtures/html-samples";

const feature = await loadFeature("features/enhance/render-interactions.feature");

describeFeature(feature, ({ Scenario, Background }) => {
  // Mock filesystem for testing
  let mockFilesystem: Map<string, string>;
  let enhanceContext: EnhanceContext;
  let enhanceResult: HookResult;
  let interactions: Interaction[];
  let outputDir: string;
  let modifiedFiles: Set<string>;

  Background(({ Given }) => {
    Given("a mock Tauri environment", () => {
      mockFilesystem = new Map();
      interactions = [];
      outputDir = "/test/output";
      modifiedFiles = new Set();

      // Mock the file system operations
      vi.mock("@symbiosis-lab/moss-api", () => ({
        readFile: vi.fn().mockImplementation((path: string) => {
          const content = mockFilesystem.get(path);
          if (!content) throw new Error(`File not found: ${path}`);
          return Promise.resolve(content);
        }),
        writeFile: vi.fn().mockImplementation((path: string, content: string) => {
          mockFilesystem.set(path, content);
          modifiedFiles.add(path);
          return Promise.resolve();
        }),
        log: vi.fn(),
      }));
    });
  });

  Scenario("Inject interaction island into article page", ({ Given, When, Then, And }) => {
    Given(/an HTML file at "(.+)" with content:/, (path: string, content: string) => {
      mockFilesystem.set(`${outputDir}/${path}`, content);
    });

    And(/(\d+) interactions for target URL "(.+)"/, (count: string, targetUrl: string) => {
      interactions = createInteractions(targetUrl, parseInt(count));
    });

    When("the enhance hook runs", async () => {
      enhanceContext = createEnhanceContext(interactions, { output_dir: outputDir });
      const { enhance } = await import("../../src/main");
      enhanceResult = await enhance(enhanceContext);
    });

    Then(/the HTML should contain section with id "(.+)"/, (id: string) => {
      const html = mockFilesystem.get(`${outputDir}/posts/hello.html`);
      expect(html).toContain(`id="${id}"`);
    });

    And(/the HTML should contain script with id "(.+)"/, (id: string) => {
      const html = mockFilesystem.get(`${outputDir}/posts/hello.html`);
      expect(html).toContain(`id="${id}"`);
    });

    And(/the interactions JSON should contain (\d+) items/, (count: string) => {
      const html = mockFilesystem.get(`${outputDir}/posts/hello.html`) ?? "";
      const data = extractInteractionData(html);
      expect(data?.interactions).toHaveLength(parseInt(count));
    });

    And("the HTML should contain a noscript fallback", () => {
      const html = mockFilesystem.get(`${outputDir}/posts/hello.html`);
      expect(html).toContain("<noscript>");
    });

    And("the loader script should be before the closing body tag", () => {
      const html = mockFilesystem.get(`${outputDir}/posts/hello.html`) ?? "";
      expect(hasLoaderBeforeBodyEnd(html)).toBe(true);
    });
  });

  Scenario("Skip HTML files without article tag", ({ Given, When, Then }) => {
    let originalContent: string;

    Given(/an HTML file at "(.+)" with content:/, (path: string, content: string) => {
      originalContent = content;
      mockFilesystem.set(`${outputDir}/${path}`, content);
    });

    Given(/(\d+) interaction for target URL "(.+)"/, (count: string, targetUrl: string) => {
      interactions = createInteractions(targetUrl, parseInt(count));
    });

    When("the enhance hook runs", async () => {
      enhanceContext = createEnhanceContext(interactions, { output_dir: outputDir });
      const { enhance } = await import("../../src/main");
      enhanceResult = await enhance(enhanceContext);
    });

    Then("the HTML should remain unchanged", () => {
      const html = mockFilesystem.get(`${outputDir}/about.html`);
      expect(html).toBe(originalContent);
    });
  });

  Scenario("No interactions - skip all injection", ({ Given, When, Then }) => {
    Given(/an HTML file at "(.+)" with content:/, (path: string, content: string) => {
      mockFilesystem.set(`${outputDir}/${path}`, content);
    });

    And("no interactions", () => {
      interactions = [];
    });

    When("the enhance hook runs", async () => {
      enhanceContext = createEnhanceContext(interactions, { output_dir: outputDir });
      modifiedFiles.clear();
      const { enhance } = await import("../../src/main");
      enhanceResult = await enhance(enhanceContext);
    });

    Then("no files should be modified", () => {
      // Only asset files should be created, not HTML files
      const htmlModified = Array.from(modifiedFiles).filter((f) => f.endsWith(".html"));
      expect(htmlModified).toHaveLength(0);
    });
  });

  Scenario("Copy browser assets to output", ({ Given, When, Then, And }) => {
    Given(/an HTML file at "(.+)" with an article tag/, (path: string) => {
      mockFilesystem.set(
        `${outputDir}/${path}`,
        "<html><body><article><h1>Test</h1></article></body></html>"
      );
    });

    And(/(\d+) interaction for target URL "(.+)"/, (count: string, targetUrl: string) => {
      interactions = createInteractions(targetUrl, parseInt(count));
    });

    When("the enhance hook runs", async () => {
      enhanceContext = createEnhanceContext(interactions, { output_dir: outputDir });
      const { enhance } = await import("../../src/main");
      enhanceResult = await enhance(enhanceContext);
    });

    Then(/file "(.+)" should exist in output/, (path: string) => {
      expect(mockFilesystem.has(`${outputDir}/${path}`)).toBe(true);
    });
  });

  Scenario("Escape HTML in static fallback to prevent XSS", ({ Given, When, Then, And }) => {
    Given(/an HTML file at "(.+)" with an article tag/, (path: string) => {
      mockFilesystem.set(
        `${outputDir}/${path}`,
        "<html><body><article><h1>Test</h1></article></body></html>"
      );
    });

    And(/an interaction with content containing "(.+)"/, (content: string) => {
      interactions = [
        createInteraction({
          content: content,
          target_url: "posts/xss.html",
        }),
      ];
    });

    When("the enhance hook runs", async () => {
      enhanceContext = createEnhanceContext(interactions, { output_dir: outputDir });
      const { enhance } = await import("../../src/main");
      enhanceResult = await enhance(enhanceContext);
    });

    Then("the static fallback should contain escaped content", () => {
      const html = mockFilesystem.get(`${outputDir}/posts/xss.html`) ?? "";
      // Check that the noscript section has escaped content
      const noscriptMatch = html.match(/<noscript>([\s\S]*?)<\/noscript>/);
      expect(noscriptMatch).toBeTruthy();
      expect(noscriptMatch![1]).toContain("&lt;script&gt;");
    });

    And("the static fallback should not contain unescaped script tags", () => {
      const html = mockFilesystem.get(`${outputDir}/posts/xss.html`) ?? "";
      const noscriptMatch = html.match(/<noscript>([\s\S]*?)<\/noscript>/);
      // The noscript content shouldn't have raw script tags from user content
      expect(noscriptMatch![1]).not.toContain('<script>alert');
    });
  });

  Scenario("Group interactions by target URL", ({ Given, When, Then, And }) => {
    Given(/the following HTML files:/, (table: Array<{ path: string }>) => {
      table.forEach((row) => {
        mockFilesystem.set(
          `${outputDir}/${row.path}`,
          `<html><body><article><h1>${row.path}</h1></article></body></html>`
        );
      });
    });

    And(
      /interactions distributed as:/,
      (table: Array<{ target_url: string; count: string }>) => {
        interactions = [];
        table.forEach((row) => {
          const count = parseInt(row.count);
          for (let i = 0; i < count; i++) {
            interactions.push(
              createInteraction({
                id: `${row.target_url}-${i}`,
                target_url: row.target_url,
              })
            );
          }
        });
      }
    );

    When("the enhance hook runs", async () => {
      enhanceContext = createEnhanceContext(interactions, { output_dir: outputDir });
      const { enhance } = await import("../../src/main");
      enhanceResult = await enhance(enhanceContext);
    });

    Then(/"(.+)" should have (\d+) interactions injected/, (path: string, count: string) => {
      const html = mockFilesystem.get(`${outputDir}/${path}`) ?? "";
      const data = extractInteractionData(html);
      expect(data?.interactions).toHaveLength(parseInt(count));
    });

    And(/"(.+)" should remain unchanged/, (path: string) => {
      const html = mockFilesystem.get(`${outputDir}/${path}`) ?? "";
      expect(hasInteractionInjection(html)).toBe(false);
    });
  });

  Scenario("Render different interaction types in static fallback", ({ Given, When, Then, And }) => {
    Given(/an HTML file at "(.+)" with an article tag/, (path: string) => {
      mockFilesystem.set(
        `${outputDir}/${path}`,
        "<html><body><article><h1>Test</h1></article></body></html>"
      );
    });

    And(
      /the following interactions for "(.+)":/,
      (targetUrl: string, table: Array<{ type: string; count: string }>) => {
        interactions = [];
        table.forEach((row) => {
          const count = parseInt(row.count);
          for (let i = 0; i < count; i++) {
            interactions.push(
              createInteraction({
                id: `${row.type}-${i}`,
                interaction_type: row.type,
                target_url: targetUrl,
              })
            );
          }
        });
      }
    );

    When("the enhance hook runs", async () => {
      enhanceContext = createEnhanceContext(interactions, { output_dir: outputDir });
      const { enhance } = await import("../../src/main");
      enhanceResult = await enhance(enhanceContext);
    });

    Then("the static fallback should show like count", () => {
      const html = mockFilesystem.get(`${outputDir}/posts/mixed.html`) ?? "";
      // Check for like indicator in noscript
      expect(html).toMatch(/likes?/i);
    });

    And("the static fallback should list comments", () => {
      const html = mockFilesystem.get(`${outputDir}/posts/mixed.html`) ?? "";
      expect(html).toContain("comment");
    });

    And("the static fallback should show zap information", () => {
      const html = mockFilesystem.get(`${outputDir}/posts/mixed.html`) ?? "";
      // Zaps might be shown with lightning emoji or "zap" text
      expect(html.toLowerCase()).toMatch(/zap|⚡/);
    });
  });

  Scenario("Handle nested article tags correctly", ({ Given, When, Then, And }) => {
    Given(/an HTML file at "(.+)" with content:/, (path: string, content: string) => {
      mockFilesystem.set(`${outputDir}/${path}`, content);
    });

    And(/(\d+) interactions for target URL "(.+)"/, (count: string, targetUrl: string) => {
      interactions = createInteractions(targetUrl, parseInt(count));
    });

    When("the enhance hook runs", async () => {
      enhanceContext = createEnhanceContext(interactions, { output_dir: outputDir });
      const { enhance } = await import("../../src/main");
      enhanceResult = await enhance(enhanceContext);
    });

    Then("the interactions should be injected before the last closing article tag", () => {
      const html = mockFilesystem.get(`${outputDir}/posts/nested.html`) ?? "";
      // The interaction section should appear before the outermost </article>
      const interactionIndex = html.indexOf('id="nostr-interactions"');
      const lastArticleClose = html.lastIndexOf("</article>");
      expect(interactionIndex).toBeLessThan(lastArticleClose);
    });

    And("only one interaction section should exist", () => {
      const html = mockFilesystem.get(`${outputDir}/posts/nested.html`) ?? "";
      const matches = html.match(/id="nostr-interactions"/g);
      expect(matches).toHaveLength(1);
    });
  });

  Scenario("Preserve existing page scripts and styles", ({ Given, When, Then, And }) => {
    let originalScripts: string[];
    let originalStyles: string[];

    Given(/an HTML file at "(.+)" with content:/, (path: string, content: string) => {
      mockFilesystem.set(`${outputDir}/${path}`, content);
      // Extract original scripts and styles
      originalScripts = (content.match(/<script[^>]*src="[^"]+"/g) ?? []);
      originalStyles = (content.match(/<link[^>]*href="[^"]+"/g) ?? []);
    });

    And(/(\d+) interaction for target URL "(.+)"/, (count: string, targetUrl: string) => {
      interactions = createInteractions(targetUrl, parseInt(count));
    });

    When("the enhance hook runs", async () => {
      enhanceContext = createEnhanceContext(interactions, { output_dir: outputDir });
      const { enhance } = await import("../../src/main");
      enhanceResult = await enhance(enhanceContext);
    });

    Then("the original scripts should be preserved", () => {
      const html = mockFilesystem.get(`${outputDir}/posts/scripts.html`) ?? "";
      originalScripts.forEach((script) => {
        expect(html).toContain(script);
      });
    });

    And("the original stylesheets should be preserved", () => {
      const html = mockFilesystem.get(`${outputDir}/posts/scripts.html`) ?? "";
      originalStyles.forEach((style) => {
        expect(html).toContain(style);
      });
    });
  });
});
