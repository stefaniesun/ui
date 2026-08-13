import { describe, expect, it, vi } from "vitest";
import { createOpenAiModel } from "./model.js";

function fakeFetch(...contents: string[]) {
  const queue = contents.slice();
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: queue.shift() ?? "" } }] }),
  })) as unknown as typeof fetch;
}

const cfg = (fetchImpl: typeof fetch) =>
  ({ baseUrl: "http://local/v1", apiKey: "k", model: "m", fetchImpl });

const segmentsJson = JSON.stringify({
  regions: [
    { displayName: "状态栏", id: "status-bar", type: "status-bar", yStart: 0, yEnd: 44, confidence: 0.96, scrollX: false, scrollY: false },
    { displayName: "会员卡", id: "member-card", type: "card", yStart: 44, yEnd: 300, confidence: 0.88, scrollX: false, scrollY: false },
  ],
});

describe("createOpenAiModel.segment", () => {
  it("parses a plain json response", async () => {
    const model = createOpenAiModel(cfg(fakeFetch(segmentsJson)));
    const out = await model.segment({ imageBase64: "AA", width: 375, height: 600, candidateYs: [44, 300], panels: [] });
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({
      displayName: "会员卡", id: "member-card", type: "card", yStart: 44, yEnd: 300, confidence: 0.88, scrollX: false, scrollY: false,
    });
  });

  it("extracts json out of a fenced response", async () => {
    const fenced = "```json\n" + segmentsJson + "\n```";
    const model = createOpenAiModel(cfg(fakeFetch(fenced)));
    expect(await model.segment({ imageBase64: "AA", width: 375, height: 600, candidateYs: [], panels: [] })).toHaveLength(2);
  });

  it("retries once when the first response is unusable", async () => {
    const fetchImpl = fakeFetch("not json at all", segmentsJson);
    const model = createOpenAiModel(cfg(fetchImpl));
    expect(await model.segment({ imageBase64: "AA", width: 375, height: 600, candidateYs: [], panels: [] })).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws after the retry also fails", async () => {
    const model = createOpenAiModel(cfg(fakeFetch("nope", "still nope")));
    await expect(model.segment({ imageBase64: "AA", width: 375, height: 600, candidateYs: [], panels: [] }))
      .rejects.toThrow(/unparsable/);
  });

  it("throws on a non-2xx response without retrying", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const model = createOpenAiModel(cfg(fetchImpl));
    await expect(model.segment({ imageBase64: "AA", width: 375, height: 600, candidateYs: [], panels: [] }))
      .rejects.toThrow(/model http 500/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a response with an unknown region type", async () => {
    const bad = JSON.stringify({ regions: [{ displayName: "x", id: "x", type: "spaceship", yStart: 0, yEnd: 10, confidence: 1 }] });
    const model = createOpenAiModel(cfg(fakeFetch(bad, bad)));
    await expect(model.segment({ imageBase64: "AA", width: 375, height: 600, candidateYs: [], panels: [] })).rejects.toThrow();
  });

  it("times out and throws a readable error instead of hanging forever, without retrying", async () => {
    const fetchImpl = vi.fn((_url: unknown, init: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
    const model = createOpenAiModel({ ...cfg(fetchImpl), timeoutMs: 20 });
    await expect(model.segment({ imageBase64: "AA", width: 375, height: 600, candidateYs: [], panels: [] }))
      .rejects.toThrow(/model request timed out after 20ms/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("createOpenAiModel.analyzeElements", () => {
  it("parses a flat element tree", async () => {
    const json = JSON.stringify({ elements: [{ id: "hero", parentId: null, displayName: "首屏", type: "container", x: 0, y: 0, width: 100, height: 80, confidence: 0.9 }] });
    const model = createOpenAiModel(cfg(fakeFetch(json)));
    await expect(model.analyzeElements({ cropBase64: "AA", width: 100, height: 80, regionName: "首屏", regionType: "banner" })).resolves.toHaveLength(1);
  });
});

describe("createOpenAiModel.nameRegion", () => {
  it("parses a naming response", async () => {
    const json = JSON.stringify({ displayName: "权益对比表", id: "benefits-comparison", type: "grid" });
    const model = createOpenAiModel(cfg(fakeFetch(json)));
    // 模型没给滚动字段时补默认 false，老模型/老提示词的响应仍然可用
    expect(await model.nameRegion({ cropBase64: "BB" })).toEqual({
      displayName: "权益对比表", id: "benefits-comparison", type: "grid",
      scrollX: false, scrollY: false,
    });
  });

  it("keeps the scroll flags the model reports", async () => {
    const json = JSON.stringify({
      displayName: "套餐横滑", id: "plan-carousel", type: "card", scrollX: true, scrollY: false,
    });
    const model = createOpenAiModel(cfg(fakeFetch(json)));
    expect(await model.nameRegion({ cropBase64: "BB" })).toMatchObject({ scrollX: true, scrollY: false });
  });
});
