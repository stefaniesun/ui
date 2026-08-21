import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import FormData from "form-data";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { ProjectStore } from "./store.js";
import { ModelConfigStore } from "./model-config.js";
import type { AiModel } from "./model.js";

const model = (overrides: Partial<AiModel> = {}): AiModel => ({
  segment: async () => [
    { displayName: "顶部", id: "top", yStart: 0, yEnd: 100, confidence: 0.9, scrollX: false, scrollY: false },
    { displayName: "内容", id: "body", yStart: 100, yEnd: 400, confidence: 0.8, scrollX: false, scrollY: false },
  ],
  nameRegion: async () => ({ displayName: "权益表", id: "benefits", type: "grid", scrollX: false, scrollY: false }),
  // 用抛错而不是返回空：这些用例不该走到分类逻辑，真走到了应该立刻炸出来
  decideIcon: async () => { throw new Error("unused"); },
  classifyChildren: async () => { throw new Error("unused"); },
  refactorElements: async () => { throw new Error("unused"); },
  ...overrides,
});

function makeApp(m: AiModel = model(), configured = true) {
  const root = mkdtempSync(join(tmpdir(), "rs-"));
  const store = new ProjectStore(join(root, "projects"));
  const configPath = join(root, "region-split.config.json");
  if (configured) {
    writeFileSync(configPath, JSON.stringify({ baseUrl: "http://local/v1", model: "m", apiKey: "key12345678" }), "utf8");
  }
  const configStore = new ModelConfigStore(configPath, {});
  return { app: buildServer({ store, configStore, createModel: () => m }), store, configStore };
}

async function upload(app: ReturnType<typeof buildServer>) {
  const buffer = await sharp({ create: { width: 375, height: 400, channels: 3, background: "#ffffff" } })
    .png().toBuffer();
  const form = new FormData();
  form.append("file", buffer, { filename: "shot.png", contentType: "image/png" });
  const res = await app.inject({ method: "POST", url: "/api/projects", payload: form, headers: form.getHeaders() });
  return res;
}

