import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { ProjectStore } from "./store.js";
import { ModelConfigStore } from "./model-config.js";
import { hashElementTree } from "./element-subtree.js";
import type { AiModel } from "./model.js";
import type { ElementTree } from "./element-types.js";

async function fixture(configured = true) {
  const root = mkdtempSync(join(tmpdir(), "refactor-routes-"));
  const store = new ProjectStore(join(root, "projects"));
  const configPath = join(root, "config.json");
  if (configured) writeFileSync(configPath, JSON.stringify({ baseUrl: "http://local/v1", model: "m", apiKey: "key12345678" }));
  const configStore = new ModelConfigStore(configPath, {});
  mkdirSync(store.projectDir("p1"), { recursive: true });
  writeFileSync(store.imagePath("p1"), await sharp({ create: { width: 100, height: 100, channels: 3, background: "white" } }).png().toBuffer());
  store.writeDoc("p1", {
    schemaVersion: "1",
    image: { fileName: "x.png", width: 100, height: 100, analyzedScale: 1, removedChrome: [] },
    regions: [{ id: "r", displayName: "卡片", bounds: { x: 0, y: 0, w: 100, h: 100 }, confidence: 1, scrollX: false, scrollY: false }],
    candidateLines: [], panels: [], updatedAt: "now",
  });
  const node = { id: "root", parentId: null, box: { x: 0, y: 0, w: 100, h: 100 }, kind: "component" as const, displayName: "root", style: {}, uniformity: 1, source: "auto" as const, classification: "tool" as const, scrollX: false, scrollY: false, positioning: "flow" as const };
  const tree: ElementTree = { regionKey: "0-100", detectedAt: "now", nodes: [node] };
  store.writeElementTree("p1", tree, node.box);
  const model: AiModel = {
    segment: vi.fn(), nameRegion: vi.fn(), decideIcon: vi.fn(), classifyChildren: vi.fn(),
    refactorElements: vi.fn().mockResolvedValue({ subtree: { rootId: "new", nodes: [{ ...node, id: "new" }] }, explanation: "changed" }),
  };
  return { app: buildServer({ store, configStore, createModel: () => model }), tree, model };
}

describe("element refactor routes", () => {
  it("creates, continues and applies a candidate session", async () => {
    const { app, tree } = await fixture();
    const created = await app.inject({ method: "POST", url: "/api/projects/p1/elements/refactor-sessions", payload: { region: { x: 0, y: 0, w: 100, h: 100 }, rootId: "root", treeVersion: hashElementTree(tree), instruction: "重构" } });
    expect(created.statusCode).toBe(200);
    const first = created.json();
    const continued = await app.inject({ method: "POST", url: `/api/projects/p1/elements/refactor-sessions/${first.sessionId}/messages`, payload: { candidateVersion: 1, instruction: "继续" } });
    expect(continued.json().candidateVersion).toBe(2);
    const applied = await app.inject({ method: "POST", url: `/api/projects/p1/elements/refactor-sessions/${first.sessionId}/apply`, payload: { candidateVersion: 2, treeVersion: first.treeVersion } });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().tree.nodes[0].id).toBe("new");
    await app.close();
  });

  it("maps request, configuration, not-found and conflict errors", async () => {
    const unconfigured = await fixture(false);
    expect((await unconfigured.app.inject({ method: "POST", url: "/api/projects/p1/elements/refactor-sessions", payload: {} })).statusCode).toBe(400);
    await unconfigured.app.close();
    const { app, tree } = await fixture();
    expect((await app.inject({ method: "POST", url: "/api/projects/missing/elements/refactor-sessions", payload: {} })).statusCode).toBe(404);
    const stale = await app.inject({ method: "POST", url: "/api/projects/p1/elements/refactor-sessions", payload: { region: { x: 0, y: 0, w: 100, h: 100 }, rootId: "root", treeVersion: "stale", instruction: "重构" } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("TREE_VERSION_CONFLICT");
    const invalid = await app.inject({ method: "POST", url: "/api/projects/p1/elements/refactor-sessions", payload: { treeVersion: hashElementTree(tree) } });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });
});
