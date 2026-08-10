# 分阶段 UI 还原工作台 · 阶段①试点 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现阶段①（测量与预处理）完整闭环：确定性测量（归一化/OCR/颜色）→ 本地工作台可视化微调 → 标注驱动 AI 补丁 → 确认冻结，产物为可 diff 的阶段文档文件。

**Architecture:** pnpm monorepo（沿用仓库既有 `ui/` 工作区）内新增 4 个包：`workbench-contracts`（类型+Schema+校验）、`measure`（sharp 归一化、RapidOCR Python 子进程桥、Lab 颜色聚类）、`workbench-server`（Fastify REST + 文件存储 + JSON Patch 历史 + 模型适配）、`workbench-ui`（Vue3 + Pinia + SVG 叠加画布）。AI 只在"标注→ChangeSet 提案"一个点介入，提案经 Schema 校验与越界/human 保护过滤，人工接受后才落库。

**Tech Stack:** TypeScript 5.9 / Node ≥22 / pnpm 10 / zod 3 / Fastify / fast-json-patch / sharp / RapidOCR(Python) / Vue 3 + Pinia + Vite / Vitest

**Spec:** `ui/docs/superpowers/specs/2026-08-10-staged-ui-restoration-workbench-design.md`

## Global Constraints

- 全部新代码位于 `ui/` 工作区内；**不得修改**遗留包（`packages/contracts`、`packages/cli`、`packages/codegen`、`apps/reference-app`）。
- 新包命名：`@ui-rebuild/workbench-contracts`、`@ui-rebuild/measure`、`@ui-rebuild/workbench-server`、`@ui-rebuild/workbench-cli`；UI 应用 `apps/workbench-ui`。
- 所有坐标一律为参考图**逻辑像素**（归一化后）；任何 API/存储不得出现物理像素。
- `source === "human"` 的条目：AI ChangeSet 与 analyze 重跑均不得修改/删除；服务端强制执行，不依赖前端。
- AI 提案（ChangeSet）永不自动落库；必须经 accept 端点显式接受。
- 阶段文档写操作全部经 JSON Patch（RFC 6902）并追加历史；`confirmed` 状态下文档只读。
- 模型调用仅 OpenAI 兼容接口，baseURL/apiKey/model 来自环境变量 `UIR_MODEL_BASE_URL / UIR_MODEL_API_KEY / UIR_MODEL_NAME`；测试一律注入 fake，不打真实网络。
- 每个 Task 结束必须 `pnpm -C ui test`（相关包）通过并提交一次 commit。
- 执行环境为 Windows（Git Bash 可用）；路径拼接用 `node:path`，禁止手写 `/` 拼接。

## File Structure（新增文件总览）

```text
ui/
  packages/workbench-contracts/
    package.json  tsconfig.json  vitest.config.ts
    src/geometry.ts          # Rect/Size + rectIntersects/rectContains/unionRects
    src/provenance.ts        # Source/Meta
    src/stage-doc.ts         # StageId/StageStatus/StageDoc + zod schema
    src/measurement.ts       # TextItem/ColorSample/IgnoreMask/Normalization/MeasurementPayload + schema
    src/annotation.ts        # Annotation/ChangeOp/ChangeSet + schema + guardChangeSet
    src/index.ts
  packages/measure/
    package.json  tsconfig.json  vitest.config.ts
    scripts/rapidocr_bridge.py   # Python: 图片路径入 → JSON 出
    src/normalize.ts         # sharp 归一化
    src/ocr.ts               # 子进程桥 + TextItem 映射
    src/color.ts             # 网格采样 + Lab + k-means
    src/index.ts
  packages/workbench-server/
    package.json  tsconfig.json  vitest.config.ts
    src/store.ts             # PageStore: 阶段文档读写/历史/undo/redo/指纹
    src/model-client.ts      # AnnotationModel 接口 + OpenAI 兼容实现
    src/routes/measurement.ts# 全部阶段①路由
    src/routes/reference.ts  # 参考图与 ?rect 裁剪
    src/app.ts               # buildApp(deps) 组装 Fastify
    src/index.ts             # 启动入口
  packages/workbench-cli/
    package.json  tsconfig.json
    src/init.ts  src/open.ts  src/doctor.ts  src/index.ts   # ui-restore 命令
  apps/workbench-ui/
    package.json  tsconfig.json  vite.config.ts  index.html
    src/main.ts  src/App.vue
    src/api.ts               # REST 客户端
    src/stores/measurement.ts# Pinia：文档/选择/撤销/审阅队列派生
    src/components/CanvasView.vue      # 底图+SVG 叠加+缩放平移+选择
    src/components/BoxOverlay.vue      # 单个文字框（含拖拽手柄）
    src/components/ReviewQueue.vue
    src/components/PropertyPanel.vue
    src/components/AnnotationPanel.vue # 标注输入 + ChangeSet 提案卡片
    src/components/ConfirmBar.vue
    src/lib/canvas-geometry.ts         # 视口↔图像坐标换算（纯函数，单测）
  pages/                     # 运行期页面工作区（gitignore 除 fixtures 拷贝示例）
```

**产物数据流：** `measure` 产出 `MeasurementPayload` → `PageStore` 存 `pages/<id>/stages/01-measurement.json` → UI 经 REST 读写 → confirm 后冻结。

---

### Task 1: workbench-contracts 脚手架 + 几何/来源基础类型

**Files:**
- Create: `ui/packages/workbench-contracts/package.json`
- Create: `ui/packages/workbench-contracts/tsconfig.json`
- Create: `ui/packages/workbench-contracts/vitest.config.ts`
- Create: `ui/packages/workbench-contracts/src/geometry.ts`
- Create: `ui/packages/workbench-contracts/src/provenance.ts`
- Create: `ui/packages/workbench-contracts/src/index.ts`
- Test: `ui/packages/workbench-contracts/src/geometry.test.ts`

**Interfaces:**
- Produces: `Rect{x,y,w,h}` `Size{w,h}` `Source` `Meta{source,confidence,reviewed}`；函数 `rectIntersects(a: Rect, b: Rect): boolean`、`rectContains(outer: Rect, inner: Rect): boolean`、`unionRects(rects: Rect[]): Rect`。后续所有包从 `@ui-rebuild/workbench-contracts` 导入。

- [ ] **Step 1: 建包脚手架**

`package.json`（对齐遗留 contracts 包风格）：

```json
{
  "name": "@ui-rebuild/workbench-contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "lint": "eslint src"
  },
  "dependencies": { "zod": "3.25.76" }
}
```

