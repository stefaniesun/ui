import { z } from "zod";

export const MIN_REGION_HEIGHT = 8;

export const regionTypes = [
  "status-bar", "nav-bar", "banner", "card", "grid", "list",
  "form", "tabs", "text-block", "action-bar", "tab-bar", "other",
] as const;
export type RegionType = (typeof regionTypes)[number];

export interface Rect { x: number; y: number; w: number; h: number }

export const rectSchema = z.object({
  x: z.number().int(), y: z.number().int(), w: z.number().int().positive(), h: z.number().int().positive(),
});

export const regionSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  type: z.enum(regionTypes),
  bounds: rectSchema,
  confidence: z.number().min(0).max(1),
  // 区域整体是否可滚动。直接对应 CSS 的 overflow-x / overflow-y，
  // 下游生成代码时是机械映射（scrollX -> 横向滚动容器 + 子项不换行）。
  // 旧文档没有这两个字段，用 default 保证仍可读入。
  scrollX: z.boolean().default(false),
  scrollY: z.boolean().default(false),
});
export type Region = z.infer<typeof regionSchema>;

export const elementTypes = [
  "container", "text", "image", "icon", "button", "input", "textarea", "select",
  "checkbox", "radio", "link", "list", "list-item", "divider", "other",
] as const;
export type ElementType = (typeof elementTypes)[number];
export type ElementSource = "ai" | "manual";
export type ElementAnalysisStatus = "pending" | "analyzing" | "ready" | "stale" | "failed";

export const elementNodeSchema = z.object({
  id: z.string().min(1), regionId: z.string().min(1), parentId: z.string().min(1).nullable(),
  displayName: z.string().min(1), type: z.enum(elementTypes), bounds: rectSchema,
  confidence: z.number().min(0).max(1), conflict: z.boolean().default(false),
  source: z.enum(["ai", "manual"]),
});
export type ElementNode = z.infer<typeof elementNodeSchema>;

export const regionElementAnalysisSchema = z.object({
  status: z.enum(["pending", "analyzing", "ready", "stale", "failed"]),
  error: z.string().optional(), analyzedAt: z.string().optional(), inputFingerprint: z.string().optional(),
});
export type RegionElementAnalysis = z.infer<typeof regionElementAnalysisSchema>;

export const candidateLineSchema = z.object({
  y: z.number(),          // 原图坐标
  strength: z.number().min(0).max(1),
});
export type CandidateLine = z.infer<typeof candidateLineSchema>;

export const panelSchema = z.object({
  top: z.number(),      // 原图坐标
  bottom: z.number(),
});

export const regionSplitDocSchema = z.object({
  schemaVersion: z.enum(["1", "2"]),
  revision: z.number().int().nonnegative().default(0),
  image: z.object({
    fileName: z.string(),
    width: z.number().positive(),
    height: z.number().positive(),
    analyzedScale: z.number().positive(),
    // 预处理抹掉的系统外壳横带。高度即安全区 inset——下游生成代码时，
    // 相邻模块的背景要向这个方向铺满这段距离。旧文档没有该字段。
    removedChrome: z.array(z.object({
      edge: z.enum(["top", "bottom"]),
      height: z.number().positive(),
    })).default([]),
  }),
  regions: z.array(regionSchema),
  elements: z.array(elementNodeSchema).default([]),
  elementAnalysis: z.record(regionElementAnalysisSchema).default({}),
  candidateLines: z.array(candidateLineSchema).default([]),
  // 检测到的卡片/面板（原图坐标）。模块边界不该横穿面板——这是候选线
  // 一维分析看不出来的信息，也一并送给模型作为约束。
  panels: z.array(panelSchema).default([]),
  // 最近一次模型分析的时间。缺省表示"从没分析过"——此时 regions 是候选切分线
  // 直接切出来的初始划分，没有任何语义判断参与。界面靠它区分两种状态，
  // 不然"区域 1..N"看起来和分析结果一模一样，很容易被当成 AI 的输出。
  analyzedAt: z.string().optional(),
  updatedAt: z.string(),
});
export type RegionSplitDoc = z.infer<typeof regionSplitDocSchema>;

export function normalizeRegionSplitDoc(doc: RegionSplitDoc): RegionSplitDoc {
  return {
    ...doc,
    schemaVersion: "2",
    elementAnalysis: Object.fromEntries(Object.entries(doc.elementAnalysis).map(([id, state]) => [
      id,
      state.status === "analyzing" ? { status: "failed", error: "analysis interrupted" } : state,
    ])),
  };
}

