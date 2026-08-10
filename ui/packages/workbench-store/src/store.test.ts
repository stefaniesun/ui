import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { emptyMeasurementDoc } from "@ui-rebuild/workbench-contracts";
import { fingerprint, StageStore } from "./store.js";

let root = "";
afterEach(() => root ? rm(root, { recursive: true, force: true }) : undefined);

describe("StageStore", () => {
  it("atomically saves, reads, and versions a measurement document", async () => {
    root = await mkdtemp(join(tmpdir(), "workbench-store-"));
    const store = new StageStore(root);
    const doc = emptyMeasurementDoc();
    doc.status = "draft";
    const saved = await store.save("member", doc);
    expect(saved.fingerprint).toBe(fingerprint(doc));
    await expect(store.readMeasurement("member")).resolves.toEqual(doc);
    await expect(store.history("member", "measurement")).resolves.toHaveLength(1);
    expect(await readFile(join(root, "member", "stages", "measurement.json"), "utf8")).toContain('"draft"');
  });

  it("returns null and empty history for a new page", async () => {
    root = await mkdtemp(join(tmpdir(), "workbench-store-"));
    const store = new StageStore(root);
    await expect(store.readMeasurement("new-page")).resolves.toBeNull();
    await expect(store.history("new-page", "measurement")).resolves.toEqual([]);
  });
});
