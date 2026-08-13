import { existsSync } from "node:fs";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import sharp from "sharp";
import { InvalidImageError, analyzeProject, createProject, ensureCleanImage, renameRegionWithModel, retryRegionElementAnalysis, type DetectSurface } from "./analyze.js";
import type { SegmentModel } from "./model.js";
import type { ModelConfig, ModelConfigStore } from "./model-config.js";
import { RevisionConflictError, type ProjectStore } from "./store.js";
import { elementNodeSchema, regionElementAnalysisSchema, regionSchema, type Region } from "./types.js";
import { ProjectWriteCoordinator } from "./write-coordinator.js";

export interface ServerDeps {
  store: ProjectStore;
  configStore: ModelConfigStore;
  createModel: (config: ModelConfig) => SegmentModel;
  detectSurface?: DetectSurface;
}

type ProjectParams = { projectId: string };

// 1×1 透明 PNG，仅用于连通性测试
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ bodyLimit: 32 * 1024 * 1024 });
  const coordinator = new ProjectWriteCoordinator();
  app.register(multipart, { limits: { fileSize: 32 * 1024 * 1024 } });
  const { store, configStore } = deps;
  const currentModel = () => deps.createModel(configStore.read());

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

  app.put<{ Params: ProjectParams; Body: { expectedRevision: number; regions: Region[]; elements: unknown[]; elementAnalysis: Record<string, unknown> } }>(
    "/api/projects/:projectId/document", async (req, reply) => {
      const { projectId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      try {
        const regions = regionSchema.array().parse(req.body.regions);
        const elements = elementNodeSchema.array().parse(req.body.elements);
        const elementAnalysis = z.record(regionElementAnalysisSchema).parse(req.body.elementAnalysis);
        return { doc: await coordinator.run(projectId, () => store.writeEditable(projectId, { expectedRevision: req.body.expectedRevision, regions, elements, elementAnalysis })) };
      } catch (err) {
        if (err instanceof RevisionConflictError) return reply.code(409).send({ error: err.message, doc: err.latest });
        return reply.code(422).send({ error: (err as Error).message });
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

  app.post<{ Params: ProjectParams & { regionId: string }; Body: { expectedRevision: number; inputFingerprint: string } }>(
    "/api/projects/:projectId/regions/:regionId/analyze-elements", async (req, reply) => {
      const { projectId, regionId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      if (!configStore.isConfigured()) return reply.code(400).send({ error: "model not configured" });
      try {
        return { doc: await retryRegionElementAnalysis({ store, coordinator, model: currentModel() }, projectId, regionId, req.body.expectedRevision, req.body.inputFingerprint) };
      } catch (err) {
        if (err instanceof RevisionConflictError) return reply.code(409).send({ error: err.message, doc: err.latest });
        if ((err as Error).message === "region not found") return reply.code(404).send({ error: "region not found" });
        return reply.code(502).send({ error: (err as Error).message });
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
