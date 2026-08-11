import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { analyzeProject, createProject, renameRegionWithModel } from "./analyze.js";
import { ProjectStore } from "./store.js";
import type { SegmentModel } from "./model.js";

const freshStore = () => new ProjectStore(mkdtempSync(join(tmpdir(), "rs-")));

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#ffffff" } }).png().toBuffer();
}

const model = (overrides: Partial<SegmentModel> = {}): SegmentModel => ({
  segment: async () => [
    { displayName: "顶部", id: "top", type: "nav-bar", yStart: 0, yEnd: 100, confidence: 0.9 },
    { displayName: "内容", id: "body", type: "card", yStart: 100, yEnd: 400, confidence: 0.8 },
  ],
  nameRegion: async () => ({ displayName: "权益表", id: "benefits", type: "grid" }),
  ...overrides,
});

describe("createProject", () => {
  it("stores the image and an initial full-page region", async () => {
    const store = freshStore();
    const { projectId, doc } = await createProject({ store }, { fileName: "shot.png", buffer: await png(375, 400) });
    expect(projectId).toMatch(/^\d{8}-[a-z0-9]{6}$/);
    expect(doc.image).toMatchObject({ width: 375, height: 400, analyzedScale: 1 });
    expect(doc.regions).toHaveLength(1);
    expect(doc.regions[0]!.bounds).toEqual({ x: 0, y: 0, w: 375, h: 400 });
    expect(doc.candidateLines).toEqual([]);
  });

  it("downscales tall images and records the scale", async () => {
    const store = freshStore();
    const { projectId, doc } = await createProject({ store }, { fileName: "long.png", buffer: await png(750, 5000) });
    expect(doc.image.height).toBe(5000);
    expect(doc.image.analyzedScale).toBeCloseTo(0.4, 5);
    expect((await sharp(store.analyzedImagePath(projectId)).metadata()).height).toBe(2000);
  });
});

describe("analyzeProject", () => {
  it("turns model segments into stored regions", async () => {
    const store = freshStore();
    const { projectId } = await createProject({ store }, { fileName: "s.png", buffer: await png(375, 400) });
    const doc = await analyzeProject({ store, model: model() }, projectId);
    expect(doc.regions.map(r => r.id)).toEqual(["top", "body"]);
    expect(doc.regions[1]!.bounds).toEqual({ x: 0, y: 100, w: 375, h: 300 });
    expect(store.readDoc(projectId).regions).toHaveLength(2);
  });

  it("stores detected candidate lines in original coordinates and snaps to them", async () => {
    const store = freshStore();
    const { projectId } = await createProject({ store }, { fileName: "s.png", buffer: await png(750, 5000) });
    const segment = vi.fn(async () => [
      { displayName: "顶部", id: "top", type: "nav-bar" as const, yStart: 0, yEnd: 40, confidence: 0.9 },
      { displayName: "内容", id: "body", type: "card" as const, yStart: 40, yEnd: 2000, confidence: 0.8 },
    ]);
    await analyzeProject(
      { store, model: model({ segment }), detectLines: async () => [{ y: 40, strength: 1 }] },
      projectId,
    );
    // 分析图 y=40 对应原图 y=100（analyzedScale = 0.4）
    const stored = store.readDoc(projectId);
    expect(stored.candidateLines).toEqual([{ y: 100, strength: 1 }]);
    expect(stored.regions[0]!.bounds.h).toBe(100);
  });

  it("keeps the existing document when the model fails", async () => {
    const store = freshStore();
    const { projectId } = await createProject({ store }, { fileName: "s.png", buffer: await png(375, 400) });
    const failing = model({ segment: async () => { throw new Error("llm down"); } });
    await expect(analyzeProject({ store, model: failing }, projectId)).rejects.toThrow(/llm down/);
    expect(store.readDoc(projectId).regions).toHaveLength(1);
  });
});

describe("renameRegionWithModel", () => {
  it("replaces name, id and type of one region", async () => {
    const store = freshStore();
    const { projectId } = await createProject({ store }, { fileName: "s.png", buffer: await png(375, 400) });
    await analyzeProject({ store, model: model() }, projectId);
    const doc = await renameRegionWithModel({ store, model: model() }, projectId, "body");
    expect(doc.regions[1]!).toMatchObject({ id: "benefits", displayName: "权益表", type: "grid" });
  });
});
