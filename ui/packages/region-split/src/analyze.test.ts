import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { InvalidImageError, analyzeProject, createProject, ensureCleanImage, renameRegionWithModel } from "./analyze.js";
import { ProjectStore } from "./store.js";
import type { SegmentModel } from "./model.js";

const freshRoot = () => mkdtempSync(join(tmpdir(), "rs-"));
const freshStore = () => new ProjectStore(freshRoot());

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#ffffff" } }).png().toBuffer();
}

const model = (overrides: Partial<SegmentModel> = {}): SegmentModel => ({
  segment: async () => [
    { displayName: "顶部", id: "top", type: "nav-bar", yStart: 0, yEnd: 100, confidence: 0.9, scrollX: false, scrollY: false },
    { displayName: "内容", id: "body", type: "card", yStart: 100, yEnd: 400, confidence: 0.8, scrollX: false, scrollY: false },
  ],
  nameRegion: async () => ({ displayName: "权益表", id: "benefits", type: "grid", scrollX: false, scrollY: false }),
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
    expect(doc.candidateLines).toEqual([]);   // 没传 detectLines 时为空
  });

  it("stores candidate lines and creates initial regions before model analysis", async () => {
    const store = freshStore();
    const { doc } = await createProject(
      { store, detectSurface: async () => ({ candidateLines: [
        { y: 40, strength: 0.8 },
        { y: 800, strength: 0.9 },
      ], panels: [] }) },
      { fileName: "long.png", buffer: await png(750, 5000) },
    );
    // 分析图坐标按 analyzedScale = 0.4 换回原图坐标。
    expect(doc.candidateLines).toEqual([
      { y: 100, strength: 0.8 },
      { y: 2000, strength: 0.9 },
    ]);
    // 距离边缘太近的 y=100 被过滤，内部强分隔线直接生成初始区域。
    expect(doc.regions.map(region => region.bounds)).toEqual([
      { x: 0, y: 0, w: 750, h: 2000 },
      { x: 0, y: 2000, w: 750, h: 3000 },
    ]);
  });

  it("downscales tall images and records the scale", async () => {
    const store = freshStore();
    const { projectId, doc } = await createProject({ store }, { fileName: "long.png", buffer: await png(750, 5000) });
    expect(doc.image.height).toBe(5000);
    expect(doc.image.analyzedScale).toBeCloseTo(0.4, 5);
    expect((await sharp(store.analyzedImagePath(projectId)).metadata()).height).toBe(2000);
  });

  it("rejects a non-image upload with a specific error and leaves no empty project directory", async () => {
    const root = freshRoot();
    const store = new ProjectStore(root);
    const notImage = Buffer.from("this is definitely not a png file");
    await expect(createProject({ store }, { fileName: "note.txt", buffer: notImage }))
      .rejects.toThrow(InvalidImageError);
    expect(readdirSync(root)).toEqual([]); // 校验失败前不应该建目录
  });
});

