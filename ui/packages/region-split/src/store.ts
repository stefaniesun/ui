import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkElementTreeInvariants, elementsDocSchema,
  type ElementsDoc, type ElementTree,
} from "./element-types.js";
import {
  checkInvariants, regionSplitDocSchema, type Rect, type Region, type RegionSplitDoc,
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

  /**
   * 元素树存独立文件，不进 regions.json。
   * 这样 regionSplitDocSchema 与 checkInvariants 一行都不用改，
   * 区域撤销栈仍然只承载 Region[]，两种编辑互不污染。
   */
  elementsPath(projectId: string): string {
    return join(this.projectDir(projectId), "elements.json");
  }

  readElements(projectId: string): ElementsDoc {
    const path = this.elementsPath(projectId);
    if (!existsSync(path)) return { schemaVersion: "1", trees: [] };
    return elementsDocSchema.parse(JSON.parse(readFileSync(path, "utf8"))) as ElementsDoc;
  }

  readElementTree(projectId: string, key: string): ElementTree | null {
    return this.readElements(projectId).trees.find(tree => tree.regionKey === key) ?? null;
  }

  readElementSourceImage(projectId: string): Buffer {
    const clean = this.cleanImagePath(projectId);
    return readFileSync(existsSync(clean) ? clean : this.imagePath(projectId));
  }

  writeElementTree(projectId: string, tree: ElementTree, region: Rect): ElementTree {
    const violations = checkElementTreeInvariants(tree, region);
    if (violations.length > 0) {
      throw new Error(`invariant violated: ${violations.map(v => v.code).join(", ")}`);
    }
    const doc = this.readElements(projectId);
    const trees = doc.trees.filter(item => item.regionKey !== tree.regionKey);
    trees.push(tree);
    trees.sort((a, b) => a.regionKey.localeCompare(b.regionKey));
    mkdirSync(this.projectDir(projectId), { recursive: true });
    writeFileSync(
      this.elementsPath(projectId),
      JSON.stringify({ ...doc, trees }, null, 2) + "\n",
      "utf8",
    );
    return tree;
  }

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