describe("region split server", () => {
  it("searches local icons with inline SVG previews", async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: "GET", url: "/api/icons/search?q=home&limit=3" });
    expect(response.statusCode).toBe(200);
    expect(response.json().candidates[0]).toMatchObject({ id: "mdi:home", name: "home" });
    expect(response.json().candidates[0].svg).toContain("<svg");
  });

  it("returns no candidates for an empty icon query", async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: "GET", url: "/api/icons/search?q=" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ candidates: [] });
  });

  it("creates a project from an uploaded image", async () => {
    const { app } = makeApp();
    const res = await upload(app);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.projectId).toMatch(/^\d{8}-[a-z0-9]{6}$/);
    expect(body.doc.regions).toHaveLength(1);
  });

  it("rejects an upload without a file", async () => {
    const { app } = makeApp();
    const form = new FormData();
    form.append("note", "no file here");
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: form, headers: form.getHeaders() });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a non-image upload with 400 and a readable message instead of crashing with 500", async () => {
    const { app } = makeApp();
    const form = new FormData();
    form.append("file", Buffer.from("not an image at all"), { filename: "note.txt", contentType: "text/plain" });
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: form, headers: form.getHeaders() });
    expect(res.statusCode).toBe(400);
    expect(typeof res.json().error).toBe("string");
    expect(res.json().error.length).toBeGreaterThan(0);
  });

  it("returns 404 for an unknown project", async () => {
    const { app } = makeApp();
    expect((await app.inject({ method: "GET", url: "/api/projects/20260811-aaaaaa" })).statusCode).toBe(404);
  });

  it("analyzes and then reads back the regions", async () => {
    const { app } = makeApp();
    const { projectId } = (await upload(app)).json();
    const analyzed = await app.inject({ method: "POST", url: `/api/projects/${projectId}/analyze` });
    expect(analyzed.statusCode).toBe(200);
    expect(analyzed.json().doc.regions.map((r: { id: string }) => r.id)).toEqual(["top", "body"]);
    const read = await app.inject({ method: "GET", url: `/api/projects/${projectId}` });
    expect(read.json().doc.regions).toHaveLength(2);
  });

  it("returns 502 when the model fails during analyze", async () => {
    const { app } = makeApp(model({ segment: async () => { throw new Error("llm down"); } }));
    const { projectId } = (await upload(app)).json();
    const res = await app.inject({ method: "POST", url: `/api/projects/${projectId}/analyze` });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/llm down/);
  });

  it("writes regions and rejects invariant violations with 422", async () => {
    const { app } = makeApp();
    const { projectId } = (await upload(app)).json();
    const ok = await app.inject({
      method: "PUT", url: `/api/projects/${projectId}/regions`,
      payload: { regions: [
        { id: "a", displayName: "上", bounds: { x: 0, y: 0, w: 375, h: 150 }, confidence: 1, scrollX: false, scrollY: false },
        { id: "b", displayName: "下", bounds: { x: 0, y: 150, w: 375, h: 250 }, confidence: 1, scrollX: false, scrollY: false },
      ] },
    });
    expect(ok.statusCode).toBe(200);
    const bad = await app.inject({
      method: "PUT", url: `/api/projects/${projectId}/regions`,
      payload: { regions: [
        { id: "a", displayName: "上", bounds: { x: 0, y: 0, w: 375, h: 100 }, confidence: 1, scrollX: false, scrollY: false },
      ] },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error).toMatch(/invariant violated/);
  });

  it("renames a region with the model", async () => {
    const { app } = makeApp();
    const { projectId } = (await upload(app)).json();
    await app.inject({ method: "POST", url: `/api/projects/${projectId}/analyze` });
    const res = await app.inject({ method: "POST", url: `/api/projects/${projectId}/regions/body/rename-ai` });
    expect(res.statusCode).toBe(200);
    expect(res.json().doc.regions[1]).toMatchObject({ id: "benefits", displayName: "权益表" });
    const missing = await app.inject({ method: "POST", url: `/api/projects/${projectId}/regions/ghost/rename-ai` });
    expect(missing.statusCode).toBe(404);
  });

  it("serves the image and a crop of it", async () => {
    const { app } = makeApp();
    const { projectId } = (await upload(app)).json();
    const full = await app.inject({ method: "GET", url: `/api/projects/${projectId}/image` });
    expect(full.statusCode).toBe(200);
    expect(full.headers["content-type"]).toBe("image/png");
    expect((await sharp(full.rawPayload).metadata()).height).toBe(400);
    const crop = await app.inject({ method: "GET", url: `/api/projects/${projectId}/image?rect=0,10,375,50` });
    expect((await sharp(crop.rawPayload).metadata()).height).toBe(50);
  });

  it("returns a whole-page outline and persists the three allowed corrections", async () => {
    const { app, store } = makeApp();
    const { projectId } = (await upload(app)).json();
    const doc = store.readDoc(projectId);
    const region = doc.regions[0]!;
    store.writeElementTree(projectId, {
      regionKey: "0-400", detectedAt: "now", nodes: [{
        id: "title", parentId: null, box: { x: 10, y: 10, w: 100, h: 30 }, kind: "text",
        displayName: "标题", text: "旧", style: {}, uniformity: 1, source: "auto", classification: "uncertain",
        scrollX: false, scrollY: false, positioning: "flow",
      }],
    }, region.bounds);
    const read = await app.inject({ method: "GET", url: `/api/projects/${projectId}/page-outline` });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ designWidth: 375, suspiciousCount: 1 });
    expect(read.json().elements[0]).toMatchObject({ id: "0-400::title", regionKey: "0-400", suspicious: true });

    const patched = await app.inject({
      method: "PATCH", url: `/api/projects/${projectId}/page-outline/${encodeURIComponent("0-400::title")}`,
      payload: { kind: "image", text: "新", box: { x: 12, y: 14, w: 110, h: 32 } },
    });
    expect(patched.statusCode).toBe(200);
    expect(store.readElementTree(projectId, "0-400")?.nodes[0]).toMatchObject({
      kind: "image", classification: "human", text: "新", box: { x: 12, y: 14, w: 110, h: 32 },
    });
  });

  it("exports a full page with separated files and globally unique classes", async () => {
    const { app, store } = makeApp();
    const { projectId } = (await upload(app)).json();
    const doc = store.readDoc(projectId);
    doc.regions = [
      { id: "a", displayName: "顶部", bounds: { x: 0, y: 0, w: 375, h: 200 }, confidence: 1, scrollX: false, scrollY: false },
      { id: "b", displayName: "底部", bounds: { x: 0, y: 200, w: 375, h: 200 }, confidence: 1, scrollX: false, scrollY: false },
    ];
    store.writeDoc(projectId, doc);
    for (const region of doc.regions) store.writeElementTree(projectId, {
      regionKey: `${region.bounds.y}-${region.bounds.y + region.bounds.h}`, detectedAt: "2026-08-18T00:00:00.000Z",
      nodes: [{ id: "same", parentId: null, box: region.bounds, kind: "text", displayName: region.displayName, text: region.displayName, style: {}, uniformity: 1, source: "manual", classification: "human", scrollX: false, scrollY: false, positioning: "flow" }],
    }, region.bounds);

    const response = await app.inject({ method: "GET", url: `/api/projects/${projectId}/page-code` });
    expect(response.statusCode).toBe(200);
    expect(response.json().html).toContain('<link rel="stylesheet" href="style.css">');
    expect(response.json().html).toContain('class="e-r0-same"');
    expect(response.json().html).toContain('class="e-r1-same"');
  });

  it("exports completed work and reports unresolved regions instead of blocking", async () => {
    const { app, store } = makeApp();
    const { projectId } = (await upload(app)).json();
    const doc = store.readDoc(projectId);
    doc.regions = [{ id: "a", displayName: "未解析区", bounds: { x: 0, y: 0, w: 375, h: 400 }, confidence: 1, scrollX: false, scrollY: false }];
    store.writeDoc(projectId, doc);
    const response = await app.inject({ method: "GET", url: `/api/projects/${projectId}/page-code` });
    expect(response.statusCode).toBe(200);
    expect(response.json().todos).toContain("解析区域 未解析区");
    expect(response.json().todos).toContain("选择目标平台字体");
  });

  it("materializes saved image crops and keeps generated region code self-contained", async () => {
    const { app, store } = makeApp();
    const { projectId } = (await upload(app)).json();
    const region = { x: 0, y: 0, w: 375, h: 400 };
    const saved = await app.inject({
      method: "PUT", url: `/api/projects/${projectId}/elements`, payload: { region, tree: {
        regionKey: "0-400",
        detectedAt: "2026-08-18T00:00:00.000Z",
        nodes: [
          { id: "avatar", parentId: null, box: { x: 20, y: 30, w: 40, h: 50 }, kind: "image", displayName: "头像", style: {}, uniformity: 0.5, source: "auto", classification: "model", scrollX: false, scrollY: false, positioning: "flow" },
          { id: "gear", parentId: null, box: { x: 100, y: 30, w: 24, h: 24 }, kind: "icon", displayName: "设置", style: {}, uniformity: 0.8, source: "auto", classification: "model", scrollX: false, scrollY: false, positioning: "flow" },
        ],
      } },
    });
    expect(saved.statusCode).toBe(200);

    const persisted = store.readElementTree(projectId, "0-400")!;
    expect(persisted.nodes[0]!.asset).toMatchObject({ cutFrom: { x: 20, y: 30, w: 40, h: 50 } });
    const ref = persisted.nodes[0]!.asset!.ref;
    const asset = await app.inject({ method: "GET", url: `/api/projects/${projectId}/assets/${ref}` });
    expect(asset.statusCode).toBe(200);
    expect(await sharp(asset.rawPayload).metadata()).toMatchObject({ width: 40, height: 50 });
  });

  it("serves the cleaned image by default and the untouched original on demand", async () => {
    const { app, store } = makeApp();
    const { projectId } = (await upload(app)).json();
    const clean = await app.inject({ method: "GET", url: `/api/projects/${projectId}/image` });
    const original = await app.inject({ method: "GET", url: `/api/projects/${projectId}/image?original=1` });
    expect(clean.statusCode).toBe(200);
    expect(original.statusCode).toBe(200);
    // 两者尺寸必须一致——预处理只重写像素，不改分辨率
    const [a, b] = [await sharp(clean.rawPayload).metadata(), await sharp(original.rawPayload).metadata()];
    expect([a.width, a.height]).toEqual([b.width, b.height]);
    expect(existsSync(store.cleanImagePath(projectId))).toBe(true);
    expect(existsSync(store.imagePath(projectId))).toBe(true);
  });

  it("rejects a malformed rect with 400", async () => {
    const { app } = makeApp();
    const { projectId } = (await upload(app)).json();
    for (const rect of ["abc", "0,10,375", "0,10,375,50,7"]) {
      const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/image?rect=${rect}` });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid rect");
    }
  });

  it("rejects a rect outside the image with 400", async () => {
    const { app } = makeApp();
    const { projectId } = (await upload(app)).json();
    // 图片是 375x400
    for (const rect of ["-1,0,10,10", "0,0,376,400", "0,300,375,200", "0,0,0,10"]) {
      const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/image?rect=${rect}` });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("rect out of bounds");
    }
  });

  it("refuses to analyze while the model is not configured", async () => {
    const { app } = makeApp(model(), false);
    const { projectId } = (await upload(app)).json();
    const res = await app.inject({ method: "POST", url: `/api/projects/${projectId}/analyze` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("model not configured");
  });
});

