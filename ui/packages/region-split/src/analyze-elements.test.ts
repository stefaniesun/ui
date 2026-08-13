import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { createProject } from "./analyze.js";
import { detectElements } from "./analyze-elements.js";
import { ProjectStore } from "./store.js";

async function seeded() {
  const store = new ProjectStore(mkdtempSync(join(tmpdir(), "rs-el-")));
  const buffer = await sharp({
    create: { width: 400, height: 300, channels: 3, background: "#f5f5f5" },
  }).composite([
    { input: { create: { width: 340, height: 140, channels: 3, background: "#ffffff" } }, top: 30, left: 30 },
  ]).png().toBuffer();
  const { projectId } = await createProject({ store }, { fileName: "s.png", buffer });
  return { store, projectId };
}

const REGION = { x: 0, y: 0, w: 400, h: 300 };

describe("detectElements", () => {
  it("produces and persists a tree", async () => {
    const { store, projectId } = await seeded();
    const tree = await detectElements({ store }, projectId, REGION);
    expect(tree.nodes).toHaveLength(1);
    expect(store.readElementTree(projectId, "0-300")!.nodes).toHaveLength(1);
  });

  it("re-detecting replaces the previous tree", async () => {
    const { store, projectId } = await seeded();
    await detectElements({ store }, projectId, REGION);
    await detectElements({ store }, projectId, REGION);
    expect(store.readElements(projectId).trees).toHaveLength(1);
  });

  it("refuses a region that is too small", async () => {
    const { store, projectId } = await seeded();
    await expect(detectElements({ store }, projectId, { x: 0, y: 0, w: 20, h: 20 }))
      .rejects.toThrow(/too small/);
  });
});