`tsconfig.json`：

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
```

确认 `ui/pnpm-workspace.yaml` 已含 `packages/*`（应已覆盖则不改；若为显式列表则追加一行）。

- [ ] **Step 2: 写失败测试** `src/geometry.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { rectContains, rectIntersects, unionRects } from "./geometry.js";

describe("geometry", () => {
  it("intersects overlapping rects", () => {
    expect(rectIntersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  });
  it("does not intersect touching edges", () => {
    expect(rectIntersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
  });
  it("contains inner rect inclusively", () => {
    expect(rectContains({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(true);
    expect(rectContains({ x: 0, y: 0, w: 10, h: 10 }, { x: 1, y: 1, w: 10, h: 10 })).toBe(false);
  });
  it("unions rects to bounding box", () => {
    expect(unionRects([{ x: 0, y: 0, w: 2, h: 2 }, { x: 4, y: 4, w: 2, h: 2 }]))
      .toEqual({ x: 0, y: 0, w: 6, h: 6 });
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm -C ui install && pnpm -C ui/packages/workbench-contracts test`
Expected: FAIL（`./geometry.js` 不存在）

- [ ] **Step 4: 实现** `src/geometry.ts`

```ts
export interface Rect { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }

export function rectIntersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function unionRects(rects: Rect[]): Rect {
  if (rects.length === 0) throw new Error("unionRects: empty input");
  const x1 = Math.min(...rects.map(r => r.x));
  const y1 = Math.min(...rects.map(r => r.y));
  const x2 = Math.max(...rects.map(r => r.x + r.w));
  const y2 = Math.max(...rects.map(r => r.y + r.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
```

`src/provenance.ts`：

```ts
export type Source = "tool" | "model" | "human";
export interface Meta { source: Source; confidence: number; reviewed: boolean }
```

`src/index.ts`：

```ts
export * from "./geometry.js";
export * from "./provenance.js";
```

- [ ] **Step 5: 跑测试通过并提交**

Run: `pnpm -C ui/packages/workbench-contracts test` → PASS

```bash
git add ui/packages/workbench-contracts ui/pnpm-lock.yaml
git commit -m "feat(workbench): add contracts package with geometry primitives"
```

---

### Task 2: StageDoc 外壳 + MeasurementPayload Schema

**Files:**
- Create: `ui/packages/workbench-contracts/src/stage-doc.ts`
- Create: `ui/packages/workbench-contracts/src/measurement.ts`
- Modify: `ui/packages/workbench-contracts/src/index.ts`
- Test: `ui/packages/workbench-contracts/src/measurement.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Rect/Size/Meta`。
- Produces: `StageId` `StageStatus` `StageDoc<T>`；`TextItem` `ColorSample` `IgnoreMask` `NormalizationInfo` `MeasurementPayload` `MeasurementDoc = StageDoc<MeasurementPayload>`；`measurementDocSchema`；`parseMeasurementDoc(data: unknown): MeasurementDoc`（失败抛 ZodError）、`emptyMeasurementDoc(): MeasurementDoc`。

- [ ] **Step 1: 写失败测试** `src/measurement.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { emptyMeasurementDoc, parseMeasurementDoc } from "./measurement.js";

const meta = { source: "tool", confidence: 0.9, reviewed: false } as const;

describe("measurement doc", () => {
  it("round-trips a valid doc", () => {
    const doc = emptyMeasurementDoc();
    doc.status = "draft";
    doc.payload.textItems.push({
      id: "t1", text: "会员", bounds: { x: 10, y: 20, w: 40, h: 16 },
      fontSizePx: 14, ocrConfidence: 0.98, ...meta,
    });
    expect(parseMeasurementDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });
  it("rejects unknown status", () => {
    const doc = { ...emptyMeasurementDoc(), status: "weird" };
    expect(() => parseMeasurementDoc(doc)).toThrow();
  });
  it("rejects confidence out of range", () => {
    const doc = emptyMeasurementDoc();
    doc.payload.colorSamples.push({
      id: "c1", role: "background", hex: "#ffffff", lab: [100, 0, 0],
      sampleRegion: { x: 0, y: 0, w: 8, h: 8 }, ...meta, confidence: 1.5,
    });
    expect(() => parseMeasurementDoc(JSON.parse(JSON.stringify(doc)))).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL（`./measurement.js` 不存在）

- [ ] **Step 3: 实现** `src/stage-doc.ts`

```ts
import { z } from "zod";

export const stageIds = ["measurement", "layout", "tokens", "content-assets", "page", "interactions"] as const;
export type StageId = (typeof stageIds)[number];
export const stageStatuses = ["empty", "analyzing", "draft", "confirmed"] as const;
export type StageStatus = (typeof stageStatuses)[number];

export interface StageDoc<TPayload> {
  stage: StageId;
  schemaVersion: string;
  status: StageStatus;
  payload: TPayload;
  upstreamFingerprint: string;   // 阶段①无上游，固定 ""
  confirmedAt?: string;
}

export function stageDocSchema<T extends z.ZodTypeAny>(stage: StageId, payload: T) {
  return z.object({
    stage: z.literal(stage),
    schemaVersion: z.string(),
    status: z.enum(stageStatuses),
    payload,
    upstreamFingerprint: z.string(),
    confirmedAt: z.string().optional(),
  });
}
```

`src/measurement.ts`：

```ts
import { z } from "zod";
import type { StageDoc } from "./stage-doc.js";
import { stageDocSchema } from "./stage-doc.js";

const rectSchema = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() });
const sizeSchema = z.object({ w: z.number().positive(), h: z.number().positive() });
const metaShape = {
  source: z.enum(["tool", "model", "human"]),
  confidence: z.number().min(0).max(1),
  reviewed: z.boolean(),
};

export const textItemSchema = z.object({
  id: z.string(), text: z.string(), bounds: rectSchema,
  lineHeightPx: z.number().positive().optional(),
  fontSizePx: z.number().positive().optional(),
  ocrConfidence: z.number().min(0).max(1),
  ...metaShape,
});
export type TextItem = z.infer<typeof textItemSchema>;

export const colorSampleSchema = z.object({
  id: z.string(),
  role: z.enum(["background", "surface", "text-primary", "text-secondary", "accent", "unknown"]),
  hex: z.string().regex(/^#[0-9a-f]{6}$/i),
  lab: z.tuple([z.number(), z.number(), z.number()]),
  sampleRegion: rectSchema,
  ...metaShape,
});
export type ColorSample = z.infer<typeof colorSampleSchema>;

export const ignoreMaskSchema = z.object({ id: z.string(), bounds: rectSchema, reason: z.string(), ...metaShape });
export type IgnoreMask = z.infer<typeof ignoreMaskSchema>;

export const normalizationSchema = z.object({
  referenceImage: z.string(),
  physicalSize: sizeSchema,
  scale: z.number().positive(),
  logicalSize: sizeSchema,
  statusBarCrop: rectSchema.optional(),
  ...metaShape,
});
export type NormalizationInfo = z.infer<typeof normalizationSchema>;

export const measurementPayloadSchema = z.object({
  normalization: normalizationSchema.nullable(),
  textItems: z.array(textItemSchema),
  colorSamples: z.array(colorSampleSchema),
  ignoreMasks: z.array(ignoreMaskSchema),
});
export type MeasurementPayload = z.infer<typeof measurementPayloadSchema>;
export type MeasurementDoc = StageDoc<MeasurementPayload>;

export const measurementDocSchema = stageDocSchema("measurement", measurementPayloadSchema);

export function parseMeasurementDoc(data: unknown): MeasurementDoc {
  return measurementDocSchema.parse(data) as MeasurementDoc;
}

export function emptyMeasurementDoc(): MeasurementDoc {
  return {
    stage: "measurement", schemaVersion: "1", status: "empty", upstreamFingerprint: "",
    payload: { normalization: null, textItems: [], colorSamples: [], ignoreMasks: [] },
  };
}
```

`src/index.ts` 追加：

```ts
export * from "./stage-doc.js";
export * from "./measurement.js";
```

- [ ] **Step 4: 跑测试通过** `pnpm -C ui/packages/workbench-contracts test` → PASS

- [ ] **Step 5: Commit**

```bash
git add ui/packages/workbench-contracts/src
git commit -m "feat(workbench): stage doc shell and measurement payload schema"
```

---

### Task 3: Annotation / ChangeSet Schema + 越界与 human 保护守卫

**Files:**
- Create: `ui/packages/workbench-contracts/src/annotation.ts`
- Modify: `ui/packages/workbench-contracts/src/index.ts`
- Test: `ui/packages/workbench-contracts/src/annotation.test.ts`

**Interfaces:**
- Consumes: `Rect` `rectIntersects` `MeasurementPayload`。
- Produces:
  - `Annotation{id,stage,bounds,instruction,targetIds?,createdAt}`
  - `ChangeOp{op:"replace"|"add"|"remove", path:string, value?:unknown, explanation:string}`
  - `ChangeSet{id,annotationId,operations:ChangeOp[],status:"proposed"|"accepted"|"rejected"}`
  - `annotationSchema` `changeSetSchema`
  - `guardChangeSet(cs: ChangeSet, payload: MeasurementPayload, bounds: Rect): { allowed: ChangeOp[]; rejected: { op: ChangeOp; reason: string }[] }`
    规则：path 仅允许 `/textItems/<i>...`、`/colorSamples/<i>...`、`/ignoreMasks/<i>...` 或数组末尾追加 `/-`；replace/remove 目标条目 `source==="human"` → 拒绝（`human-protected`）；目标条目 bounds 与标注 bounds 不相交 → 拒绝（`out-of-bounds`）；`/-` 追加的新条目 value.bounds 不与标注 bounds 相交 → 拒绝；其余 path → `invalid-path`。

- [ ] **Step 1: 写失败测试** `src/annotation.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { guardChangeSet, type ChangeSet } from "./annotation.js";
import { emptyMeasurementDoc } from "./measurement.js";

function payloadWithItems() {
  const p = emptyMeasurementDoc().payload;
  p.textItems.push(
    { id: "t0", text: "y128", bounds: { x: 10, y: 10, w: 40, h: 16 }, ocrConfidence: 0.7,
      source: "tool", confidence: 0.7, reviewed: false },
    { id: "t1", text: "已修", bounds: { x: 10, y: 40, w: 40, h: 16 }, ocrConfidence: 0.7,
      source: "human", confidence: 1, reviewed: true },
    { id: "t2", text: "远处", bounds: { x: 300, y: 500, w: 40, h: 16 }, ocrConfidence: 0.9,
      source: "tool", confidence: 0.9, reviewed: false },
  );
  return p;
}
const bounds = { x: 0, y: 0, w: 100, h: 100 };
const cs = (ops: ChangeSet["operations"]): ChangeSet =>
  ({ id: "cs1", annotationId: "a1", operations: ops, status: "proposed" });

describe("guardChangeSet", () => {
  it("allows replace on tool item inside bounds", () => {
    const r = guardChangeSet(cs([{ op: "replace", path: "/textItems/0/text", value: "¥128", explanation: "fix" }]),
      payloadWithItems(), bounds);
    expect(r.allowed).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });
  it("rejects ops on human items", () => {
    const r = guardChangeSet(cs([{ op: "replace", path: "/textItems/1/text", value: "x", explanation: "" }]),
      payloadWithItems(), bounds);
    expect(r.rejected[0]?.reason).toBe("human-protected");
  });
  it("rejects ops on items outside annotation bounds", () => {
    const r = guardChangeSet(cs([{ op: "remove", path: "/textItems/2", explanation: "" }]),
      payloadWithItems(), bounds);
    expect(r.rejected[0]?.reason).toBe("out-of-bounds");
  });
  it("rejects unknown paths", () => {
    const r = guardChangeSet(cs([{ op: "replace", path: "/status", value: "confirmed", explanation: "" }]),
      payloadWithItems(), bounds);
    expect(r.rejected[0]?.reason).toBe("invalid-path");
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现** `src/annotation.ts`

```ts
import { z } from "zod";
import { rectIntersects, type Rect } from "./geometry.js";
import type { MeasurementPayload } from "./measurement.js";

export const annotationSchema = z.object({
  id: z.string(),
  stage: z.literal("measurement"),
  bounds: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
  instruction: z.string().min(1),
  targetIds: z.array(z.string()).optional(),
  createdAt: z.string(),
});
export type Annotation = z.infer<typeof annotationSchema>;

export const changeOpSchema = z.object({
  op: z.enum(["replace", "add", "remove"]),
  path: z.string(),
  value: z.unknown().optional(),
  explanation: z.string(),
});
export type ChangeOp = z.infer<typeof changeOpSchema>;

export const changeSetSchema = z.object({
  id: z.string(),
  annotationId: z.string(),
  operations: z.array(changeOpSchema),
  status: z.enum(["proposed", "accepted", "rejected"]),
});
export type ChangeSet = z.infer<typeof changeSetSchema>;

const collections = ["textItems", "colorSamples", "ignoreMasks"] as const;
type Collection = (typeof collections)[number];
const pathRe = new RegExp(`^/(${collections.join("|")})/(\\d+|-)(/.*)?$`);

export interface GuardResult { allowed: ChangeOp[]; rejected: { op: ChangeOp; reason: string }[] }

export function guardChangeSet(cs: ChangeSet, payload: MeasurementPayload, bounds: Rect): GuardResult {
  const allowed: ChangeOp[] = [];
  const rejected: GuardResult["rejected"] = [];
  for (const op of cs.operations) {
    const m = pathRe.exec(op.path);
    if (!m) { rejected.push({ op, reason: "invalid-path" }); continue; }
    const coll = m[1] as Collection;
    const idx = m[2];
    if (idx === "-") {
      const v = op.value as { bounds?: Rect } | undefined;
      if (op.op !== "add" || !v?.bounds || !rectIntersects(v.bounds, bounds)) {
        rejected.push({ op, reason: "out-of-bounds" }); continue;
      }
      allowed.push(op); continue;
    }
    const item = (payload[coll] as { bounds: Rect; source: string }[])[Number(idx)];
    if (!item) { rejected.push({ op, reason: "invalid-path" }); continue; }
    if (item.source === "human") { rejected.push({ op, reason: "human-protected" }); continue; }
    if (!rectIntersects(item.bounds, bounds)) { rejected.push({ op, reason: "out-of-bounds" }); continue; }
    allowed.push(op);
  }
  return { allowed, rejected };
}
```

`src/index.ts` 追加 `export * from "./annotation.js";`

- [ ] **Step 4: 跑测试通过** → PASS
- [ ] **Step 5: Commit**

```bash
git add ui/packages/workbench-contracts/src
git commit -m "feat(workbench): annotation changeset schema with bounds and human guards"
```

---

### Task 4: measure 包 — 参考图归一化（sharp）

**Files:**
- Create: `ui/packages/measure/package.json`（依赖 `sharp`、`@ui-rebuild/workbench-contracts: workspace:*`；scripts 与 Task 1 相同）
- Create: `ui/packages/measure/tsconfig.json`、`vitest.config.ts`（内容同 Task 1 模板）
- Create: `ui/packages/measure/src/normalize.ts`
- Create: `ui/packages/measure/src/index.ts`
- Test: `ui/packages/measure/src/normalize.test.ts`

**Interfaces:**
- Produces: `normalizeReference(input: { imagePath: string; scale: number; statusBarHeightPx?: number; outPath: string }): Promise<NormalizationInfo>` — 读原图，按 `1/scale` 缩放到逻辑像素并写 `outPath`（PNG）；`statusBarHeightPx`（逻辑像素）> 0 时记录 `statusBarCrop = {x:0,y:0,w:logicalW,h:statusBarHeightPx}`（只记录为遮罩，不裁掉像素，保持坐标系完整）；返回 `NormalizationInfo`（`source:"tool"`, `confidence:1`, `reviewed:false`）。

- [ ] **Step 1: 写失败测试** `src/normalize.test.ts`（用 sharp 现场生成测试图，不提交二进制夹具）

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeReference } from "./normalize.js";

describe("normalizeReference", () => {
  it("scales physical pixels down to logical size", async () => {
    const dir = mkdtempSync(join(tmpdir(), "uir-"));
    const src = join(dir, "ref.png");
    await sharp({ create: { width: 750, height: 1500, channels: 3, background: "#ffffff" } })
      .png().toFile(src);
    const out = join(dir, "ref.norm.png");
    const info = await normalizeReference({ imagePath: src, scale: 2, statusBarHeightPx: 44, outPath: out });
    expect(info.physicalSize).toEqual({ w: 750, h: 1500 });
    expect(info.logicalSize).toEqual({ w: 375, h: 750 });
    expect(info.statusBarCrop).toEqual({ x: 0, y: 0, w: 375, h: 44 });
    const outMeta = await sharp(out).metadata();
    expect(outMeta.width).toBe(375);
    expect(info.source).toBe("tool");
  });
});
```

- [ ] **Step 2: 跑测试确认失败** `pnpm -C ui/packages/measure test` → FAIL

- [ ] **Step 3: 实现** `src/normalize.ts`

```ts
import sharp from "sharp";
import { basename } from "node:path";
import type { NormalizationInfo } from "@ui-rebuild/workbench-contracts";

export async function normalizeReference(input: {
  imagePath: string; scale: number; statusBarHeightPx?: number; outPath: string;
}): Promise<NormalizationInfo> {
  const meta = await sharp(input.imagePath).metadata();
  if (!meta.width || !meta.height) throw new Error(`cannot read image size: ${input.imagePath}`);
  const logicalW = Math.round(meta.width / input.scale);
  const logicalH = Math.round(meta.height / input.scale);
  await sharp(input.imagePath).resize(logicalW, logicalH).png().toFile(input.outPath);
  return {
    referenceImage: basename(input.outPath),
    physicalSize: { w: meta.width, h: meta.height },
    scale: input.scale,
    logicalSize: { w: logicalW, h: logicalH },
    ...(input.statusBarHeightPx && input.statusBarHeightPx > 0
      ? { statusBarCrop: { x: 0, y: 0, w: logicalW, h: input.statusBarHeightPx } }
      : {}),
    source: "tool", confidence: 1, reviewed: false,
  };
}
```

`src/index.ts`：`export * from "./normalize.js";`

- [ ] **Step 4: 跑测试通过** → PASS
- [ ] **Step 5: Commit** `git add ui/packages/measure ui/pnpm-lock.yaml && git commit -m "feat(workbench): reference image normalization"`

---

### Task 5: measure 包 — RapidOCR Python 桥

**Files:**
- Create: `ui/packages/measure/scripts/rapidocr_bridge.py`
- Create: `ui/packages/measure/src/ocr.ts`
- Modify: `ui/packages/measure/src/index.ts`
- Test: `ui/packages/measure/src/ocr.test.ts`
- Create: `ui/packages/measure/scripts/fake_ocr_bridge.py`（测试替身）

**Interfaces:**
- Produces: `runOcr(imagePath: string, opts?: { pythonBin?: string; bridgeScript?: string }): Promise<TextItem[]>`。桥协议：`python <bridge> <imagePath>` → stdout 单行 JSON `{"items":[{"text":str,"box":[x,y,w,h],"score":float}]}`（box 为归一化图上的像素）。`runOcr` 将其映射为 `TextItem`：`id` 为 `t-<序号>`、`fontSizePx = Math.round(h * 0.72)`（字高经验系数，人工可改）、`source:"tool"`、`confidence=score`、`ocrConfidence=score`、`reviewed:false`。非零退出码/非法 JSON → 抛错并附 stderr。

- [ ] **Step 1: 写真桥脚本** `scripts/rapidocr_bridge.py`

```python
import json, sys

def main() -> None:
    image_path = sys.argv[1]
    from rapidocr_onnxruntime import RapidOCR
    engine = RapidOCR()
    result, _ = engine(image_path)
    items = []
    for box, text, score in (result or []):
        xs = [p[0] for p in box]; ys = [p[1] for p in box]
        x, y = min(xs), min(ys)
        items.append({"text": text, "box": [round(x), round(y), round(max(xs) - x), round(max(ys) - y)],
                      "score": float(score)})
    print(json.dumps({"items": items}, ensure_ascii=False))

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 写测试替身** `scripts/fake_ocr_bridge.py`（无需安装 rapidocr，输出固定结果；`FAIL` 入参时退出码 3）

```python
import json, sys

if len(sys.argv) > 1 and sys.argv[1].endswith("FAIL.png"):
    print("boom", file=sys.stderr); sys.exit(3)
print(json.dumps({"items": [
    {"text": "会员中心", "box": [24, 60, 96, 22], "score": 0.98},
    {"text": "y128", "box": [24, 120, 48, 18], "score": 0.61},
]}, ensure_ascii=False))
```

- [ ] **Step 3: 写失败测试** `src/ocr.test.ts`

```ts
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runOcr } from "./ocr.js";

const here = dirname(fileURLToPath(import.meta.url));
const fake = join(here, "..", "scripts", "fake_ocr_bridge.py");
const py = process.env.UIR_PYTHON_BIN ?? "python";

describe("runOcr", () => {
  it("maps bridge output to TextItems", async () => {
    const items = await runOcr("whatever.png", { pythonBin: py, bridgeScript: fake });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "t-0", text: "会员中心", bounds: { x: 24, y: 60, w: 96, h: 22 },
      fontSizePx: 16, source: "tool", ocrConfidence: 0.98, reviewed: false,
    });
  });
  it("throws with stderr on bridge failure", async () => {
    await expect(runOcr("FAIL.png", { pythonBin: py, bridgeScript: fake })).rejects.toThrow(/boom/);
  });
});
```

- [ ] **Step 4: 跑测试确认失败** → FAIL

- [ ] **Step 5: 实现** `src/ocr.ts`

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { TextItem } from "@ui-rebuild/workbench-contracts";

const execFileAsync = promisify(execFile);
const defaultBridge = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "rapidocr_bridge.py");

interface BridgeItem { text: string; box: [number, number, number, number]; score: number }

export async function runOcr(imagePath: string, opts: { pythonBin?: string; bridgeScript?: string } = {}): Promise<TextItem[]> {
  const python = opts.pythonBin ?? process.env.UIR_PYTHON_BIN ?? "python";
  const bridge = opts.bridgeScript ?? defaultBridge;
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(python, [bridge, imagePath], { maxBuffer: 32 * 1024 * 1024 }));
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new Error(`ocr bridge failed: ${e.stderr ?? e.message}`);
  }
  const parsed = JSON.parse(stdout) as { items: BridgeItem[] };
  return parsed.items.map((item, i) => ({
    id: `t-${i}`,
    text: item.text,
    bounds: { x: item.box[0], y: item.box[1], w: item.box[2], h: item.box[3] },
    fontSizePx: Math.round(item.box[3] * 0.72),
    ocrConfidence: item.score,
    source: "tool" as const,
    confidence: item.score,
    reviewed: false,
  }));
}
```

`src/index.ts` 追加 `export * from "./ocr.js";`

- [ ] **Step 6: 跑测试通过** → PASS（环境无 `python` 时设 `UIR_PYTHON_BIN` 后重跑；仍无则此 Task 标记阻塞并上报，不得跳过测试）
- [ ] **Step 7: Commit** `git add ui/packages/measure && git commit -m "feat(workbench): rapidocr python bridge"`

---

### Task 6: measure 包 — 颜色采样与聚类

**Files:**
- Create: `ui/packages/measure/src/color.ts`
- Modify: `ui/packages/measure/src/index.ts`
- Test: `ui/packages/measure/src/color.test.ts`

**Interfaces:**
- Consumes: `TextItem`（避开文字区域采样）。
- Produces:
  - `rgbToLab(r: number, g: number, b: number): [number, number, number]`（D65/sRGB 标准转换）
  - `sampleColors(imagePath: string, textItems: TextItem[], opts?: { k?: number }): Promise<ColorSample[]>` — 归一化图上按 16px 网格取 8×8 均值色块，跳过与任意 textItem bounds 相交及距图边 <8px 的网格；Lab 空间 k-means（默认 k=5，固定迭代 20 轮、以像素索引均匀取初始中心保证确定性）；每簇产出一个 `ColorSample`：`hex` 为簇内最近真实采样色、`sampleRegion` 为该采样网格、占比最大簇 `role:"background"` 其余 `"unknown"`、`confidence` = 簇内平均 ΔE 越小越高（`max(0.5, 1 - meanDe/20)`）、`source:"tool"`。

- [ ] **Step 1: 写失败测试** `src/color.test.ts`（现场合成上灰下白双色图）

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { rgbToLab, sampleColors } from "./color.js";

describe("color", () => {
  it("converts white to Lab L=100", () => {
    const [l, a, b] = rgbToLab(255, 255, 255);
    expect(l).toBeCloseTo(100, 0);
    expect(Math.abs(a)).toBeLessThan(1);
    expect(Math.abs(b)).toBeLessThan(1);
  });
  it("finds the two dominant colors and marks the biggest as background", async () => {
    const dir = mkdtempSync(join(tmpdir(), "uir-"));
    const img = join(dir, "two.png");
    await sharp({ create: { width: 200, height: 300, channels: 3, background: "#f5f5f5" } })
      .composite([{ input: { create: { width: 200, height: 100, channels: 3, background: "#ff3355" } }, top: 200, left: 0 }])
      .png().toFile(img);
    const samples = await sampleColors(img, [], { k: 2 });
    expect(samples).toHaveLength(2);
    const bg = samples.find(s => s.role === "background");
    expect(bg?.hex.toLowerCase()).toBe("#f5f5f5");
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现** `src/color.ts`

```ts
import sharp from "sharp";
import { rectIntersects, type Rect } from "@ui-rebuild/workbench-contracts";
import type { ColorSample, TextItem } from "@ui-rebuild/workbench-contracts";

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const f = (v: number) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
  const [rl, gl, bl] = [f(r), f(g), f(b)];
  let x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  let y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  let z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  const g2 = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  [x, y, z] = [g2(x), g2(y), g2(z)];
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const deltaE = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const toHex = (rgb: number[]) => "#" + rgb.map(v => Math.round(v).toString(16).padStart(2, "0")).join("");

interface Cell { rgb: [number, number, number]; lab: [number, number, number]; region: Rect }

export async function sampleColors(imagePath: string, textItems: TextItem[], opts: { k?: number } = {}): Promise<ColorSample[]> {
  const k = opts.k ?? 5;
  const { data, info } = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
  const cells: Cell[] = [];
  const step = 16, size = 8, margin = 8;
  for (let y = margin; y + size < info.height - margin; y += step) {
    for (let x = margin; x + size < info.width - margin; x += step) {
      const region: Rect = { x, y, w: size, h: size };
      if (textItems.some(t => rectIntersects(t.bounds, region))) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
        const i = ((y + dy) * info.width + (x + dx)) * info.channels;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
      const rgb: [number, number, number] = [r / n, g / n, b / n];
      cells.push({ rgb, lab: rgbToLab(...rgb), region });
    }
  }
  if (cells.length === 0) return [];
  // 确定性 k-means：均匀间隔取初始中心
  let centers = Array.from({ length: Math.min(k, cells.length) },
    (_, i) => cells[Math.floor((i * cells.length) / Math.min(k, cells.length))].lab.slice() as number[]);
  let assign = new Array<number>(cells.length).fill(0);
  for (let iter = 0; iter < 20; iter++) {
    assign = cells.map(c => centers.reduce((best, ctr, ci) =>
      deltaE(c.lab, ctr) < deltaE(c.lab, centers[best]) ? ci : best, 0));
    centers = centers.map((ctr, ci) => {
      const mine = cells.filter((_, i) => assign[i] === ci);
      if (mine.length === 0) return ctr;
      return [0, 1, 2].map(d => mine.reduce((s, c) => s + c.lab[d], 0) / mine.length);
    });
  }
  const clusters = centers.map((ctr, ci) => {
    const mine = cells.filter((_, i) => assign[i] === ci);
    return { ctr, mine };
  }).filter(c => c.mine.length > 0);
  clusters.sort((a, b) => b.mine.length - a.mine.length);
  return clusters.map((c, ci) => {
    const rep = c.mine.reduce((best, cell) => deltaE(cell.lab, c.ctr) < deltaE(best.lab, c.ctr) ? cell : best);
    const meanDe = c.mine.reduce((s, cell) => s + deltaE(cell.lab, c.ctr), 0) / c.mine.length;
    return {
      id: `c-${ci}`, role: ci === 0 ? "background" as const : "unknown" as const,
      hex: toHex(rep.rgb), lab: rep.lab, sampleRegion: rep.region,
      source: "tool" as const, confidence: Math.max(0.5, 1 - meanDe / 20), reviewed: false,
    };
  });
}
```

`src/index.ts` 追加 `export * from "./color.js";`

- [ ] **Step 4: 跑测试通过** → PASS
- [ ] **Step 5: Commit** `git add ui/packages/measure/src && git commit -m "feat(workbench): color sampling with lab kmeans"`

---

### Task 7: workbench-server — PageStore（文档读写 + JSON Patch 历史 + undo/redo）

**Files:**
- Create: `ui/packages/workbench-server/package.json`（依赖 `fastify`、`fast-json-patch`、`@ui-rebuild/workbench-contracts: workspace:*`、`@ui-rebuild/measure: workspace:*`、`sharp`；dev 依赖 `vitest`）
- Create: `ui/packages/workbench-server/tsconfig.json`、`vitest.config.ts`（同 Task 1 模板）
- Create: `ui/packages/workbench-server/src/store.ts`
- Test: `ui/packages/workbench-server/src/store.test.ts`

**Interfaces:**
- Produces: `class PageStore`：
  - `constructor(pagesRoot: string)`
  - `pageDir(pageId): string`；`readDoc(pageId): MeasurementDoc`（无文件返回 `emptyMeasurementDoc()`）；`writeDoc(pageId, doc): void`（写 `stages/01-measurement.json`，2 空格缩进 + 末尾换行）
  - `applyPatch(pageId, ops: Operation[], origin: "human" | "changeset"): MeasurementDoc` — 对当前 doc 应用 fast-json-patch；应用后 zod 校验，失败抛错不落盘；`confirmed` 状态抛 `Error("stage is confirmed")`；成功则落盘 + 追加历史文件 `history/01-measurement/<seq>.json`（内容 `{seq, at, origin, ops, inverse}`，`inverse` 为反向补丁，用 fast-json-patch 的 `compare(after, before)` 生成）
  - `undo(pageId): MeasurementDoc | null`、`redo(pageId): MeasurementDoc | null` — 基于历史序号游标（游标存 `history/01-measurement/cursor.json`）
  - `fingerprint(doc): string`（payload 的 sha256 hex）
- 注：patch 目标是**整个 doc**（path 以 `/payload/...` 开头），人工直接编辑（改 bounds、文字、reviewed 等）与已接受的 ChangeSet 都走它；ChangeSet 的 `/textItems/...` 路径由路由层加 `/payload` 前缀后传入。

- [ ] **Step 1: 写失败测试** `src/store.test.ts`

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PageStore } from "./store.js";

const meta = { source: "tool", confidence: 0.9, reviewed: false } as const;
const item = { id: "t0", text: "y128", bounds: { x: 1, y: 1, w: 10, h: 10 }, ocrConfidence: 0.9, ...meta };

function freshStore() {
  return new PageStore(mkdtempSync(join(tmpdir(), "uir-pages-")));
}

describe("PageStore", () => {
  it("returns empty doc for unknown page", () => {
    expect(freshStore().readDoc("p1").status).toBe("empty");
  });
  it("applies patch, persists, and undoes/redoes", () => {
    const s = freshStore();
    s.applyPatch("p1", [
      { op: "replace", path: "/status", value: "draft" },
      { op: "add", path: "/payload/textItems/-", value: item },
    ], "human");
    s.applyPatch("p1", [{ op: "replace", path: "/payload/textItems/0/text", value: "¥128" }], "human");
    expect(s.readDoc("p1").payload.textItems[0].text).toBe("¥128");
    expect(s.undo("p1")?.payload.textItems[0].text).toBe("y128");
    expect(s.redo("p1")?.payload.textItems[0].text).toBe("¥128");
  });
  it("rejects invalid payload and keeps file untouched", () => {
    const s = freshStore();
    s.applyPatch("p1", [{ op: "replace", path: "/status", value: "draft" }], "human");
    expect(() => s.applyPatch("p1", [{ op: "replace", path: "/status", value: "nope" }], "human")).toThrow();
    expect(s.readDoc("p1").status).toBe("draft");
  });
  it("rejects patches on confirmed docs", () => {
    const s = freshStore();
    s.applyPatch("p1", [{ op: "replace", path: "/status", value: "confirmed" }], "human");
    expect(() => s.applyPatch("p1", [{ op: "add", path: "/payload/textItems/-", value: item }], "human"))
      .toThrow(/confirmed/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现** `src/store.ts`

```ts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as jsonpatch from "fast-json-patch";
import type { Operation } from "fast-json-patch";
import { emptyMeasurementDoc, parseMeasurementDoc, type MeasurementDoc } from "@ui-rebuild/workbench-contracts";

interface HistoryEntry { seq: number; at: string; origin: string; ops: Operation[]; inverse: Operation[] }

export class PageStore {
  constructor(private pagesRoot: string) {}

  pageDir(pageId: string) { return join(this.pagesRoot, pageId); }
  private docPath(pageId: string) { return join(this.pageDir(pageId), "stages", "01-measurement.json"); }
  private histDir(pageId: string) { return join(this.pageDir(pageId), "history", "01-measurement"); }
  private cursorPath(pageId: string) { return join(this.histDir(pageId), "cursor.json"); }

  readDoc(pageId: string): MeasurementDoc {
    const p = this.docPath(pageId);
    if (!existsSync(p)) return emptyMeasurementDoc();
    return parseMeasurementDoc(JSON.parse(readFileSync(p, "utf8")));
  }

  writeDoc(pageId: string, doc: MeasurementDoc): void {
    mkdirSync(join(this.pageDir(pageId), "stages"), { recursive: true });
    writeFileSync(this.docPath(pageId), JSON.stringify(doc, null, 2) + "\n", "utf8");
  }

  private readCursor(pageId: string): number {
    const p = this.cursorPath(pageId);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as { cursor: number }).cursor : 0;
  }
  private writeCursor(pageId: string, cursor: number): void {
    mkdirSync(this.histDir(pageId), { recursive: true });
    writeFileSync(this.cursorPath(pageId), JSON.stringify({ cursor }) + "\n", "utf8");
  }
  private readEntry(pageId: string, seq: number): HistoryEntry | null {
    const p = join(this.histDir(pageId), `${String(seq).padStart(6, "0")}.json`);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as HistoryEntry) : null;
  }

  applyPatch(pageId: string, ops: Operation[], origin: "human" | "changeset"): MeasurementDoc {
    const before = this.readDoc(pageId);
    if (before.status === "confirmed" && !ops.some(o => o.path === "/status")) {
      throw new Error("stage is confirmed");
    }
    const after = parseMeasurementDoc(
      jsonpatch.applyPatch(jsonpatch.deepClone(before), jsonpatch.deepClone(ops), true, false).newDocument,
    );
    const cursor = this.readCursor(pageId);
    const entry: HistoryEntry = {
      seq: cursor + 1, at: new Date().toISOString(), origin,
      ops, inverse: jsonpatch.compare(after, before),
    };
    this.writeDoc(pageId, after);
    mkdirSync(this.histDir(pageId), { recursive: true });
    writeFileSync(join(this.histDir(pageId), `${String(entry.seq).padStart(6, "0")}.json`),
      JSON.stringify(entry, null, 2) + "\n", "utf8");
    this.writeCursor(pageId, entry.seq);
    return after;
  }

  undo(pageId: string): MeasurementDoc | null {
    const cursor = this.readCursor(pageId);
    const entry = this.readEntry(pageId, cursor);
    if (!entry) return null;
    const doc = parseMeasurementDoc(
      jsonpatch.applyPatch(jsonpatch.deepClone(this.readDoc(pageId)), jsonpatch.deepClone(entry.inverse), true, false).newDocument,
    );
    this.writeDoc(pageId, doc);
    this.writeCursor(pageId, cursor - 1);
    return doc;
  }

  redo(pageId: string): MeasurementDoc | null {
    const cursor = this.readCursor(pageId);
    const entry = this.readEntry(pageId, cursor + 1);
    if (!entry) return null;
    const doc = parseMeasurementDoc(
      jsonpatch.applyPatch(jsonpatch.deepClone(this.readDoc(pageId)), jsonpatch.deepClone(entry.ops), true, false).newDocument,
    );
    this.writeDoc(pageId, doc);
    this.writeCursor(pageId, cursor + 1);
    return doc;
  }

  fingerprint(doc: MeasurementDoc): string {
    return createHash("sha256").update(JSON.stringify(doc.payload)).digest("hex");
  }

  listHistory(pageId: string): HistoryEntry[] {
    if (!existsSync(this.histDir(pageId))) return [];
    return readdirSync(this.histDir(pageId)).filter(f => /^\d+\.json$/.test(f)).sort()
      .map(f => JSON.parse(readFileSync(join(this.histDir(pageId), f), "utf8")) as HistoryEntry);
  }
}
```

注意：redo 之后若产生新 patch，后续 seq 文件会被覆盖（新写入同号文件），这正是"撤销后再编辑丢弃 redo 分支"的期望语义。

- [ ] **Step 4: 跑测试通过** → PASS
- [ ] **Step 5: Commit** `git add ui/packages/workbench-server ui/pnpm-lock.yaml && git commit -m "feat(workbench): page store with json patch history"`

---

### Task 8: workbench-server — 文档路由 + analyze（保留 human 条目的合并）

**Files:**
- Create: `ui/packages/workbench-server/src/routes/measurement.ts`
- Create: `ui/packages/workbench-server/src/app.ts`
- Test: `ui/packages/workbench-server/src/routes/measurement.test.ts`

**Interfaces:**
- Consumes: `PageStore`、`normalizeReference`、`runOcr`、`sampleColors`。
- Produces: `buildApp(deps: AppDeps): FastifyInstance`，其中

```ts
export interface AppDeps {
  store: PageStore;
  measure: {   // 可注入 fake，测试不跑真 OCR
    normalize: typeof normalizeReference;
    ocr: (imagePath: string) => Promise<TextItem[]>;
    colors: (imagePath: string, items: TextItem[]) => Promise<ColorSample[]>;
  };
  model: AnnotationModel;        // Task 9 定义；本 Task 先占位 { proposeChangeSet: () => Promise.reject(new Error("not configured")) }
}
```

路由（均挂 `/api/pages/:pageId/stages/measurement` 前缀）：
  - `GET /` → `{ doc, fingerprint }`
  - `PATCH /` body `{ ops: Operation[] }` → 应用为 human patch；zod/patch 错误 → 400 `{error}`；confirmed → 409
  - `POST /analyze` body `{ scale: number; statusBarHeightPx?: number }` → 读 `reference/default.png`，归一化写 `reference/default.norm.png`，OCR + 颜色；**合并规则**：新 doc 的 textItems = 工具新结果 + 旧 doc 中全部 `source==="human"` 的条目（追加尾部，id 前缀 `keep-` 防撞）；colorSamples 同规则；ignoreMasks 全保留；status → `draft`。整个结果通过一次 `applyPatch(pageId, [{op:"replace",path:"",value:newDoc}], "human")` 落盘？——**不行**，根路径 replace 不合法；改为 `writeDoc` 直写 + 手动追加一条 origin `"analyze"` 的历史（复用 `applyPatch` 逻辑需放开 origin 类型为 string）。
  - `POST /undo`、`POST /redo` → `{ doc }`；无可撤销 → 204

- [ ] **Step 1: 写失败测试** `src/routes/measurement.test.ts`

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp, type AppDeps } from "../app.js";
import { PageStore } from "../store.js";

const meta = { source: "tool", confidence: 0.9, reviewed: false } as const;
const toolItem = { id: "t-0", text: "会员", bounds: { x: 1, y: 1, w: 10, h: 10 }, ocrConfidence: 0.9, ...meta };

function makeApp() {
  const root = mkdtempSync(join(tmpdir(), "uir-pages-"));
  mkdirSync(join(root, "p1", "reference"), { recursive: true });
  writeFileSync(join(root, "p1", "reference", "default.png"), "fake");
  const store = new PageStore(root);
  const deps: AppDeps = {
    store,
    measure: {
      normalize: async () => ({ referenceImage: "default.norm.png", physicalSize: { w: 750, h: 1500 },
        scale: 2, logicalSize: { w: 375, h: 750 }, source: "tool", confidence: 1, reviewed: false }),
      ocr: async () => [toolItem],
      colors: async () => [],
    },
    model: { proposeChangeSet: () => Promise.reject(new Error("not configured")) },
  };
  return { app: buildApp(deps), store };
}

describe("measurement routes", () => {
  it("GET returns empty doc initially", async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: "GET", url: "/api/pages/p1/stages/measurement" });
    expect(res.statusCode).toBe(200);
    expect(res.json().doc.status).toBe("empty");
  });
  it("analyze fills doc and preserves human items on rerun", async () => {
    const { app } = makeApp();
    await app.inject({ method: "POST", url: "/api/pages/p1/stages/measurement/analyze",
      payload: { scale: 2 } });
    const patch = [{ op: "add", path: "/payload/textItems/-", value:
      { ...toolItem, id: "h-1", text: "人工加的", source: "human", confidence: 1, reviewed: true } }];
    await app.inject({ method: "PATCH", url: "/api/pages/p1/stages/measurement", payload: { ops: patch } });
    const res = await app.inject({ method: "POST", url: "/api/pages/p1/stages/measurement/analyze",
      payload: { scale: 2 } });
    const texts = res.json().doc.payload.textItems.map((t: { text: string }) => t.text);
    expect(texts).toContain("人工加的");
    expect(texts).toContain("会员");
  });
  it("PATCH rejects invalid ops with 400", async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: "PATCH", url: "/api/pages/p1/stages/measurement",
      payload: { ops: [{ op: "replace", path: "/status", value: "bogus" }] } });
    expect(res.statusCode).toBe(400);
  });
  it("PATCH on confirmed doc returns 409", async () => {
    const { app, store } = makeApp();
    store.applyPatch("p1", [{ op: "replace", path: "/status", value: "confirmed" }], "human");
    const res = await app.inject({ method: "PATCH", url: "/api/pages/p1/stages/measurement",
      payload: { ops: [{ op: "add", path: "/payload/textItems/-", value: toolItem }] } });
    expect(res.statusCode).toBe(409);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现**

`src/app.ts`：

```ts
import Fastify, { type FastifyInstance } from "fastify";
import type { ColorSample, TextItem } from "@ui-rebuild/workbench-contracts";
import type { normalizeReference } from "@ui-rebuild/measure";
import type { PageStore } from "./store.js";
import type { AnnotationModel } from "./model-client.js";
import { registerMeasurementRoutes } from "./routes/measurement.js";

export interface AppDeps {
  store: PageStore;
  measure: {
    normalize: typeof normalizeReference;
    ocr: (imagePath: string) => Promise<TextItem[]>;
    colors: (imagePath: string, items: TextItem[]) => Promise<ColorSample[]>;
  };
  model: AnnotationModel;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify();
  registerMeasurementRoutes(app, deps);
  return app;
}
```

`src/model-client.ts`（本 Task 只放接口，Task 9 补实现）：

```ts
import type { Annotation, ChangeSet, MeasurementPayload } from "@ui-rebuild/workbench-contracts";

export interface AnnotationModel {
  proposeChangeSet(input: {
    annotation: Annotation;
    cropPngBase64: string;
    itemsInBounds: unknown[];
    payload: MeasurementPayload;
  }): Promise<ChangeSet>;
}
```

`src/routes/measurement.ts`：

```ts
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Operation } from "fast-json-patch";
import { emptyMeasurementDoc, type MeasurementDoc, type TextItem } from "@ui-rebuild/workbench-contracts";
import type { AppDeps } from "../app.js";

const PREFIX = "/api/pages/:pageId/stages/measurement";
type Params = { pageId: string };

export function registerMeasurementRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { store } = deps;

  app.get<{ Params: Params }>(PREFIX, async (req) => {
    const doc = store.readDoc(req.params.pageId);
    return { doc, fingerprint: store.fingerprint(doc) };
  });

  app.patch<{ Params: Params; Body: { ops: Operation[] } }>(PREFIX, async (req, reply) => {
    try {
      return { doc: store.applyPatch(req.params.pageId, req.body.ops, "human") };
    } catch (err) {
      const msg = (err as Error).message;
      return reply.code(msg.includes("confirmed") ? 409 : 400).send({ error: msg });
    }
  });

  app.post<{ Params: Params; Body: { scale: number; statusBarHeightPx?: number } }>(
    `${PREFIX}/analyze`, async (req, reply) => {
      const { pageId } = req.params;
      const old = store.readDoc(pageId);
      if (old.status === "confirmed") return reply.code(409).send({ error: "stage is confirmed" });
      const refDir = join(store.pageDir(pageId), "reference");
      const src = join(refDir, "default.png");
      const out = join(refDir, "default.norm.png");
      const normalization = await deps.measure.normalize({
        imagePath: src, scale: req.body.scale,
        statusBarHeightPx: req.body.statusBarHeightPx, outPath: out,
      });
      const textItems = await deps.measure.ocr(out);
      const colorSamples = await deps.measure.colors(out, textItems);
      const keepText = old.payload.textItems.filter(t => t.source === "human")
        .map((t, i) => ({ ...t, id: t.id.startsWith("keep-") ? t.id : `keep-${i}-${t.id}` }));
      const keepColors = old.payload.colorSamples.filter(c => c.source === "human");
      const doc: MeasurementDoc = {
        ...emptyMeasurementDoc(), status: "draft",
        payload: {
          normalization,
          textItems: [...textItems, ...keepText] as TextItem[],
          colorSamples: [...colorSamples, ...keepColors],
          ignoreMasks: old.payload.ignoreMasks,
        },
      };
      store.writeDoc(pageId, doc);
      return { doc };
    });

  app.post<{ Params: Params }>(`${PREFIX}/undo`, async (req, reply) => {
    const doc = store.undo(req.params.pageId);
    return doc ? { doc } : reply.code(204).send();
  });
  app.post<{ Params: Params }>(`${PREFIX}/redo`, async (req, reply) => {
    const doc = store.redo(req.params.pageId);
    return doc ? { doc } : reply.code(204).send();
  });
}
```

注：analyze 直写 doc 不走 applyPatch（根替换非法），代价是 analyze 本身不可 undo——可接受，重跑 analyze 即等效恢复。

- [ ] **Step 4: 跑测试通过** → PASS
- [ ] **Step 5: Commit** `git add ui/packages/workbench-server/src && git commit -m "feat(workbench): measurement routes with human-preserving analyze"`

---

### Task 9: workbench-server — 模型客户端 + 标注/ChangeSet 路由

**Files:**
- Modify: `ui/packages/workbench-server/src/model-client.ts`（追加 OpenAI 兼容实现）
- Create: `ui/packages/workbench-server/src/routes/annotation.ts`
- Modify: `ui/packages/workbench-server/src/app.ts`（注册新路由）
- Test: `ui/packages/workbench-server/src/routes/annotation.test.ts`

**Interfaces:**
- Consumes: `AnnotationModel`（Task 8）、`guardChangeSet`、`PageStore.applyPatch`。
- Produces:
  - `createOpenAiAnnotationModel(cfg: { baseUrl: string; apiKey: string; model: string }): AnnotationModel` — POST `{baseUrl}/chat/completions`，messages 含 system 提示（要求仅输出符合 ChangeSet JSON 的对象，path 相对 payload，如 `/textItems/3/text`）、user 内容 = 指令文字 + `data:image/png;base64` 裁剪图 + 框内条目 JSON。响应 `choices[0].message.content` 先直接 `JSON.parse`，失败再截取首个 `{...}` 块重试一次，仍失败抛错。结果过 `changeSetSchema.parse`。
  - 路由：
    - `POST ${PREFIX}/annotations` body `{ bounds, instruction, targetIds? }` → 服务端裁剪归一化图（sharp `extract`，bounds 外扩 10% 并夹紧图界）→ 调 `model.proposeChangeSet` → `guardChangeSet` 过滤 → 存 `stages/changesets/<id>.json`（含 allowed/rejected）→ 返回 `{ changeSet: { id, allowed, rejected } }`；模型异常 → 502 `{error}`
    - `POST ${PREFIX}/changesets/:csId/accept` body `{ opIndexes?: number[] }`（缺省全部 allowed）→ 把选中 ops 的 path 加 `/payload` 前缀后 `applyPatch(pageId, ops, "changeset")` → 标记 changeset `accepted` → `{ doc }`；找不到/已接受 → 404/409

- [ ] **Step 1: 写失败测试** `src/routes/annotation.test.ts`（fake model 注入；makeApp 复用 Task 8 测试的构造函数——将其提取到 `src/test-helpers.ts` 导出 `makeApp(overrides?: Partial<AppDeps>)`，Task 8 测试同步改为引用它）

```ts
import { describe, expect, it } from "vitest";
import type { ChangeSet } from "@ui-rebuild/workbench-contracts";
import { makeApp, toolItem } from "../test-helpers.js";

const proposal: ChangeSet = {
  id: "cs-1", annotationId: "a-1", status: "proposed",
  operations: [
    { op: "replace", path: "/textItems/0/text", value: "¥128", explanation: "货币符号误识" },
    { op: "replace", path: "/status", value: "confirmed", explanation: "越权操作应被拒" },
  ],
};

describe("annotation routes", () => {
  it("proposes guarded changeset and accepts allowed ops", async () => {
    const { app } = makeApp({ model: { proposeChangeSet: async () => proposal } });
    await app.inject({ method: "POST", url: "/api/pages/p1/stages/measurement/analyze", payload: { scale: 2 } });
    const res = await app.inject({ method: "POST", url: "/api/pages/p1/stages/measurement/annotations",
      payload: { bounds: { x: 0, y: 0, w: 50, h: 50 }, instruction: "y应为¥" } });
    expect(res.statusCode).toBe(200);
    const cs = res.json().changeSet;
    expect(cs.allowed).toHaveLength(1);
    expect(cs.rejected).toHaveLength(1);
    const acc = await app.inject({ method: "POST",
      url: `/api/pages/p1/stages/measurement/changesets/${cs.id}/accept`, payload: {} });
    expect(acc.json().doc.payload.textItems[0].text).toBe("¥128");
  });
  it("returns 502 when model fails", async () => {
    const { app } = makeApp({ model: { proposeChangeSet: async () => { throw new Error("llm down"); } } });
    await app.inject({ method: "POST", url: "/api/pages/p1/stages/measurement/analyze", payload: { scale: 2 } });
    const res = await app.inject({ method: "POST", url: "/api/pages/p1/stages/measurement/annotations",
      payload: { bounds: { x: 0, y: 0, w: 50, h: 50 }, instruction: "x" } });
    expect(res.statusCode).toBe(502);
  });
});
```

`src/test-helpers.ts`（同 Task 8 的 makeApp，`measure.normalize` fake 需真实写出一张 1x1 PNG 到 outPath——用 sharp 生成——否则裁剪步骤读文件失败；`toolItem` 一并导出）。裁剪失败（如 fake 图小于 bounds）不应 500：实现中裁剪区域必须与图像尺寸求交后再 extract。

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现**

`src/model-client.ts` 追加：

```ts
import { changeSetSchema } from "@ui-rebuild/workbench-contracts";

const SYSTEM_PROMPT = [
  "你是 UI 截图测量数据的修正助手。用户框选了截图局部并给出指令。",
  "你只能输出一个 JSON 对象，结构为 {\"id\":string,\"annotationId\":string,\"status\":\"proposed\",",
  "\"operations\":[{\"op\":\"replace|add|remove\",\"path\":string,\"value\":any,\"explanation\":string}]}。",
  "path 相对 payload，如 /textItems/3/text；新增用 /textItems/-。",
  "只修改与指令直接相关的条目；每个 operation 的 explanation 用一句中文说明理由。",
].join("\n");

export function createOpenAiAnnotationModel(cfg: { baseUrl: string; apiKey: string; model: string }): AnnotationModel {
  return {
    async proposeChangeSet(input) {
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: [
              { type: "text", text:
                `指令：${input.annotation.instruction}\n` +
                `annotationId：${input.annotation.id}\n` +
                `框内当前条目（含其在 payload 数组中的 index）：\n${JSON.stringify(input.itemsInBounds, null, 2)}` },
              { type: "image_url", image_url: { url: `data:image/png;base64,${input.cropPngBase64}` } },
            ] },
          ],
          temperature: 0,
        }),
      });
      if (!res.ok) throw new Error(`model http ${res.status}`);
      const body = await res.json() as { choices: { message: { content: string } }[] };
      const raw = body.choices[0]?.message?.content ?? "";
      let parsed: unknown;
      try { parsed = JSON.parse(raw); }
      catch {
        const m = /\{[\s\S]*\}/.exec(raw);
        if (!m) throw new Error("model returned non-json content");
        parsed = JSON.parse(m[0]);
      }
      return changeSetSchema.parse(parsed);
    },
  };
}
```

`src/routes/annotation.ts`：

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { FastifyInstance } from "fastify";
import type { Operation } from "fast-json-patch";
import { guardChangeSet, rectIntersects, type Annotation, type ChangeOp, type Rect } from "@ui-rebuild/workbench-contracts";
import type { AppDeps } from "../app.js";

const PREFIX = "/api/pages/:pageId/stages/measurement";
interface StoredChangeSet { id: string; annotationId: string; status: string;
  allowed: ChangeOp[]; rejected: { op: ChangeOp; reason: string }[] }

export function registerAnnotationRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { store } = deps;
  const csDir = (pageId: string) => join(store.pageDir(pageId), "stages", "changesets");

  app.post<{ Params: { pageId: string }; Body: { bounds: Rect; instruction: string; targetIds?: string[] } }>(
    `${PREFIX}/annotations`, async (req, reply) => {
      const { pageId } = req.params;
      const doc = store.readDoc(pageId);
      if (doc.status === "confirmed") return reply.code(409).send({ error: "stage is confirmed" });
      const annotation: Annotation = {
        id: `a-${randomUUID()}`, stage: "measurement", bounds: req.body.bounds,
        instruction: req.body.instruction, targetIds: req.body.targetIds,
        createdAt: new Date().toISOString(),
      };
      const imgPath = join(store.pageDir(pageId), "reference",
        doc.payload.normalization?.referenceImage ?? "default.norm.png");
      const meta = await sharp(imgPath).metadata();
      const b = annotation.bounds;
      const pad = Math.round(Math.max(b.w, b.h) * 0.1);
      const left = Math.max(0, Math.round(b.x) - pad);
      const top = Math.max(0, Math.round(b.y) - pad);
      const width = Math.min((meta.width ?? 0) - left, Math.round(b.w) + 2 * pad);
      const height = Math.min((meta.height ?? 0) - top, Math.round(b.h) + 2 * pad);
      const crop = await sharp(imgPath).extract({ left, top, width: Math.max(1, width), height: Math.max(1, height) })
        .png().toBuffer();
      const itemsInBounds = doc.payload.textItems
        .map((item, index) => ({ index, item }))
        .filter(e => rectIntersects(e.item.bounds, b));
      let proposal;
      try {
        proposal = await deps.model.proposeChangeSet({
          annotation, cropPngBase64: crop.toString("base64"),
          itemsInBounds, payload: doc.payload,
        });
      } catch (err) {
        return reply.code(502).send({ error: (err as Error).message });
      }
      const { allowed, rejected } = guardChangeSet(proposal, doc.payload, b);
      const storedCs: StoredChangeSet = { id: proposal.id, annotationId: annotation.id,
        status: "proposed", allowed, rejected };
      mkdirSync(csDir(pageId), { recursive: true });
      writeFileSync(join(csDir(pageId), `${storedCs.id}.json`), JSON.stringify({ annotation, ...storedCs }, null, 2) + "\n", "utf8");
      return { changeSet: storedCs };
    });

  app.post<{ Params: { pageId: string; csId: string }; Body: { opIndexes?: number[] } }>(
    `${PREFIX}/changesets/:csId/accept`, async (req, reply) => {
      const { pageId, csId } = req.params;
      const p = join(csDir(pageId), `${csId}.json`);
      if (!existsSync(p)) return reply.code(404).send({ error: "changeset not found" });
      const cs = JSON.parse(readFileSync(p, "utf8")) as StoredChangeSet;
      if (cs.status !== "proposed") return reply.code(409).send({ error: "changeset already resolved" });
      const chosen = (req.body.opIndexes ?? cs.allowed.map((_, i) => i)).map(i => cs.allowed[i]).filter(Boolean);
      const ops = chosen.map(o => ({ ...o, path: `/payload${o.path}` })) as unknown as Operation[];
      const doc = store.applyPatch(pageId, ops, "changeset");
      writeFileSync(p, JSON.stringify({ ...cs, status: "accepted" }, null, 2) + "\n", "utf8");
      return { doc };
    });
}
```

`src/app.ts` 在 `registerMeasurementRoutes` 后追加 `registerAnnotationRoutes(app, deps);`

- [ ] **Step 4: 跑测试通过** → PASS（含 Task 8 测试回归）
- [ ] **Step 5: Commit** `git add ui/packages/workbench-server/src && git commit -m "feat(workbench): annotation proposals with guarded changesets"`

---

### Task 10: workbench-server — confirm/unfreeze 门禁 + 参考图路由 + 启动入口

**Files:**
- Modify: `ui/packages/workbench-server/src/routes/measurement.ts`（追加 confirm/unfreeze）
- Create: `ui/packages/workbench-server/src/routes/reference.ts`
- Create: `ui/packages/workbench-server/src/index.ts`
- Modify: `ui/packages/workbench-server/src/app.ts`
- Test: `ui/packages/workbench-server/src/routes/confirm.test.ts`

**Interfaces:**
- Produces:
  - `POST ${PREFIX}/confirm` → 门禁检查，全过则 `status:"confirmed"` + `confirmedAt`，返回 `{ doc }`；未过 → 422 `{ gate: { unreviewedLowConfidence: string[]; normalizationUnreviewed: boolean; masksMissingReason: string[] } }`。门禁规则（阈值 0.85）：① 所有 `confidence < 0.85 && !reviewed` 的 textItems/colorSamples id 列表必须为空；② `normalization.reviewed === true`；③ 所有 ignoreMask `reason` 非空。
  - `POST ${PREFIX}/unfreeze` → confirmed → draft，返回 `{ doc }`；非 confirmed → 409。
  - `GET /api/pages/:pageId/reference/:name` → 返回图片文件；query `?rect=x,y,w,h` 时返回裁剪 PNG。
  - `src/index.ts`：读 `process.env.UIR_PAGES_ROOT`（默认 `./pages`）、`UIR_MODEL_*` 环境变量组装真实 deps 并 `app.listen({ port: 4700 })`；`UIR_MODEL_BASE_URL` 缺失时 model 为抛错占位（标注功能不可用但其余可用）。
- 状态转换实现注意：`applyPatch` 对 `/status` 的 replace 已放行（Task 7 实现中 confirmed 检查排除了 status 补丁），confirm/unfreeze 复用它以进历史。

- [ ] **Step 1: 写失败测试** `src/routes/confirm.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { makeApp } from "../test-helpers.js";

describe("confirm gate", () => {
  it("blocks confirm while low-confidence items unreviewed", async () => {
    const { app } = makeApp();   // fake ocr 返回 confidence 0.9 的 toolItem
    await app.inject({ method: "POST", url: "/api/pages/p1/stages/measurement/analyze", payload: { scale: 2 } });
    await app.inject({ method: "PATCH", url: "/api/pages/p1/stages/measurement", payload: { ops: [
      { op: "add", path: "/payload/textItems/-", value: { id: "low", text: "?", bounds: { x: 1, y: 1, w: 5, h: 5 },
        ocrConfidence: 0.4, source: "tool", confidence: 0.4, reviewed: false } },
    ] } });
    const res = await app.inject({ method: "POST", url: "/api/pages/p1/stages/measurement/confirm" });
    expect(res.statusCode).toBe(422);
    expect(res.json().gate.unreviewedLowConfidence).toContain("low");
  });
  it("confirms when gates pass, then unfreezes", async () => {
    const { app } = makeApp();
    await app.inject({ method: "POST", url: "/api/pages/p1/stages/measurement/analyze", payload: { scale: 2 } });
    await app.inject({ method: "PATCH", url: "/api/pages/p1/stages/measurement", payload: { ops: [
      { op: "replace", path: "/payload/normalization/reviewed", value: true },
    ] } });
    const ok = await app.inject({ method: "POST", url: "/api/pages/p1/stages/measurement/confirm" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().doc.status).toBe("confirmed");
    const patch = await app.inject({ method: "PATCH", url: "/api/pages/p1/stages/measurement",
      payload: { ops: [{ op: "replace", path: "/payload/textItems/0/text", value: "x" }] } });
    expect(patch.statusCode).toBe(409);
    const un = await app.inject({ method: "POST", url: "/api/pages/p1/stages/measurement/unfreeze" });
    expect(un.json().doc.status).toBe("draft");
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现**（`routes/measurement.ts` 追加）

```ts
const THRESHOLD = 0.85;

app.post<{ Params: Params }>(`${PREFIX}/confirm`, async (req, reply) => {
  const doc = store.readDoc(req.params.pageId);
  const low = [...doc.payload.textItems, ...doc.payload.colorSamples]
    .filter(i => i.confidence < THRESHOLD && !i.reviewed).map(i => i.id);
  const gate = {
    unreviewedLowConfidence: low,
    normalizationUnreviewed: !doc.payload.normalization?.reviewed,
    masksMissingReason: doc.payload.ignoreMasks.filter(m => m.reason.trim() === "").map(m => m.id),
  };
  if (gate.unreviewedLowConfidence.length || gate.normalizationUnreviewed || gate.masksMissingReason.length) {
    return reply.code(422).send({ gate });
  }
  const confirmed = store.applyPatch(req.params.pageId, [
    { op: "replace", path: "/status", value: "confirmed" },
    { op: "add", path: "/confirmedAt", value: new Date().toISOString() },
  ], "human");
  return { doc: confirmed };
});

app.post<{ Params: Params }>(`${PREFIX}/unfreeze`, async (req, reply) => {
  const doc = store.readDoc(req.params.pageId);
  if (doc.status !== "confirmed") return reply.code(409).send({ error: "not confirmed" });
  return { doc: store.applyPatch(req.params.pageId, [
    { op: "replace", path: "/status", value: "draft" },
    { op: "remove", path: "/confirmedAt" },
  ], "human") };
});
```

`src/routes/reference.ts`：

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";

export function registerReferenceRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get<{ Params: { pageId: string; name: string }; Querystring: { rect?: string } }>(
    "/api/pages/:pageId/reference/:name", async (req, reply) => {
      const p = join(deps.store.pageDir(req.params.pageId), "reference", req.params.name);
      if (!existsSync(p) || req.params.name.includes("..")) return reply.code(404).send();
      let img = sharp(p);
      if (req.query.rect) {
        const [x, y, w, h] = req.query.rect.split(",").map(Number);
        img = img.extract({ left: Math.max(0, x), top: Math.max(0, y), width: w, height: h });
      }
      reply.type("image/png");
      return reply.send(await img.png().toBuffer());
    });
}
```

`src/index.ts`：

```ts
import { PageStore } from "./store.js";
import { buildApp } from "./app.js";
import { createOpenAiAnnotationModel, type AnnotationModel } from "./model-client.js";
import { normalizeReference, runOcr, sampleColors } from "@ui-rebuild/measure";

const store = new PageStore(process.env.UIR_PAGES_ROOT ?? "./pages");
const model: AnnotationModel = process.env.UIR_MODEL_BASE_URL
  ? createOpenAiAnnotationModel({
      baseUrl: process.env.UIR_MODEL_BASE_URL,
      apiKey: process.env.UIR_MODEL_API_KEY ?? "",
      model: process.env.UIR_MODEL_NAME ?? "",
    })
  : { proposeChangeSet: () => Promise.reject(new Error("UIR_MODEL_BASE_URL not set")) };

const app = buildApp({ store, model,
  measure: { normalize: normalizeReference, ocr: (p) => runOcr(p), colors: sampleColors } });
app.listen({ port: Number(process.env.UIR_PORT ?? 4700), host: "127.0.0.1" })
  .then(addr => console.log(`workbench server on ${addr}`));
```

`app.ts` 注册 `registerReferenceRoutes(app, deps);`；`package.json` 加 script `"dev": "node --experimental-strip-types src/index.ts"`（Node 22.6+ 支持；若报错改为 `tsx src/index.ts` 并加 dev 依赖 `tsx`）。

- [ ] **Step 4: 跑测试通过** → PASS（全包回归 `pnpm -C ui test`）
- [ ] **Step 5: Commit** `git add ui/packages/workbench-server && git commit -m "feat(workbench): confirm gates, reference serving, server entry"`

---

### Task 11: workbench-ui 脚手架 + API 客户端 + Pinia store + 坐标换算库

**Files:**
- Create: `ui/apps/workbench-ui/package.json`（依赖 `vue@^3.5`、`pinia@^2.2`；dev 依赖 `vite@^5`、`@vitejs/plugin-vue`、`vitest`、`@vue/test-utils`、`jsdom`、`typescript`；scripts：`dev: vite`、`build: vite build`、`test: vitest run`）
- Create: `ui/apps/workbench-ui/vite.config.ts`（plugin-vue + `server.proxy: { "/api": "http://127.0.0.1:4700" }`；test 环境 `jsdom`）
- Create: `ui/apps/workbench-ui/tsconfig.json`、`index.html`、`src/main.ts`、`src/App.vue`（此 Task 仅挂空壳布局：左 320px 队列 / 中画布 / 右 320px 面板三栏 grid）
- Create: `ui/apps/workbench-ui/src/api.ts`
- Create: `ui/apps/workbench-ui/src/stores/measurement.ts`
- Create: `ui/apps/workbench-ui/src/lib/canvas-geometry.ts`
- Test: `ui/apps/workbench-ui/src/stores/measurement.test.ts`、`ui/apps/workbench-ui/src/lib/canvas-geometry.test.ts`

**Interfaces:**
- Consumes: Task 8–10 的 REST API。
- Produces:
  - `api.ts`：`getDoc(pageId)` `patchDoc(pageId, ops)` `analyze(pageId, body)` `undo/redo(pageId)` `confirm/unfreeze(pageId)` `annotate(pageId, body)` `acceptChangeSet(pageId, csId, opIndexes?)` — 全部 `fetch` 包装，非 2xx 抛 `ApiError{status,body}`；204 返回 `null`。
  - store `useMeasurementStore`：state `{ pageId, doc, selectedIds: string[], pendingChangeSet, gate, loading }`；getters `reviewQueue`（未 reviewed 条目按 confidence 升序）、`textItemIndexById(id)`；actions `load(pageId)` `applyOps(ops)`（乐观更新+失败回滚重载）、`updateItem(id, partial)`（对 TextItem 字段生成 replace ops，并自动附带 `source:"human"`、`confidence:1`、`reviewed:true` 三个 replace）、`markReviewed(id)` `removeItem(id)` `addItem(item)` `undo/redo` `confirm/unfreeze` `annotate(bounds, instruction)` `acceptPending(opIndexes?)` `rejectPending()`。
  - `canvas-geometry.ts`：`imageToView(pt, view)` / `viewToImage(pt, view)`，`view = { zoom: number; panX: number; panY: number }`（`view = image * zoom + pan`）；`handleAt(bounds, corner)` 返回 8 个手柄位置；`resizeBounds(bounds, handle, dx, dy, minSize=4)` 纯函数实现拖拽手柄改 bounds。

- [ ] **Step 1: 写失败测试**

`src/lib/canvas-geometry.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { imageToView, resizeBounds, viewToImage } from "./canvas-geometry.js";

describe("canvas geometry", () => {
  it("round-trips image/view coords", () => {
    const view = { zoom: 2, panX: 10, panY: -5 };
    expect(viewToImage(imageToView({ x: 30, y: 40 }, view), view)).toEqual({ x: 30, y: 40 });
  });
  it("resizes from se handle and clamps min size", () => {
    const b = { x: 10, y: 10, w: 20, h: 20 };
    expect(resizeBounds(b, "se", 5, 3)).toEqual({ x: 10, y: 10, w: 25, h: 23 });
    expect(resizeBounds(b, "se", -100, -100)).toEqual({ x: 10, y: 10, w: 4, h: 4 });
  });
  it("resizes from nw handle moving origin", () => {
    expect(resizeBounds({ x: 10, y: 10, w: 20, h: 20 }, "nw", 4, 6))
      .toEqual({ x: 14, y: 16, w: 16, h: 14 });
  });
});
```

`src/stores/measurement.test.ts`（mock `../api.js` 模块）：

```ts
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyMeasurementDoc } from "@ui-rebuild/workbench-contracts";

const docWith = () => {
  const d = emptyMeasurementDoc(); d.status = "draft";
  d.payload.textItems.push(
    { id: "a", text: "hi", bounds: { x: 0, y: 0, w: 5, h: 5 }, ocrConfidence: 0.5,
      source: "tool", confidence: 0.5, reviewed: false },
    { id: "b", text: "lo", bounds: { x: 0, y: 9, w: 5, h: 5 }, ocrConfidence: 0.9,
      source: "tool", confidence: 0.9, reviewed: false },
  );
  return d;
};
vi.mock("../api.js", () => ({
  getDoc: vi.fn(async () => ({ doc: docWith(), fingerprint: "f" })),
  patchDoc: vi.fn(async () => ({ doc: docWith() })),
}));
import * as api from "../api.js";
import { useMeasurementStore } from "./measurement.js";

describe("measurement store", () => {
  beforeEach(() => setActivePinia(createPinia()));
  it("orders review queue by ascending confidence", async () => {
    const s = useMeasurementStore();
    await s.load("p1");
    expect(s.reviewQueue.map(i => i.id)).toEqual(["a", "b"]);
  });
  it("updateItem sends human provenance ops", async () => {
    const s = useMeasurementStore();
    await s.load("p1");
    await s.updateItem("a", { text: "fixed" });
    const ops = (api.patchDoc as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const paths = ops.map((o: { path: string }) => o.path);
    expect(paths).toContain("/payload/textItems/0/text");
    expect(paths).toContain("/payload/textItems/0/source");
    expect(paths).toContain("/payload/textItems/0/reviewed");
  });
});
```

- [ ] **Step 2: 跑测试确认失败** `pnpm -C ui/apps/workbench-ui test` → FAIL

- [ ] **Step 3: 实现**

`src/lib/canvas-geometry.ts`：

```ts
export interface ViewTransform { zoom: number; panX: number; panY: number }
export interface Pt { x: number; y: number }
export interface Bounds { x: number; y: number; w: number; h: number }
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const imageToView = (p: Pt, v: ViewTransform): Pt =>
  ({ x: p.x * v.zoom + v.panX, y: p.y * v.zoom + v.panY });
export const viewToImage = (p: Pt, v: ViewTransform): Pt =>
  ({ x: (p.x - v.panX) / v.zoom, y: (p.y - v.panY) / v.zoom });

export function resizeBounds(b: Bounds, h: Handle, dx: number, dy: number, minSize = 4): Bounds {
  let { x, y, w, h: hh } = b;
  if (h.includes("e")) w += dx;
  if (h.includes("s")) hh += dy;
  if (h.includes("w")) { x += dx; w -= dx; }
  if (h.includes("n")) { y += dy; hh -= dy; }
  if (w < minSize) { if (h.includes("w")) x -= minSize - w; w = minSize; }
  if (hh < minSize) { if (h.includes("n")) y -= minSize - hh; hh = minSize; }
  return { x, y, w, h: hh };
}

export function handles(b: Bounds): { id: Handle; x: number; y: number }[] {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = b.x + b.w, bt = b.y + b.h;
  return [
    { id: "nw", x: b.x, y: b.y }, { id: "n", x: cx, y: b.y }, { id: "ne", x: r, y: b.y },
    { id: "e", x: r, y: cy }, { id: "se", x: r, y: bt }, { id: "s", x: cx, y: bt },
    { id: "sw", x: b.x, y: bt }, { id: "w", x: b.x, y: cy },
  ];
}
```

`src/api.ts`：

```ts
import type { MeasurementDoc, Rect } from "@ui-rebuild/workbench-contracts";
import type { Operation } from "fast-json-patch";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) { super(`api ${status}`); }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
  if (res.status === 204) return null as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

const base = (pageId: string) => `/api/pages/${pageId}/stages/measurement`;

export const getDoc = (pageId: string) =>
  call<{ doc: MeasurementDoc; fingerprint: string }>(base(pageId));
export const patchDoc = (pageId: string, ops: Operation[]) =>
  call<{ doc: MeasurementDoc }>(base(pageId), { method: "PATCH", body: JSON.stringify({ ops }) });
export const analyze = (pageId: string, body: { scale: number; statusBarHeightPx?: number }) =>
  call<{ doc: MeasurementDoc }>(`${base(pageId)}/analyze`, { method: "POST", body: JSON.stringify(body) });
export const undo = (pageId: string) => call<{ doc: MeasurementDoc } | null>(`${base(pageId)}/undo`, { method: "POST" });
export const redo = (pageId: string) => call<{ doc: MeasurementDoc } | null>(`${base(pageId)}/redo`, { method: "POST" });
export const confirm = (pageId: string) => call<{ doc: MeasurementDoc }>(`${base(pageId)}/confirm`, { method: "POST" });
export const unfreeze = (pageId: string) => call<{ doc: MeasurementDoc }>(`${base(pageId)}/unfreeze`, { method: "POST" });
export const annotate = (pageId: string, body: { bounds: Rect; instruction: string }) =>
  call<{ changeSet: { id: string; allowed: unknown[]; rejected: unknown[] } }>(
    `${base(pageId)}/annotations`, { method: "POST", body: JSON.stringify(body) });
export const acceptChangeSet = (pageId: string, csId: string, opIndexes?: number[]) =>
  call<{ doc: MeasurementDoc }>(`${base(pageId)}/changesets/${csId}/accept`,
    { method: "POST", body: JSON.stringify({ opIndexes }) });
export const referenceUrl = (pageId: string, name: string) => `/api/pages/${pageId}/reference/${name}`;
```

`src/stores/measurement.ts`：

```ts
import { defineStore } from "pinia";
import type { MeasurementDoc, TextItem } from "@ui-rebuild/workbench-contracts";
import type { Operation } from "fast-json-patch";
import * as api from "../api.js";

interface PendingChangeSet { id: string; allowed: { op: string; path: string; value?: unknown; explanation: string }[];
  rejected: { op: unknown; reason: string }[] }

export const useMeasurementStore = defineStore("measurement", {
  state: () => ({
    pageId: "" as string,
    doc: null as MeasurementDoc | null,
    selectedIds: [] as string[],
    pendingChangeSet: null as PendingChangeSet | null,
    gate: null as unknown,
    loading: false,
  }),
  getters: {
    reviewQueue(state): TextItem[] {
      if (!state.doc) return [];
      return state.doc.payload.textItems.filter(t => !t.reviewed)
        .slice().sort((a, b) => a.confidence - b.confidence);
    },
    isConfirmed: (state) => state.doc?.status === "confirmed",
  },
  actions: {
    async load(pageId: string) {
      this.pageId = pageId; this.loading = true;
      try { this.doc = (await api.getDoc(pageId)).doc; } finally { this.loading = false; }
    },
    textItemIndexById(id: string): number {
      return this.doc?.payload.textItems.findIndex(t => t.id === id) ?? -1;
    },
    async applyOps(ops: Operation[]) {
      this.doc = (await api.patchDoc(this.pageId, ops)).doc;
    },
    async updateItem(id: string, partial: Partial<TextItem>) {
      const i = this.textItemIndexById(id);
      if (i < 0) return;
      const ops: Operation[] = Object.entries(partial).map(([k, v]) =>
        ({ op: "replace", path: `/payload/textItems/${i}/${k}`, value: v }));
      ops.push(
        { op: "replace", path: `/payload/textItems/${i}/source`, value: "human" },
        { op: "replace", path: `/payload/textItems/${i}/confidence`, value: 1 },
        { op: "replace", path: `/payload/textItems/${i}/reviewed`, value: true },
      );
      await this.applyOps(ops);
    },
    async markReviewed(id: string) {
      const i = this.textItemIndexById(id);
      if (i >= 0) await this.applyOps([{ op: "replace", path: `/payload/textItems/${i}/reviewed`, value: true }]);
    },
    async removeItem(id: string) {
      const i = this.textItemIndexById(id);
      if (i >= 0) await this.applyOps([{ op: "remove", path: `/payload/textItems/${i}` }]);
    },
    async addItem(item: TextItem) {
      await this.applyOps([{ op: "add", path: "/payload/textItems/-", value: item }]);
    },
    async undoLast() { const r = await api.undo(this.pageId); if (r) this.doc = r.doc; },
    async redoLast() { const r = await api.redo(this.pageId); if (r) this.doc = r.doc; },
    async confirmStage() {
      try { this.doc = (await api.confirm(this.pageId)).doc; this.gate = null; }
      catch (e) { if (e instanceof api.ApiError && e.status === 422) this.gate = (e.body as { gate: unknown }).gate; else throw e; }
    },
    async unfreezeStage() { this.doc = (await api.unfreeze(this.pageId)).doc; },
    async annotateRegion(bounds: { x: number; y: number; w: number; h: number }, instruction: string) {
      this.pendingChangeSet = (await api.annotate(this.pageId, { bounds, instruction })).changeSet as PendingChangeSet;
    },
    async acceptPending(opIndexes?: number[]) {
      if (!this.pendingChangeSet) return;
      this.doc = (await api.acceptChangeSet(this.pageId, this.pendingChangeSet.id, opIndexes)).doc;
      this.pendingChangeSet = null;
    },
    rejectPending() { this.pendingChangeSet = null; },
  },
});
```

`src/main.ts`：

```ts
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";

createApp(App).use(createPinia()).mount("#app");
```

`src/App.vue`（壳布局，页面 id 取 `location.hash.slice(1) || "demo"`）：

```vue
<script setup lang="ts">
import { onMounted } from "vue";
import { useMeasurementStore } from "./stores/measurement.js";
const store = useMeasurementStore();
onMounted(() => store.load(location.hash.slice(1) || "demo"));
</script>

<template>
  <div class="layout">
    <aside class="left">审阅队列（Task 13）</aside>
    <main class="center">画布（Task 12）</main>
    <aside class="right">属性面板（Task 13）</aside>
  </div>
</template>

<style>
html, body, #app { height: 100%; margin: 0; font-family: system-ui, sans-serif; }
.layout { display: grid; grid-template-columns: 320px 1fr 320px; height: 100%; }
.left, .right { border-right: 1px solid #ddd; overflow: auto; padding: 8px; }
.right { border-right: 0; border-left: 1px solid #ddd; }
.center { overflow: hidden; background: #f0f1f3; }
</style>
```

- [ ] **Step 4: 跑测试通过** → PASS
- [ ] **Step 5: Commit** `git add ui/apps/workbench-ui ui/pnpm-lock.yaml && git commit -m "feat(workbench): ui scaffold with api client and measurement store"`

---

### Task 12: 画布组件 — 底图 + 框叠加 + 缩放平移 + 选择

**Files:**
- Create: `ui/apps/workbench-ui/src/components/CanvasView.vue`
- Create: `ui/apps/workbench-ui/src/components/BoxOverlay.vue`
- Modify: `ui/apps/workbench-ui/src/App.vue`（center 换成 `<CanvasView />`）
- Test: `ui/apps/workbench-ui/src/components/BoxOverlay.test.ts`

**Interfaces:**
- Consumes: store、`canvas-geometry`、`referenceUrl`。
- Produces: `CanvasView`（自包含，读写 store）；`BoxOverlay` props `{ item: TextItem; selected: boolean; zoom: number }`，emits `select(id, additive)`。置信度着色：`confidence >= 0.95` 绿 `#22a06b`、`>= 0.85` 黄 `#e2a400`、否则红 `#d0454c`；`reviewed` 时透明度 0.35。`CanvasView` 暴露的画布模式 state 存 store 外的本地 `ref<Mode>`，`Mode = "select" | "draw-text" | "draw-mask" | "annotate"`（后两种 Task 13/14 接线，此处先定义类型与切换）。

- [ ] **Step 1: 写失败测试** `src/components/BoxOverlay.test.ts`

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import BoxOverlay from "./BoxOverlay.vue";

const item = { id: "t1", text: "hi", bounds: { x: 10, y: 20, w: 30, h: 16 }, ocrConfidence: 0.6,
  source: "tool" as const, confidence: 0.6, reviewed: false };

describe("BoxOverlay", () => {
  it("renders rect at item bounds with low-confidence color", () => {
    const w = mount(BoxOverlay, { props: { item, selected: false, zoom: 1 } });
    const rect = w.find("rect");
    expect(rect.attributes("x")).toBe("10");
    expect(rect.attributes("stroke")).toBe("#d0454c");
  });
  it("emits select with additive flag on shift-click", async () => {
    const w = mount(BoxOverlay, { props: { item, selected: false, zoom: 1 } });
    await w.find("rect").trigger("pointerdown", { shiftKey: true });
    expect(w.emitted("select")?.[0]).toEqual(["t1", true]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现**

`src/components/BoxOverlay.vue`：

```vue
<script setup lang="ts">
import { computed } from "vue";
import type { TextItem } from "@ui-rebuild/workbench-contracts";

const props = defineProps<{ item: TextItem; selected: boolean; zoom: number }>();
const emit = defineEmits<{ select: [id: string, additive: boolean] }>();

const color = computed(() => props.item.confidence >= 0.95 ? "#22a06b"
  : props.item.confidence >= 0.85 ? "#e2a400" : "#d0454c");
const opacity = computed(() => (props.item.reviewed ? 0.35 : 1));
</script>

<template>
  <g :opacity="opacity" @pointerdown.stop="emit('select', item.id, $event.shiftKey)">
    <rect :x="item.bounds.x" :y="item.bounds.y" :width="item.bounds.w" :height="item.bounds.h"
      fill="transparent" :stroke="selected ? '#2f6fed' : color"
      :stroke-width="(selected ? 2.5 : 1.5) / zoom" style="cursor: pointer" />
  </g>
</template>
```

`src/components/CanvasView.vue`：

```vue
<script setup lang="ts">
import { computed, ref } from "vue";
import { referenceUrl } from "../api.js";
import { useMeasurementStore } from "../stores/measurement.js";
import { viewToImage, type ViewTransform } from "../lib/canvas-geometry.js";
import BoxOverlay from "./BoxOverlay.vue";

export type Mode = "select" | "draw-text" | "draw-mask" | "annotate";
const mode = defineModel<Mode>("mode", { default: "select" });

const store = useMeasurementStore();
const view = ref<ViewTransform>({ zoom: 1, panX: 0, panY: 0 });
const rootEl = ref<HTMLElement>();
const panning = ref<{ x: number; y: number } | null>(null);

const norm = computed(() => store.doc?.payload.normalization ?? null);
const imgUrl = computed(() => norm.value ? referenceUrl(store.pageId, norm.value.referenceImage) : "");

function onWheel(e: WheelEvent) {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const rect = rootEl.value!.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  const before = viewToImage({ x: px, y: py }, view.value);
  view.value.zoom = Math.min(8, Math.max(0.2, view.value.zoom * factor));
  view.value.panX = px - before.x * view.value.zoom;
  view.value.panY = py - before.y * view.value.zoom;
}
function onPointerDown(e: PointerEvent) {
  if (mode.value === "select") {
    store.selectedIds = [];
    panning.value = { x: e.clientX - view.value.panX, y: e.clientY - view.value.panY };
  }
}
function onPointerMove(e: PointerEvent) {
  if (panning.value) {
    view.value.panX = e.clientX - panning.value.x;
    view.value.panY = e.clientY - panning.value.y;
  }
}
function onSelect(id: string, additive: boolean) {
  store.selectedIds = additive ? [...new Set([...store.selectedIds, id])] : [id];
}
</script>

<template>
  <div ref="rootEl" class="canvas" @wheel="onWheel"
    @pointerdown="onPointerDown" @pointermove="onPointerMove"
    @pointerup="panning = null" @pointerleave="panning = null">
    <svg v-if="norm" :width="'100%'" :height="'100%'">
      <g :transform="`translate(${view.panX},${view.panY}) scale(${view.zoom})`">
        <image :href="imgUrl" :width="norm.logicalSize.w" :height="norm.logicalSize.h" />
        <rect v-if="norm.statusBarCrop" v-bind="norm.statusBarCrop"
          :width="norm.statusBarCrop.w" :height="norm.statusBarCrop.h"
          fill="#00000022" stroke="none" />
        <rect v-for="m in store.doc!.payload.ignoreMasks" :key="m.id"
          :x="m.bounds.x" :y="m.bounds.y" :width="m.bounds.w" :height="m.bounds.h"
          fill="#7a3ce822" stroke="#7a3ce8" :stroke-width="1 / view.zoom" stroke-dasharray="4 3" />
        <BoxOverlay v-for="t in store.doc!.payload.textItems" :key="t.id"
          :item="t" :selected="store.selectedIds.includes(t.id)" :zoom="view.zoom" @select="onSelect" />
      </g>
    </svg>
    <div v-else class="empty">尚无归一化图，先在右侧运行分析</div>
  </div>
</template>

<style scoped>
.canvas { width: 100%; height: 100%; user-select: none; touch-action: none; }
.empty { padding: 40px; color: #888; }
</style>
```

`App.vue` 的 center 区替换为 `<CanvasView v-model:mode="mode" />`（`const mode = ref<Mode>("select")`）。

- [ ] **Step 4: 跑测试通过** → PASS
- [ ] **Step 5: 手工冒烟（必须执行并记录结果）**：起服务端（`UIR_PAGES_ROOT` 指向含一张真实截图的 pages 目录）+ `pnpm -C ui/apps/workbench-ui dev`，浏览器打开 `http://localhost:5173/#demo`：先经 REST 触发一次 analyze（`curl -X POST .../analyze -d '{"scale":2}' -H "content-type: application/json"`），确认①底图显示②框按置信度着色③滚轮以鼠标为中心缩放④拖空白平移⑤点框选中变蓝、shift 加选。
- [ ] **Step 6: Commit** `git add ui/apps/workbench-ui/src && git commit -m "feat(workbench): canvas with overlays, zoom, pan, selection"`

---

### Task 13: 编辑交互 + 审阅队列 + 属性面板 + 确认冻结

**Files:**
- Modify: `ui/apps/workbench-ui/src/components/CanvasView.vue`（拖拽手柄、双击改字、画新框/遮罩、快捷键）
- Modify: `ui/apps/workbench-ui/src/components/BoxOverlay.vue`（选中时渲染 8 手柄并 emit resize）
- Create: `ui/apps/workbench-ui/src/components/ReviewQueue.vue`
- Create: `ui/apps/workbench-ui/src/components/PropertyPanel.vue`
- Create: `ui/apps/workbench-ui/src/components/ConfirmBar.vue`
- Modify: `ui/apps/workbench-ui/src/App.vue`（装配三栏 + 顶栏）
- Test: `ui/apps/workbench-ui/src/components/ReviewQueue.test.ts`

**Interfaces:**
- Consumes: store actions（Task 11）、`resizeBounds/handles`（Task 11）。
- Produces（交互契约，全部落在组件内，无新 API）：
  - **BoxOverlay** 追加 props `{ editable: boolean }`、emits `resize(id, handle, dxImage, dyImage)`（pointer capture 拖拽，位移已除以 zoom 换算为图像像素）、`open-edit(id)`（双击）。
  - **CanvasView** 编辑逻辑：
    - resize 结束（pointerup）→ `store.updateItem(id, { bounds })`（updateItem 自动置 human/reviewed，见 Task 11）。
    - 双击框 → 画布上浮动 `<input>` 内联改字，Enter 提交 `updateItem(id,{text})`、Esc 取消。
    - 快捷键（window keydown，输入框聚焦时忽略）：`Delete` 删除选中（`removeItem`）；`N` 切 `draw-text` 模式；`I` 切 `draw-mask`；`A` 切 `annotate`（Task 14 接线）；`Esc` 回 `select`；`M` 合并选中 ≥2 个文字框（新条目 text 按 y,x 排序拼接、bounds 用 `unionRects`、`source:"human"`，随后删除原条目——组合成一次 `applyOps` 多操作补丁，保证单条历史可整体撤销）；`Ctrl+Z / Ctrl+Shift+Z` → undo/redo。
    - `draw-text` / `draw-mask` 模式：pointerdown 起点 → 拖出虚线框 → pointerup 后：text 模式弹内联输入收文字并 `addItem`（`ocrConfidence:1`）；mask 模式 `prompt` 收 reason 后 `applyOps` add ignoreMask；完成后回 `select`。
  - **ReviewQueue**：列表渲染 `store.reviewQueue`，每行：`referenceUrl(pageId, norm.referenceImage)?rect=` 裁剪缩略图 + 可编辑文字 input + 置信度徽标；`Enter` = 未改字 `markReviewed` / 改了字 `updateItem`；点行 → `store.selectedIds=[id]`；顶部进度 `已审 x / 总 y`。
  - **PropertyPanel**：无选中时显示归一化卡片（设备逻辑宽高、scale、状态栏高度、"分析/重新分析"按钮触发 `api.analyze`、"归一化无误"勾选 → `applyOps` 置 `normalization/reviewed`）+ 颜色采样列表（色卡、role 下拉改值）；选中单条时显示 TextItem 全字段表单（text、bounds 四值、fontSizePx，change 即 `updateItem`）。
  - **ConfirmBar**（顶栏右侧）：状态徽标（draft/confirmed）、undo/redo 按钮、"确认冻结"按钮 → `confirmStage()`；`store.gate` 非空时弹出未过门禁清单（点条目定位画布）；confirmed 状态显示"解冻"。

- [ ] **Step 1: 写失败测试** `src/components/ReviewQueue.test.ts`

```ts
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyMeasurementDoc } from "@ui-rebuild/workbench-contracts";
import { useMeasurementStore } from "../stores/measurement.js";
import ReviewQueue from "./ReviewQueue.vue";

vi.mock("../api.js", () => ({ referenceUrl: () => "x.png", patchDoc: vi.fn(async () => ({ doc: emptyMeasurementDoc() })) }));

describe("ReviewQueue", () => {
  beforeEach(() => setActivePinia(createPinia()));
  it("lists unreviewed items ascending by confidence and selects on click", async () => {
    const store = useMeasurementStore();
    const doc = emptyMeasurementDoc(); doc.status = "draft";
    doc.payload.textItems.push(
      { id: "hi", text: "好", bounds: { x: 0, y: 0, w: 5, h: 5 }, ocrConfidence: 0.9, source: "tool", confidence: 0.9, reviewed: false },
      { id: "lo", text: "差", bounds: { x: 0, y: 9, w: 5, h: 5 }, ocrConfidence: 0.4, source: "tool", confidence: 0.4, reviewed: false },
      { id: "done", text: "完", bounds: { x: 0, y: 18, w: 5, h: 5 }, ocrConfidence: 1, source: "human", confidence: 1, reviewed: true },
    );
    store.doc = doc;
    const w = mount(ReviewQueue);
    const rows = w.findAll("[data-test=row]");
    expect(rows).toHaveLength(2);
    expect(rows[0].attributes("data-id")).toBe("lo");
    await rows[0].trigger("click");
    expect(store.selectedIds).toEqual(["lo"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现** `ReviewQueue.vue`

```vue
<script setup lang="ts">
import { computed } from "vue";
import { referenceUrl } from "../api.js";
import { useMeasurementStore } from "../stores/measurement.js";

const store = useMeasurementStore();
const total = computed(() => store.doc?.payload.textItems.length ?? 0);
const done = computed(() => total.value - store.reviewQueue.length);
const norm = computed(() => store.doc?.payload.normalization);

function thumb(b: { x: number; y: number; w: number; h: number }) {
  return norm.value
    ? `${referenceUrl(store.pageId, norm.value.referenceImage)}?rect=${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`
    : "";
}
async function submit(id: string, original: string, e: Event) {
  const value = (e.target as HTMLInputElement).value;
  if (value !== original) await store.updateItem(id, { text: value });
  else await store.markReviewed(id);
}
</script>

<template>
  <div>
    <div class="progress">已审 {{ done }} / {{ total }}</div>
    <div v-for="item in store.reviewQueue" :key="item.id" data-test="row" :data-id="item.id"
      class="row" :class="{ sel: store.selectedIds.includes(item.id) }"
      @click="store.selectedIds = [item.id]">
      <img :src="thumb(item.bounds)" :alt="item.text" />
      <input :value="item.text" @keydown.enter="submit(item.id, item.text, $event)" @click.stop />
      <span class="conf" :data-level="item.confidence >= 0.85 ? 'mid' : 'low'">
        {{ Math.round(item.confidence * 100) }}%
      </span>
    </div>
  </div>
</template>

<style scoped>
.progress { padding: 6px 4px; font-size: 12px; color: #666; }
.row { display: flex; gap: 6px; align-items: center; padding: 6px 4px; border-radius: 6px; cursor: pointer; }
.row.sel { background: #e8f0fe; }
.row img { height: 22px; max-width: 90px; object-fit: contain; background: #fff; border: 1px solid #eee; }
.row input { flex: 1; min-width: 0; }
.conf[data-level=low] { color: #d0454c; }
.conf[data-level=mid] { color: #e2a400; }
</style>
```

`BoxOverlay.vue` 追加（`editable && selected` 时渲染手柄；pointer capture 累计位移换算图像坐标后 emit）：

```vue
<!-- 追加到 <template> 的 <g> 内 -->
<template v-if="selected && editable">
  <circle v-for="h in handleList" :key="h.id" :cx="h.x" :cy="h.y" :r="4 / zoom"
    fill="#2f6fed" style="cursor: crosshair"
    @pointerdown.stop="startResize(h.id, $event)" />
</template>
```

```ts
// 追加到 <script setup>
import { handles, type Handle } from "../lib/canvas-geometry.js";
const props2 = defineProps<{ editable?: boolean }>();   // 合并进原 defineProps
const emitResize = defineEmits<{ resize: [id: string, h: Handle, dx: number, dy: number];
  "resize-end": [id: string]; "open-edit": [id: string] }>();  // 合并进原 defineEmits
const handleList = computed(() => handles(props.item.bounds));
let drag: { h: Handle; sx: number; sy: number } | null = null;
function startResize(h: Handle, e: PointerEvent) {
  drag = { h, sx: e.clientX, sy: e.clientY };
  (e.target as Element).setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    if (!drag) return;
    emitResize("resize", props.item.id, drag.h,
      (ev.clientX - drag.sx) / props.zoom, (ev.clientY - drag.sy) / props.zoom);
    drag = { ...drag, sx: ev.clientX, sy: ev.clientY };
  };
  const up = () => { drag = null; emitResize("resize-end", props.item.id);
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
}
```

`CanvasView.vue` 接线（要点，完整装配由实现者按契约补齐）：本地 `draftBounds: Map<string, Bounds>` 存拖拽中的临时 bounds（渲染时覆盖 item.bounds），`resize` 事件里 `resizeBounds` 累加，`resize-end` 时 `store.updateItem(id, { bounds: draftBounds.get(id) })` 并清空；双击浮动 input 用绝对定位 div 叠在 svg 上（`imageToView` 求位置）；快捷键处理器挂 `window`，`e.target instanceof HTMLInputElement` 时直接返回；`M` 合并逻辑：

```ts
async function mergeSelected() {
  const items = store.doc!.payload.textItems.filter(t => store.selectedIds.includes(t.id));
  if (items.length < 2) return;
  const sorted = items.slice().sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  const merged = {
    id: `m-${Date.now()}`, text: sorted.map(t => t.text).join(""),
    bounds: unionRects(sorted.map(t => t.bounds)), ocrConfidence: 1,
    source: "human" as const, confidence: 1, reviewed: true,
  };
  const removes = sorted.map(t => store.textItemIndexById(t.id))
    .sort((a, b) => b - a)   // 从大到小删，避免 index 位移
    .map(i => ({ op: "remove" as const, path: `/payload/textItems/${i}` }));
  await store.applyOps([...removes, { op: "add", path: "/payload/textItems/-", value: merged }]);
  store.selectedIds = [merged.id];
}
```

`PropertyPanel.vue` / `ConfirmBar.vue` 按上方 Interfaces 契约实现（表单 change → `updateItem`；分析按钮 → `api.analyze(store.pageId, {scale, statusBarHeightPx})` 后 `store.load(store.pageId)`；gate 清单渲染 `store.gate`）。`App.vue` 装配：顶栏（模式切换按钮组 + ConfirmBar）+ 三栏。

- [ ] **Step 4: 跑测试通过** → PASS
- [ ] **Step 5: 手工冒烟（必须执行并记录）**：真实截图走一遍——改字、拖手柄、删框、N 画新框、I 画遮罩、M 合并、队列 Enter 快速过审、确认冻结被低置信度项挡下 → 清完队列 + 勾归一化 → 确认成功 → 界面只读 → 解冻恢复。
- [ ] **Step 6: Commit** `git add ui/apps/workbench-ui/src && git commit -m "feat(workbench): editing interactions, review queue, confirm flow"`

---

### Task 14: 标注模式 + ChangeSet 幽灵预览

**Files:**
- Create: `ui/apps/workbench-ui/src/components/AnnotationPanel.vue`
- Modify: `ui/apps/workbench-ui/src/components/CanvasView.vue`（annotate 模式画框 + 幽灵预览层）
- Modify: `ui/apps/workbench-ui/src/App.vue`（右栏在 pendingChangeSet 非空时切到 AnnotationPanel）
- Test: `ui/apps/workbench-ui/src/components/AnnotationPanel.test.ts`

**Interfaces:**
- Consumes: `store.annotateRegion / acceptPending / rejectPending / pendingChangeSet`。
- Produces:
  - annotate 模式：拖框（橙色虚线）→ pointerup 弹出浮动文本域 + "发送"按钮 → `annotateRegion(bounds, instruction)`（loading 态显示"AI 分析中"）→ 完成后框保留高亮，右栏显示提案。
  - **AnnotationPanel**：列出 `pendingChangeSet.allowed` 每条 op 卡片（explanation、path、旧值→新值、勾选框默认全选）与 `rejected` 灰色卡片（含 reason 徽标：`human-protected`/`out-of-bounds`/`invalid-path`）；按钮"接受勾选"→ `acceptPending(选中下标)`、"全部拒绝"→ `rejectPending()`。
  - 幽灵预览：`pendingChangeSet` 非空时，CanvasView 对 allowed ops 渲染预览层——`replace /textItems/i/text` 在对应框上方画新文字标签（蓝底白字）；`replace .../bounds` 画蓝色虚线新框；`add /textItems/-` 画蓝色虚线新框；`remove` 在原框上画红色对角线。预览计算函数抽为纯函数放 `src/lib/ghost-preview.ts` 并导出 `ghostShapes(allowed, payload): GhostShape[]`，`GhostShape = { kind: "new-box" | "removed-box" | "text-label"; bounds: Bounds; label?: string }`。
- 测试聚焦 `ghostShapes` 纯函数 + AnnotationPanel 渲染。

- [ ] **Step 1: 写失败测试** `src/components/AnnotationPanel.test.ts`

```ts
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMeasurementStore } from "../stores/measurement.js";
import AnnotationPanel from "./AnnotationPanel.vue";
import { ghostShapes } from "../lib/ghost-preview.js";
import { emptyMeasurementDoc } from "@ui-rebuild/workbench-contracts";

vi.mock("../api.js", () => ({}));

describe("AnnotationPanel", () => {
  beforeEach(() => setActivePinia(createPinia()));
  it("renders allowed ops with checkboxes and rejected with reasons", () => {
    const store = useMeasurementStore();
    store.pendingChangeSet = {
      id: "cs1",
      allowed: [{ op: "replace", path: "/textItems/0/text", value: "¥128", explanation: "修正货币符号" }],
      rejected: [{ op: { path: "/status" }, reason: "invalid-path" }],
    };
    const w = mount(AnnotationPanel);
    expect(w.findAll("[data-test=allowed]")).toHaveLength(1);
    expect(w.find("[data-test=allowed] input[type=checkbox]").element).toBeTruthy();
    expect(w.find("[data-test=rejected]").text()).toContain("invalid-path");
  });
});

describe("ghostShapes", () => {
  it("maps ops to preview shapes", () => {
    const p = emptyMeasurementDoc().payload;
    p.textItems.push({ id: "t0", text: "y128", bounds: { x: 1, y: 2, w: 30, h: 10 }, ocrConfidence: 0.6,
      source: "tool", confidence: 0.6, reviewed: false });
    const shapes = ghostShapes([
      { op: "replace", path: "/textItems/0/text", value: "¥128", explanation: "" },
      { op: "remove", path: "/textItems/0", explanation: "" },
      { op: "add", path: "/textItems/-", value: { bounds: { x: 5, y: 5, w: 8, h: 8 } }, explanation: "" },
    ], p);
    expect(shapes).toEqual([
      { kind: "text-label", bounds: { x: 1, y: 2, w: 30, h: 10 }, label: "¥128" },
      { kind: "removed-box", bounds: { x: 1, y: 2, w: 30, h: 10 } },
      { kind: "new-box", bounds: { x: 5, y: 5, w: 8, h: 8 } },
    ]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现**

`src/lib/ghost-preview.ts`：

```ts
import type { MeasurementPayload } from "@ui-rebuild/workbench-contracts";

interface Op { op: string; path: string; value?: unknown; explanation: string }
interface Bounds { x: number; y: number; w: number; h: number }
export type GhostShape = { kind: "new-box" | "removed-box" | "text-label"; bounds: Bounds; label?: string };

export function ghostShapes(allowed: Op[], payload: MeasurementPayload): GhostShape[] {
  const shapes: GhostShape[] = [];
  for (const op of allowed) {
    const m = /^\/(textItems|colorSamples|ignoreMasks)\/(\d+|-)(\/(.*))?$/.exec(op.path);
    if (!m) continue;
    const coll = m[1] as keyof MeasurementPayload & ("textItems" | "colorSamples" | "ignoreMasks");
    if (m[2] === "-") {
      const v = op.value as { bounds?: Bounds };
      if (v?.bounds) shapes.push({ kind: "new-box", bounds: v.bounds });
      continue;
    }
    const item = payload[coll][Number(m[2])] as { bounds: Bounds } | undefined;
    if (!item) continue;
    if (op.op === "remove" && !m[3]) shapes.push({ kind: "removed-box", bounds: item.bounds });
    else if (m[4] === "text") shapes.push({ kind: "text-label", bounds: item.bounds, label: String(op.value) });
    else if (m[4] === "bounds") shapes.push({ kind: "new-box", bounds: op.value as Bounds });
    else shapes.push({ kind: "text-label", bounds: item.bounds, label: "已修改" });
  }
  return shapes;
}
```

`src/components/AnnotationPanel.vue`：

```vue
<script setup lang="ts">
import { ref, watch } from "vue";
import { useMeasurementStore } from "../stores/measurement.js";

const store = useMeasurementStore();
const checked = ref<boolean[]>([]);
watch(() => store.pendingChangeSet, cs => { checked.value = cs ? cs.allowed.map(() => true) : []; }, { immediate: true });
const accept = () => store.acceptPending(checked.value.flatMap((c, i) => (c ? [i] : [])));
</script>

<template>
  <div v-if="store.pendingChangeSet">
    <h3>AI 修改提案</h3>
    <div v-for="(op, i) in store.pendingChangeSet.allowed" :key="i" data-test="allowed" class="card">
      <label><input type="checkbox" v-model="checked[i]" /> {{ op.explanation || op.path }}</label>
      <div class="detail">{{ op.path }} → {{ JSON.stringify(op.value) }}</div>
    </div>
    <div v-for="(r, i) in store.pendingChangeSet.rejected" :key="'r' + i" data-test="rejected" class="card rejected">
      <span class="badge">{{ r.reason }}</span> 已被系统拦截
    </div>
    <div class="actions">
      <button @click="accept">接受勾选</button>
      <button @click="store.rejectPending()">全部拒绝</button>
    </div>
  </div>
</template>

<style scoped>
.card { border: 1px solid #ddd; border-radius: 8px; padding: 8px; margin: 6px 0; }
.card.rejected { opacity: 0.55; }
.badge { background: #d0454c; color: #fff; border-radius: 4px; padding: 1px 6px; font-size: 11px; }
.detail { font-size: 12px; color: #666; margin-top: 4px; word-break: break-all; }
.actions { display: flex; gap: 8px; margin-top: 10px; }
</style>
```

`CanvasView.vue`：annotate 模式复用 draw 框逻辑（橙色 `#e07b00` 虚线）；pointerup 后浮动 `<textarea>` + 发送按钮；幽灵层在最上：

```vue
<g v-if="store.pendingChangeSet">
  <template v-for="(s, i) in ghosts" :key="i">
    <rect v-if="s.kind !== 'text-label'" :x="s.bounds.x" :y="s.bounds.y"
      :width="s.bounds.w" :height="s.bounds.h" fill="none"
      :stroke="s.kind === 'new-box' ? '#2f6fed' : '#d0454c'"
      :stroke-width="2 / view.zoom" stroke-dasharray="5 4" />
    <line v-if="s.kind === 'removed-box'" :x1="s.bounds.x" :y1="s.bounds.y"
      :x2="s.bounds.x + s.bounds.w" :y2="s.bounds.y + s.bounds.h" stroke="#d0454c" :stroke-width="2 / view.zoom" />
    <text v-if="s.kind === 'text-label'" :x="s.bounds.x" :y="s.bounds.y - 4 / view.zoom"
      fill="#2f6fed" :font-size="12 / view.zoom">{{ s.label }}</text>
  </template>
</g>
```

（`const ghosts = computed(() => store.pendingChangeSet && store.doc ? ghostShapes(store.pendingChangeSet.allowed, store.doc.payload) : [])`）

`App.vue`：右栏 `store.pendingChangeSet ? AnnotationPanel : PropertyPanel`。

- [ ] **Step 4: 跑测试通过** → PASS
- [ ] **Step 5: 手工冒烟（必须执行并记录）**：配置真实 `UIR_MODEL_*` 指向本地/中转多模态模型，对真实截图框选一列 OCR 错字 + 指令 → 观察提案卡片、幽灵预览、部分勾选接受后画布与文档更新、拒绝路径、模型不可用时 502 的错误提示。
- [ ] **Step 6: Commit** `git add ui/apps/workbench-ui/src && git commit -m "feat(workbench): annotation mode with ghost preview changesets"`

---

### Task 15: workbench-cli（init/open/doctor）+ 端到端走查

**Files:**
- Create: `ui/packages/workbench-cli/package.json`（`bin: { "ui-restore": "./src/index.ts" }` 配 `tsx` 运行；依赖 `commander`、`@ui-rebuild/measure: workspace:*`；scripts 同模板 + `"start": "tsx src/index.ts"`）
- Create: `ui/packages/workbench-cli/tsconfig.json`
- Create: `ui/packages/workbench-cli/src/index.ts`、`src/init.ts`、`src/open.ts`、`src/doctor.ts`
- Test: `ui/packages/workbench-cli/src/init.test.ts`

**Interfaces:**
- Produces:
  - `ui-restore init <pageId> --image <path> [--scale 2] [--pages-root ./pages]` → 建 `pages/<pageId>/reference/`，拷贝图片为 `default.png`，写 `manifest.yaml`（pageId、scale、statusBarHeightPx: 44）。实现为可测导出 `initPage(opts): { pageDir: string }`。
  - `ui-restore open <pageId>` → spawn workbench-server（传 `UIR_PAGES_ROOT`），spawn `vite dev`（或生产模式直接 serve 构建产物），打印 `http://localhost:5173/#<pageId>` 并用 `start` 命令开浏览器（Windows）。
  - `ui-restore doctor` → 逐项检查并打印 ✔/✘ 与修复指引：Node ≥22；`python --version` 可用；`python -c "import rapidocr_onnxruntime"`（✘ 时提示 `pip install rapidocr-onnxruntime`）；`UIR_MODEL_BASE_URL` 是否配置（仅警告）。
- 端到端走查（人工执行清单，写入 README）。

- [ ] **Step 1: 写失败测试** `src/init.test.ts`

```ts
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initPage } from "./init.js";

describe("initPage", () => {
  it("creates workspace with reference image and manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "uir-cli-"));
    const img = join(dir, "shot.png");
    writeFileSync(img, "png-bytes");
    const { pageDir } = initPage({ pageId: "member", imagePath: img, scale: 3, pagesRoot: join(dir, "pages") });
    expect(existsSync(join(pageDir, "reference", "default.png"))).toBe(true);
    expect(existsSync(join(pageDir, "manifest.yaml"))).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现** `src/init.ts`

```ts
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function initPage(opts: { pageId: string; imagePath: string; scale: number; pagesRoot: string }) {
  const pageDir = join(opts.pagesRoot, opts.pageId);
  mkdirSync(join(pageDir, "reference"), { recursive: true });
  copyFileSync(opts.imagePath, join(pageDir, "reference", "default.png"));
  writeFileSync(join(pageDir, "manifest.yaml"),
    `pageId: ${opts.pageId}\nscale: ${opts.scale}\nstatusBarHeightPx: 44\n`, "utf8");
  return { pageDir };
}
```

`src/doctor.ts`（execFile 探测，每项 try/catch 打印 ✔/✘ + 指引）、`src/open.ts`（`spawn` 两个子进程，`stdio: "inherit"`，`start http://localhost:5173/#<pageId>`）、`src/index.ts`（commander 装配三个命令）——按 Interfaces 契约实现，全部薄封装，无业务逻辑。

- [ ] **Step 4: 跑测试通过** → PASS
- [ ] **Step 5: 端到端走查（人工，必须执行并记录到 `ui/docs/superpowers/plans/2026-08-10-workbench-stage1-pilot-walkthrough.md`）**

以 `ui/fixtures/xunlei-member/reference/default.png` 为素材：

```bash
ui-restore doctor
ui-restore init xunlei-member --image ui/fixtures/xunlei-member/reference/default.png --scale 3
ui-restore open xunlei-member
```

清单（对应 spec §5.6 验收标准）：
1. analyze 后画布出现 OCR 框，产物 `pages/xunlei-member/stages/01-measurement.json` 可读、git diff 友好。
2. 计时完成全部文字审阅（目标 ≤10 分钟），记录实际用时与主要摩擦点。
3. 至少 2 条标注微调（1 条批量改字、1 条删误检），记录提案质量与接受率。
4. 撤销/重做跨越 10+ 次操作无状态错乱；确认冻结 → 只读 → 解冻全流程正常。
5. 重跑 analyze，确认人工条目全部保留。

- [ ] **Step 6: Commit**

```bash
git add ui/packages/workbench-cli ui/docs/superpowers/plans/2026-08-10-workbench-stage1-pilot-walkthrough.md ui/pnpm-lock.yaml
git commit -m "feat(workbench): cli init/open/doctor with e2e walkthrough"
```

---

## 计划自检记录

- **Spec 覆盖**：spec §5.1 数据结构 → Task 2；§5.2 测量引擎 → Task 4–6；§5.3 API → Task 8–10；§5.4 界面 → Task 11–14；§5.5 单一 AI 调用点 → Task 9；§5.6 验收 → Task 15 Step 5；§3.1 冻结/解冻 → Task 10；§3.2 human 保护 → Task 3/7/8；§3.3 标注协议 → Task 3/9/14；§3.4 审阅队列与门禁 → Task 10/13。spec §5.7 不做项未出现在任何 Task 中。
- **已知取舍**（实现者不必"修复"这些）：analyze 不可 undo（重跑等效）；ChangeSet 拒绝项不进历史（仅存 changesets 文件）；画布合并/拆分中"拆分（S 键）"从 spec §5.4 降级为后续增强，MVP 用"删除+补画"替代——已与 Task 13 契约一致。
- **类型一致性**：`MeasurementDoc/TextItem/ChangeSet/guardChangeSet/PageStore.applyPatch/updateItem` 的签名在 Task 2/3/7/11 定义后未在后续任务中变形；ChangeSet path 相对 payload、路由层加 `/payload` 前缀的约定在 Task 7 注释、Task 9 实现、Task 14 ghostShapes 中一致。
