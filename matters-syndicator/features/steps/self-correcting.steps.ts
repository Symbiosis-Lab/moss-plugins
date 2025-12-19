/**
 * Step definitions for self-correcting reference updates
 * Tests that image references are updated after download (or skip if already exists)
 */
import { loadFeature, describeFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import {
  setupMockTauri,
  type MockTauriContext,
} from "@symbiosis-lab/moss-api/testing";

const feature = await loadFeature("features/download/self-correcting.feature");

describeFeature(feature, ({ Scenario }) => {
  let ctx: MockTauriContext | null = null;
  const projectPath = "/test/project";
  let downloadResult: {
    filesProcessed: number;
    imagesDownloaded: number;
    imagesSkipped: number;
    errors: string[];
  } | null = null;

  // UUIDs used in tests
  const uuid1 = "82ba1757-adc9-4a37-b097-8edbf38e9b9f";
  const uuid2 = "12345678-1234-1234-1234-123456789abc";

  // ============================================================================
  // Scenario: Updates references when assets already exist
  // ============================================================================
  Scenario("Updates references when assets already exist", ({ Given, When, Then, And }) => {
    Given("a mock Tauri environment", () => {
      ctx = setupMockTauri();
      downloadResult = null;
      expect(ctx).toBeDefined();
    });

    And("an in-memory filesystem", () => {
      expect(ctx!.filesystem).toBeDefined();
    });

    And("a markdown file with remote image URLs", () => {
      const markdownContent = `---
title: "Test Article"
cover: "https://imagedelivery.net/xxx/prod/embed/${uuid1}/image.jpg/public"
---

Some text here.

![](https://assets.matters.news/embed/${uuid1}/image.jpg)
`;
      ctx!.filesystem.setFile(`${projectPath}/文章/test.md`, markdownContent);
    });

    And("the assets already exist locally", () => {
      // Asset already exists - simulating a previous download
      ctx!.filesystem.setFile(`${projectPath}/assets/${uuid1}.jpg`, "[binary image data]");
    });

    When("I run downloadMediaAndUpdate", async () => {
      const { downloadMediaAndUpdate } = await import("../../src/downloader");
      downloadResult = await downloadMediaAndUpdate(projectPath);
    });

    Then("no downloads should occur", () => {
      expect(ctx!.downloadTracker.completedDownloads.length).toBe(0);
    });

    And("all image references should be updated to local paths", () => {
      const content = ctx!.filesystem.getFile(`${projectPath}/文章/test.md`)?.content;
      expect(content).toBeDefined();
      // Cover should be updated to relative path
      expect(content).toContain(`cover: "../assets/${uuid1}.jpg"`);
      // Body image should be updated to relative path
      expect(content).toContain(`![](../assets/${uuid1}.jpg)`);
      // Should NOT contain remote URLs
      expect(content).not.toContain("https://assets.matters.news");
      expect(content).not.toContain("https://imagedelivery.net");
      ctx?.cleanup();
    });
  });

  // ============================================================================
  // Scenario: Downloads and updates in single pass
  // ============================================================================
  Scenario("Downloads and updates in single pass", ({ Given, When, Then, And }) => {
    Given("a mock Tauri environment", () => {
      ctx = setupMockTauri();
      downloadResult = null;
      expect(ctx).toBeDefined();
    });

    And("an in-memory filesystem", () => {
      expect(ctx!.filesystem).toBeDefined();
    });

    And("a markdown file with remote image URLs", () => {
      const markdownContent = `---
title: "Test Article"
---

![](https://assets.matters.news/embed/${uuid1}/image.jpg)
`;
      ctx!.filesystem.setFile(`${projectPath}/文章/test.md`, markdownContent);

      // Configure mock response for the download
      ctx!.urlConfig.setResponse(`https://assets.matters.news/embed/${uuid1}/image.jpg`, {
        status: 200,
        ok: true,
        contentType: "image/jpeg",
        bytesWritten: 1024,
        actualPath: `assets/${uuid1}.jpg`,
      });
    });

    And("no assets exist locally", () => {
      // No assets in the assets folder - fresh state
      expect(ctx!.filesystem.listFiles(`${projectPath}/assets/*`).length).toBe(0);
    });

    When("I run downloadMediaAndUpdate", async () => {
      const { downloadMediaAndUpdate } = await import("../../src/downloader");
      downloadResult = await downloadMediaAndUpdate(projectPath);
    });

    Then("all images should be downloaded", () => {
      expect(ctx!.downloadTracker.completedDownloads.length).toBe(1);
      expect(downloadResult!.imagesDownloaded).toBe(1);
    });

    And("all image references should be updated to local paths", () => {
      const content = ctx!.filesystem.getFile(`${projectPath}/文章/test.md`)?.content;
      expect(content).toBeDefined();
      expect(content).toContain(`![](../assets/${uuid1}.jpg)`);
      expect(content).not.toContain("https://assets.matters.news");
      ctx?.cleanup();
    });
  });

  // ============================================================================
  // Scenario: Resumes correctly after interruption
  // ============================================================================
  Scenario("Resumes correctly after interruption", ({ Given, When, Then, And }) => {
    Given("a mock Tauri environment", () => {
      ctx = setupMockTauri();
      downloadResult = null;
      expect(ctx).toBeDefined();
    });

    And("an in-memory filesystem", () => {
      expect(ctx!.filesystem).toBeDefined();
    });

    And("a markdown file with multiple remote image URLs", () => {
      const markdownContent = `---
title: "Test Article"
---

![](https://assets.matters.news/embed/${uuid1}/a.jpg)
![](https://assets.matters.news/embed/${uuid2}/b.jpg)
`;
      ctx!.filesystem.setFile(`${projectPath}/文章/test.md`, markdownContent);

      // Only configure response for uuid2 (uuid1 already exists)
      ctx!.urlConfig.setResponse(`https://assets.matters.news/embed/${uuid2}/b.jpg`, {
        status: 200,
        ok: true,
        contentType: "image/jpeg",
        bytesWritten: 1024,
        actualPath: `assets/${uuid2}.jpg`,
      });
    });

    And("some assets already exist locally", () => {
      // uuid1 already downloaded (simulating interrupted run)
      ctx!.filesystem.setFile(`${projectPath}/assets/${uuid1}.jpg`, "[binary image data]");
      // uuid2 not downloaded yet
    });

    When("I run downloadMediaAndUpdate", async () => {
      const { downloadMediaAndUpdate } = await import("../../src/downloader");
      downloadResult = await downloadMediaAndUpdate(projectPath);
    });

    Then("only missing assets should be downloaded", () => {
      // Only uuid2 should be downloaded
      expect(ctx!.downloadTracker.completedDownloads.length).toBe(1);
      expect(downloadResult!.imagesDownloaded).toBe(1);
    });

    And("all image references should be updated to local paths", () => {
      const content = ctx!.filesystem.getFile(`${projectPath}/文章/test.md`)?.content;
      expect(content).toBeDefined();
      expect(content).toContain(`![](../assets/${uuid1}.jpg)`);
      expect(content).toContain(`![](../assets/${uuid2}.jpg)`);
      expect(content).not.toContain("https://assets.matters.news");
      ctx?.cleanup();
    });
  });

  // ============================================================================
  // Scenario: Handles cross-CDN URLs with same UUID
  // ============================================================================
  Scenario("Handles cross-CDN URLs with same UUID", ({ Given, When, Then, And }) => {
    Given("a mock Tauri environment", () => {
      ctx = setupMockTauri();
      downloadResult = null;
      expect(ctx).toBeDefined();
    });

    And("an in-memory filesystem", () => {
      expect(ctx!.filesystem).toBeDefined();
    });

    And("a markdown file with cover and body images using different CDNs", () => {
      // Cover uses imagedelivery.net, body uses assets.matters.news
      const markdownContent = `---
title: "Test Article"
cover: "https://imagedelivery.net/kDRCweMmqLnTPNlbum-pYA/prod/embed/${uuid1}/image.jpg/public"
---

![](https://assets.matters.news/embed/${uuid1}/image.jpg)
`;
      ctx!.filesystem.setFile(`${projectPath}/文章/test.md`, markdownContent);

      // Configure response for one of the URLs (both have same UUID)
      ctx!.urlConfig.setResponse(`https://assets.matters.news/embed/${uuid1}/image.jpg`, {
        status: 200,
        ok: true,
        contentType: "image/jpeg",
        bytesWritten: 1024,
        actualPath: `assets/${uuid1}.jpg`,
      });
      ctx!.urlConfig.setResponse(`https://imagedelivery.net/kDRCweMmqLnTPNlbum-pYA/prod/embed/${uuid1}/image.jpg/public`, {
        status: 200,
        ok: true,
        contentType: "image/jpeg",
        bytesWritten: 1024,
        actualPath: `assets/${uuid1}.jpg`,
      });
    });

    And("both URLs contain the same UUID", () => {
      // This is already set up above - both URLs contain uuid1
    });

    When("I run downloadMediaAndUpdate", async () => {
      const { downloadMediaAndUpdate } = await import("../../src/downloader");
      downloadResult = await downloadMediaAndUpdate(projectPath);
    });

    Then("only one download should occur", () => {
      // Both URLs have the same UUID, so only one download should happen
      expect(ctx!.downloadTracker.completedDownloads.length).toBeLessThanOrEqual(1);
    });

    And("both cover and body references should point to the same local file", () => {
      const content = ctx!.filesystem.getFile(`${projectPath}/文章/test.md`)?.content;
      expect(content).toBeDefined();
      // Both should point to the same local path
      expect(content).toContain(`cover: "../assets/${uuid1}.jpg"`);
      expect(content).toContain(`![](../assets/${uuid1}.jpg)`);
      expect(content).not.toContain("https://imagedelivery.net");
      expect(content).not.toContain("https://assets.matters.news");
      ctx?.cleanup();
    });
  });

  // ============================================================================
  // Scenario: Idempotent operation
  // ============================================================================
  Scenario("Idempotent operation", ({ Given, When, Then, And }) => {
    let originalContent: string;

    Given("a mock Tauri environment", () => {
      ctx = setupMockTauri();
      downloadResult = null;
      expect(ctx).toBeDefined();
    });

    And("an in-memory filesystem", () => {
      expect(ctx!.filesystem).toBeDefined();
    });

    And("a markdown file with local image references", () => {
      const markdownContent = `---
title: "Test Article"
cover: "../assets/${uuid1}.jpg"
---

![](../assets/${uuid1}.jpg)
`;
      ctx!.filesystem.setFile(`${projectPath}/文章/test.md`, markdownContent);
      originalContent = markdownContent;
    });

    And("all assets exist locally", () => {
      ctx!.filesystem.setFile(`${projectPath}/assets/${uuid1}.jpg`, "[binary image data]");
    });

    When("I run downloadMediaAndUpdate twice", async () => {
      const { downloadMediaAndUpdate } = await import("../../src/downloader");
      await downloadMediaAndUpdate(projectPath);
      downloadResult = await downloadMediaAndUpdate(projectPath);
    });

    Then("no downloads should occur", () => {
      expect(ctx!.downloadTracker.completedDownloads.length).toBe(0);
    });

    And("the file should not be modified", () => {
      const content = ctx!.filesystem.getFile(`${projectPath}/文章/test.md`)?.content;
      expect(content).toBe(originalContent);
      ctx?.cleanup();
    });
  });
});
