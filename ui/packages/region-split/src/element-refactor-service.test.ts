import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ElementNode, ElementTree } from "./element-types.js";
import { RefactorSessionStore } from "./element-refactor-session-store.js";
import { applyRefactorSession, createRefactorSession, continueRefactorSession, RefactorServiceError } from "./element-refactor-service.js";
import { hashElementTree } from "./element-subtree.js";
import { ProjectStore } from "./store.js";
import { ElementRefactorModelOutputError, type ElementRefactorModel } from "./element-refactor-model.js";

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
      references: [{ number: "1", id: "root", parentId: null, displayName: "root", kind: "component", box: region }, { number: "1.1", id: "child", parentId: "root", displayName: "child", kind: "text", box: { x: 10, y: 10, w: 40, h: 20 } }],
      cropBase64: expect.any(String),
      original: expect.objectContaining({ rootId: "root" }),
      current: expect.objectContaining({ rootId: "root" }),
      instruction: "重构",
    }));
  });

  it("numbers a nested refactor subtree from its selected root", async () => {
    const deps = await fixture();
    const tree = deps.store.readElementTree("p1", "0-100")!;
    const version = hashElementTree(tree);
    vi.mocked(deps.model.refactorElements).mockResolvedValueOnce({
      subtree: { rootId: "child", nodes: [node("child", "root")] }, explanation: "unchanged",
    });
    await createRefactorSession(deps, "p1", { region, rootId: "child", treeVersion: version, instruction: "重构子节点" });
    expect(deps.model.refactorElements).toHaveBeenCalledWith(expect.objectContaining({
      references: [{ number: "1", id: "child", parentId: "root", displayName: "child", kind: "text", box: { x: 10, y: 10, w: 40, h: 20 } }],
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

  it("rejects a crop that is not fully covered by the source image", async () => {
    const deps = await fixture();
    const oversized = originalTree();
    oversized.nodes[0] = { ...oversized.nodes[0]!, box: { x: 0, y: 0, w: 101, h: 100 } };
    oversized.nodes[1] = { ...oversized.nodes[1]!, box: { x: 10, y: 10, w: 40, h: 20 } };
    deps.store.writeElementTree("p1", oversized, { x: 0, y: 0, w: 101, h: 100 });
    await expect(createRefactorSession(deps, "p1", { region: { x: 0, y: 0, w: 101, h: 100 }, rootId: "root", treeVersion: hashElementTree(oversized), instruction: "越界" }))
      .rejects.toMatchObject({ code: "INVALID_SCOPE" });
  });

  it("rejects a late concurrent continuation instead of overwriting", async () => {
    const deps = await fixture();
    const tree = deps.store.readElementTree("p1", "0-100")!;
    const first = await createRefactorSession(deps, "p1", { region, rootId: "root", treeVersion: hashElementTree(tree), instruction: "首轮" });
    let resolveFirst!: (value: typeof deps.candidate) => void;
    let resolveSecond!: (value: typeof deps.candidate) => void;
    vi.mocked(deps.model.refactorElements)
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
    const slow = continueRefactorSession(deps, "p1", first.sessionId, { candidateVersion: 1, instruction: "慢" });
    await vi.waitFor(() => expect(resolveFirst).toBeTypeOf("function"));
    const fast = continueRefactorSession(deps, "p1", first.sessionId, { candidateVersion: 1, instruction: "快" });
    await vi.waitFor(() => expect(resolveSecond).toBeTypeOf("function"));
    resolveSecond(deps.candidate);
    await expect(fast).resolves.toMatchObject({ candidateVersion: 2 });
    resolveFirst(deps.candidate);
    await expect(slow).rejects.toMatchObject({ code: "CANDIDATE_VERSION_CONFLICT" });
  });

  it("repairs one typed model output error", async () => {
    const deps = await fixture();
    vi.mocked(deps.model.refactorElements)
      .mockRejectedValueOnce(new ElementRefactorModelOutputError("bad JSON"))
      .mockResolvedValueOnce(deps.candidate);
    const tree = deps.store.readElementTree("p1", "0-100")!;
    await expect(createRefactorSession(deps, "p1", { region, rootId: "root", treeVersion: hashElementTree(tree), instruction: "修复输出" }))
      .resolves.toMatchObject({ candidateVersion: 1 });
    expect(vi.mocked(deps.model.refactorElements).mock.calls[1]![0].validationFeedback)
      .toEqual([{ code: "refactor.model-output", message: "bad JSON" }]);
  });

  it("applies only the current candidate and deletes the session after success", async () => {
    const deps = await fixture();
    const tree = deps.store.readElementTree("p1", "0-100")!;
    const session = await createRefactorSession(deps, "p1", { region, rootId: "root", treeVersion: hashElementTree(tree), instruction: "应用" });
    expect(() => applyRefactorSession(deps, "p1", session.sessionId, { candidateVersion: 2, treeVersion: session.treeVersion }))
      .toThrowError(expect.objectContaining({ code: "CANDIDATE_VERSION_CONFLICT" }));
    expect(deps.sessions.peek(session.sessionId)).not.toBeNull();
    const applied = applyRefactorSession(deps, "p1", session.sessionId, { candidateVersion: 1, treeVersion: session.treeVersion });
    expect(applied.tree.nodes.map(item => item.id)).toEqual(["new-root"]);
    expect(deps.sessions.peek(session.sessionId)).toBeNull();
  });

  it("keeps the session when the tree changed before apply", async () => {
    const deps = await fixture();
    const tree = deps.store.readElementTree("p1", "0-100")!;
    const session = await createRefactorSession(deps, "p1", { region, rootId: "root", treeVersion: hashElementTree(tree), instruction: "应用" });
    deps.store.writeElementTree("p1", { ...tree, detectedAt: "changed" }, region);
    expect(() => applyRefactorSession(deps, "p1", session.sessionId, { candidateVersion: 1, treeVersion: session.treeVersion }))
      .toThrowError(expect.objectContaining({ code: "TREE_VERSION_CONFLICT" }));
    expect(deps.sessions.peek(session.sessionId)).not.toBeNull();
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
