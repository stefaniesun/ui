import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Operation } from "fast-json-patch";
import { emptyMeasurementDoc, type MeasurementDoc } from "@ui-rebuild/workbench-contracts";
import type { AppDeps } from "../app.js";

const PREFIX = "/api/pages/:pageId/stages/measurement";
type Params = { pageId: string };
export function registerMeasurementRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { store } = deps;
  app.get<{ Params: Params }>(PREFIX, async (request) => {
    const doc = store.readDoc(request.params.pageId); return { doc, fingerprint: store.fingerprint(doc) };
  });
  app.patch<{ Params: Params; Body: { ops: Operation[] } }>(PREFIX, async (request, reply) => {
    try { return { doc: store.applyPatch(request.params.pageId, request.body.ops, "human") }; }
    catch (error) { const message = (error as Error).message; return reply.code(message.includes("confirmed") ? 409 : 400).send({ error: message }); }
  });
  app.post<{ Params: Params; Body: { scale: number; statusBarHeightPx?: number } }>(`${PREFIX}/analyze`, async (request, reply) => {
    const old = store.readDoc(request.params.pageId);
    if (old.status === "confirmed") return reply.code(409).send({ error: "stage is confirmed" });
    const referenceDir = join(store.pageDir(request.params.pageId), "reference");
    const output = join(referenceDir, "default.norm.png");
    const normalization = await deps.measure.normalize({ imagePath: join(referenceDir, "default.png"), scale: request.body.scale, statusBarHeightPx: request.body.statusBarHeightPx, outPath: output });
    normalization.referenceImage = "default.norm.png";
    const textItems = await deps.measure.ocr(output);
    const colorSamples = await deps.measure.colors(output, textItems);
    const keptText = old.payload.textItems.filter((item) => item.source === "human").map((item, index) => ({ ...item, id: item.id.startsWith("keep-") ? item.id : `keep-${index}-${item.id}` }));
    const keptColors = old.payload.colorSamples.filter((item) => item.source === "human");
    const doc: MeasurementDoc = { ...emptyMeasurementDoc(), status: "draft", payload: { normalization, textItems: [...textItems, ...keptText], colorSamples: [...colorSamples, ...keptColors], ignoreMasks: old.payload.ignoreMasks } };
    store.writeDoc(request.params.pageId, doc); return { doc };
  });
  app.post<{ Params: Params }>(`${PREFIX}/undo`, async (request, reply) => { const doc = store.undo(request.params.pageId); return doc ? { doc } : reply.code(204).send(); });
  app.post<{ Params: Params }>(`${PREFIX}/redo`, async (request, reply) => { const doc = store.redo(request.params.pageId); return doc ? { doc } : reply.code(204).send(); });
  app.post<{ Params: Params }>(`${PREFIX}/confirm`, async (request, reply) => {
    const doc = store.readDoc(request.params.pageId);
    const gate = {
      unreviewedLowConfidence: [...doc.payload.textItems, ...doc.payload.colorSamples].filter((item) => item.confidence < 0.85 && !item.reviewed).map((item) => item.id),
      normalizationUnreviewed: !doc.payload.normalization?.reviewed,
      masksMissingReason: doc.payload.ignoreMasks.filter((mask) => !mask.reason.trim()).map((mask) => mask.id),
    };
    if (gate.unreviewedLowConfidence.length || gate.normalizationUnreviewed || gate.masksMissingReason.length) return reply.code(422).send({ gate });
    return { doc: store.applyPatch(request.params.pageId, [{ op: "replace", path: "/status", value: "confirmed" }, { op: "add", path: "/confirmedAt", value: new Date().toISOString() }], "human") };
  });
  app.post<{ Params: Params }>(`${PREFIX}/unfreeze`, async (request, reply) => {
    if (store.readDoc(request.params.pageId).status !== "confirmed") return reply.code(409).send({ error: "not confirmed" });
    return { doc: store.applyPatch(request.params.pageId, [{ op: "replace", path: "/status", value: "draft" }, { op: "remove", path: "/confirmedAt" }], "human") };
  });
}
