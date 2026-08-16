import { describe, expect, it } from "vitest";
import { RefactorSessionStore } from "./element-refactor-session-store.js";
import type { RefactorSession } from "./element-refactor-session-store.js";

function input(): Omit<RefactorSession, "id" | "expiresAt"> {
  const node = { id: "root", parentId: null, box: { x: 0, y: 0, w: 10, h: 10 }, kind: "component" as const, displayName: "root", style: {}, uniformity: 1, source: "auto" as const, classification: "tool" as const, scrollX: false, scrollY: false, positioning: "flow" as const };
  return { projectId: "p1", region: node.box, rootId: "root", treeVersion: "v1", candidateVersion: 1, original: { rootId: "root", nodes: [node] }, candidate: { subtree: { rootId: "root", nodes: [node] }, explanation: "" }, history: [] };
}

describe("RefactorSessionStore", () => {
  it("creates, clones, refreshes and updates sessions", () => {
    let now = 100;
    const store = new RefactorSessionStore({ ttlMs: 50, now: () => now });
    const created = store.create(input());
    expect(created.id).toBeTruthy();
    expect(created.expiresAt).toBe(150);
    created.projectId = "mutated";
    now = 120;
    expect(store.get(created.id)!.projectId).toBe("p1");
    expect(store.get(created.id)!.expiresAt).toBe(170);
    const updated = store.update(created.id, current => ({ ...current, candidateVersion: 2 }));
    expect(updated.candidateVersion).toBe(2);
  });

  it("expires, prunes and deletes sessions", () => {
    let now = 0;
    const store = new RefactorSessionStore({ ttlMs: 10, now: () => now });
    const first = store.create(input());
    now = 11;
    expect(store.get(first.id)).toBeNull();
    const second = store.create(input());
    const third = store.create(input());
    now = 22;
    expect(store.pruneExpired()).toBe(2);
    expect(store.get(second.id)).toBeNull();
    store.delete(third.id);
  });

  it("rejects updating a missing session", () => {
    const store = new RefactorSessionStore();
    expect(() => store.update("missing", value => value)).toThrow(/not found/);
  });
});
