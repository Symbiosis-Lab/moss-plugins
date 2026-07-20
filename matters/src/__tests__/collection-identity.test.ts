/**
 * Collection identity — rename-proof sync for collections.
 *
 * Articles are deduped by identity (`syndicated:` URL → shortHash, found
 * anywhere in the project), but collections used to be deduped only by their
 * COMPUTED path (slugify(remote title)). Renaming a collection folder locally
 * made every subsequent sync re-create the old folder.
 *
 * These tests lock in the three-layer fix:
 * 1. Known-ID gate: a collection whose id is in config.knownCollectionIds was
 *    synced once already — never re-create it, wherever it went.
 * 2. Identity marker: newly created collection files carry their Matters
 *    collection URL in `syndicated:`, so future syncs can match them exactly
 *    (like articles) even after rename/move — and without any config state.
 * 3. Placement resolution: new member articles land in the collection's ACTUAL
 *    local folder (marker dir, else majority folder of local member articles),
 *    not in a re-created folder named after the remote title.
 */
// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupMockTauri, type MockTauriContext } from "@symbiosis-lab/moss-api/testing";
import { syncToLocalFiles, scanLocalArticles } from "../sync";
import { resetDomain } from "../domain";
import type {
  MattersArticle,
  MattersCollection,
  MattersUserProfile,
} from "../types";

const PROJECT = "/test/project";
const PLUGIN = "matters";
const COLLECTION_ID = "Q29sbGVjdGlvbjo0ODQx";
const COLLECTION_URL = `https://matters.town/@guo/collections/${COLLECTION_ID}`;

const profile: MattersUserProfile = {
  userName: "guo",
  displayName: "刘果",
  language: "zh_hans",
};

function makeArticle(overrides: Partial<MattersArticle>): MattersArticle {
  return {
    id: "a1",
    title: "下一代开放互联网",
    slug: "下一代开放互联网",
    shortHash: "vt5utvta7h49",
    content: "<p>body</p>",
    summary: "summary",
    createdAt: "2024-01-01T00:00:00Z",
    tags: [],
    ...overrides,
  };
}

function makeCollection(overrides: Partial<MattersCollection>): MattersCollection {
  return {
    id: COLLECTION_ID,
    title: "分布式信息网络",
    description: "去中心化网络中的博弈、设计和现实",
    articles: [
      {
        id: "a1",
        shortHash: "vt5utvta7h49",
        title: "下一代开放互联网",
        slug: "下一代开放互联网",
      },
    ],
    ...overrides,
  };
}

/** Seed an already-synced member article inside the RENAMED folder 文字/信息网络/. */
function seedRenamedCollectionState(ctx: MockTauriContext, homeWithMarker: boolean) {
  ctx.filesystem.setFile(
    `${PROJECT}/文字/信息网络/下一代开放互联网.md`,
    [
      "---",
      "title: 下一代开放互联网",
      "syndicated:",
      "- https://matters.town/@guo/下一代开放互联网-vt5utvta7h49",
      "---",
      "",
      "body",
    ].join("\n")
  );
  const markerLines = homeWithMarker
    ? ["syndicated:", `- ${COLLECTION_URL}`]
    : [];
  ctx.filesystem.setFile(
    `${PROJECT}/文字/信息网络/信息网络.md`,
    ["---", "is_collection: 'true'", ...markerLines, "---", "", "去中心化网络"].join("\n")
  );
}

/** Seed the plugin config with knownCollectionIds. */
function seedKnownIds(ctx: MockTauriContext, ids: string[]) {
  ctx.filesystem.setFile(
    `${PROJECT}/.moss/plugins/${PLUGIN}/config.json`,
    JSON.stringify({ userName: "guo", knownCollectionIds: ids })
  );
}

function syncArgs(
  articles: MattersArticle[],
  collections: MattersCollection[]
): Parameters<typeof syncToLocalFiles> {
  // homepageFile "刘果.md" → skip homepage generation (covered separately)
  return [articles, [], collections, "guo", {}, profile, "刘果.md", "刘果"];
}

