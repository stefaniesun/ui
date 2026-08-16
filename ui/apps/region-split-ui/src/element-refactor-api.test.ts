import { afterEach, describe, expect, it, vi } from "vitest";
import { elementRefactorApi } from "./element-refactor-api.js";

const region = { x: 0, y: 0, w: 100, h: 100 };
afterEach(() => vi.unstubAllGlobals());

describe("elementRefactorApi", () => {
  it("posts create, continue and apply payloads to their endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    await elementRefactorApi.createSession("p1", { region, rootId: "root", treeVersion: "v1", instruction: "重构" });
    await elementRefactorApi.sendMessage("p1", "s1", { candidateVersion: 1, instruction: "继续" });
    await elementRefactorApi.apply("p1", "s1", { candidateVersion: 2, treeVersion: "v1" });
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      "/api/projects/p1/elements/refactor-sessions",
      "/api/projects/p1/elements/refactor-sessions/s1/messages",
      "/api/projects/p1/elements/refactor-sessions/s1/apply",
    ]);
    expect(fetchMock.mock.calls.every(call => call[1].method === "POST")).toBe(true);
  });

  it("preserves structured API error details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "changed", code: "TREE_VERSION_CONFLICT", treeVersion: "v2" }) }));
    await expect(elementRefactorApi.createSession("p1", { region, rootId: "root", treeVersion: "v1", instruction: "重构" }))
      .rejects.toEqual(expect.objectContaining({ status: 409, code: "TREE_VERSION_CONFLICT", treeVersion: "v2" }));
  });
});
