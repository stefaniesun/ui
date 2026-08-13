import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkInvariants, regionSplitDocSchema, type Region, type RegionSplitDoc,
} from "./types.js";

export class ProjectStore {
  constructor(private root: string) {}

  newProjectId(): string {
    const now = new Date();
    const date = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("");
    const suffix = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
    return `${date}-${suffix}`;
  }

  projectDir(projectId: string): string {
    if (projectId.includes("/") || projectId.includes("\\") || projectId.includes("..")) {
      throw new Error("invalid project id");
    }
    return join(this.root, projectId);
  }

  /** 上传的原图，永不改动——它是后续像素比对的事实基准 */
  imagePath(projectId: string): string { return join(this.projectDir(projectId), "image.png"); }
  /** 抹掉系统外壳后的图，与原图同分辨率；界面和裁剪都用它 */
  cleanImagePath(projectId: string): string { return join(this.projectDir(projectId), "image.clean.png"); }
  analyzedImagePath(projectId: string): string { return join(this.projectDir(projectId), "image.analyzed.png"); }
  private docPath(projectId: string): string { return join(this.projectDir(projectId), "regions.json"); }

  exists(projectId: string): boolean { return existsSync(this.docPath(projectId)); }

  readDoc(projectId: string): RegionSplitDoc {
    const path = this.docPath(projectId);
    if (!existsSync(path)) throw new Error("project not found");
    return regionSplitDocSchema.parse(JSON.parse(readFileSync(path, "utf8"))) as RegionSplitDoc;
  }

  writeDoc(projectId: string, doc: RegionSplitDoc): void {
    const parsed = regionSplitDocSchema.parse(doc) as RegionSplitDoc;
    const violations = checkInvariants(parsed.regions, parsed.image);
    if (violations.length > 0) {
      throw new Error(`invariant violated: ${violations.map(v => v.code).join(", ")}`);
    }
    mkdirSync(this.projectDir(projectId), { recursive: true });
    writeFileSync(this.docPath(projectId), JSON.stringify(parsed, null, 2) + "\n", "utf8");
  }

  writeRegions(projectId: string, regions: Region[]): RegionSplitDoc {
    const next: RegionSplitDoc = {
      ...this.readDoc(projectId), regions, updatedAt: new Date().toISOString(),
    };
    this.writeDoc(projectId, next);
    return next;
  }
}