describe("collection identity", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ projectPath: PROJECT, pluginName: PLUGIN });
    resetDomain();
  });

  afterEach(() => {
    ctx.cleanup();
    resetDomain();
  });

  describe("known-ID gate", () => {
    it("does not re-create a renamed collection whose id was synced before", async () => {
      seedRenamedCollectionState(ctx, false); // customized home, NO marker
      seedKnownIds(ctx, [COLLECTION_ID]);

      const { result } = await syncToLocalFiles(
        ...syncArgs([makeArticle({})], [makeCollection({})])
      );

      expect(
        ctx.filesystem.getFile(`${PROJECT}/文字/分布式信息网络/分布式信息网络.md`)
      ).toBeUndefined();
      expect(result.errors).toEqual([]);
    });

    it("still creates collections with unknown ids", async () => {
      seedRenamedCollectionState(ctx, false);
      seedKnownIds(ctx, ["Q29sbGVjdGlvbjo5OTk5"]); // some other collection

      await syncToLocalFiles(...syncArgs([makeArticle({})], [makeCollection({})]));

      expect(
        ctx.filesystem.getFile(`${PROJECT}/文字/分布式信息网络/分布式信息网络.md`)
      ).toBeDefined();
    });
  });

  describe("identity marker", () => {
    it("stamps new collection files with their Matters collection URL", async () => {
      seedRenamedCollectionState(ctx, false);
      // No known ids — collection is new from the plugin's point of view…
      // …but the folder was renamed, so it re-creates. The point here is the
      // created file must carry the identity marker for FUTURE syncs.
      await syncToLocalFiles(...syncArgs([makeArticle({})], [makeCollection({})]));

      const created = ctx.filesystem.getFile(
        `${PROJECT}/文字/分布式信息网络/分布式信息网络.md`
      );
      expect(created).toBeDefined();
      expect(created!.content).toContain(COLLECTION_URL);
    });

    it("does not re-create a collection whose marker exists under a renamed folder", async () => {
      seedRenamedCollectionState(ctx, true); // home carries the marker
      // NO knownCollectionIds config at all — marker alone must gate

      const { result } = await syncToLocalFiles(
        ...syncArgs([makeArticle({})], [makeCollection({})])
      );

      expect(
        ctx.filesystem.getFile(`${PROJECT}/文字/分布式信息网络/分布式信息网络.md`)
      ).toBeUndefined();
      expect(result.errors).toEqual([]);
    });
  });

  describe("placement of new member articles", () => {
    const newArticle = () =>
      makeArticle({
        id: "a2",
        title: "新文章",
        slug: "新文章",
        shortHash: "newhash12345",
      });
    const collectionWithNewMember = () =>
      makeCollection({
        articles: [
          { id: "a1", shortHash: "vt5utvta7h49", title: "下一代开放互联网", slug: "下一代开放互联网" },
          { id: "a2", shortHash: "newhash12345", title: "新文章", slug: "新文章" },
        ],
      });

    it("places a new member article into the marker-resolved folder", async () => {
      seedRenamedCollectionState(ctx, true);

      const { articlePathMap } = await syncToLocalFiles(
        ...syncArgs([makeArticle({}), newArticle()], [collectionWithNewMember()])
      );

      expect(ctx.filesystem.getFile(`${PROJECT}/文字/信息网络/新文章.md`)).toBeDefined();
      expect(
        ctx.filesystem.getFile(`${PROJECT}/文字/分布式信息网络/新文章.md`)
      ).toBeUndefined();
      expect(articlePathMap.get("newhash12345")).toBe("文字/信息网络/新文章.md");
    });

    it("places a new member article by majority folder of local members when no marker exists", async () => {
      seedRenamedCollectionState(ctx, false); // no marker
      seedKnownIds(ctx, [COLLECTION_ID]); // known → gate + member-majority placement

      await syncToLocalFiles(
        ...syncArgs([makeArticle({}), newArticle()], [collectionWithNewMember()])
      );

      expect(ctx.filesystem.getFile(`${PROJECT}/文字/信息网络/新文章.md`)).toBeDefined();
      expect(
        ctx.filesystem.getFile(`${PROJECT}/文字/分布式信息网络/新文章.md`)
      ).toBeUndefined();
    });

    it("does NOT let member-majority hijack a genuinely new collection", async () => {
      // Existing standalone article at the article-folder root, remote adds a
      // NEW collection containing it. The collection must be created at its
      // computed path; the local standalone stays put.
      ctx.filesystem.setFile(
        `${PROJECT}/文字/等等.md`,
        [
          "---",
          "title: 等等",
          "syndicated:",
          "- https://matters.town/@guo/等等-standalone99",
          "---",
          "",
          "body",
        ].join("\n")
      );

      await syncToLocalFiles(
        ...syncArgs(
          [makeArticle({ id: "a3", title: "等等", slug: "等等", shortHash: "standalone99" })],
          [
            makeCollection({
              id: "Q29sbGVjdGlvbjoxMjM0",
              title: "新合集",
              articles: [{ id: "a3", shortHash: "standalone99", title: "等等", slug: "等等" }],
            }),
          ]
        )
      );

      expect(ctx.filesystem.getFile(`${PROJECT}/文字/新合集/新合集.md`)).toBeDefined();
    });
  });

  describe("scanLocalArticles", () => {
    it("does not report collection marker files as articles", async () => {
      seedRenamedCollectionState(ctx, true);

      const articles = await scanLocalArticles();

      expect(articles).toHaveLength(1);
      expect(articles[0].shortHash).toBe("vt5utvta7h49");
      expect(articles[0].path).toBe("文字/信息网络/下一代开放互联网.md");
    });
  });

  describe("homepage pinned works", () => {
    it("links a pinned collection to its resolved local folder", async () => {
      seedRenamedCollectionState(ctx, true);

      await syncToLocalFiles(
        [makeArticle({})],
        [],
        [makeCollection({})],
        "guo",
        {},
        {
          ...profile,
          pinnedWorks: [
            { id: COLLECTION_ID, type: "collection", title: "分布式信息网络" },
          ],
        },
        null, // no homepage yet → generate one
        "刘果"
      );

      const home = ctx.filesystem.getFile(`${PROJECT}/刘果.md`);
      expect(home).toBeDefined();
      expect(home!.content).toContain("(/文字/信息网络/)");
      expect(home!.content).not.toContain("(/文字/分布式信息网络/)");
    });
  });
});