export interface RawSegment {
  displayName: string;
  id: string;
  type: RegionType;
  yStart: number;   // 分析图坐标
  yEnd: number;     // 分析图坐标
  confidence: number;
  scrollX: boolean;
  scrollY: boolean;
}

export interface InvariantViolation { code: string; message: string }

export function checkInvariants(
  regions: Region[],
  image: { width: number; height: number },
): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  if (regions.length === 0) {
    return [{ code: "empty", message: "regions must not be empty" }];
  }
  const first = regions[0]!;
  const last = regions[regions.length - 1]!;
  if (first.bounds.y !== 0) {
    out.push({ code: "first-not-zero", message: `first region starts at ${first.bounds.y}, expected 0` });
  }
  if (last.bounds.y + last.bounds.h !== image.height) {
    out.push({
      code: "last-not-bottom",
      message: `last region ends at ${last.bounds.y + last.bounds.h}, expected ${image.height}`,
    });
  }
  for (let i = 1; i < regions.length; i++) {
    const prev = regions[i - 1]!;
    const cur = regions[i]!;
    if (cur.bounds.y < prev.bounds.y) {
      out.push({ code: "not-ascending", message: `region ${cur.id} is out of order` });
    } else if (prev.bounds.y + prev.bounds.h !== cur.bounds.y) {
      out.push({
        code: "gap-or-overlap",
        message: `region ${prev.id} ends at ${prev.bounds.y + prev.bounds.h} but ${cur.id} starts at ${cur.bounds.y}`,
      });
    }
  }
  for (const region of regions) {
    if (region.bounds.h < MIN_REGION_HEIGHT) {
      out.push({ code: "too-short", message: `region ${region.id} height ${region.bounds.h} < ${MIN_REGION_HEIGHT}` });
    }
    if (region.bounds.x !== 0 || region.bounds.w !== image.width) {
      out.push({ code: "bad-x-or-width", message: `region ${region.id} must span full width` });
    }
  }
  const seen = new Set<string>();
  for (const region of regions) {
    if (seen.has(region.id)) {
      out.push({ code: "duplicate-id", message: `duplicate region id ${region.id}` });
    }
    seen.add(region.id);
  }
  return out;
}

function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function checkDocumentInvariants(doc: RegionSplitDoc): InvariantViolation[] {
  const out = checkInvariants(doc.regions, doc.image);
  const regions = new Map(doc.regions.map(region => [region.id, region]));
  const elements = new Map<string, ElementNode>();
  for (const element of doc.elements) {
    if (elements.has(element.id)) out.push({ code: "duplicate-element-id", message: `duplicate element id ${element.id}` });
    elements.set(element.id, element);
    if (!regions.has(element.regionId)) out.push({ code: "invalid-element-region", message: `unknown region ${element.regionId}` });
    if (![element.bounds.x, element.bounds.y, element.bounds.w, element.bounds.h].every(Number.isInteger)) out.push({ code: "fractional-element-bounds", message: `element ${element.id} bounds must be integers` });
    if (element.bounds.w < 4 || element.bounds.h < 4) out.push({ code: "element-too-small", message: `element ${element.id} is too small` });
    if (!contains({ x: 0, y: 0, w: doc.image.width, h: doc.image.height }, element.bounds)) {
      out.push({ code: "element-outside-image", message: `element ${element.id} is outside the image` });
    }
  }
  for (const element of doc.elements) {
    if (element.parentId) {
      const parent = elements.get(element.parentId);
      if (!parent) out.push({ code: "invalid-element-parent", message: `unknown parent ${element.parentId}` });
      else {
        if (!contains(parent.bounds, element.bounds)) out.push({ code: "child-outside-parent", message: `${element.id} is outside parent` });
        if (parent.regionId !== element.regionId) out.push({ code: "child-region-mismatch", message: `${element.id} must share its parent's region` });
      }
    } else if (!element.conflict) {
      const region = regions.get(element.regionId);
      if (region && !contains(region.bounds, element.bounds)) out.push({ code: "element-outside-region", message: `${element.id} is outside region` });
    }
    const seen = new Set<string>([element.id]);
    let parentId = element.parentId;
    while (parentId) {
      if (seen.has(parentId)) { out.push({ code: "element-parent-cycle", message: `element parent cycle at ${element.id}` }); break; }
      seen.add(parentId);
      parentId = elements.get(parentId)?.parentId ?? null;
    }
  }
  return out;
}
