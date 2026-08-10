import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { FastifyInstance } from "fastify";
import type { Operation } from "fast-json-patch";
import { guardChangeSet, rectIntersects, type Annotation, type ChangeOp, type Rect } from "@ui-rebuild/workbench-contracts";
import type { AppDeps } from "../app.js";

interface StoredChangeSet { id: string; annotationId: string; status: string; allowed: ChangeOp[]; rejected: Array<{ op: ChangeOp; reason: string }> }
const PREFIX = "/api/pages/:pageId/stages/measurement";
export function registerAnnotationRoutes(app: FastifyInstance, deps: AppDeps): void {
  const directory = (pageId: string) => join(deps.store.pageDir(pageId), "stages", "changesets");
  app.post<{ Params: { pageId: string }; Body: { bounds: Rect; instruction: string; targetIds?: string[] } }>(`${PREFIX}/annotations`, async (request, reply) => {
    const doc = deps.store.readDoc(request.params.pageId);
    if (doc.status === "confirmed") return reply.code(409).send({ error: "stage is confirmed" });
    const annotation: Annotation = { id: `a-${randomUUID()}`, stage: "measurement", bounds: request.body.bounds, instruction: request.body.instruction, targetIds: request.body.targetIds, createdAt: new Date().toISOString() };
    const imagePath = join(deps.store.pageDir(request.params.pageId), "reference", doc.payload.normalization?.referenceImage ?? "default.norm.png");
    try {
      const metadata = await sharp(imagePath).metadata(); const bounds = annotation.bounds; const pad = Math.round(Math.max(bounds.w, bounds.h) * 0.1);
      const left = Math.max(0, Math.round(bounds.x) - pad); const top = Math.max(0, Math.round(bounds.y) - pad);
      const width = Math.max(1, Math.min((metadata.width ?? 0) - left, Math.round(bounds.w) + pad * 2));
      const height = Math.max(1, Math.min((metadata.height ?? 0) - top, Math.round(bounds.h) + pad * 2));
      const crop = await sharp(imagePath).extract({ left, top, width, height }).png().toBuffer();
      const itemsInBounds = doc.payload.textItems.map((item, index) => ({ index, item })).filter(({ item }) => rectIntersects(item.bounds, bounds));
      const proposal = await deps.model.proposeChangeSet({ annotation, cropPngBase64: crop.toString("base64"), itemsInBounds, payload: doc.payload });
      const guarded = guardChangeSet(proposal, doc.payload, bounds);
      const stored: StoredChangeSet = { id: proposal.id, annotationId: annotation.id, status: "proposed", ...guarded };
      mkdirSync(directory(request.params.pageId), { recursive: true }); writeFileSync(join(directory(request.params.pageId), `${stored.id}.json`), `${JSON.stringify({ annotation, ...stored }, null, 2)}\n`, "utf8");
      return { changeSet: stored };
    } catch (error) { return reply.code(502).send({ error: (error as Error).message }); }
  });
  app.post<{ Params: { pageId: string; csId: string }; Body: { opIndexes?: number[] } }>(`${PREFIX}/changesets/:csId/accept`, async (request, reply) => {
    const path = join(directory(request.params.pageId), `${request.params.csId}.json`);
    if (!existsSync(path)) return reply.code(404).send({ error: "changeset not found" });
    const changeSet = JSON.parse(readFileSync(path, "utf8")) as StoredChangeSet;
    if (changeSet.status !== "proposed") return reply.code(409).send({ error: "changeset already resolved" });
    const selected = (request.body?.opIndexes ?? changeSet.allowed.map((_, index) => index)).map((index) => changeSet.allowed[index]).filter((item): item is ChangeOp => Boolean(item));
    const operations = selected.map((operation) => ({ ...operation, path: `/payload${operation.path}` })) as Operation[];
    const doc = deps.store.applyPatch(request.params.pageId, operations, "changeset");
    writeFileSync(path, `${JSON.stringify({ ...changeSet, status: "accepted" }, null, 2)}\n`, "utf8"); return { doc };
  });
}
