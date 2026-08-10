import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MeasurementDoc, StageDoc, StageId } from "@ui-rebuild/workbench-contracts";
import { parseMeasurementDoc } from "@ui-rebuild/workbench-contracts";

export interface HistoryEntry {
  version: string;
  savedAt: string;
  stage: StageId;
  status: string;
  fingerprint: string;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export class StageStore {
  constructor(private readonly pagesRoot: string) {}

  private stagePath(pageId: string, stage: StageId): string {
    return join(this.pagesRoot, pageId, "stages", `${stage}.json`);
  }

  async readMeasurement(pageId: string): Promise<MeasurementDoc | null> {
    try {
      return parseMeasurementDoc(JSON.parse(await readFile(this.stagePath(pageId, "measurement"), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save<T>(pageId: string, doc: StageDoc<T>): Promise<HistoryEntry> {
    const target = this.stagePath(pageId, doc.stage);
    const historyDir = join(this.pagesRoot, pageId, "history", doc.stage);
    await mkdir(dirname(target), { recursive: true });
    await mkdir(historyDir, { recursive: true });
    const savedAt = new Date().toISOString();
    const version = savedAt.replaceAll(":", "-");
    const serialized = `${JSON.stringify(doc, null, 2)}\n`;
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, serialized, "utf8");
    await rename(temporary, target);
    await writeFile(join(historyDir, `${version}.json`), serialized, "utf8");
    return { version, savedAt, stage: doc.stage, status: doc.status, fingerprint: fingerprint(doc) };
  }

  async history(pageId: string, stage: StageId): Promise<HistoryEntry[]> {
    const directory = join(this.pagesRoot, pageId, "history", stage);
    try {
      const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort().reverse();
      return Promise.all(files.map(async (file) => {
        const doc = JSON.parse(await readFile(join(directory, file), "utf8")) as StageDoc<unknown>;
        const version = file.slice(0, -5);
        return { version, savedAt: version.replace(/-(\d\d)-(\d\d)\.(\d\d\d)Z$/, ":$1:$2.$3Z"), stage, status: doc.status, fingerprint: fingerprint(doc) };
      }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
