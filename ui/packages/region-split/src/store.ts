import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkElementTreeInvariants, elementsDocSchema, regionKey,
  type ElementsDoc, type ElementTree,
} from "./element-types.js";
import type { ElementSubtree } from "./element-refactor-types.js";
import { hashElementTree, replaceElementSubtree as replaceSubtree } from "./element-subtree.js";
import {
  checkInvariants, regionSplitDocSchema, type Rect, type Region, type RegionSplitDoc,
} from "./types.js";

interface AtomicFileOps {
  exists(path: string): boolean;
  write(path: string, content: string): void;
  rename(from: string, to: string): void;
  remove(path: string): void;
}

const atomicFileOps: AtomicFileOps = {
  exists: existsSync,
  write: (path, content) => writeFileSync(path, content, "utf8"),
  rename: renameSync,
  remove: path => rmSync(path, { force: true }),
};

export class ProjectStore {
  constructor(private root: string, private fileOps: AtomicFileOps = atomicFileOps) {}

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

  readElementTreeVersion(projectId: string, key: string): string | null {
    const tree = this.readElementTree(projectId, key);
    return tree ? hashElementTree(tree) : null;
  }

  #writeElementsAtomic(projectId: string, doc: ElementsDoc): void {
    const target = this.elementsPath(projectId);
    const token = `${process.pid}.${randomUUID()}`;
    const temporary = `${target}.${token}.tmp`;
    const backup = `${target}.${token}.bak`;
    mkdirSync(this.projectDir(projectId), { recursive: true });
    let movedOriginal = false;
    let committed = false;
    try {
      this.fileOps.write(temporary, JSON.stringify(doc, null, 2) + "\n");
      if (this.fileOps.exists(target)) {
        this.fileOps.rename(target, backup);
        movedOriginal = true;
      }
      this.fileOps.rename(temporary, target);
      committed = true;
    } catch (error) {
      if (movedOriginal && !committed && !this.fileOps.exists(target) && this.fileOps.exists(backup)) {
        try {
          this.fileOps.rename(backup, target);
          movedOriginal = false;
        } catch (restoreError) {
          throw new Error(`element write failed and recovery backup remains at ${backup}`, { cause: restoreError });
        }
      }
      throw error;
    } finally {
      try { this.fileOps.remove(temporary); } catch { /* 提交语义不由临时文件清理决定 */ }
      if (committed || !movedOriginal) {
        try { this.fileOps.remove(backup); } catch { /* 新正式文件已提交，保留多余备份可后续清理 */ }
      }
    }
  }

  replaceElementSubtree(
    projectId: string,
    region: Rect,
    expectedTreeVersion: string,
    rootId: string,
    candidate: ElementSubtree,
  ): { tree: ElementTree; treeVersion: string } {
    const doc = this.readElements(projectId);
    const index = doc.trees.findIndex(tree => tree.regionKey === regionKey(region));
    if (index < 0) throw new Error("element tree not found");
    const current = doc.trees[index]!;
    if (hashElementTree(current) !== expectedTreeVersion) throw new Error("element tree version conflict");
    const tree = replaceSubtree(current, rootId, candidate);
    const violations = checkElementTreeInvariants(tree, region);
    if (violations.length > 0) throw new Error(`invariant violated: ${violations.map(v => v.code).join(", ")}`);
    const trees = [...doc.trees];
    trees[index] = tree;
    this.#writeElementsAtomic(projectId, { ...doc, trees });
    return { tree, treeVersion: hashElementTree(tree) };
  }

  writeElementTree(projectId: string, tree: ElementTree, region: Rect): ElementTree {
    if (tree.regionKey !== regionKey(region)) throw new Error("element tree region key mismatch");
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
