import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import FormData from "form-data";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { ProjectStore } from "./store.js";
import { ModelConfigStore } from "./model-config.js";
import type { SegmentModel } from "./model.js";

const model = (overrides: Partial<SegmentModel> = {}): SegmentModel => ({
  segment: async () => [
    { displayName: "顶部", id: "top", type: "nav-bar", yStart: 0, yEnd: 100, confidence: 0.9 },
    { displayName: "内容", id: "body", type: "card", yStart: 100, yEnd: 400, confidence: 0.8 },
  ],
  nameRegion: async () => ({ displayName: "权益表", id: "benefits", type: "grid" }),
  ...overrides,
});

function makeApp(m: SegmentModel = model(), configured = true) {
  const root = mkdtempSync(join(tmpdir(), "rs-"));
  const store = new ProjectStore(join(root, "projects"));
  const configStore = new ModelConfigStore(join(root, "model-config.json"), {});
  if (configured) configStore.write({ baseUrl: "http://local/v1", model: "m", apiKey: "key12345678" });
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
        { id: "a", displayName: "上", type: "card", bounds: { x: 0, y: 0, w: 375, h: 150 }, confidence: 1 },
        { id: "b", displayName: "下", type: "card", bounds: { x: 0, y: 150, w: 375, h: 250 }, confidence: 1 },
      ] },
    });
    expect(ok.statusCode).toBe(200);
    const bad = await app.inject({
      method: "PUT", url: `/api/projects/${projectId}/regions`,
      payload: { regions: [
        { id: "a", displayName: "上", type: "card", bounds: { x: 0, y: 0, w: 375, h: 100 }, confidence: 1 },
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
    expect(res.json().doc.regions[1]).toMatchObject({ id: "benefits", displayName: "权益表", type: "grid" });
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
  it("reads and writes config without exposing the raw key", async () => {
    const { app } = makeApp(model(), false);
    expect((await app.inject({ method: "GET", url: "/api/model-config" })).json())
      .toEqual({ baseUrl: "", model: "", hasApiKey: false, apiKeyMask: "" });

    const saved = await app.inject({
      method: "PUT", url: "/api/model-config",
      payload: { baseUrl: "http://local/v1", model: "qwen-vl", apiKey: "sk-abcdefghijkl" },
    });
    expect(saved.json()).toEqual({
      baseUrl: "http://local/v1", model: "qwen-vl", hasApiKey: true, apiKeyMask: "sk-••••ijkl",
    });
    expect(JSON.stringify(saved.json())).not.toContain("abcdefgh");
  });

  it("keeps the stored key when the payload omits it", async () => {
    const { app, configStore } = makeApp(model(), false);
    await app.inject({
      method: "PUT", url: "/api/model-config",
      payload: { baseUrl: "http://a/v1", model: "m1", apiKey: "originalkey1" },
    });
    await app.inject({ method: "PUT", url: "/api/model-config", payload: { baseUrl: "http://b/v1", model: "m2" } });
    expect(configStore.read().apiKey).toBe("originalkey1");
  });

  it("reports a successful connection test", async () => {
    const { app } = makeApp();
    const res = await app.inject({
      method: "POST", url: "/api/model-config/test",
      payload: { baseUrl: "http://local/v1", model: "m" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("reports a failed connection test with 200 and a reason", async () => {
    const failing = model({ nameRegion: async () => { throw new Error("connect ECONNREFUSED"); } });
    const { app } = makeApp(failing);
    const res = await app.inject({
      method: "POST", url: "/api/model-config/test",
      payload: { baseUrl: "http://bad/v1", model: "m" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false, error: "connect ECONNREFUSED" });
  });

  it("falls back to the saved key only when the tested baseUrl matches the saved baseUrl", async () => {
    const seenConfigs: { baseUrl: string; apiKey: string }[] = [];
    const recordingModel = (): SegmentModel => ({
      segment: async () => [],
      nameRegion: async () => ({ displayName: "x", id: "x", type: "other" }),
    });
    const root = mkdtempSync(join(tmpdir(), "rs-"));
    const store = new ProjectStore(join(root, "projects"));
    const configStore = new ModelConfigStore(join(root, "model-config.json"), {});
    configStore.write({ baseUrl: "http://saved/v1", model: "saved-model", apiKey: "sk-savedkey123" });
    const app = buildServer({
      store, configStore,
      createModel: (config) => {
        seenConfigs.push({ baseUrl: config.baseUrl, apiKey: config.apiKey });
        return recordingModel();
      },
    });

    await app.inject({
      method: "POST", url: "/api/model-config/test",
      payload: { baseUrl: "http://saved/v1", model: "saved-model" },
    });
    expect(seenConfigs[0]).toEqual({ baseUrl: "http://saved/v1", apiKey: "sk-savedkey123" });

    await app.inject({
      method: "POST", url: "/api/model-config/test",
      payload: { baseUrl: "http://attacker.example/v1", model: "saved-model" },
    });
    expect(seenConfigs[1]).toEqual({ baseUrl: "http://attacker.example/v1", apiKey: "" });
  });
});
