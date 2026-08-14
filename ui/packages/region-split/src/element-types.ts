import { z } from "zod";
import { rectSchema, type InvariantViolation, type Rect } from "./types.js";

/**
 * 元素分两层，不是并列的六类：
 * - 容器类（component / grid）有子节点，对应 <div>；
 * - 叶子类（text / icon / image / decoration）没有子节点。
 * 这个二分决定了界面上每个节点能做什么操作，也决定了下游怎么生成标签。
 */
export const elementKinds = [
  "component", "grid", "text", "icon", "image", "decoration",
] as const;
export type ElementKind = (typeof elementKinds)[number];

export const leafKinds: readonly ElementKind[] = ["text", "icon", "image", "decoration"];

export const elementNodeSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().nullable(),
  /** 原图坐标 */
  box: rectSchema,
  kind: z.enum(elementKinds),
  displayName: z.string().min(1),
  style: z.object({
    background: z.string().optional(),
    borderRadius: z.number().int().nonnegative().optional(),
    /** 墨色：文字的字色、图标的线条色、装饰的颜色 */
    color: z.string().optional(),
  }).default({}),
  uniformity: z.number().min(0).max(1),
  source: z.enum(["auto", "manual"]).default("auto"),
  /** 这个节点的类型是谁定的。uncertain 表示还需人工指定。 */
  classification: z.enum(["tool", "model", "human", "uncertain"]).default("tool"),

  // 以下字段阶段一不产出，但现在就定义好，避免阶段二改 schema 破坏已存的文件。
  layout: z.object({
    direction: z.enum(["row", "column"]),
    gap: z.number().int().nonnegative(),
    padding: z.object({
      top: z.number().int().nonnegative(),
      right: z.number().int().nonnegative(),
      bottom: z.number().int().nonnegative(),
      left: z.number().int().nonnegative(),
    }),
  }).optional(),
  scrollX: z.boolean().default(false),
  scrollY: z.boolean().default(false),
  repeat: z.object({
    count: z.number().int().min(2),
    templateId: z.string().min(1),
    pitch: z.number(),
  }).optional(),
  /** absolute 的节点脱离布局流，相对父节点绝对定位（角标压在图标上那种形态）。 */
  positioning: z.enum(["flow", "absolute"]).default("flow"),
});
export type ElementNode = z.infer<typeof elementNodeSchema>;

export const elementTreeSchema = z.object({
  regionKey: z.string().min(1),
  /**
   * 这个区域自身的背景色。放在树上而不是 regions.json 里：区域的拆分、合并、
   * 边界微调都是纯函数，拿不到像素；而检测时本来就在读图，顺手就测了。
   */
  background: z.string().optional(),
  detectedAt: z.string(),
  namedAt: z.string().optional(),
  nodes: z.array(elementNodeSchema),
});
export type ElementTree = z.infer<typeof elementTreeSchema>;

export const elementsDocSchema = z.object({
  schemaVersion: z.string(),
  trees: z.array(elementTreeSchema).default([]),
});
export type ElementsDoc = z.infer<typeof elementsDocSchema>;

/**
 * 树按区域的**几何边界**索引，不用 region.id。
 * id 会在 AI 重命名、拆分、合并之后变化，用它索引会让已人工确认的树凭空孤立；
 * 边界是稳定的——只要那条线没被移动，树就仍然对应同一块像素。
 */
export function regionKey(bounds: Rect): string {
  return `${bounds.y}-${bounds.y + bounds.h}`;
}

function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w
    && inner.y + inner.h <= outer.y + outer.h;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function checkElementTreeInvariants(
  tree: ElementTree, region: Rect,
): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const byId = new Map<string, ElementNode>();
  for (const node of tree.nodes) {
    if (byId.has(node.id)) {
      out.push({ code: "duplicate-id", message: `duplicate element id ${node.id}` });
    }
    byId.set(node.id, node);
  }

  for (const node of tree.nodes) {
    if (node.parentId === null) {
      if (!contains(region, node.box)) {
        out.push({ code: "root-outside-region", message: `root ${node.id} escapes the region` });
      }
      continue;
    }
    const parent = byId.get(node.parentId);
    if (!parent) {
      out.push({
        code: "missing-parent",
        message: `${node.id} references unknown parent ${node.parentId}`,
      });
      continue;
    }
    if (!contains(parent.box, node.box)) {
      out.push({ code: "child-outside-parent", message: `${node.id} escapes parent ${parent.id}` });
    }
  }

  for (const node of tree.nodes) {
    const seen = new Set<string>([node.id]);
    let cursor = node.parentId;
    while (cursor !== null) {
      if (seen.has(cursor)) {
        out.push({ code: "cycle", message: `${node.id} is part of a parent cycle` });
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }

  const siblingsOf = new Map<string | null, ElementNode[]>();
  for (const node of tree.nodes) {
    const list = siblingsOf.get(node.parentId) ?? [];
    list.push(node);
    siblingsOf.set(node.parentId, list);
  }
  for (const [parentId, siblings] of siblingsOf) {
    const parent = parentId === null ? null : byId.get(parentId);
    if (parent && leafKinds.includes(parent.kind)) {
      out.push({ code: "leaf-with-children", message: `leaf ${parent.id} must not have children` });
    }
    // absolute 的节点脱离布局流，允许与兄弟重叠（角标压在图标上就是这种形态）
    const flow = siblings.filter(node => node.positioning === "flow");
    for (let i = 0; i < flow.length; i++) {
      for (let j = i + 1; j < flow.length; j++) {
        if (overlaps(flow[i]!.box, flow[j]!.box)) {
          out.push({ code: "sibling-overlap", message: `${flow[i]!.id} overlaps ${flow[j]!.id}` });
        }
      }
    }
  }
  return out;
}
