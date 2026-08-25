import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { assetFileName, materializeTreeAssets } from "./asset-cache.js";
import { regionKey, type ElementTree } from "./element-types.js";
import { ProjectStore } from "./store.js";

const region = { x: 0, y: 0, w: 100, h: 80 };

async function fixture() {
  const store = new ProjectStore(mkdtempSync(join(tmpdir(), "rs-assets-")));
  const projectId = "20260818-asset1";
  store.writeDoc(projectId, {
    schemaVersion: "1",
    image: { fileName: "image.png", width: 100, height: 80, analyzedScale: 1, removedChrome: [] },
    regions: [{ id: "r", displayName: "区域", bounds: region, confidence: 1, scrollX: false, scrollY: false }],
    candidateLines: [], panels: [], updatedAt: new Date().toISOString(),
  });
  const image = await sharp({ create: { width: 100, height: 80, channels: 3, background: "#3578e5" } }).png().toBuffer();
  await sharp(image).toFile(store.cleanImagePath(projectId));
  return { store, projectId };
}

function tree(box = { x: 10, y: 12, w: 20, h: 18 }): ElementTree {
  return {
    regionKey: regionKey(region), detectedAt: "2026-08-18T00:00:00.000Z",
    nodes: [{ id: "picture", parentId: null, box, kind: "image", displayName: "图片", style: {}, uniformity: 1, source: "manual", classification: "human", scrollX: false, scrollY: false, positioning: "flow" }],
  };
}

describe("materializeTreeAssets", () => {
  it("reuses a crop for the same project and box", async () => {
    const { store, projectId } = await fixture();
    const first = await materializeTreeAssets(store, projectId, region, tree());
    const second = await materializeTreeAssets(store, projectId, region, first.tree);
    expect(second.files.picture).toBe(first.files.picture);
    expect(first.tree.nodes[0]!.asset?.ref).toBe(assetFileName(projectId, tree().nodes[0]!.box));
  });

  it("materializes a library icon as a reusable SVG", async () => {
    const { store, projectId } = await fixture();
    const iconTree = tree();
    iconTree.nodes[0] = {
      ...iconTree.nodes[0]!, kind: "icon", style: { color: "#3578e5" },
      iconDecision: {
        kind: "library", iconId: "mdi:home", query: "home", candidates: ["mdi:home"],
      },
    };
    const first = await materializeTreeAssets(store, projectId, region, iconTree);
    const second = await materializeTreeAssets(store, projectId, region, first.tree);
    const ref = first.tree.nodes[0]!.asset?.ref;
    expect(ref).toMatch(/\.svg$/);
    expect(second.tree.nodes[0]!.asset?.ref).toBe(ref);
    expect(first.tree.nodes[0]!.iconDecision).toMatchObject({
      kind: "library", sourceAssetRef: assetFileName(projectId, iconTree.nodes[0]!.box),
    });
    expect(readFileSync(first.files.picture!, "utf8")).toContain("<svg");
    expect(readFileSync(first.files.picture!, "utf8")).toContain("currentColor");
    expect(readFileSync(first.files.picture!, "utf8")).not.toContain("#3578e5");

    const originalRef = first.tree.nodes[0]!.iconDecision?.kind === "library"
      ? first.tree.nodes[0]!.iconDecision.sourceAssetRef : undefined;
    expect(originalRef).toBeTruthy();
    rmSync(join(store.assetsDir(projectId), originalRef!));
    await materializeTreeAssets(store, projectId, region, first.tree);
    expect(existsSync(join(store.assetsDir(projectId), originalRef!))).toBe(true);

    const moved = { ...first.tree, nodes: first.tree.nodes.map(node => ({ ...node, box: { ...node.box, x: node.box.x + 1 } })) };
    const rematerialized = await materializeTreeAssets(store, projectId, region, moved);
    expect(rematerialized.tree.nodes[0]!.iconDecision).toMatchObject({
      kind: "library", sourceAssetRef: assetFileName(projectId, moved.nodes[0]!.box),
    });
  });

  it("falls back to PNG when a persisted library icon no longer exists", async () => {
    const { store, projectId } = await fixture();
    const iconTree = tree();
    iconTree.nodes[0] = {
      ...iconTree.nodes[0]!, kind: "icon",
      iconDecision: { kind: "library", iconId: "mdi:not-a-real-icon", query: "missing", candidates: ["mdi:not-a-real-icon"] },
    };
    const result = await materializeTreeAssets(store, projectId, region, iconTree);
    expect(result.tree.nodes[0]!.asset?.ref).toMatch(/\.png$/);
  });

  it("keeps crop and ambiguous icons as PNG fallbacks", async () => {
    const { store, projectId } = await fixture();
    for (const iconDecision of [
      { kind: "crop" as const, assetRef: "", reason: "品牌图标" },
      { kind: "ambiguous" as const, query: "home", candidates: ["mdi:home"] },
    ]) {
      const iconTree = tree();
      iconTree.nodes[0] = { ...iconTree.nodes[0]!, kind: "icon", iconDecision };
      const result = await materializeTreeAssets(store, projectId, region, iconTree);
      expect(result.tree.nodes[0]!.asset?.ref).toMatch(/\.png$/);
    }
  });

  it("changes the reference after geometry changes", async () => {
    const { store, projectId } = await fixture();
    const first = await materializeTreeAssets(store, projectId, region, tree());
    const second = await materializeTreeAssets(store, projectId, region, tree({ x: 11, y: 12, w: 20, h: 18 }));
    expect(second.files.picture).not.toBe(first.files.picture);
  });

  it("rebuilds a deleted cache file from the original image", async () => {
    const { store, projectId } = await fixture();
    const first = await materializeTreeAssets(store, projectId, region, tree());
    const expected = readFileSync(first.files.picture!);
    rmSync(first.files.picture!);
    expect(existsSync(first.files.picture!)).toBe(false);
    const rebuilt = await materializeTreeAssets(store, projectId, region, first.tree);
    expect(readFileSync(rebuilt.files.picture!)).toEqual(expected);
  });
});