describe("ensureCleanImage", () => {
  it("backfills the clean image for projects created before preprocessing existed", async () => {
    const store = freshStore();
    const { projectId } = await createProject({ store }, { fileName: "s.png", buffer: await png(375, 400) });
    // 模拟老项目：删掉清理图，把分析图换回未处理的原图
    rmSync(store.cleanImagePath(projectId));
    writeFileSync(store.analyzedImagePath(projectId), readFileSync(store.imagePath(projectId)));
    expect(existsSync(store.cleanImagePath(projectId))).toBe(false);

    await ensureCleanImage(store, projectId);
    expect(existsSync(store.cleanImagePath(projectId))).toBe(true);
    // 补出来的图必须与原图同分辨率
    const meta = await sharp(store.cleanImagePath(projectId)).metadata();
    expect([meta.width, meta.height]).toEqual([375, 400]);
  });

  it("is idempotent — an existing clean image is left alone", async () => {
    const store = freshStore();
    const { projectId } = await createProject({ store }, { fileName: "s.png", buffer: await png(375, 400) });
    const before = readFileSync(store.cleanImagePath(projectId));
    await ensureCleanImage(store, projectId);
    expect(readFileSync(store.cleanImagePath(projectId)).equals(before)).toBe(true);
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
      { displayName: "顶部", id: "top", type: "nav-bar" as const, yStart: 0, yEnd: 40, confidence: 0.9, scrollX: false, scrollY: false },
      { displayName: "内容", id: "body", type: "card" as const, yStart: 40, yEnd: 2000, confidence: 0.8, scrollX: false, scrollY: false },
    ]);
    await analyzeProject(
      { store, model: model({ segment }), detectSurface: async () => ({ candidateLines: [{ y: 40, strength: 1 }], panels: [] }) },
      projectId,
    );
    // 分析图 y=40 对应原图 y=100（analyzedScale = 0.4）
    const stored = store.readDoc(projectId);
    expect(stored.candidateLines).toEqual([{ y: 100, strength: 1 }]);
    expect(stored.regions[0]!.bounds.h).toBe(100);
  });

  it("keeps the candidate lines computed at upload time when analyze is not given detectLines", async () => {
    const store = freshStore();
    const { projectId } = await createProject(
      { store, detectSurface: async () => ({ candidateLines: [{ y: 40, strength: 0.8 }], panels: [] }) },
      { fileName: "long.png", buffer: await png(750, 5000) },
    );
    const before = store.readDoc(projectId).candidateLines;
    expect(before).toEqual([{ y: 100, strength: 0.8 }]); // 上传时已按 analyzedScale=0.4 换算好
    expect(store.readDoc(projectId).regions).toHaveLength(1); // 过于靠近边缘，不作为初始分区线

    const doc = await analyzeProject({ store, model: model() }, projectId); // 不传 detectLines
    expect(doc.candidateLines).toEqual(before);
    expect(store.readDoc(projectId).candidateLines).toEqual(before);
  });

  // scrollX/scrollY 是给下游代码生成用的（横滑容器 / 内嵌滚动面板），
  // 必须原样从模型输出穿过 reconcile 落到存储里，不能在中途被丢掉。
  it("carries the model's scroll flags through to the stored regions", async () => {
    const store = freshStore();
    const { projectId } = await createProject({ store }, { fileName: "s.png", buffer: await png(375, 400) });
    const scrolling = model({
      segment: async () => [
        { displayName: "顶部", id: "top", type: "nav-bar", yStart: 0, yEnd: 100, confidence: 0.9,
          scrollX: false, scrollY: false },
        { displayName: "套餐横滑", id: "plans", type: "card", yStart: 100, yEnd: 400, confidence: 0.9,
          scrollX: true, scrollY: false },
      ],
    });
    const doc = await analyzeProject({ store, model: scrolling }, projectId);
    expect(doc.regions.map(r => [r.id, r.scrollX, r.scrollY]))
      .toEqual([["top", false, false], ["plans", true, false]]);
    expect(store.readDoc(projectId).regions[1]!.scrollX).toBe(true);
  });

  it("keeps the existing document when the model fails", async () => {
    const store = freshStore();
    const { projectId } = await createProject({ store }, { fileName: "s.png", buffer: await png(375, 400) });
    const failing = model({ segment: async () => { throw new Error("llm down"); } });
    await expect(analyzeProject({ store, model: failing }, projectId)).rejects.toThrow(/llm down/);
    expect(store.readDoc(projectId).regions).toHaveLength(1);
  });

  it("passes through the model-layer error message unchanged", async () => {
    const store = freshStore();
    const { projectId } = await createProject({ store }, { fileName: "s.png", buffer: await png(375, 400) });
    const failing = model({ segment: async () => { throw new Error("model http 500"); } });
    await expect(analyzeProject({ store, model: failing }, projectId)).rejects.toThrow("model http 500");
  });

  it("hides the filesystem path when the analyzed image cannot be read from disk", async () => {
    const store = freshStore();
    const { projectId } = await createProject({ store }, { fileName: "s.png", buffer: await png(375, 400) });
    rmSync(store.analyzedImagePath(projectId));
    const err: Error = await analyzeProject({ store, model: model() }, projectId).catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain(store.analyzedImagePath(projectId));
    expect(err.message).not.toMatch(/[a-zA-Z]:[\\/]/); // 不含盘符路径
    expect(err.message).not.toMatch(/\/tmp\//); // 不含 posix 绝对路径
    expect(err.message.length).toBeGreaterThan(0);
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

  it("hides the filesystem path when the source image cannot be read from disk", async () => {
    const store = freshStore();
    const { projectId } = await createProject({ store }, { fileName: "s.png", buffer: await png(375, 400) });
    await analyzeProject({ store, model: model() }, projectId);
    // 两张都删掉：只删清理图的话 ensureCleanImage 会从原图重建，读盘不会失败
    rmSync(store.cleanImagePath(projectId));
    rmSync(store.imagePath(projectId));
    const err: Error = await renameRegionWithModel({ store, model: model() }, projectId, "body").catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain(store.imagePath(projectId));
    expect(err.message).not.toMatch(/[a-zA-Z]:[\\/]/);
    expect(err.message).not.toMatch(/\/tmp\//);
    expect(err.message.length).toBeGreaterThan(0);
  });
});
