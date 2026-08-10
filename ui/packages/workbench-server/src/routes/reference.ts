import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";

export function registerReferenceRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get<{ Params: { pageId: string; name: string }; Querystring: { rect?: string } }>("/api/pages/:pageId/reference/:name", async (request, reply) => {
    if (request.params.name.includes("..") || request.params.name.includes("/") || request.params.name.includes("\\")) return reply.code(404).send();
    const path = join(deps.store.pageDir(request.params.pageId), "reference", request.params.name);
    if (!existsSync(path)) return reply.code(404).send();
    let image = sharp(path);
    if (request.query.rect) {
      const [x, y, w, h] = request.query.rect.split(",").map(Number);
      if (![x, y, w, h].every(Number.isFinite) || !w || !h || w <= 0 || h <= 0) return reply.code(400).send({ error: "invalid rect" });
      const metadata = await image.metadata();
      const left = Math.max(0, Math.round(x!)); const top = Math.max(0, Math.round(y!));
      image = image.extract({ left, top, width: Math.min(Math.round(w!), (metadata.width ?? 0) - left), height: Math.min(Math.round(h!), (metadata.height ?? 0) - top) });
    }
    reply.type("image/png"); return reply.send(await image.png().toBuffer());
  });
}