describe("model config routes", () => {
  it("exposes a read-only view that never contains the raw key", async () => {
    const { app } = makeApp(model(), false);
    const empty = (await app.inject({ method: "GET", url: "/api/model-config" })).json();
    expect(empty).toMatchObject({ baseUrl: "", model: "", hasApiKey: false });
    expect(typeof empty.configPath).toBe("string");

    const { app: configured } = makeApp();
    const view = (await configured.inject({ method: "GET", url: "/api/model-config" })).json();
    expect(view).toMatchObject({ baseUrl: "http://local/v1", model: "m", hasApiKey: true });
    expect(JSON.stringify(view)).not.toContain("key12345678");
  });

  it("offers no way to write the config over http", async () => {
    const { app } = makeApp();
    for (const method of ["PUT", "POST"] as const) {
      const res = await app.inject({
        method, url: "/api/model-config",
        payload: { baseUrl: "http://attacker/v1", model: "m", apiKey: "sk-injected" },
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it("checks connectivity using the server-side config only", async () => {
    const seen: { baseUrl: string; apiKey: string }[] = [];
    const root = mkdtempSync(join(tmpdir(), "rs-"));
    const store = new ProjectStore(join(root, "projects"));
    const configPath = join(root, "region-split.config.json");
    writeFileSync(configPath, JSON.stringify({
      baseUrl: "http://saved/v1", model: "saved-model", apiKey: "sk-savedkey123",
    }), "utf8");
    const app = buildServer({
      store,
      configStore: new ModelConfigStore(configPath, {}),
      createModel: config => {
        seen.push({ baseUrl: config.baseUrl, apiKey: config.apiKey });
        return model();
      },
    });

    const res = await app.inject({ method: "POST", url: "/api/model-config/check" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(seen).toEqual([{ baseUrl: "http://saved/v1", apiKey: "sk-savedkey123" }]);
  });

  it("ignores a request body on the connectivity check", async () => {
    const seen: string[] = [];
    const root = mkdtempSync(join(tmpdir(), "rs-"));
    const configPath = join(root, "region-split.config.json");
    writeFileSync(configPath, JSON.stringify({
      baseUrl: "http://saved/v1", model: "m", apiKey: "sk-savedkey123",
    }), "utf8");
    const app = buildServer({
      store: new ProjectStore(join(root, "projects")),
      configStore: new ModelConfigStore(configPath, {}),
      createModel: config => { seen.push(config.baseUrl); return model(); },
    });

    await app.inject({
      method: "POST", url: "/api/model-config/check",
      payload: { baseUrl: "http://attacker.example/v1", model: "m" },
    });
    // 请求体被完全忽略，永远用服务端自己的配置
    expect(seen).toEqual(["http://saved/v1"]);
  });

  it("reports a failed check with 200 and a reason", async () => {
    const { app } = makeApp(model({ nameRegion: async () => { throw new Error("connect ECONNREFUSED"); } }));
    const res = await app.inject({ method: "POST", url: "/api/model-config/check" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false, error: "connect ECONNREFUSED" });
  });

  it("reports not configured instead of calling the model", async () => {
    const { app } = makeApp(model(), false);
    expect((await app.inject({ method: "POST", url: "/api/model-config/check" })).json())
      .toEqual({ ok: false, error: "model not configured" });
  });
});

describe("element routes", () => {
  async function project() {
    const { app } = makeApp();
    const created = await upload(app);
    return { app, projectId: created.json().projectId as string };
  }
  const REGION = { x: 0, y: 0, w: 375, h: 400 };
  const node = (over: Record<string, unknown>) => ({
    parentId: null, kind: "component", displayName: "x", style: {},
    uniformity: 1, source: "manual", classification: "human",
    scrollX: false, scrollY: false, positioning: "flow", ...over,
  });

  it("does not expose per-region code generation", async () => {
    const { app, projectId } = await project();
    const response = await app.inject({ method: "GET", url: `/api/projects/${projectId}/code?y=0&h=400` });
    expect(response.statusCode).toBe(404);
  });

  it("persists a selected project font stack", async () => {
    const { app, projectId } = await project();
    const response = await app.inject({
      method: "PUT", url: `/api/projects/${projectId}/font-stack`,
      payload: { fontStack: "Arial, sans-serif" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().doc.fontStack).toBe("Arial, sans-serif");
  });

  it("lists which regions already have an element tree", async () => {
    const { app, projectId } = await project();
    await app.inject({ method: "POST", url: `/api/projects/${projectId}/elements/detect`, payload: { region: REGION } });
    const response = await app.inject({ method: "GET", url: `/api/projects/${projectId}/parsed-regions` });
    expect(response.statusCode).toBe(200);
    expect(response.json().regionKeys).toContain("0-400");
  });

  it("returns an empty parsed-region list for a project with no trees", async () => {
    const { app, projectId } = await project();
    const response = await app.inject({ method: "GET", url: `/api/projects/${projectId}/parsed-regions` });
    expect(response.statusCode).toBe(200);
    expect(response.json().regionKeys).toEqual([]);
  });

  it("returns null before detection", async () => {
    const { app, projectId } = await project();
    const res = await app.inject({
      method: "GET", url: `/api/projects/${projectId}/elements?y=0&h=400`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tree: null, treeVersion: null });
  });

  it("404s for an unknown project", async () => {
    const { app } = makeApp();
    const res = await app.inject({
      method: "POST", url: "/api/projects/ghost/elements/detect", payload: { region: REGION },
    });
    expect(res.statusCode).toBe(404);
  });

  it("detects and then reads back a tree", async () => {
    const { app, projectId } = await project();
    const detect = await app.inject({
      method: "POST", url: `/api/projects/${projectId}/elements/detect`, payload: { region: REGION },
    });
    expect(detect.statusCode).toBe(200);
    const read = await app.inject({
      method: "GET", url: `/api/projects/${projectId}/elements?y=0&h=400`,
    });
    expect(read.json().tree.regionKey).toBe("0-400");
    expect(read.json().treeVersion).toMatch(/^[a-f0-9]{64}$/);
  });

  // 检测是纯本地像素计算，不依赖模型配置
  it("detects without a configured model", async () => {
    const { app } = makeApp(undefined, false);
    const created = await upload(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${created.json().projectId}/elements/detect`,
      payload: { region: REGION },
    });
    expect(res.statusCode).toBe(200);
  });

  it("saves an edited tree", async () => {
    const { app, projectId } = await project();
    const res = await app.inject({
      method: "PUT", url: `/api/projects/${projectId}/elements`,
      payload: {
        region: REGION,
        tree: {
          regionKey: "0-400", detectedAt: "2026-08-13T00:00:00.000Z",
          nodes: [node({ id: "n1", box: { x: 0, y: 0, w: 50, h: 50 } })],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tree.nodes).toHaveLength(1);
  });

  it("422s a tree whose child escapes its parent", async () => {
    const { app, projectId } = await project();
    const res = await app.inject({
      method: "PUT", url: `/api/projects/${projectId}/elements`,
      payload: {
        region: REGION,
        tree: {
          regionKey: "0-400", detectedAt: "2026-08-13T00:00:00.000Z",
          nodes: [
            node({ id: "n1", box: { x: 0, y: 0, w: 50, h: 50 } }),
            node({ id: "n2", parentId: "n1", kind: "text", box: { x: 40, y: 0, w: 50, h: 50 } }),
          ],
        },
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it("400s a region smaller than the minimum", async () => {
    const { app, projectId } = await project();
    const res = await app.inject({
      method: "POST", url: `/api/projects/${projectId}/elements/detect`,
      payload: { region: { x: 0, y: 0, w: 10, h: 10 } },
    });
    expect(res.statusCode).toBe(400);
  });
});
