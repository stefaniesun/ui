import { existsSync } from "node:fs";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import sharp from "sharp";
import { InvalidImageError, analyzeProject, createProject, ensureCleanImage, renameRegionWithModel, type DetectSurface } from "./analyze.js";
import { MIN_ANALYZABLE_SIZE, detectElements } from "./analyze-elements.js";
import { elementTreeSchema, regionKey } from "./element-types.js";
import { RefactorSessionStore } from "./element-refactor-session-store.js";
import { registerElementRefactorRoutes } from "./element-refactor-routes.js";
import { emitHtml } from "./emit-html.js";
import type { AiModel } from "./model.js";
import type { ModelConfig, ModelConfigStore } from "./model-config.js";
import type { ProjectStore } from "./store.js";
import type { Rect, Region } from "./types.js";

export interface ServerDeps {
  store: ProjectStore;
  configStore: ModelConfigStore;
  createModel: (config: ModelConfig) => AiModel;
  detectSurface?: DetectSurface;
  refactorSessions?: RefactorSessionStore;
}

type ProjectParams = { projectId: string };

// 1×1 透明 PNG，仅用于连通性测试
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ bodyLimit: 32 * 1024 * 1024 });
  app.register(multipart, { limits: { fileSize: 32 * 1024 * 1024 } });
  const { store, configStore } = deps;
  const currentModel = () => deps.createModel(configStore.read());
  const refactorSessions = deps.refactorSessions ?? new RefactorSessionStore();
  registerElementRefactorRoutes(app, { ...deps, sessions: refactorSessions });
  const pruneTimer = setInterval(() => refactorSessions.pruneExpired(), 5 * 60 * 1000);
  pruneTimer.unref();
  app.addHook("onClose", async () => clearInterval(pruneTimer));

  app.post("/api/projects", async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "file field is required" });
    const buffer = await file.toBuffer();
    try {
      const { projectId, doc } = await createProject(
        { store, detectSurface: deps.detectSurface }, { fileName: file.filename, buffer });
      return reply.code(201).send({ projectId, doc });
    } catch (err) {
      if (err instanceof InvalidImageError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get<{ Params: ProjectParams }>("/api/projects/:projectId", async (req, reply) => {
    const { projectId } = req.params;
    if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
    return { projectId, doc: store.readDoc(projectId) };
  });

  app.post<{ Params: ProjectParams }>("/api/projects/:projectId/analyze", async (req, reply) => {
    const { projectId } = req.params;
    if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
    if (!configStore.isConfigured()) return reply.code(400).send({ error: "model not configured" });
    try {
      return {
        doc: await analyzeProject({ store, model: currentModel(), detectSurface: deps.detectSurface }, projectId),
      };
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.put<{ Params: ProjectParams; Body: { regions: Region[] } }>(
    "/api/projects/:projectId/regions", async (req, reply) => {
      const { projectId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      try {
        return { doc: store.writeRegions(projectId, req.body.regions) };
      } catch (err) {
        return reply.code(422).send({ error: (err as Error).message });
      }
    });

  app.post<{ Params: ProjectParams & { regionId: string } }>(
    "/api/projects/:projectId/regions/:regionId/rename-ai", async (req, reply) => {
      const { projectId, regionId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      if (!configStore.isConfigured()) return reply.code(400).send({ error: "model not configured" });
      if (!store.readDoc(projectId).regions.some(region => region.id === regionId)) {
        return reply.code(404).send({ error: "region not found" });
      }
      try {
        return { doc: await renameRegionWithModel({ store, model: currentModel() }, projectId, regionId) };
      } catch (err) {
        return reply.code(502).send({ error: (err as Error).message });
      }
    });

  // 模型配置是只读的：改配置要编辑项目里的配置文件，服务不提供写入接口。
  // 前端只用它判断能否分析，以及在未配置时提示该去改哪个文件。
  app.get("/api/model-config", async () => configStore.view());

  // 连通性自检：用当前配置文件里的配置发一个最小请求。
  // 配置来自服务端自身，不接受请求体，所以不存在"把已存 Key 引到任意地址"的问题。
  app.post("/api/model-config/check", async () => {
    if (!configStore.isConfigured()) return { ok: false, error: "model not configured" };
    try {
      await currentModel().nameRegion({ cropBase64: TINY_PNG_BASE64 });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get<{ Params: ProjectParams; Querystring: { y?: string; h?: string } }>(
    "/api/projects/:projectId/elements", async (req, reply) => {
      const { projectId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      const y = Number(req.query.y);
      const h = Number(req.query.h);
      if (!Number.isInteger(y) || !Number.isInteger(h)) {
        return reply.code(400).send({ error: "invalid region" });
      }
      // 没解析过返回 null 而不是 404：这是正常状态，不是错误。
      // 键只由纵向跨度决定，x/w 传 0 是刻意的。
      const key = regionKey({ x: 0, y, w: 0, h });
      const tree = store.readElementTree(projectId, key);
      return { tree, treeVersion: tree ? store.readElementTreeVersion(projectId, key) : null };
    });

  app.get<{ Params: ProjectParams; Querystring: { y?: string; h?: string } }>(
    "/api/projects/:projectId/code", async (req, reply) => {
      const { projectId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      const y = Number(req.query.y);
      const h = Number(req.query.h);
      if (!Number.isInteger(y) || !Number.isInteger(h)) {
        return reply.code(400).send({ error: "invalid region" });
      }
      const region = { x: 0, y, w: store.readDoc(projectId).image.width, h };
      const tree = store.readElementTree(projectId, regionKey(region));
      if (!tree) return reply.code(404).send({ error: "region not parsed" });
      return emitHtml({ designWidth: region.w, region, tree });
    });

  app.post<{ Params: ProjectParams; Body: { region: Rect } }>(
    "/api/projects/:projectId/elements/detect", async (req, reply) => {
      const { projectId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      const region = req.body?.region;
      if (!region || region.w < MIN_ANALYZABLE_SIZE || region.h < MIN_ANALYZABLE_SIZE) {
        return reply.code(400).send({ error: "region is too small to analyse" });
      }
      // 层级、布局量、滚动全是纯本地像素计算，没配模型也照常产出；
      // 模型只负责叶子的文字/图标判别与命名，配了就用，失败会在内部降级。
      const model = configStore.isConfigured() ? currentModel() : undefined;
      try {
        return { tree: await detectElements({ store, model }, projectId, region) };
      } catch (err) {
        return reply.code(502).send({ error: (err as Error).message });
      }
    });

  app.put<{ Params: ProjectParams; Body: { region: Rect; tree: unknown } }>(
    "/api/projects/:projectId/elements", async (req, reply) => {
      const { projectId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      const parsed = elementTreeSchema.safeParse(req.body?.tree);
      if (!parsed.success || !req.body?.region) {
        return reply.code(422).send({ error: "invalid element tree" });
      }
      try {
        const tree = store.writeElementTree(projectId, parsed.data, req.body.region);
        return { tree, treeVersion: store.readElementTreeVersion(projectId, tree.regionKey) };
      } catch (err) {
        return reply.code(422).send({ error: (err as Error).message });
      }
    });

  app.get<{ Params: ProjectParams; Querystring: { rect?: string; original?: string } }>(
    "/api/projects/:projectId/image", async (req, reply) => {
      // 默认给清理后的图（界面和裁剪都该看不到系统外壳）；
      // ?original=1 取未经处理的原图，留给将来的像素比对用。
      // 老项目建的时候还没有预处理，这里按需补齐，避免取图 404。
      const { projectId } = req.params;
      if (req.query.original !== "1") await ensureCleanImage(store, projectId);
      const path = req.query.original === "1"
        ? store.imagePath(projectId)
        : store.cleanImagePath(projectId);
      if (!existsSync(path)) return reply.code(404).send({ error: "image not found" });
      let image = sharp(path);
      if (req.query.rect) {
        const parts = req.query.rect.split(",").map(Number);
        if (parts.length !== 4 || parts.some(value => !Number.isInteger(value))) {
          return reply.code(400).send({ error: "invalid rect" });
        }
        const [x, y, w, h] = parts as [number, number, number, number];
        const meta = await image.metadata();
        const withinImage =
          x >= 0 && y >= 0 && w > 0 && h > 0 &&
          x + w <= (meta.width ?? 0) && y + h <= (meta.height ?? 0);
        if (!withinImage) return reply.code(400).send({ error: "rect out of bounds" });
        image = image.extract({ left: x, top: y, width: w, height: h });
      }
      reply.type("image/png");
      return reply.send(await image.png().toBuffer());
    });

  return app;
}
