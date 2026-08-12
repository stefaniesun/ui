import { mkdtempSync, writeFileSync } from "node:fs";
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
