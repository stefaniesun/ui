import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { emptyMeasurementDoc } from "@ui-rebuild/workbench-contracts";
import { buildApp, type AppDeps } from "./app.js";
import type { AnnotationModel } from "./model-client.js";
import { PageStore } from "./store.js";

let root = "";
afterEach(() => root ? rm(root, { recursive: true, force: true }) : undefined);
async function fixture() {
  root = await mkdtemp(join(tmpdir(), "workbench-server-"));
  const store = new PageStore(root); const doc = emptyMeasurementDoc(); doc.status = "draft";
  doc.payload.normalization = { referenceImage: "default.norm.png", physicalSize: { w: 100, h: 200 }, scale: 1, logicalSize: { w: 100, h: 200 }, source: "tool", confidence: 1, reviewed: true };
  store.writeDoc("member", doc); await mkdir(join(root, "member", "reference"), { recursive: true });
  const model: AnnotationModel = { proposeChangeSet: async () => ({ id: "cs1", annotationId: "a1", operations: [], status: "proposed" }) };
  const measure: AppDeps["measure"] = { normalize: async () => doc.payload.normalization!, ocr: async () => [], colors: async () => [] };
  return { store, app: buildApp({ store, model, measure }) };
}

describe("measurement routes", () => {
  it("patches and undoes a document", async () => {
    const { app } = await fixture();
    const patched = await app.inject({ method: "PATCH", url: "/api/pages/member/stages/measurement", payload: { ops: [{ op: "add", path: "/payload/textItems/0", value: { id: "t1", text: "会员", bounds: { x: 1, y: 2, w: 20, h: 10 }, ocrConfidence: 1, source: "human", confidence: 1, reviewed: true } }] } });
    expect(patched.statusCode).toBe(200); expect(patched.json().doc.payload.textItems).toHaveLength(1);
    const undone = await app.inject({ method: "POST", url: "/api/pages/member/stages/measurement/undo" });
    expect(undone.json().doc.payload.textItems).toHaveLength(0);
  });

  it("confirms reviewed data then blocks edits until unfreeze", async () => {
    const { app } = await fixture();
    expect((await app.inject({ method: "POST", url: "/api/pages/member/stages/measurement/confirm" })).statusCode).toBe(200);
    expect((await app.inject({ method: "PATCH", url: "/api/pages/member/stages/measurement", payload: { ops: [{ op: "replace", path: "/status", value: "draft" }, { op: "add", path: "/payload/textItems/0", value: {} }] } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/api/pages/member/stages/measurement/unfreeze" })).statusCode).toBe(200);
  });

  it("reports confirmation gate failures", async () => {
    const { app, store } = await fixture(); const doc = store.readDoc("member"); doc.payload.normalization!.reviewed = false; store.writeDoc("member", doc);
    const response = await app.inject({ method: "POST", url: "/api/pages/member/stages/measurement/confirm" });
    expect(response.statusCode).toBe(422); expect(response.json().gate.normalizationUnreviewed).toBe(true);
  });
});
