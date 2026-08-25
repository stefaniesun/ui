import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import sharp from "sharp";
import { InvalidImageError, analyzeProject, createProject, ensureCleanImage, renameRegionWithModel, type DetectSurface } from "./analyze.js";
import { MIN_ANALYZABLE_SIZE, detectElements } from "./analyze-elements.js";
import { analysisStats } from "./analysis-stats.js";
import { materializeTreeAssets } from "./asset-cache.js";
import { elementTreeSchema, regionKey } from "./element-types.js";
import { buildPageOutline, pageElementPatchSchema, parsePageElementId, patchElementTree } from "./page-outline.js";
import { iconById, iconToSvg, searchIcons } from "./icon-library.js";
import { RefactorSessionStore } from "./element-refactor-session-store.js";
import { registerElementRefactorRoutes } from "./element-refactor-routes.js";
import { emitPage } from "./emit-page.js";
import type { AiModel } from "./model.js";
import type { ModelConfig, ModelConfigStore } from "./model-config.js";
import type { ProjectStore } from "./store.js";
import type { Rect, Region } from "./types.js";
import { createZip } from "./zip.js";

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
  const pageOutlineFailures = new Map<string, Record<string, string>>();
  const detectAllRuns = new Map<string, Promise<{
    total: number; completed: number; skipped: number; failed: number; failedRegionKeys: string[];
  }>>();
  const refactorSessions = deps.refactorSessions ?? new RefactorSessionStore();
  registerElementRefactorRoutes(app, { ...deps, sessions: refactorSessions });

  app.get<{ Querystring: { q?: string; limit?: string } }>("/api/icons/search", async req => {
    const query = req.query.q?.trim() ?? "";
    const parsedLimit = Number.parseInt(req.query.limit ?? "8", 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(30, Math.max(1, parsedLimit)) : 8;
    const candidates = searchIcons(query, limit).flatMap(candidate => {
      const icon = iconById(candidate.id);
      return icon ? [{ ...candidate, svg: iconToSvg(icon) }] : [];
    });
    return { candidates };
  });
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

  app.put<{ Params: ProjectParams; Body: { fontStack?: unknown } }>(
    "/api/projects/:projectId/font-stack", async (req, reply) => {
      const { projectId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      const fontStack = typeof req.body?.fontStack === "string" ? req.body.fontStack.trim() : "";
      if (!fontStack) return reply.code(400).send({ error: "fontStack is required" });
      const doc = { ...store.readDoc(projectId), fontStack, updatedAt: new Date().toISOString() };
      store.writeDoc(projectId, doc);
      return { doc };
    });

  app.get<{ Params: ProjectParams }>(
    "/api/projects/:projectId/analysis-stats", async (req, reply) => {
      const { projectId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      const doc = store.readDoc(projectId);
      return analysisStats(doc.regions, store.readElements(projectId).trees, doc.fontStack);
    });

  app.get<{ Params: ProjectParams }>(
    "/api/projects/:projectId/parsed-regions", async (req, reply) => {
      const { projectId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      return { regionKeys: store.readElements(projectId).trees.map(tree => tree.regionKey) };
    });

  app.get<{ Params: ProjectParams }>(
    "/api/projects/:projectId/page-outline", async (req, reply) => {
      const { projectId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      const doc = store.readDoc(projectId);
      const trees = [];
      for (const tree of store.readElements(projectId).trees) {
        const region = doc.regions.find(item => regionKey(item.bounds) === tree.regionKey);
        if (!region) continue;
        try {
          trees.push((await materializeTreeAssets(store, projectId, region.bounds, tree)).tree);
        } catch {
          trees.push(tree);
        }
      }
      return buildPageOutline(doc, trees, pageOutlineFailures.get(projectId));
    });

  app.patch<{ Params: ProjectParams & { elementId: string }; Body: unknown }>(
    "/api/projects/:projectId/page-outline/:elementId", async (req, reply) => {
      const { projectId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      const identity = parsePageElementId(req.params.elementId);
      const patch = pageElementPatchSchema.safeParse(req.body);
      if (!identity || !patch.success) return reply.code(422).send({ error: "invalid element patch" });
      const doc = store.readDoc(projectId);
      const region = doc.regions.find(item => regionKey(item.bounds) === identity.regionKey);
      const tree = store.readElementTree(projectId, identity.regionKey);
      if (!region || !tree) return reply.code(404).send({ error: "element not found" });
      try {
        const next = patchElementTree(tree, region.bounds, identity.localId, patch.data);
        store.writeElementTree(projectId, next, region.bounds);
        const materialized = await materializeTreeAssets(store, projectId, region.bounds, next);
        const trees = store.readElements(projectId).trees.map(item => item.regionKey === materialized.tree.regionKey ? materialized.tree : item);
        return buildPageOutline(doc, trees, pageOutlineFailures.get(projectId));
      } catch (err) {
        return reply.code(422).send({ error: (err as Error).message });
      }
    });

  app.get<{ Params: ProjectParams }>(
    "/api/projects/:projectId/page-code", async (req, reply) => {
      const { projectId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      const doc = store.readDoc(projectId);
      const regions = [...doc.regions].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
      const pageRegions: Array<{ region: Rect; tree: NonNullable<ReturnType<ProjectStore["readElementTree"]>> }> = [];
      const missing: string[] = [];
      const assetSources = new Map<string, string>();
      const inlineSvgSources = new Map<string, string>();
      const assets = new Map<string, string>();

      for (const region of regions) {
        const tree = store.readElementTree(projectId, regionKey(region.bounds));
        if (!tree) { missing.push(region.displayName); continue; }
        for (const node of tree.nodes) {
          const { x, y, w, h } = node.box;
          if ((node.kind === "image" || node.kind === "icon")
            && (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > doc.image.width || y + h > doc.image.height)) {
            return reply.code(422).send({ error: `asset bounds out of image: ${region.id}/${node.id}` });
          }
        }
        const index = pageRegions.length;
        const materialized = await materializeTreeAssets(store, projectId, region.bounds, tree, false);
        for (const [nodeId, path] of Object.entries(materialized.files)) {
          const ref = materialized.tree.nodes.find(node => node.id === nodeId)?.asset?.ref;
          if (!ref) continue;
          if (ref.endsWith(".svg")) {
            inlineSvgSources.set(`${index}:${nodeId}`, readFileSync(path, "utf8"));
          } else {
            assetSources.set(`${index}:${nodeId}`, `assets/${ref}`);
            assets.set(`assets/${ref}`, readFileSync(path).toString("base64"));
          }
        }
        pageRegions.push({ region: region.bounds, tree: materialized.tree });
      }
      const page = emitPage({
        designWidth: doc.image.width,
        regions: pageRegions,
        assets: key => assetSources.get(key),
        inlineSvg: key => inlineSvgSources.get(key),
        fontStack: doc.fontStack,
      });
      return {
        html: page.html,
        css: page.css,
        assets: [...assets].map(([path, contentBase64]) => ({ path, contentBase64 })),
        todos: analysisStats(doc.regions, store.readElements(projectId).trees, doc.fontStack).todos,
      };
    });

  app.get<{ Params: ProjectParams }>(
    "/api/projects/:projectId/page-code.zip", async (req, reply) => {
      const generated = await app.inject({ method: "GET", url: `/api/projects/${req.params.projectId}/page-code` });
      if (generated.statusCode !== 200) {
        reply.code(generated.statusCode).type(generated.headers["content-type"] ?? "application/json");
        return reply.send(generated.rawPayload);
      }
      const output = generated.json<{ html: string; css: string; assets: Array<{ path: string; contentBase64: string }> }>();
      const zip = createZip([
        { name: "index.html", content: output.html },
        { name: "style.css", content: output.css },
        ...output.assets.map(asset => ({ name: asset.path, content: Buffer.from(asset.contentBase64, "base64") })),
      ]);
      return reply
        .type("application/zip")
        .header("content-disposition", `attachment; filename="region-page-${req.params.projectId}.zip"`)
        .send(zip);
    });

  app.get<{ Params: ProjectParams & { fileName: string } }>(
    "/api/projects/:projectId/assets/:fileName", async (req, reply) => {
      const { projectId, fileName } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      const isPng = /^[a-f0-9]{40}\.png$/.test(fileName);
      const isSvg = /^[a-zA-Z0-9_-]+-[a-zA-Z0-9_-]+-[a-f0-9]{12}\.svg$/.test(fileName);
      if (!isPng && !isSvg) return reply.code(400).send({ error: "invalid asset name" });
      const path = join(store.assetsDir(projectId), fileName);
      if (!existsSync(path)) return reply.code(404).send({ error: "asset not found" });
      return reply.type(isSvg ? "image/svg+xml" : "image/png").send(readFileSync(path));
    });

  app.post<{ Params: ProjectParams; Body: { retry?: boolean } }>(
    "/api/projects/:projectId/elements/detect-all", async (req, reply) => {
      const { projectId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      const running = detectAllRuns.get(projectId);
      if (running) return running;
      const run = (async () => {
        const doc = store.readDoc(projectId);
        const regions = [...doc.regions].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
        const previous = pageOutlineFailures.get(projectId) ?? {};
        const failures: Record<string, string> = { ...previous };
        let completed = 0;
        let skipped = 0;
        for (const region of regions) {
          const key = regionKey(region.bounds);
          const existing = store.readElementTree(projectId, key);
          if (existing && !(req.body?.retry && previous[key])) {
            try {
              await materializeTreeAssets(store, projectId, region.bounds, existing);
              skipped += 1;
              delete failures[key];
            } catch (err) {
              failures[key] = (err as Error).message;
            }
            continue;
          }
          try {
            const model = configStore.isConfigured() ? currentModel() : undefined;
            const detected = await detectElements({ store, model }, projectId, region.bounds);
            await materializeTreeAssets(store, projectId, region.bounds, detected);
            completed += 1;
            delete failures[key];
          } catch (err) {
            failures[key] = (err as Error).message;
          }
        }
        pageOutlineFailures.set(projectId, failures);
        return {
          total: regions.length,
          completed,
          skipped,
          failed: Object.keys(failures).length,
          failedRegionKeys: Object.keys(failures),
        };
      })();
      detectAllRuns.set(projectId, run);
      try {
        return await run;
      } finally {
        detectAllRuns.delete(projectId);
      }
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
        const detected = await detectElements({ store, model }, projectId, region);
        const assets = await materializeTreeAssets(store, projectId, region, detected);
        return { tree: assets.tree };
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
        const stored = store.writeElementTree(projectId, parsed.data, req.body.region);
        const assets = await materializeTreeAssets(store, projectId, req.body.region, stored);
        return { tree: assets.tree, treeVersion: store.readElementTreeVersion(projectId, assets.tree.regionKey) };
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
