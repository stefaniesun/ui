import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { applyPatch as patch, compare, type Operation } from "fast-json-patch";
import { emptyMeasurementDoc, parseMeasurementDoc, type MeasurementDoc } from "@ui-rebuild/workbench-contracts";

interface HistoryRecord { seq: number; at: string; origin: string; ops: Operation[]; inverse: Operation[] }
interface Cursor { seq: number }

export class PageStore {
  constructor(public readonly pagesRoot: string) {}
  pageDir(pageId: string): string { return join(this.pagesRoot, pageId); }
  private docPath(pageId: string): string { return join(this.pageDir(pageId), "stages", "01-measurement.json"); }
  private historyDir(pageId: string): string { return join(this.pageDir(pageId), "history", "01-measurement"); }
  private cursorPath(pageId: string): string { return join(this.historyDir(pageId), "cursor.json"); }

  readDoc(pageId: string): MeasurementDoc {
    const path = this.docPath(pageId);
    return existsSync(path) ? parseMeasurementDoc(JSON.parse(readFileSync(path, "utf8"))) : emptyMeasurementDoc();
  }
  writeDoc(pageId: string, doc: MeasurementDoc): void {
    const path = this.docPath(pageId);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(parseMeasurementDoc(doc), null, 2)}\n`, "utf8");
  }
  fingerprint(doc: MeasurementDoc): string {
    return createHash("sha256").update(JSON.stringify(doc.payload)).digest("hex");
  }
  private cursor(pageId: string): Cursor {
    const path = this.cursorPath(pageId);
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as Cursor : { seq: 0 };
  }
  private writeCursor(pageId: string, seq: number): void {
    mkdirSync(this.historyDir(pageId), { recursive: true });
    writeFileSync(this.cursorPath(pageId), `${JSON.stringify({ seq }, null, 2)}\n`, "utf8");
  }
  private historyPath(pageId: string, seq: number): string { return join(this.historyDir(pageId), `${String(seq).padStart(6, "0")}.json`); }
  applyPatch(pageId: string, ops: Operation[], origin: string): MeasurementDoc {
    const before = this.readDoc(pageId);
    if (before.status === "confirmed" && ops.some((op) => op.path !== "/status" && op.path !== "/confirmedAt" && op.path !== "/confirmedBy")) {
      throw new Error("stage is confirmed");
    }
    const raw = structuredClone(before);
    const after = parseMeasurementDoc(patch(raw, ops, true, false).newDocument);
    const cursor = this.cursor(pageId);
    mkdirSync(this.historyDir(pageId), { recursive: true });
    for (const file of readdirSync(this.historyDir(pageId)).filter((name) => /^\d+\.json$/.test(name))) {
      if (Number(file.slice(0, -5)) > cursor.seq) rmSync(join(this.historyDir(pageId), file));
    }
    const seq = cursor.seq + 1;
    const record: HistoryRecord = { seq, at: new Date().toISOString(), origin, ops, inverse: compare(after, before) };
    writeFileSync(this.historyPath(pageId, seq), `${JSON.stringify(record, null, 2)}\n`, "utf8");
    this.writeDoc(pageId, after);
    this.writeCursor(pageId, seq);
    return after;
  }
  private record(pageId: string, seq: number): HistoryRecord | null {
    const path = this.historyPath(pageId, seq);
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as HistoryRecord : null;
  }
  undo(pageId: string): MeasurementDoc | null {
    const cursor = this.cursor(pageId);
    const record = this.record(pageId, cursor.seq);
    if (!record) return null;
    const doc = parseMeasurementDoc(patch(structuredClone(this.readDoc(pageId)), record.inverse, true, false).newDocument);
    this.writeDoc(pageId, doc); this.writeCursor(pageId, cursor.seq - 1); return doc;
  }
  redo(pageId: string): MeasurementDoc | null {
    const cursor = this.cursor(pageId);
    const record = this.record(pageId, cursor.seq + 1);
    if (!record) return null;
    const doc = parseMeasurementDoc(patch(structuredClone(this.readDoc(pageId)), record.ops, true, false).newDocument);
    this.writeDoc(pageId, doc); this.writeCursor(pageId, cursor.seq + 1); return doc;
  }
  listHistory(pageId: string): HistoryRecord[] {
    const dir = this.historyDir(pageId);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((name) => /^\d+\.json$/.test(name)).sort().map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as HistoryRecord);
  }
}
