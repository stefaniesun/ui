import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkDocumentInvariants, normalizeRegionSplitDoc, regionSplitDocSchema,
  type ElementNode, type Region, type RegionElementAnalysis, type RegionSplitDoc,
} from "./types.js";

export class RevisionConflictError extends Error {
  constructor(public readonly latest: RegionSplitDoc) { super("document revision conflict"); }
}

export interface EditableDocumentInput {
  expectedRevision: number;
  regions: Region[];
  elements: ElementNode[];
  elementAnalysis: Record<string, RegionElementAnalysis>;
}

export class ProjectStore {
  constructor(private root: string) {}
  newProjectId(): string {
    const now = new Date();
    const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("");
    return `${date}-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;
  }
  projectDir(projectId: string): string {
    if (projectId.includes("/") || projectId.includes("\\") || projectId.includes("..")) throw new Error("invalid project id");
    return join(this.root, projectId);
  }
  imagePath(projectId: string): string { return join(this.projectDir(projectId), "image.png"); }
  cleanImagePath(projectId: string): string { return join(this.projectDir(projectId), "image.clean.png"); }
  analyzedImagePath(projectId: string): string { return join(this.projectDir(projectId), "image.analyzed.png"); }
  private docPath(projectId: string): string { return join(this.projectDir(projectId), "regions.json"); }
  exists(projectId: string): boolean { return existsSync(this.docPath(projectId)); }

  readDoc(projectId: string): RegionSplitDoc {
    const path = this.docPath(projectId);
    if (!existsSync(path)) throw new Error("project not found");
    return normalizeRegionSplitDoc(regionSplitDocSchema.parse(JSON.parse(readFileSync(path, "utf8"))) as RegionSplitDoc);
  }

  private persist(projectId: string, doc: RegionSplitDoc): void {
    const parsed = regionSplitDocSchema.parse(doc) as RegionSplitDoc;
    const violations = checkDocumentInvariants(parsed);
    if (violations.length) throw new Error(`invariant violated: ${violations.map(item => item.code).join(", ")}`);
    const directory = this.projectDir(projectId);
    mkdirSync(directory, { recursive: true });
    const temporary = join(directory, `.regions-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
    try {
      writeFileSync(temporary, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      renameSync(temporary, this.docPath(projectId));
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }

  writeDoc(projectId: string, doc: RegionSplitDoc): void { this.persist(projectId, doc); }

  commitDocument(projectId: string, expectedRevision: number, buildNext: (current: RegionSplitDoc) => RegionSplitDoc): RegionSplitDoc {
    const current = this.readDoc(projectId);
    if (current.revision !== expectedRevision) throw new RevisionConflictError(current);
    const next = { ...buildNext(current), schemaVersion: "2" as const, revision: current.revision + 1, updatedAt: new Date().toISOString() };
    this.persist(projectId, next);
    return next;
  }

  writeEditable(projectId: string, input: EditableDocumentInput): RegionSplitDoc {
    return this.commitDocument(projectId, input.expectedRevision, current => ({
      ...current, regions: input.regions, elements: input.elements, elementAnalysis: input.elementAnalysis,
    }));
  }

  writeRegions(projectId: string, regions: Region[]): RegionSplitDoc {
    const current = this.readDoc(projectId);
    return this.writeEditable(projectId, {
      expectedRevision: current.revision, regions,
      elements: current.elements, elementAnalysis: current.elementAnalysis,
    });
  }
}
