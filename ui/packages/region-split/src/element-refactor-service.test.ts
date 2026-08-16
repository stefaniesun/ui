import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ElementNode, ElementTree } from "./element-types.js";
import { RefactorSessionStore } from "./element-refactor-session-store.js";
import { createRefactorSession, continueRefactorSession, RefactorServiceError } from "./element-refactor-service.js";
import { hashElementTree } from "./element-subtree.js";
import { ProjectStore } from "./store.js";
import type { ElementRefactorModel } from "./element-refactor-model.js";

const region = { x: 0, y: 0, w: 100, h: 100 };
function node(id: string, parentId: string | null = null): ElementNode {
  return { id, parentId, box: parentId ? { x: 10, y: 10, w: 40, h: 20 } : region, kind: parentId ? "text" : "component", displayName: id, style: {}, uniformity: 1, source: "auto", classification: "tool", scrollX: false, scrollY: false, positioning: "flow" };
}
const originalTree = (): ElementTree => ({ regionKey: "0-100", detectedAt: "now", nodes: [node("root"), node("child", "root")] });

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "refactor-service-"));
  const store = new ProjectStore(dir);
  mkdirSync(store.projectDir("p1"), { recursive: true });
  writeFileSync(store.imagePath("p1"), await sharp({ create: { width: 100, height: 100, channels: 3, background: "white" } }).png().toBuffer());
  store.writeElementTree("p1", originalTree(), region);
  const candidate = { subtree: { rootId: "new-root", nodes: [{ ...node("new-root"), displayName: "new" }] }, explanation: "changed" };
  const model: ElementRefactorModel = { refactorElements: vi.fn().mockResolvedValue(candidate) };
  return { store, model, sessions: new RefactorSessionStore(), candidate };
}

describe("element refactor service", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("rejects stale tree versions before calling the model", async () => {
    const deps = await fixture();
    await expect(createRefactorSession(deps, "p1", { region, rootId: "root", treeVersion: "stale", instruction: "重构" }))
      .rejects.toMatchObject({ code: "TREE_VERSION_CONFLICT" });
    expect(deps.model.refactorElements).not.toHaveBeenCalled();
  });

  it("creates a validated versioned candidate using the cropped scope", async () => {
    const deps = await fixture();
    const tree = deps.store.readElementTree("p1", "0-100")!;
    const result = await createRefactorSession(deps, "p1", { region, rootId: "root", treeVersion: hashElementTree(tree), instruction: "重构" });
    expect(result).toMatchObject({ candidateVersion: 1, candidate: { rootId: "new-root" } });
    expect(deps.model.refactorElements).toHaveBeenCalledWith(expect.objectContaining({
      cropBase64: expect.any(String),
      original: expect.objectContaining({ rootId: "root" }),
      current: expect.objectContaining({ rootId: "root" }),
      instruction: "重构",
    }));
  });

  it("continues from the previous candidate and rejects stale candidate versions", async () => {
    const deps = await fixture();
    const tree = deps.store.readElementTree("p1", "0-100")!;
    const first = await createRefactorSession(deps, "p1", { region, rootId: "root", treeVersion: hashElementTree(tree), instruction: "首轮" });
    const second = await continueRefactorSession(deps, "p1", first.sessionId, { candidateVersion: 1, instruction: "继续" });
    expect(second.candidateVersion).toBe(2);
    expect(deps.model.refactorElements).toHaveBeenLastCalledWith(expect.objectContaining({ current: deps.candidate.subtree, history: expect.any(Array) }));
    await expect(continueRefactorSession(deps, "p1", first.sessionId, { candidateVersion: 1, instruction: "过期" }))
      .rejects.toMatchObject({ code: "CANDIDATE_VERSION_CONFLICT" });
  });

  it("repairs one invalid candidate and preserves the previous candidate if repair fails", async () => {
    const deps = await fixture();
    const invalid = { subtree: { rootId: "bad", nodes: [{ ...node("bad"), box: { x: -1, y: 0, w: 101, h: 100 } }] }, explanation: "bad" };
    vi.mocked(deps.model.refactorElements).mockResolvedValueOnce(invalid).mockResolvedValueOnce(deps.candidate);
    const tree = deps.store.readElementTree("p1", "0-100")!;
    await createRefactorSession(deps, "p1", { region, rootId: "root", treeVersion: hashElementTree(tree), instruction: "修复" });
    expect(deps.model.refactorElements).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.model.refactorElements).mock.calls[1]![0].validationFeedback).toBeTruthy();

    const broken = await fixture();
    vi.mocked(broken.model.refactorElements).mockResolvedValue(invalid);
    await expect(createRefactorSession(broken, "p1", { region, rootId: "root", treeVersion: hashElementTree(broken.store.readElementTree("p1", "0-100")!), instruction: "失败" }))
      .rejects.toBeInstanceOf(RefactorServiceError);
  });
});
