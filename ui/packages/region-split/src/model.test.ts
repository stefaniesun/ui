import { describe, expect, it, vi } from "vitest";
import { createOpenAiModel } from "./model.js";
import type { ElementNode } from "./element-types.js";

function element(id: string, parentId: string | null = null): ElementNode {
  return {
    id, parentId, box: { x: 10, y: 20, w: 100, h: 80 }, kind: "component",
    displayName: id, style: {}, uniformity: 1, source: "auto", classification: "tool",
    scrollX: false, scrollY: false, positioning: "flow",
  };
}

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

describe("createOpenAiModel.refactorElements", () => {
  const candidate = JSON.stringify({
    subtree: { rootId: "new-root", nodes: [element("new-root")] },
    explanation: "补齐组件层级",
  });
  const input = {
    cropBase64: "CROP_ONLY",
    original: { rootId: "root", nodes: [element("root")] },
    current: { rootId: "root", nodes: [element("root"), element("child", "root")] },
    instruction: "为每个文字补充入口组件",
    history: [{ role: "user" as const, content: "这是入口列表" }],
    bounds: { x: 10, y: 20, w: 100, h: 80 },
  };

  it("sends the crop and complete constrained refactor context", async () => {
    const fetchImpl = fakeFetch(candidate);
    const model = createOpenAiModel(cfg(fetchImpl));
    await expect(model.refactorElements(input)).resolves.toMatchObject({ explanation: "补齐组件层级" });
    const body = String(vi.mocked(fetchImpl).mock.calls[0]![1]!.body);
    expect(body).toContain("data:image/png;base64,CROP_ONLY");
    const request = JSON.parse(body) as { messages: Array<{ content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }> };
    const system = String(request.messages[0]!.content);
    const parts = request.messages[1]!.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    const context = JSON.parse(parts.find(part => part.type === "text")!.text!);
    expect(context).toMatchObject({
      instruction: "为每个文字补充入口组件",
      bounds: input.bounds,
      original: input.original,
      current: input.current,
      history: input.history,
    });
    expect(system).toContain("single root");
    expect(system).toContain("validationFeedback");
    expect(parts.find(part => part.type === "image_url")!.image_url!.url)
      .toBe("data:image/png;base64,CROP_ONLY");
    expect(body).not.toContain("image.clean.png");
  });

  it("parses a fenced candidate response surrounded by prose with braces", async () => {
    const raw = "说明 {不是 JSON}\n```json\n" + candidate + "\n```\n不要输出 {示例}";
    const model = createOpenAiModel(cfg(fakeFetch(raw)));
    await expect(model.refactorElements(input)).resolves.toMatchObject({
      subtree: { rootId: "new-root" },
    });
  });

  it("labels validation feedback as errors that must be fixed", async () => {
    const fetchImpl = fakeFetch(candidate);
    const model = createOpenAiModel(cfg(fetchImpl));
    await model.refactorElements({
      ...input,
      validationFeedback: [{ code: "refactor.outside-scope", message: "node escapes bounds" }],
    });
    const body = JSON.parse(String(vi.mocked(fetchImpl).mock.calls[0]![1]!.body)) as {
      messages: Array<{ content: string | Array<{ type: string; text?: string }> }>;
    };
    const parts = body.messages[1]!.content as Array<{ type: string; text?: string }>;
    expect(JSON.parse(parts[0]!.text!).validationFeedback).toEqual([
      { code: "refactor.outside-scope", message: "node escapes bounds" },
    ]);
    expect(String(body.messages[0]!.content)).toContain("must fix");
  });

  it("throws a readable typed error for an invalid candidate", async () => {
    const model = createOpenAiModel(cfg(fakeFetch("not-json")));
    await expect(model.refactorElements(input)).rejects.toMatchObject({
      name: "ElementRefactorModelOutputError",
      message: expect.stringMatching(/unparsable/),
    });
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

describe("createOpenAiModel.classifyChildren", () => {
  const twoChildren = JSON.stringify({
    children: [
      { kind: "icon", displayName: "客服图标" },
      { kind: "text", displayName: "联系客服" },
    ],
  });

  it("returns one classification per child in reading order", async () => {
    const model = createOpenAiModel(cfg(fakeFetch(twoChildren)));
    const result = await model.classifyChildren({
      cropBase64: "AA", count: 2, direction: "column",
    });
    expect(result.children).toEqual([
      { kind: "icon", displayName: "客服图标" },
      { kind: "text", displayName: "联系客服" },
    ]);
    expect(result.whole).toBeNull();
  });

  // 模型的空间定位不可靠，所以永远不给它坐标——顺序由树提供
  it("never sends coordinates to the model", async () => {
    const fetchImpl = fakeFetch(JSON.stringify({
      children: [{ kind: "text", displayName: "标题" }],
    }));
    const model = createOpenAiModel(cfg(fetchImpl));
    await model.classifyChildren({ cropBase64: "AA", count: 1, direction: "row" });
    const body = String(vi.mocked(fetchImpl).mock.calls[0]![1]!.body);
    expect(body).not.toContain("坐标");
    expect(body).not.toMatch(/\\"(x|y|w|h)\\":/);
    expect(body).toContain("1 个并列子元素");
    expect(body).toContain("横排");
  });

  it("rejects a list whose length does not match the child count", async () => {
    const short = JSON.stringify({ children: [{ kind: "text", displayName: "只有一个" }] });
    const model = createOpenAiModel(cfg(fakeFetch(short, short)));
    await expect(model.classifyChildren({
      cropBase64: "AA", count: 3, direction: "row",
    })).rejects.toThrow(/count 3/);
  });

  it("retries once before giving up", async () => {
    const fetchImpl = fakeFetch(
      JSON.stringify({ children: [] }),
      JSON.stringify({ children: [{ kind: "icon", displayName: "图标" }] }),
    );
    const model = createOpenAiModel(cfg(fetchImpl));
    const result = await model.classifyChildren({
      cropBase64: "AA", count: 1, direction: "row",
    });
    expect(result.children).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects an unknown kind", async () => {
    const bad = JSON.stringify({ children: [{ kind: "button", displayName: "按钮" }] });
    const model = createOpenAiModel(cfg(fakeFetch(bad, bad)));
    await expect(model.classifyChildren({
      cropBase64: "AA", count: 1, direction: "row",
    })).rejects.toThrow();
  });
});
