# UI 效果图区域拆分工具 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现"上传移动端 UI 效果图 → AI 拆成 5–10 个粗粒度模块并自动命名 → 人工用鼠标/按钮做微调、拆分、合并、重命名"的完整工具。

**Architecture:** 粗粒度模块拆分被建模为 **Y 轴一维切分**——区域首尾相接覆盖全图，所以核心数据是一组边界线而非任意矩形。所有编辑操作（微调/拆分/合并）都是纯函数 `Region[] → Region[]`，放在共享包里，UI 只做渲染和事件绑定，撤销栈是这些纯函数结果的快照。服务端每次写入前校验不变量，违反即拒绝。

**Tech Stack:** TypeScript 5.9 / Node ≥22 / pnpm 10 / zod 3 / sharp / Fastify 5 / Vue 3 + Vite / Vitest

**Spec:** `ui/docs/superpowers/specs/2026-08-11-region-split-design.md`

## Global Constraints

- 工作目录 `D:\workspace\ui` 当前只有 `docs/`，**从零重建**；不得引用任何已删除的 `workbench-*` 包。
- 包命名：`@region-split/core`（`packages/region-split`）、`@region-split/ui`（`apps/region-split-ui`）。
- 所有 `Region.bounds` 一律为**原图像素坐标**；`x` 恒为 0，`w` 恒为 `image.width`。分析图坐标只存在于 `reconcile` 内部与候选线检测中，绝不外泄。
- 不变量（spec §4.1），任何写入前必须成立：`regions` 按 `bounds.y` 升序且相邻首尾相接（`前.y + 前.h === 后.y`）；首区域 `y === 0`；末区域 `y + h === image.height`；所有 `h >= 8`；所有 `x === 0` 且 `w === image.width`；`id` 全局唯一。违反一律拒绝，**不做静默修正**。
- `MIN_REGION_HEIGHT = 8`，`SNAP_THRESHOLD = 12`，`MAX_ANALYZED_HEIGHT = 2000`，`UNDO_STACK_LIMIT = 50`，`COALESCE_MS = 500`，`RENAME_TIMEOUT_MS = 15000`。
- 模型接入仅 OpenAI 兼容 Chat Completions，配置来自环境变量 `UIR_MODEL_BASE_URL` / `UIR_MODEL_API_KEY` / `UIR_MODEL_NAME`；**测试一律注入 fake，不打真实网络**。
- 数据结构不含 `reason` 字段。
- 键盘只保留两处：上下方向键微调下边界、`Ctrl+Z` / `Ctrl+Shift+Z` 撤销重做。其余操作一律走按钮或鼠标。
- 每个 Task 结束必须 `pnpm -C ui test` 相关包通过，并提交一次 commit。
- 平台为 Windows（Git Bash 可用）；路径拼接用 `node:path`。

## File Structure

```text
ui/
  package.json              pnpm workspace 根，脚本 test/typecheck/lint
  pnpm-workspace.yaml
  tsconfig.base.json        共享编译选项
  vitest.workspace.ts       聚合两个单元的测试
  .gitignore  .npmrc

  packages/region-split/                     @region-split/core
    src/types.ts            Region/RegionSplitDoc + zod schema + checkInvariants
    src/operations.ts       纯函数编辑操作（微调/拆分/合并/重命名/相邻判断）
    src/reconcile.ts        模型分段 → 合法 Region[]（排序/吸附/夹紧/合并过小/去重/换算）
    src/candidate-lines.ts  水平投影候选切分线检测
    src/model.ts            OpenAI 兼容调用（分段 + 单块命名）
    src/analyze.ts          编排：预处理 → 候选线 → 模型 → reconcile
    src/store.ts            项目目录读写 + 写入前不变量校验
    src/server.ts           buildServer(deps) Fastify 路由
    src/index.ts            进程入口（读环境变量、组装真实依赖、listen）

  apps/region-split-ui/                      @region-split/ui
    index.html  vite.config.ts  tsconfig.json
    src/main.ts  src/App.vue
    src/api.ts              REST 客户端
    src/state.ts            createStore()：doc/选中/撤销栈/与服务端同步
    src/components/ImageCanvas.vue   图片 + 分段叠加 + 选中 + 拆分线
    src/components/RegionList.vue    右侧列表（联动、就地重命名）
    src/components/Toolbar.vue       全局工具栏 + 上下文操作条 + 状态条
```

**依赖方向**：`ui` 单向依赖 `core` 的类型与 `operations`；`core` 不知道 UI 存在。编辑逻辑全部在 `core/operations.ts`，因此可以脱离浏览器完整测试。

---

### Task 1: Monorepo 脚手架 + 类型与不变量校验

**Files:**
- Create: `ui/package.json`、`ui/pnpm-workspace.yaml`、`ui/tsconfig.base.json`、`ui/vitest.workspace.ts`、`ui/.gitignore`、`ui/.npmrc`
- Create: `ui/packages/region-split/package.json`、`tsconfig.json`、`vitest.config.ts`
- Create: `ui/packages/region-split/src/types.ts`
- Test: `ui/packages/region-split/src/types.test.ts`

**Interfaces:**
- Produces:
  - `Rect { x, y, w, h }`、`RegionType`（12 个字面量）、`Region { id, displayName, type, bounds, confidence }`
  - `CandidateLine { y: number; strength: number }`（**原图坐标**；由 Task 11 的检测产生，前端拆分模式吸附也用它）
  - `RegionSplitDoc { schemaVersion, image: { fileName, width, height, analyzedScale }, regions, candidateLines, updatedAt }`
  - zod: `rectSchema` `regionSchema` `candidateLineSchema` `regionSplitDocSchema`（`candidateLines` 用 `.default([])`，旧文件缺该字段也能读）
  - 常量 `MIN_REGION_HEIGHT = 8`
  - `checkInvariants(regions: Region[], image: { width: number; height: number }): InvariantViolation[]`，`InvariantViolation { code: string; message: string }`，返回空数组表示合法。`code` 取值：`empty` `not-ascending` `gap-or-overlap` `first-not-zero` `last-not-bottom` `too-short` `bad-x-or-width` `duplicate-id`

- [ ] **Step 1: 建根脚手架**

`ui/package.json`：

```json
{
  "name": "region-split-workspace",
  "private": true,
  "packageManager": "pnpm@10.13.1",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.base.json"
  },
  "devDependencies": {
    "@types/node": "22.17.0",
    "typescript": "5.9.2",
    "vitest": "2.1.9"
  }
}
```

`ui/pnpm-workspace.yaml`：

```yaml
packages:
  - packages/*
  - apps/*
```

`ui/tsconfig.base.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true,
    "noEmit": true
  }
}
```

`ui/vitest.workspace.ts`：

```ts
export default ["packages/*", "apps/*"];
```

`ui/.npmrc`：

```text
store-dir=.cache/pnpm-store
```

`ui/.gitignore`：

```text
node_modules/
dist/
.cache/
projects/
*.log
```

`ui/packages/region-split/package.json`：

```json
{
  "name": "@region-split/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p tsconfig.json" },
  "dependencies": { "zod": "3.25.76" }
}
```

`ui/packages/region-split/tsconfig.json`：

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`ui/packages/region-split/vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
```

- [ ] **Step 2: 写失败测试** `ui/packages/region-split/src/types.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { checkInvariants, type Region } from "./types.js";

const image = { width: 375, height: 300 };
const r = (id: string, y: number, h: number): Region => ({
  id, displayName: id, type: "other", bounds: { x: 0, y, w: 375, h }, confidence: 0.9,
});

describe("checkInvariants", () => {
  it("accepts a contiguous full-cover set", () => {
    expect(checkInvariants([r("a", 0, 100), r("b", 100, 200)], image)).toEqual([]);
  });
  it("rejects empty regions", () => {
    expect(checkInvariants([], image).map(v => v.code)).toEqual(["empty"]);
  });
  it("rejects a gap between regions", () => {
    const codes = checkInvariants([r("a", 0, 90), r("b", 100, 200)], image).map(v => v.code);
    expect(codes).toContain("gap-or-overlap");
  });
  it("rejects when first region does not start at 0", () => {
    const codes = checkInvariants([r("a", 10, 90), r("b", 100, 200)], image).map(v => v.code);
    expect(codes).toContain("first-not-zero");
  });
  it("rejects when last region does not reach image bottom", () => {
    const codes = checkInvariants([r("a", 0, 100), r("b", 100, 150)], image).map(v => v.code);
    expect(codes).toContain("last-not-bottom");
  });
  it("rejects regions shorter than the minimum height", () => {
    const codes = checkInvariants([r("a", 0, 4), r("b", 4, 296)], image).map(v => v.code);
    expect(codes).toContain("too-short");
  });
  it("rejects wrong x or width", () => {
    const bad = { ...r("a", 0, 100), bounds: { x: 5, y: 0, w: 370, h: 100 } };
    const codes = checkInvariants([bad, r("b", 100, 200)], image).map(v => v.code);
    expect(codes).toContain("bad-x-or-width");
  });
  it("rejects duplicate ids", () => {
    const codes = checkInvariants([r("a", 0, 100), r("a", 100, 200)], image).map(v => v.code);
    expect(codes).toContain("duplicate-id");
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm -C ui install && pnpm -C ui/packages/region-split test`
Expected: FAIL —— 找不到 `./types.js`

- [ ] **Step 4: 实现** `ui/packages/region-split/src/types.ts`

```ts
import { z } from "zod";

export const MIN_REGION_HEIGHT = 8;

export const regionTypes = [
  "status-bar", "nav-bar", "banner", "card", "grid", "list",
  "form", "tabs", "text-block", "action-bar", "tab-bar", "other",
] as const;
export type RegionType = (typeof regionTypes)[number];

export interface Rect { x: number; y: number; w: number; h: number }

export const rectSchema = z.object({
  x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive(),
});

export const regionSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  type: z.enum(regionTypes),
  bounds: rectSchema,
  confidence: z.number().min(0).max(1),
});
export type Region = z.infer<typeof regionSchema>;

export const candidateLineSchema = z.object({
  y: z.number(),          // 原图坐标
  strength: z.number().min(0).max(1),
});
export type CandidateLine = z.infer<typeof candidateLineSchema>;

export const regionSplitDocSchema = z.object({
  schemaVersion: z.string(),
  image: z.object({
    fileName: z.string(),
    width: z.number().positive(),
    height: z.number().positive(),
    analyzedScale: z.number().positive(),
  }),
  regions: z.array(regionSchema),
  candidateLines: z.array(candidateLineSchema).default([]),
  updatedAt: z.string(),
});
export type RegionSplitDoc = z.infer<typeof regionSplitDocSchema>;

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
```

`ui/packages/region-split/src/index.ts`：

```ts
export * from "./types.js";
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm -C ui/packages/region-split test`
Expected: PASS（8 个用例）

- [ ] **Step 6: Commit**

```bash
git add ui/package.json ui/pnpm-workspace.yaml ui/tsconfig.base.json ui/vitest.workspace.ts ui/.gitignore ui/.npmrc ui/packages/region-split ui/pnpm-lock.yaml
git commit -m "feat: scaffold region-split workspace with region types and invariants"
```

---

### Task 2: 编辑操作纯函数

**Files:**
- Create: `ui/packages/region-split/src/operations.ts`
- Modify: `ui/packages/region-split/src/index.ts`
- Test: `ui/packages/region-split/src/operations.test.ts`

**Interfaces:**
- Consumes: `Region` `MIN_REGION_HEIGHT`（Task 1）
- Produces（全部为纯函数，不修改入参，返回新数组）：
  - `adjustBoundary(regions: Region[], index: number, delta: number): Region[]` —— 调整第 `index` 个区域的下边界，本区域 `h += delta`、下一区域 `y += delta` 且 `h -= delta`。`index` 为最后一个区域时原样返回。任一侧结果 `< MIN_REGION_HEIGHT` 时钳制到恰好等于 `MIN_REGION_HEIGHT`；无法移动则原样返回。
  - `canAdjustBoundary(regions: Region[], index: number): boolean` —— `index` 合法且不是最后一个区域。
  - `splitRegion(regions: Region[], index: number, y: number): Region[]` —— 在绝对坐标 `y` 处把第 `index` 个区域切成两块。上块保留原 `id`/`displayName`/`type`/`confidence`；下块 `id` 为 `<原id>-2`（若已存在则继续追加 `-3`、`-4`…），`displayName` 为 `未命名区域`，`type` 为 `other`，`confidence` 为 0。若 `y` 使任一侧 `< MIN_REGION_HEIGHT` 则原样返回。
  - `canSplitAt(regions: Region[], index: number, y: number): boolean`
  - `mergeRegions(regions: Region[], ids: string[]): Region[]` —— 合并一组相邻区域为一个；`bounds` 取并集（`y` 取最小、`h` 取总和）；结果保留最靠上区域的 `id`，`displayName` 为 `未命名区域`，`type` 为 `other`，`confidence` 为 0。`ids` 少于 2 个或不相邻时原样返回。
  - `areAdjacent(regions: Region[], ids: string[]): boolean` —— `ids` 在 `regions` 中对应的下标是否构成连续区间（顺序无关，至少 2 个）。
  - `renameRegion(regions: Region[], id: string, displayName: string): Region[]` —— 只改 `displayName`，`id` 不变。
  - `applyNaming(regions: Region[], id: string, naming: { displayName: string; id: string; type: RegionType }): Region[]` —— 用模型返回的命名替换指定区域；新 `id` 与其他区域冲突时追加 `-2`、`-3`… 直到唯一。

- [ ] **Step 1: 写失败测试** `ui/packages/region-split/src/operations.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  adjustBoundary, applyNaming, areAdjacent, canAdjustBoundary,
  canSplitAt, mergeRegions, renameRegion, splitRegion,
} from "./operations.js";
import type { Region } from "./types.js";

const r = (id: string, y: number, h: number): Region => ({
  id, displayName: `名-${id}`, type: "card", bounds: { x: 0, y, w: 375, h }, confidence: 0.9,
});
const base = () => [r("a", 0, 100), r("b", 100, 100), r("c", 200, 100)];

describe("adjustBoundary", () => {
  it("moves the boundary and compensates the next region", () => {
    const out = adjustBoundary(base(), 0, 10);
    expect(out[0]!.bounds).toEqual({ x: 0, y: 0, w: 375, h: 110 });
    expect(out[1]!.bounds).toEqual({ x: 0, y: 110, w: 375, h: 90 });
    expect(out[2]!.bounds).toEqual({ x: 0, y: 200, w: 375, h: 100 });
  });
  it("clamps so neither side drops below the minimum height", () => {
    const out = adjustBoundary(base(), 0, 500);
    expect(out[0]!.bounds.h).toBe(192);
    expect(out[1]!.bounds.h).toBe(8);
  });
  it("returns input unchanged for the last region", () => {
    const input = base();
    expect(adjustBoundary(input, 2, 10)).toEqual(input);
    expect(canAdjustBoundary(input, 2)).toBe(false);
    expect(canAdjustBoundary(input, 1)).toBe(true);
  });
});

describe("splitRegion", () => {
  it("splits into two regions with a placeholder lower block", () => {
    const out = splitRegion(base(), 1, 150);
    expect(out).toHaveLength(4);
    expect(out[1]!).toMatchObject({ id: "b", displayName: "名-b", type: "card" });
    expect(out[1]!.bounds).toEqual({ x: 0, y: 100, w: 375, h: 50 });
    expect(out[2]!).toMatchObject({ id: "b-2", displayName: "未命名区域", type: "other", confidence: 0 });
    expect(out[2]!.bounds).toEqual({ x: 0, y: 150, w: 375, h: 50 });
  });
  it("avoids colliding with an existing id", () => {
    const regions = [r("a", 0, 100), r("a-2", 100, 200)];
    const out = splitRegion(regions, 0, 50);
    expect(out[1]!.id).toBe("a-3");
  });
  it("refuses splits that would create a too-short side", () => {
    const input = base();
    expect(canSplitAt(input, 1, 104)).toBe(false);
    expect(splitRegion(input, 1, 104)).toEqual(input);
    expect(canSplitAt(input, 1, 150)).toBe(true);
  });
});

describe("mergeRegions", () => {
  it("merges adjacent regions into one placeholder region", () => {
    const out = mergeRegions(base(), ["b", "c"]);
    expect(out).toHaveLength(2);
    expect(out[1]!).toMatchObject({ id: "b", displayName: "未命名区域", type: "other", confidence: 0 });
    expect(out[1]!.bounds).toEqual({ x: 0, y: 100, w: 375, h: 200 });
  });
  it("ignores non-adjacent selections", () => {
    const input = base();
    expect(mergeRegions(input, ["a", "c"])).toEqual(input);
    expect(areAdjacent(input, ["a", "c"])).toBe(false);
    expect(areAdjacent(input, ["c", "b"])).toBe(true);
    expect(areAdjacent(input, ["a"])).toBe(false);
  });
});

describe("renameRegion and applyNaming", () => {
  it("renames only the display name", () => {
    const out = renameRegion(base(), "b", "会员卡");
    expect(out[1]!).toMatchObject({ id: "b", displayName: "会员卡" });
  });
  it("applies model naming and de-duplicates the id", () => {
    const out = applyNaming(base(), "b", { displayName: "权益表", id: "a", type: "grid" });
    expect(out[1]!).toMatchObject({ id: "a-2", displayName: "权益表", type: "grid" });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C ui/packages/region-split test`
Expected: FAIL —— 找不到 `./operations.js`

- [ ] **Step 3: 实现** `ui/packages/region-split/src/operations.ts`

```ts
import { MIN_REGION_HEIGHT, type Region, type RegionType } from "./types.js";

const PLACEHOLDER_NAME = "未命名区域";

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function withBounds(region: Region, y: number, h: number): Region {
  return { ...region, bounds: { ...region.bounds, y, h } };
}

export function canAdjustBoundary(regions: Region[], index: number): boolean {
  return index >= 0 && index < regions.length - 1;
}

export function adjustBoundary(regions: Region[], index: number, delta: number): Region[] {
  if (!canAdjustBoundary(regions, index)) return regions;
  const cur = regions[index]!;
  const next = regions[index + 1]!;
  const minDelta = MIN_REGION_HEIGHT - cur.bounds.h;
  const maxDelta = next.bounds.h - MIN_REGION_HEIGHT;
  const applied = Math.max(minDelta, Math.min(maxDelta, delta));
  if (applied === 0) return regions;
  const out = regions.slice();
  out[index] = withBounds(cur, cur.bounds.y, cur.bounds.h + applied);
  out[index + 1] = withBounds(next, next.bounds.y + applied, next.bounds.h - applied);
  return out;
}

export function canSplitAt(regions: Region[], index: number, y: number): boolean {
  const region = regions[index];
  if (!region) return false;
  const top = y - region.bounds.y;
  const bottom = region.bounds.y + region.bounds.h - y;
  return top >= MIN_REGION_HEIGHT && bottom >= MIN_REGION_HEIGHT;
}

export function splitRegion(regions: Region[], index: number, y: number): Region[] {
  if (!canSplitAt(regions, index, y)) return regions;
  const region = regions[index]!;
  const taken = new Set(regions.map(item => item.id));
  const lower: Region = {
    id: uniqueId(`${region.id}-2`, taken),
    displayName: PLACEHOLDER_NAME,
    type: "other",
    bounds: { x: region.bounds.x, y, w: region.bounds.w, h: region.bounds.y + region.bounds.h - y },
    confidence: 0,
  };
  const out = regions.slice();
  out.splice(index, 1, withBounds(region, region.bounds.y, y - region.bounds.y), lower);
  return out;
}

export function areAdjacent(regions: Region[], ids: string[]): boolean {
  if (ids.length < 2) return false;
  const indexes = ids.map(id => regions.findIndex(region => region.id === id));
  if (indexes.some(i => i < 0)) return false;
  const sorted = indexes.slice().sort((a, b) => a - b);
  return sorted.every((value, i) => i === 0 || value === sorted[i - 1]! + 1);
}

export function mergeRegions(regions: Region[], ids: string[]): Region[] {
  if (!areAdjacent(regions, ids)) return regions;
  const indexes = ids.map(id => regions.findIndex(region => region.id === id)).sort((a, b) => a - b);
  const start = indexes[0]!;
  const end = indexes[indexes.length - 1]!;
  const head = regions[start]!;
  const tail = regions[end]!;
  const merged: Region = {
    id: head.id,
    displayName: PLACEHOLDER_NAME,
    type: "other",
    bounds: {
      x: head.bounds.x, y: head.bounds.y, w: head.bounds.w,
      h: tail.bounds.y + tail.bounds.h - head.bounds.y,
    },
    confidence: 0,
  };
  const out = regions.slice();
  out.splice(start, end - start + 1, merged);
  return out;
}

export function renameRegion(regions: Region[], id: string, displayName: string): Region[] {
  return regions.map(region => (region.id === id ? { ...region, displayName } : region));
}

export function applyNaming(
  regions: Region[],
  id: string,
  naming: { displayName: string; id: string; type: RegionType },
): Region[] {
  const taken = new Set(regions.filter(region => region.id !== id).map(region => region.id));
  const nextId = uniqueId(naming.id, taken);
  return regions.map(region =>
    region.id === id
      ? { ...region, id: nextId, displayName: naming.displayName, type: naming.type }
      : region);
}
```

`ui/packages/region-split/src/index.ts` 追加：

```ts
export * from "./operations.js";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -C ui/packages/region-split test`
Expected: PASS（types 8 个 + operations 9 个）

- [ ] **Step 5: Commit**

```bash
git add ui/packages/region-split/src
git commit -m "feat: add pure region editing operations"
```

---

### Task 3: 融合与修正（reconcile）

**Files:**
- Modify: `ui/packages/region-split/src/types.ts`（追加 `RawSegment`）
- Create: `ui/packages/region-split/src/reconcile.ts`
- Modify: `ui/packages/region-split/src/index.ts`
- Test: `ui/packages/region-split/src/reconcile.test.ts`

**Interfaces:**
- Consumes: `Region` `CandidateLine` `MIN_REGION_HEIGHT` `checkInvariants`（Task 1）
- Produces:
  - `RawSegment { displayName: string; id: string; type: RegionType; yStart: number; yEnd: number; confidence: number }`（**分析图坐标**）
  - `fullPageRegions(image: { width: number; height: number }): Region[]` —— 单个覆盖全图的兜底区域：`id` 为 `region-1`、`displayName` 为 `整页`、`type` 为 `other`、`confidence` 为 0
  - `reconcile(segments: RawSegment[], opts: ReconcileOptions): Region[]`，`ReconcileOptions { imageWidth: number; imageHeight: number; analyzedScale: number; candidateLines?: CandidateLine[]; snapThreshold?: number }`（`snapThreshold` 默认 12，单位为原图像素）
- 算法（顺序固定，产出必定满足不变量）：① `segments` 空则返回 `fullPageRegions`；② 按 `yStart` 升序；③ 取 n−1 条内部边界（第 i 条 = 第 i+1 段的 `yStart`）；④ 按 `analyzedScale` 换算到原图并四舍五入；⑤ 吸附到 `snapThreshold` 内的候选线，多条候选时取 `strength` 最大、并列取更近的；⑥ 从上到下逐条校验：边界必须 ≥ 上一条已保留边界 + `MIN_REGION_HEIGHT` 且 ≤ `imageHeight − MIN_REGION_HEIGHT`，不满足则丢弃该边界（对应段并入上一段）；⑦ 由保留的边界数组构造区域，`y`/`h` 由相邻边界直接算出，因此首尾相接、覆盖全图；⑧ `id` 去重，冲突追加 `-2`、`-3`…

- [ ] **Step 1: 写失败测试** `ui/packages/region-split/src/reconcile.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { fullPageRegions, reconcile } from "./reconcile.js";
import { checkInvariants, type RawSegment } from "./types.js";

const image = { width: 375, height: 600 };
const seg = (id: string, yStart: number, yEnd: number): RawSegment => ({
  id, displayName: `名-${id}`, type: "card", yStart, yEnd, confidence: 0.9,
});

describe("reconcile", () => {
  it("falls back to a single full-page region when there are no segments", () => {
    const out = reconcile([], { ...image, analyzedScale: 1 });
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ id: "region-1", displayName: "整页", type: "other" });
    expect(out[0]!.bounds).toEqual({ x: 0, y: 0, w: 375, h: 600 });
    expect(checkInvariants(out, image)).toEqual([]);
  });

  it("makes segments contiguous and clamps the ends", () => {
    const out = reconcile([seg("a", 10, 190), seg("b", 200, 400), seg("c", 400, 550)],
      { ...image, analyzedScale: 1 });
    expect(out.map(r => [r.bounds.y, r.bounds.h])).toEqual([[0, 200], [200, 200], [400, 200]]);
    expect(checkInvariants(out, image)).toEqual([]);
  });

  it("scales analyzed coordinates back to original pixels", () => {
    const out = reconcile([seg("a", 0, 100), seg("b", 100, 300)],
      { ...image, analyzedScale: 0.5 });
    expect(out.map(r => [r.bounds.y, r.bounds.h])).toEqual([[0, 200], [200, 400]]);
  });

  it("snaps boundaries to the strongest nearby candidate line", () => {
    const out = reconcile([seg("a", 0, 200), seg("b", 200, 600)], {
      ...image, analyzedScale: 1,
      candidateLines: [{ y: 208, strength: 0.4 }, { y: 206, strength: 0.9 }, { y: 400, strength: 1 }],
    });
    expect(out[0]!.bounds.h).toBe(206);
  });

  it("ignores candidate lines outside the snap threshold", () => {
    const out = reconcile([seg("a", 0, 200), seg("b", 200, 600)], {
      ...image, analyzedScale: 1, candidateLines: [{ y: 240, strength: 1 }],
    });
    expect(out[0]!.bounds.h).toBe(200);
  });

  it("drops boundaries that would create a too-short region and merges into the previous segment", () => {
    const out = reconcile([seg("a", 0, 100), seg("b", 100, 104), seg("c", 104, 600)],
      { ...image, analyzedScale: 1 });
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe("a");
    expect(out.map(r => [r.bounds.y, r.bounds.h])).toEqual([[0, 100], [100, 500]]);
    expect(checkInvariants(out, image)).toEqual([]);
  });

  it("de-duplicates ids", () => {
    const out = reconcile([seg("dup", 0, 300), seg("dup", 300, 600)], { ...image, analyzedScale: 1 });
    expect(out.map(r => r.id)).toEqual(["dup", "dup-2"]);
  });
});

describe("fullPageRegions", () => {
  it("covers the whole image", () => {
    expect(checkInvariants(fullPageRegions(image), image)).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C ui/packages/region-split test`
Expected: FAIL —— 找不到 `./reconcile.js`

- [ ] **Step 3: 在 types.ts 追加 `RawSegment`**

```ts
export interface RawSegment {
  displayName: string;
  id: string;
  type: RegionType;
  yStart: number;   // 分析图坐标
  yEnd: number;     // 分析图坐标
  confidence: number;
}
```

- [ ] **Step 4: 实现** `ui/packages/region-split/src/reconcile.ts`

```ts
import { MIN_REGION_HEIGHT, type CandidateLine, type RawSegment, type Region } from "./types.js";

const DEFAULT_SNAP_THRESHOLD = 12;

export interface ReconcileOptions {
  imageWidth: number;
  imageHeight: number;
  analyzedScale: number;
  candidateLines?: CandidateLine[];
  snapThreshold?: number;
}

export function fullPageRegions(image: { width: number; height: number }): Region[] {
  return [{
    id: "region-1",
    displayName: "整页",
    type: "other",
    bounds: { x: 0, y: 0, w: image.width, h: image.height },
    confidence: 0,
  }];
}

function snap(y: number, lines: CandidateLine[], threshold: number): number {
  let best: CandidateLine | null = null;
  for (const line of lines) {
    const distance = Math.abs(line.y - y);
    if (distance > threshold) continue;
    if (
      best === null ||
      line.strength > best.strength ||
      (line.strength === best.strength && distance < Math.abs(best.y - y))
    ) {
      best = line;
    }
  }
  return best ? best.y : y;
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function reconcile(segments: RawSegment[], opts: ReconcileOptions): Region[] {
  const image = { width: opts.imageWidth, height: opts.imageHeight };
  if (segments.length === 0) return fullPageRegions(image);

  const sorted = segments.slice().sort((a, b) => a.yStart - b.yStart);
  const lines = opts.candidateLines ?? [];
  const threshold = opts.snapThreshold ?? DEFAULT_SNAP_THRESHOLD;

  // 保留的边界，以及该边界之后那一段对应的原始 segment 下标
  const kept: { y: number; segmentIndex: number }[] = [];
  let previous = 0;
  for (let i = 1; i < sorted.length; i++) {
    const scaled = Math.round(sorted[i]!.yStart / opts.analyzedScale);
    const snapped = snap(scaled, lines, threshold);
    if (snapped < previous + MIN_REGION_HEIGHT) continue;
    if (snapped > image.height - MIN_REGION_HEIGHT) continue;
    kept.push({ y: snapped, segmentIndex: i });
    previous = snapped;
  }

  const starts = [0, ...kept.map(item => item.y)];
  const metaIndexes = [0, ...kept.map(item => item.segmentIndex)];
  const taken = new Set<string>();

  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1]! : image.height;
    const meta = sorted[metaIndexes[i]!]!;
    const id = uniqueId(meta.id, taken);
    taken.add(id);
    return {
      id,
      displayName: meta.displayName,
      type: meta.type,
      bounds: { x: 0, y: start, w: image.width, h: end - start },
      confidence: meta.confidence,
    };
  });
}
```

`ui/packages/region-split/src/index.ts` 追加：

```ts
export * from "./reconcile.js";
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm -C ui/packages/region-split test`
Expected: PASS（新增 8 个用例）

- [ ] **Step 6: Commit**

```bash
git add ui/packages/region-split/src
git commit -m "feat: reconcile model segments into valid regions"
```

---

### Task 4: 模型客户端与模型配置

**Files:**
- Create: `ui/packages/region-split/src/model.ts`
- Create: `ui/packages/region-split/src/model-config.ts`
- Modify: `ui/packages/region-split/src/index.ts`
- Test: `ui/packages/region-split/src/model.test.ts`、`ui/packages/region-split/src/model-config.test.ts`

**Interfaces:**
- Consumes: `RawSegment` `RegionType` `regionTypes`（Task 1/3）
- Produces:
  - `interface RegionNaming { displayName: string; id: string; type: RegionType }`
  - `interface SegmentModel { segment(input: SegmentInput): Promise<RawSegment[]>; nameRegion(input: { cropBase64: string }): Promise<RegionNaming> }`
  - `interface SegmentInput { imageBase64: string; width: number; height: number; candidateYs: number[] }`（`width`/`height` 为**分析图**尺寸）
  - `createOpenAiModel(cfg: { baseUrl: string; apiKey: string; model: string; fetchImpl?: typeof fetch }): SegmentModel`
  - `interface ModelConfig { baseUrl: string; apiKey: string; model: string }`
  - `interface ModelConfigView { baseUrl: string; model: string; hasApiKey: boolean; apiKeyMask: string }`
  - `maskApiKey(key: string): string` —— 空串返回 `""`；长度 ≤ 8 返回 `"••••"`；否则返回 `前3位 + "••••" + 后4位`
  - `class ModelConfigStore`：`constructor(filePath: string, env?: Record<string, string | undefined>)`；`read(): ModelConfig`（文件存在用文件，否则回落 `UIR_MODEL_BASE_URL`/`UIR_MODEL_API_KEY`/`UIR_MODEL_NAME`，都没有则三个空串）；`write(input: { baseUrl: string; model: string; apiKey?: string }): ModelConfig`（`apiKey` 缺省或空串时保留原值）；`view(): ModelConfigView`；`isConfigured(): boolean`（`baseUrl` 与 `model` 都非空）
- 行为：`POST {baseUrl}/chat/completions`，`temperature: 0`，图片以 `data:image/png;base64,` 传入。响应内容先直接 `JSON.parse`；失败则用 `/\{[\s\S]*\}/` 提取首个 JSON 块再解析（覆盖模型加 ``` 围栏的情况）；仍失败则**重发一次同样的请求**；再失败抛 `Error("model returned unparsable content")`。解析结果经 zod 校验，非法同样触发一次重试。HTTP 非 2xx 抛 `Error("model http <status>")`，不重试。

- [ ] **Step 1: 写失败测试** `ui/packages/region-split/src/model.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { createOpenAiModel } from "./model.js";

function fakeFetch(...contents: string[]) {
  const queue = contents.slice();
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: queue.shift() ?? "" } }] }),
  })) as unknown as typeof fetch;
}

const cfg = (fetchImpl: typeof fetch) =>
  ({ baseUrl: "http://local/v1", apiKey: "k", model: "m", fetchImpl });

const segmentsJson = JSON.stringify({
  regions: [
    { displayName: "状态栏", id: "status-bar", type: "status-bar", yStart: 0, yEnd: 44, confidence: 0.96 },
    { displayName: "会员卡", id: "member-card", type: "card", yStart: 44, yEnd: 300, confidence: 0.88 },
  ],
});

describe("createOpenAiModel.segment", () => {
  it("parses a plain json response", async () => {
    const model = createOpenAiModel(cfg(fakeFetch(segmentsJson)));
    const out = await model.segment({ imageBase64: "AA", width: 375, height: 600, candidateYs: [44, 300] });
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({
      displayName: "会员卡", id: "member-card", type: "card", yStart: 44, yEnd: 300, confidence: 0.88,
    });
  });

  it("extracts json out of a fenced response", async () => {
    const fenced = "```json\n" + segmentsJson + "\n```";
    const model = createOpenAiModel(cfg(fakeFetch(fenced)));
    expect(await model.segment({ imageBase64: "AA", width: 375, height: 600, candidateYs: [] })).toHaveLength(2);
  });

  it("retries once when the first response is unusable", async () => {
    const fetchImpl = fakeFetch("not json at all", segmentsJson);
    const model = createOpenAiModel(cfg(fetchImpl));
    expect(await model.segment({ imageBase64: "AA", width: 375, height: 600, candidateYs: [] })).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws after the retry also fails", async () => {
    const model = createOpenAiModel(cfg(fakeFetch("nope", "still nope")));
    await expect(model.segment({ imageBase64: "AA", width: 375, height: 600, candidateYs: [] }))
      .rejects.toThrow(/unparsable/);
  });

  it("throws on a non-2xx response without retrying", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const model = createOpenAiModel(cfg(fetchImpl));
    await expect(model.segment({ imageBase64: "AA", width: 375, height: 600, candidateYs: [] }))
      .rejects.toThrow(/model http 500/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a response with an unknown region type", async () => {
    const bad = JSON.stringify({ regions: [{ displayName: "x", id: "x", type: "spaceship", yStart: 0, yEnd: 10, confidence: 1 }] });
    const model = createOpenAiModel(cfg(fakeFetch(bad, bad)));
    await expect(model.segment({ imageBase64: "AA", width: 375, height: 600, candidateYs: [] })).rejects.toThrow();
  });
});

describe("createOpenAiModel.nameRegion", () => {
  it("parses a naming response", async () => {
    const json = JSON.stringify({ displayName: "权益对比表", id: "benefits-comparison", type: "grid" });
    const model = createOpenAiModel(cfg(fakeFetch(json)));
    expect(await model.nameRegion({ cropBase64: "BB" })).toEqual({
      displayName: "权益对比表", id: "benefits-comparison", type: "grid",
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C ui/packages/region-split test`
Expected: FAIL —— 找不到 `./model.js`

- [ ] **Step 3: 实现** `ui/packages/region-split/src/model.ts`

```ts
import { z } from "zod";
import { regionTypes, type RawSegment, type RegionType } from "./types.js";

export interface RegionNaming { displayName: string; id: string; type: RegionType }

export interface SegmentInput {
  imageBase64: string;
  width: number;    // 分析图宽
  height: number;   // 分析图高
  candidateYs: number[];
}

export interface SegmentModel {
  segment(input: SegmentInput): Promise<RawSegment[]>;
  nameRegion(input: { cropBase64: string }): Promise<RegionNaming>;
}

const segmentsSchema = z.object({
  regions: z.array(z.object({
    displayName: z.string().min(1),
    id: z.string().min(1),
    type: z.enum(regionTypes),
    yStart: z.number(),
    yEnd: z.number(),
    confidence: z.number().min(0).max(1),
  })).min(1),
});

const namingSchema = z.object({
  displayName: z.string().min(1),
  id: z.string().min(1),
  type: z.enum(regionTypes),
});

const SEGMENT_PROMPT = [
  "你在分析一张移动端 UI 效果图，需要把整页按视觉/功能单元从上到下切成若干模块。",
  "只输出一个 JSON 对象，格式为 {\"regions\":[{\"displayName\":string,\"id\":string,\"type\":string,\"yStart\":number,\"yEnd\":number,\"confidence\":number}]}。",
  "要求：模块数量 5 到 10 个；必须从 y=0 开始、到图片底部结束；每段 yEnd 等于下一段 yStart；",
  "displayName 用简短中文，id 用 kebab-case 英文，confidence 取 0 到 1。",
  `type 只能取以下之一：${regionTypes.join("、")}。`,
  "参考给出的候选切分线：它们是图像分析得到的真实分割位置，优先在这些位置附近切分。",
].join("\n");

const NAMING_PROMPT = [
  "这是一张移动端 UI 页面中某一个模块的裁图。给它命名并判断类型。",
  "只输出一个 JSON 对象，格式为 {\"displayName\":string,\"id\":string,\"type\":string}。",
  "displayName 用简短中文，id 用 kebab-case 英文。",
  `type 只能取以下之一：${regionTypes.join("、")}。`,
].join("\n");

function extractJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const match = /\{[\s\S]*\}/.exec(raw);
    if (!match) throw new Error("model returned unparsable content");
    return JSON.parse(match[0]);
  }
}

export function createOpenAiModel(cfg: {
  baseUrl: string; apiKey: string; model: string; fetchImpl?: typeof fetch;
}): SegmentModel {
  const doFetch = cfg.fetchImpl ?? fetch;
  const endpoint = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;

  async function ask(systemPrompt: string, userText: string, imageBase64: string): Promise<string> {
    const res = await doFetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
          ] },
        ],
      }),
    });
    if (!res.ok) throw new Error(`model http ${res.status}`);
    const body = await res.json() as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content ?? "";
  }

  async function askParsed<T>(
    systemPrompt: string, userText: string, imageBase64: string, schema: z.ZodType<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await ask(systemPrompt, userText, imageBase64);
      try {
        return schema.parse(extractJson(raw));
      } catch (err) {
        if (attempt === 1) {
          throw err instanceof z.ZodError
            ? new Error(`model returned invalid shape: ${err.message}`)
            : new Error("model returned unparsable content");
        }
      }
    }
    throw new Error("model returned unparsable content");
  }

  return {
    async segment(input) {
      const userText = [
        `图片尺寸：宽 ${input.width}，高 ${input.height}（像素）。`,
        input.candidateYs.length > 0
          ? `候选切分线 y 值：${input.candidateYs.join(", ")}`
          : "本次没有候选切分线，请自行判断切分位置。",
      ].join("\n");
      const parsed = await askParsed(SEGMENT_PROMPT, userText, input.imageBase64, segmentsSchema);
      return parsed.regions as RawSegment[];
    },
    async nameRegion(input) {
      return askParsed(NAMING_PROMPT, "请命名这个模块。", input.cropBase64, namingSchema);
    },
  };
}
```

- [ ] **Step 4: 写失败测试** `ui/packages/region-split/src/model-config.test.ts`

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { maskApiKey, ModelConfigStore } from "./model-config.js";

const freshPath = () => join(mkdtempSync(join(tmpdir(), "rs-cfg-")), "model-config.json");

describe("maskApiKey", () => {
  it("masks by length", () => {
    expect(maskApiKey("")).toBe("");
    expect(maskApiKey("short")).toBe("••••");
    expect(maskApiKey("sk-abcdefghijkl")).toBe("sk-••••ijkl");
  });
});

describe("ModelConfigStore", () => {
  it("falls back to environment variables when no file exists", () => {
    const store = new ModelConfigStore(freshPath(), {
      UIR_MODEL_BASE_URL: "http://env/v1", UIR_MODEL_API_KEY: "envkey123456", UIR_MODEL_NAME: "env-model",
    });
    expect(store.read()).toEqual({ baseUrl: "http://env/v1", apiKey: "envkey123456", model: "env-model" });
    expect(store.isConfigured()).toBe(true);
  });

  it("returns empty config when neither file nor env is set", () => {
    const store = new ModelConfigStore(freshPath(), {});
    expect(store.read()).toEqual({ baseUrl: "", apiKey: "", model: "" });
    expect(store.isConfigured()).toBe(false);
  });

  it("prefers the saved file over environment variables", () => {
    const store = new ModelConfigStore(freshPath(), { UIR_MODEL_BASE_URL: "http://env/v1", UIR_MODEL_NAME: "env-model" });
    store.write({ baseUrl: "http://file/v1", model: "file-model", apiKey: "filekey12345" });
    expect(store.read()).toEqual({ baseUrl: "http://file/v1", apiKey: "filekey12345", model: "file-model" });
  });

  it("keeps the existing api key when the new one is empty", () => {
    const store = new ModelConfigStore(freshPath(), {});
    store.write({ baseUrl: "http://a/v1", model: "m", apiKey: "originalkey1" });
    store.write({ baseUrl: "http://b/v1", model: "m2" });
    expect(store.read()).toEqual({ baseUrl: "http://b/v1", apiKey: "originalkey1", model: "m2" });
  });

  it("never exposes the raw key through view()", () => {
    const store = new ModelConfigStore(freshPath(), {});
    store.write({ baseUrl: "http://a/v1", model: "m", apiKey: "sk-abcdefghijkl" });
    expect(store.view()).toEqual({
      baseUrl: "http://a/v1", model: "m", hasApiKey: true, apiKeyMask: "sk-••••ijkl",
    });
  });
});
```

- [ ] **Step 5: 跑测试确认失败**

Run: `pnpm -C ui/packages/region-split test`
Expected: FAIL —— 找不到 `./model-config.js`

- [ ] **Step 6: 实现** `ui/packages/region-split/src/model-config.ts`

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

export interface ModelConfig { baseUrl: string; apiKey: string; model: string }
export interface ModelConfigView {
  baseUrl: string; model: string; hasApiKey: boolean; apiKeyMask: string;
}

const modelConfigSchema = z.object({
  baseUrl: z.string(), apiKey: z.string(), model: z.string(),
});

export function maskApiKey(key: string): string {
  if (key === "") return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
}

export class ModelConfigStore {
  constructor(
    private filePath: string,
    private env: Record<string, string | undefined> = process.env,
  ) {}

  read(): ModelConfig {
    if (existsSync(this.filePath)) {
      return modelConfigSchema.parse(JSON.parse(readFileSync(this.filePath, "utf8")));
    }
    return {
      baseUrl: this.env.UIR_MODEL_BASE_URL ?? "",
      apiKey: this.env.UIR_MODEL_API_KEY ?? "",
      model: this.env.UIR_MODEL_NAME ?? "",
    };
  }

  write(input: { baseUrl: string; model: string; apiKey?: string }): ModelConfig {
    const previous = this.read();
    const next: ModelConfig = {
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: input.apiKey && input.apiKey !== "" ? input.apiKey : previous.apiKey,
    };
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(next, null, 2) + "\n", "utf8");
    return next;
  }

  view(): ModelConfigView {
    const config = this.read();
    return {
      baseUrl: config.baseUrl,
      model: config.model,
      hasApiKey: config.apiKey !== "",
      apiKeyMask: maskApiKey(config.apiKey),
    };
  }

  isConfigured(): boolean {
    const config = this.read();
    return config.baseUrl !== "" && config.model !== "";
  }
}
```

`ui/packages/region-split/src/index.ts` 追加：

```ts
export * from "./model.js";
export * from "./model-config.js";
```

- [ ] **Step 7: 跑测试确认通过**

Run: `pnpm -C ui/packages/region-split test`
Expected: PASS（新增 13 个用例）

- [ ] **Step 8: Commit**

```bash
git add ui/packages/region-split/src
git commit -m "feat: add model client and persisted model configuration"
```

---

### Task 5: 项目存储与分析编排

**Files:**
- Modify: `ui/packages/region-split/package.json`（追加依赖 `sharp: 0.33.5`）
- Create: `ui/packages/region-split/src/store.ts`
- Create: `ui/packages/region-split/src/analyze.ts`
- Modify: `ui/packages/region-split/src/index.ts`
- Test: `ui/packages/region-split/src/store.test.ts`、`ui/packages/region-split/src/analyze.test.ts`

**Interfaces:**
- Consumes: `RegionSplitDoc` `checkInvariants` `regionSplitDocSchema`（Task 1）、`reconcile` `fullPageRegions`（Task 3）、`SegmentModel`（Task 4）
- Produces:
  - `class ProjectStore`：
    - `constructor(root: string)`
    - `newProjectId(): string` —— `YYYYMMDD-<6位随机小写字母数字>`
    - `projectDir(projectId: string): string`
    - `imagePath(projectId: string): string` → `<dir>/image.png`
    - `analyzedImagePath(projectId: string): string` → `<dir>/image.analyzed.png`
    - `exists(projectId: string): boolean`
    - `readDoc(projectId: string): RegionSplitDoc` —— 不存在抛 `Error("project not found")`
    - `writeDoc(projectId: string, doc: RegionSplitDoc): void` —— 先 `regionSplitDocSchema.parse`，再 `checkInvariants`；有违反抛 `Error("invariant violated: <codes>")`，不写盘
    - `writeRegions(projectId: string, regions: Region[]): RegionSplitDoc` —— 读现有 doc、替换 `regions`、刷新 `updatedAt`、走 `writeDoc` 校验后返回新 doc；`candidateLines` 保持不变
  - `createProject(deps: { store: ProjectStore }, input: { fileName: string; buffer: Buffer }): Promise<{ projectId: string; doc: RegionSplitDoc }>` —— 生成 projectId、建目录、写 `image.png`、按 `MAX_ANALYZED_HEIGHT = 2000` 生成 `image.analyzed.png`（未超高则 `analyzedScale` 为 1 且分析图为原图副本）、写入含单个全页区域且 `candidateLines` 为空数组的初始 doc
  - `analyzeProject(deps: { store: ProjectStore; model: SegmentModel; detectLines?: (analyzedPath: string) => Promise<CandidateLine[]> }, projectId: string): Promise<RegionSplitDoc>` —— 读 doc → 读分析图 base64 →（有 `detectLines` 则先检测候选线，**结果按 `analyzedScale` 换算为原图坐标**）→ `model.segment` → `reconcile` → 用 `writeDoc` 写入新的 `regions` 和 `candidateLines`。模型抛错时**保留现有 doc 不变**并向上抛出。
  - `renameRegionWithModel(deps: { store: ProjectStore; model: SegmentModel }, projectId: string, regionId: string): Promise<RegionSplitDoc>` —— 按该区域 bounds 从原图裁剪 → `model.nameRegion` → `applyNaming` → `writeRegions`
- **`projectId` 里出现 `/`、`\` 或 `..` 一律抛 `Error("invalid project id")`**（`projectDir` 内校验），防止路径穿越。

- [ ] **Step 1: 写失败测试** `ui/packages/region-split/src/store.test.ts`

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectStore } from "./store.js";
import { fullPageRegions } from "./reconcile.js";
import type { RegionSplitDoc } from "./types.js";

const freshStore = () => new ProjectStore(mkdtempSync(join(tmpdir(), "rs-")));
const doc = (): RegionSplitDoc => ({
  schemaVersion: "1",
  image: { fileName: "image.png", width: 375, height: 600, analyzedScale: 1 },
  regions: fullPageRegions({ width: 375, height: 600 }),
  candidateLines: [],
  updatedAt: new Date().toISOString(),
});

describe("ProjectStore", () => {
  it("round-trips a document", () => {
    const store = freshStore();
    store.writeDoc("p1", doc());
    expect(store.readDoc("p1").regions).toHaveLength(1);
    expect(store.exists("p1")).toBe(true);
  });

  it("throws when the project is missing", () => {
    expect(() => freshStore().readDoc("nope")).toThrow(/project not found/);
  });

  it("rejects writes that violate invariants and keeps the old file", () => {
    const store = freshStore();
    store.writeDoc("p1", doc());
    const broken = doc();
    broken.regions = [{
      id: "x", displayName: "x", type: "other",
      bounds: { x: 0, y: 0, w: 375, h: 100 }, confidence: 1,
    }];
    expect(() => store.writeDoc("p1", broken)).toThrow(/invariant violated/);
    expect(store.readDoc("p1").regions[0]!.bounds.h).toBe(600);
  });

  it("writeRegions refreshes updatedAt and validates", () => {
    const store = freshStore();
    store.writeDoc("p1", { ...doc(), updatedAt: "2020-01-01T00:00:00.000Z" });
    const next = store.writeRegions("p1", [
      { id: "a", displayName: "上", type: "card", bounds: { x: 0, y: 0, w: 375, h: 200 }, confidence: 1 },
      { id: "b", displayName: "下", type: "card", bounds: { x: 0, y: 200, w: 375, h: 400 }, confidence: 1 },
    ]);
    expect(next.regions).toHaveLength(2);
    expect(next.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
  });

  it("rejects project ids that escape the root", () => {
    const store = freshStore();
    expect(() => store.projectDir("../evil")).toThrow(/invalid project id/);
    expect(() => store.projectDir("a/b")).toThrow(/invalid project id/);
  });

  it("keeps candidate lines when only regions are written", () => {
    const store = freshStore();
    store.writeDoc("p1", { ...doc(), candidateLines: [{ y: 120, strength: 0.8 }] });
    const next = store.writeRegions("p1", [
      { id: "a", displayName: "上", type: "card", bounds: { x: 0, y: 0, w: 375, h: 200 }, confidence: 1 },
      { id: "b", displayName: "下", type: "card", bounds: { x: 0, y: 200, w: 375, h: 400 }, confidence: 1 },
    ]);
    expect(next.candidateLines).toEqual([{ y: 120, strength: 0.8 }]);
  });

  it("generates dated project ids", () => {
    expect(freshStore().newProjectId()).toMatch(/^\d{8}-[a-z0-9]{6}$/);
  });
});
```

- [ ] **Step 2: 写失败测试** `ui/packages/region-split/src/analyze.test.ts`

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { analyzeProject, createProject, renameRegionWithModel } from "./analyze.js";
import { ProjectStore } from "./store.js";
import type { SegmentModel } from "./model.js";

const freshStore = () => new ProjectStore(mkdtempSync(join(tmpdir(), "rs-")));

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#ffffff" } }).png().toBuffer();
}

const model = (overrides: Partial<SegmentModel> = {}): SegmentModel => ({
  segment: async () => [
    { displayName: "顶部", id: "top", type: "nav-bar", yStart: 0, yEnd: 100, confidence: 0.9 },
    { displayName: "内容", id: "body", type: "card", yStart: 100, yEnd: 400, confidence: 0.8 },
  ],
  nameRegion: async () => ({ displayName: "权益表", id: "benefits", type: "grid" }),
  ...overrides,
});

describe("createProject", () => {
  it("stores the image and an initial full-page region", async () => {
    const store = freshStore();
    const { projectId, doc } = await createProject({ store }, { fileName: "shot.png", buffer: await png(375, 400) });
    expect(projectId).toMatch(/^\d{8}-[a-z0-9]{6}$/);
    expect(doc.image).toMatchObject({ width: 375, height: 400, analyzedScale: 1 });
    expect(doc.regions).toHaveLength(1);
    expect(doc.regions[0]!.bounds).toEqual({ x: 0, y: 0, w: 375, h: 400 });
    expect(doc.candidateLines).toEqual([]);
  });

  it("downscales tall images and records the scale", async () => {
    const store = freshStore();
    const { projectId, doc } = await createProject({ store }, { fileName: "long.png", buffer: await png(750, 5000) });
    expect(doc.image.height).toBe(5000);
    expect(doc.image.analyzedScale).toBeCloseTo(0.4, 5);
    expect((await sharp(store.analyzedImagePath(projectId)).metadata()).height).toBe(2000);
  });
});

describe("analyzeProject", () => {
  it("turns model segments into stored regions", async () => {
    const store = freshStore();
    const { projectId } = await createProject({ store }, { fileName: "s.png", buffer: await png(375, 400) });
    const doc = await analyzeProject({ store, model: model() }, projectId);
    expect(doc.regions.map(r => r.id)).toEqual(["top", "body"]);
    expect(doc.regions[1]!.bounds).toEqual({ x: 0, y: 100, w: 375, h: 300 });
    expect(store.readDoc(projectId).regions).toHaveLength(2);
  });

  it("stores detected candidate lines in original coordinates and snaps to them", async () => {
    const store = freshStore();
    const { projectId } = await createProject({ store }, { fileName: "s.png", buffer: await png(750, 5000) });
    const segment = vi.fn(async () => [
      { displayName: "顶部", id: "top", type: "nav-bar" as const, yStart: 0, yEnd: 40, confidence: 0.9 },
      { displayName: "内容", id: "body", type: "card" as const, yStart: 40, yEnd: 2000, confidence: 0.8 },
    ]);
    await analyzeProject(
      { store, model: model({ segment }), detectLines: async () => [{ y: 40, strength: 1 }] },
      projectId,
    );
    // 分析图 y=40 对应原图 y=100（analyzedScale = 0.4）
    const stored = store.readDoc(projectId);
    expect(stored.candidateLines).toEqual([{ y: 100, strength: 1 }]);
    expect(stored.regions[0]!.bounds.h).toBe(100);
  });

  it("keeps the existing document when the model fails", async () => {
    const store = freshStore();
    const { projectId } = await createProject({ store }, { fileName: "s.png", buffer: await png(375, 400) });
    const failing = model({ segment: async () => { throw new Error("llm down"); } });
    await expect(analyzeProject({ store, model: failing }, projectId)).rejects.toThrow(/llm down/);
    expect(store.readDoc(projectId).regions).toHaveLength(1);
  });
});

describe("renameRegionWithModel", () => {
  it("replaces name, id and type of one region", async () => {
    const store = freshStore();
    const { projectId } = await createProject({ store }, { fileName: "s.png", buffer: await png(375, 400) });
    await analyzeProject({ store, model: model() }, projectId);
    const doc = await renameRegionWithModel({ store, model: model() }, projectId, "body");
    expect(doc.regions[1]!).toMatchObject({ id: "benefits", displayName: "权益表", type: "grid" });
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm -C ui install && pnpm -C ui/packages/region-split test`
Expected: FAIL —— 找不到 `./store.js` 与 `./analyze.js`

- [ ] **Step 4: 实现** `ui/packages/region-split/src/store.ts`

```ts
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

  imagePath(projectId: string): string { return join(this.projectDir(projectId), "image.png"); }
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
```

- [ ] **Step 5: 实现** `ui/packages/region-split/src/analyze.ts`

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { applyNaming } from "./operations.js";
import { fullPageRegions, reconcile } from "./reconcile.js";
import type { SegmentModel } from "./model.js";
import type { ProjectStore } from "./store.js";
import type { CandidateLine, RegionSplitDoc } from "./types.js";

export const MAX_ANALYZED_HEIGHT = 2000;

export async function createProject(
  deps: { store: ProjectStore },
  input: { fileName: string; buffer: Buffer },
): Promise<{ projectId: string; doc: RegionSplitDoc }> {
  const { store } = deps;
  const projectId = store.newProjectId();
  mkdirSync(store.projectDir(projectId), { recursive: true });

  const image = sharp(input.buffer);
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new Error("cannot read image size");
  await sharp(input.buffer).png().toFile(store.imagePath(projectId));

  const analyzedScale = meta.height > MAX_ANALYZED_HEIGHT ? MAX_ANALYZED_HEIGHT / meta.height : 1;
  if (analyzedScale < 1) {
    await sharp(input.buffer)
      .resize(Math.round(meta.width * analyzedScale), MAX_ANALYZED_HEIGHT)
      .png().toFile(store.analyzedImagePath(projectId));
  } else {
    writeFileSync(store.analyzedImagePath(projectId), readFileSync(store.imagePath(projectId)));
  }

  const doc: RegionSplitDoc = {
    schemaVersion: "1",
    image: { fileName: input.fileName, width: meta.width, height: meta.height, analyzedScale },
    regions: fullPageRegions({ width: meta.width, height: meta.height }),
    candidateLines: [],
    updatedAt: new Date().toISOString(),
  };
  store.writeDoc(projectId, doc);
  return { projectId, doc };
}

export async function analyzeProject(
  deps: {
    store: ProjectStore;
    model: SegmentModel;
    detectLines?: (analyzedPath: string) => Promise<CandidateLine[]>;
  },
  projectId: string,
): Promise<RegionSplitDoc> {
  const { store, model } = deps;
  const doc = store.readDoc(projectId);
  const analyzedPath = store.analyzedImagePath(projectId);
  const analyzedMeta = await sharp(analyzedPath).metadata();

  // detectLines 返回分析图坐标，这里统一换算成原图坐标后再往下传
  const analyzedLines = deps.detectLines ? await deps.detectLines(analyzedPath) : [];
  const candidateLines: CandidateLine[] = analyzedLines.map(line => ({
    y: Math.round(line.y / doc.image.analyzedScale),
    strength: line.strength,
  }));

  const segments = await model.segment({
    imageBase64: readFileSync(analyzedPath).toString("base64"),
    width: analyzedMeta.width ?? 0,
    height: analyzedMeta.height ?? 0,
    candidateYs: candidateLines.map(line => Math.round(line.y * doc.image.analyzedScale)),
  });

  const regions = reconcile(segments, {
    imageWidth: doc.image.width,
    imageHeight: doc.image.height,
    analyzedScale: doc.image.analyzedScale,
    candidateLines,
  });
  const next: RegionSplitDoc = {
    ...doc, regions, candidateLines, updatedAt: new Date().toISOString(),
  };
  store.writeDoc(projectId, next);
  return next;
}

export async function renameRegionWithModel(
  deps: { store: ProjectStore; model: SegmentModel },
  projectId: string,
  regionId: string,
): Promise<RegionSplitDoc> {
  const { store, model } = deps;
  const doc = store.readDoc(projectId);
  const region = doc.regions.find(item => item.id === regionId);
  if (!region) throw new Error("region not found");
  const crop = await sharp(store.imagePath(projectId))
    .extract({
      left: region.bounds.x, top: region.bounds.y,
      width: region.bounds.w, height: region.bounds.h,
    })
    .png().toBuffer();
  const naming = await model.nameRegion({ cropBase64: crop.toString("base64") });
  return store.writeRegions(projectId, applyNaming(doc.regions, regionId, naming));
}
```

`ui/packages/region-split/src/index.ts` 追加：

```ts
export * from "./store.js";
export * from "./analyze.js";
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm -C ui/packages/region-split test`
Expected: PASS（新增 10 个用例）

- [ ] **Step 7: Commit**

```bash
git add ui/packages/region-split ui/pnpm-lock.yaml
git commit -m "feat: add project store and analysis orchestration"
```

---

### Task 6: HTTP 服务

**Files:**
- Modify: `ui/packages/region-split/package.json`（追加 `fastify: 5.2.1`、`@fastify/multipart: 9.0.3`；devDependencies 追加 `form-data: 4.0.1`）
- Create: `ui/packages/region-split/src/server.ts`
- Create: `ui/packages/region-split/src/index.ts` 的进程入口 `ui/packages/region-split/src/main.ts`
- Modify: `ui/packages/region-split/package.json`（scripts 追加 `"dev": "node --experimental-strip-types src/main.ts"`）
- Test: `ui/packages/region-split/src/server.test.ts`

**Interfaces:**
- Consumes: `ProjectStore` `createProject` `analyzeProject` `renameRegionWithModel`（Task 5）、`SegmentModel` `ModelConfig` `ModelConfigStore`（Task 4）
- Produces:
  - `interface ServerDeps { store: ProjectStore; configStore: ModelConfigStore; createModel: (config: ModelConfig) => SegmentModel; detectLines?: (analyzedPath: string) => Promise<CandidateLine[]> }`
  - `buildServer(deps: ServerDeps): FastifyInstance`
- **模型客户端按请求构造**：每次需要模型时执行 `deps.createModel(deps.configStore.read())`，因此界面改配置后立即生效，无需重启。
- 路由与状态码：

| 方法 | 路径 | 成功 | 失败 |
|------|------|------|------|
| POST | `/api/projects` | 201 `{ projectId, doc }` | 无文件 400 |
| GET | `/api/projects/:projectId` | 200 `{ projectId, doc }` | 不存在 404 |
| POST | `/api/projects/:projectId/analyze` | 200 `{ doc }` | 未配置模型 400 `{ error: "model not configured" }`；模型失败 502 `{ error }` |
| PUT | `/api/projects/:projectId/regions` | 200 `{ doc }` | 违反不变量 422 `{ error }` |
| POST | `/api/projects/:projectId/regions/:regionId/rename-ai` | 200 `{ doc }` | 未配置模型 400；区域不存在 404；模型失败 502 |
| GET | `/api/projects/:projectId/image` | 200 `image/png`（`?rect=x,y,w,h` 时返回裁剪） | 不存在 404 |
| GET | `/api/model-config` | 200 `ModelConfigView` | — |
| PUT | `/api/model-config` | 200 `ModelConfigView` | — |
| POST | `/api/model-config/test` | 200 `{ ok: true }` 或 `{ ok: false, error }` | — |

- `POST /api/model-config/test` 的请求体为 `{ baseUrl, model, apiKey? }`（`apiKey` 为空时用已保存的），用这份配置构造模型并调用 `nameRegion` 发一张 1×1 的最小 PNG；抛错则返回 `{ ok: false, error: 错误信息 }`，**永远返回 200**，让前端就地展示结果。

- [ ] **Step 1: 写失败测试** `ui/packages/region-split/src/server.test.ts`

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import FormData from "form-data";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { ProjectStore } from "./store.js";
import { ModelConfigStore } from "./model-config.js";
import type { SegmentModel } from "./model.js";

const model = (overrides: Partial<SegmentModel> = {}): SegmentModel => ({
  segment: async () => [
    { displayName: "顶部", id: "top", type: "nav-bar", yStart: 0, yEnd: 100, confidence: 0.9 },
    { displayName: "内容", id: "body", type: "card", yStart: 100, yEnd: 400, confidence: 0.8 },
  ],
  nameRegion: async () => ({ displayName: "权益表", id: "benefits", type: "grid" }),
  ...overrides,
});

function makeApp(m: SegmentModel = model(), configured = true) {
  const root = mkdtempSync(join(tmpdir(), "rs-"));
  const store = new ProjectStore(join(root, "projects"));
  const configStore = new ModelConfigStore(join(root, "model-config.json"), {});
  if (configured) configStore.write({ baseUrl: "http://local/v1", model: "m", apiKey: "key12345678" });
  return { app: buildServer({ store, configStore, createModel: () => m }), store, configStore };
}

async function upload(app: ReturnType<typeof buildServer>) {
  const buffer = await sharp({ create: { width: 375, height: 400, channels: 3, background: "#ffffff" } })
    .png().toBuffer();
  const form = new FormData();
  form.append("file", buffer, { filename: "shot.png", contentType: "image/png" });
  const res = await app.inject({ method: "POST", url: "/api/projects", payload: form, headers: form.getHeaders() });
  return res;
}

describe("region split server", () => {
  it("creates a project from an uploaded image", async () => {
    const { app } = makeApp();
    const res = await upload(app);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.projectId).toMatch(/^\d{8}-[a-z0-9]{6}$/);
    expect(body.doc.regions).toHaveLength(1);
  });

  it("rejects an upload without a file", async () => {
    const { app } = makeApp();
    const form = new FormData();
    form.append("note", "no file here");
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: form, headers: form.getHeaders() });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an unknown project", async () => {
    const { app } = makeApp();
    expect((await app.inject({ method: "GET", url: "/api/projects/20260811-aaaaaa" })).statusCode).toBe(404);
  });

  it("analyzes and then reads back the regions", async () => {
    const { app } = makeApp();
    const { projectId } = (await upload(app)).json();
    const analyzed = await app.inject({ method: "POST", url: `/api/projects/${projectId}/analyze` });
    expect(analyzed.statusCode).toBe(200);
    expect(analyzed.json().doc.regions.map((r: { id: string }) => r.id)).toEqual(["top", "body"]);
    const read = await app.inject({ method: "GET", url: `/api/projects/${projectId}` });
    expect(read.json().doc.regions).toHaveLength(2);
  });

  it("returns 502 when the model fails during analyze", async () => {
    const { app } = makeApp(model({ segment: async () => { throw new Error("llm down"); } }));
    const { projectId } = (await upload(app)).json();
    const res = await app.inject({ method: "POST", url: `/api/projects/${projectId}/analyze` });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/llm down/);
  });

  it("writes regions and rejects invariant violations with 422", async () => {
    const { app } = makeApp();
    const { projectId } = (await upload(app)).json();
    const ok = await app.inject({
      method: "PUT", url: `/api/projects/${projectId}/regions`,
      payload: { regions: [
        { id: "a", displayName: "上", type: "card", bounds: { x: 0, y: 0, w: 375, h: 150 }, confidence: 1 },
        { id: "b", displayName: "下", type: "card", bounds: { x: 0, y: 150, w: 375, h: 250 }, confidence: 1 },
      ] },
    });
    expect(ok.statusCode).toBe(200);
    const bad = await app.inject({
      method: "PUT", url: `/api/projects/${projectId}/regions`,
      payload: { regions: [
        { id: "a", displayName: "上", type: "card", bounds: { x: 0, y: 0, w: 375, h: 100 }, confidence: 1 },
      ] },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error).toMatch(/invariant violated/);
  });

  it("renames a region with the model", async () => {
    const { app } = makeApp();
    const { projectId } = (await upload(app)).json();
    await app.inject({ method: "POST", url: `/api/projects/${projectId}/analyze` });
    const res = await app.inject({ method: "POST", url: `/api/projects/${projectId}/regions/body/rename-ai` });
    expect(res.statusCode).toBe(200);
    expect(res.json().doc.regions[1]).toMatchObject({ id: "benefits", displayName: "权益表", type: "grid" });
    const missing = await app.inject({ method: "POST", url: `/api/projects/${projectId}/regions/ghost/rename-ai` });
    expect(missing.statusCode).toBe(404);
  });

  it("serves the image and a crop of it", async () => {
    const { app } = makeApp();
    const { projectId } = (await upload(app)).json();
    const full = await app.inject({ method: "GET", url: `/api/projects/${projectId}/image` });
    expect(full.statusCode).toBe(200);
    expect(full.headers["content-type"]).toBe("image/png");
    expect((await sharp(full.rawPayload).metadata()).height).toBe(400);
    const crop = await app.inject({ method: "GET", url: `/api/projects/${projectId}/image?rect=0,10,375,50` });
    expect((await sharp(crop.rawPayload).metadata()).height).toBe(50);
  });

  it("refuses to analyze while the model is not configured", async () => {
    const { app } = makeApp(model(), false);
    const { projectId } = (await upload(app)).json();
    const res = await app.inject({ method: "POST", url: `/api/projects/${projectId}/analyze` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("model not configured");
  });
});

describe("model config routes", () => {
  it("reads and writes config without exposing the raw key", async () => {
    const { app } = makeApp(model(), false);
    expect((await app.inject({ method: "GET", url: "/api/model-config" })).json())
      .toEqual({ baseUrl: "", model: "", hasApiKey: false, apiKeyMask: "" });

    const saved = await app.inject({
      method: "PUT", url: "/api/model-config",
      payload: { baseUrl: "http://local/v1", model: "qwen-vl", apiKey: "sk-abcdefghijkl" },
    });
    expect(saved.json()).toEqual({
      baseUrl: "http://local/v1", model: "qwen-vl", hasApiKey: true, apiKeyMask: "sk-••••ijkl",
    });
    expect(JSON.stringify(saved.json())).not.toContain("abcdefgh");
  });

  it("keeps the stored key when the payload omits it", async () => {
    const { app, configStore } = makeApp(model(), false);
    await app.inject({
      method: "PUT", url: "/api/model-config",
      payload: { baseUrl: "http://a/v1", model: "m1", apiKey: "originalkey1" },
    });
    await app.inject({ method: "PUT", url: "/api/model-config", payload: { baseUrl: "http://b/v1", model: "m2" } });
    expect(configStore.read().apiKey).toBe("originalkey1");
  });

  it("reports a successful connection test", async () => {
    const { app } = makeApp();
    const res = await app.inject({
      method: "POST", url: "/api/model-config/test",
      payload: { baseUrl: "http://local/v1", model: "m" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("reports a failed connection test with 200 and a reason", async () => {
    const failing = model({ nameRegion: async () => { throw new Error("connect ECONNREFUSED"); } });
    const { app } = makeApp(failing);
    const res = await app.inject({
      method: "POST", url: "/api/model-config/test",
      payload: { baseUrl: "http://bad/v1", model: "m" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false, error: "connect ECONNREFUSED" });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C ui install && pnpm -C ui/packages/region-split test`
Expected: FAIL —— 找不到 `./server.js`

- [ ] **Step 3: 实现** `ui/packages/region-split/src/server.ts`

```ts
import { existsSync } from "node:fs";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import sharp from "sharp";
import { analyzeProject, createProject, renameRegionWithModel } from "./analyze.js";
import type { SegmentModel } from "./model.js";
import type { ModelConfig, ModelConfigStore } from "./model-config.js";
import type { ProjectStore } from "./store.js";
import type { CandidateLine, Region } from "./types.js";

export interface ServerDeps {
  store: ProjectStore;
  configStore: ModelConfigStore;
  createModel: (config: ModelConfig) => SegmentModel;
  detectLines?: (analyzedPath: string) => Promise<CandidateLine[]>;
}

type ProjectParams = { projectId: string };

// 1×1 透明 PNG，仅用于连通性测试
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ bodyLimit: 32 * 1024 * 1024 });
  app.register(multipart, { limits: { fileSize: 32 * 1024 * 1024 } });
  const { store, configStore } = deps;
  const currentModel = () => deps.createModel(configStore.read());

  app.post("/api/projects", async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "file field is required" });
    const buffer = await file.toBuffer();
    const { projectId, doc } = await createProject({ store }, { fileName: file.filename, buffer });
    return reply.code(201).send({ projectId, doc });
  });

  app.get<{ Params: ProjectParams }>("/api/projects/:projectId", async (req, reply) => {
    const { projectId } = req.params;
    if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
    return { projectId, doc: store.readDoc(projectId) };
  });

  app.post<{ Params: ProjectParams }>("/api/projects/:projectId/analyze", async (req, reply) => {
    const { projectId } = req.params;
    if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
    if (!configStore.isConfigured()) return reply.code(400).send({ error: "model not configured" });
    try {
      return {
        doc: await analyzeProject({ store, model: currentModel(), detectLines: deps.detectLines }, projectId),
      };
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.put<{ Params: ProjectParams; Body: { regions: Region[] } }>(
    "/api/projects/:projectId/regions", async (req, reply) => {
      const { projectId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      try {
        return { doc: store.writeRegions(projectId, req.body.regions) };
      } catch (err) {
        return reply.code(422).send({ error: (err as Error).message });
      }
    });

  app.post<{ Params: ProjectParams & { regionId: string } }>(
    "/api/projects/:projectId/regions/:regionId/rename-ai", async (req, reply) => {
      const { projectId, regionId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      if (!configStore.isConfigured()) return reply.code(400).send({ error: "model not configured" });
      if (!store.readDoc(projectId).regions.some(region => region.id === regionId)) {
        return reply.code(404).send({ error: "region not found" });
      }
      try {
        return { doc: await renameRegionWithModel({ store, model: currentModel() }, projectId, regionId) };
      } catch (err) {
        return reply.code(502).send({ error: (err as Error).message });
      }
    });

  app.get("/api/model-config", async () => configStore.view());

  app.put<{ Body: { baseUrl: string; model: string; apiKey?: string } }>(
    "/api/model-config", async (req) => {
      configStore.write(req.body);
      return configStore.view();
    });

  app.post<{ Body: { baseUrl: string; model: string; apiKey?: string } }>(
    "/api/model-config/test", async (req) => {
      const saved = configStore.read();
      const config: ModelConfig = {
        baseUrl: req.body.baseUrl,
        model: req.body.model,
        apiKey: req.body.apiKey && req.body.apiKey !== "" ? req.body.apiKey : saved.apiKey,
      };
      try {
        await deps.createModel(config).nameRegion({ cropBase64: TINY_PNG_BASE64 });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    });

  app.get<{ Params: ProjectParams; Querystring: { rect?: string } }>(
    "/api/projects/:projectId/image", async (req, reply) => {
      const path = store.imagePath(req.params.projectId);
      if (!existsSync(path)) return reply.code(404).send({ error: "image not found" });
      let image = sharp(path);
      if (req.query.rect) {
        const [x, y, w, h] = req.query.rect.split(",").map(Number);
        image = image.extract({ left: x ?? 0, top: y ?? 0, width: w ?? 1, height: h ?? 1 });
      }
      reply.type("image/png");
      return reply.send(await image.png().toBuffer());
    });

  return app;
}
```

`ui/packages/region-split/src/main.ts`：

```ts
import { join } from "node:path";
import { detectCandidateLines } from "./candidate-lines.js";
import { createOpenAiModel } from "./model.js";
import { ModelConfigStore } from "./model-config.js";
import { buildServer } from "./server.js";
import { ProjectStore } from "./store.js";

const dataRoot = process.env.UIR_DATA_ROOT ?? "./data";
const store = new ProjectStore(join(dataRoot, "projects"));
const configStore = new ModelConfigStore(join(dataRoot, "model-config.json"));

const app = buildServer({
  store,
  configStore,
  createModel: config => createOpenAiModel(config),
  detectLines: detectCandidateLines,
});
const port = Number(process.env.UIR_PORT ?? 4800);
app.listen({ port, host: "127.0.0.1" })
  .then(address => console.log(`region-split server on ${address}`));
```

> `detectCandidateLines` 在 Task 12 才实现。本 Task 先在 `candidate-lines.ts` 放一个占位实现，保证 `main.ts` 能启动：
>
> ```ts
> // ui/packages/region-split/src/candidate-lines.ts
> import type { CandidateLine } from "./types.js";
>
> // Task 12 会用真实的水平投影分析替换这里
> export async function detectCandidateLines(_analyzedPath: string): Promise<CandidateLine[]> {
>   return [];
> }
> ```

`package.json` 的 `scripts` 追加 `"dev": "node --experimental-strip-types src/main.ts"`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -C ui/packages/region-split test`
Expected: PASS（新增 13 个用例）

- [ ] **Step 5: Commit**

```bash
git add ui/packages/region-split ui/pnpm-lock.yaml
git commit -m "feat: add region split http server with model config routes"
```

---

### Task 7: 前端脚手架、API 客户端与状态仓库

**Files:**
- Create: `ui/apps/region-split-ui/package.json`、`tsconfig.json`、`vite.config.ts`、`index.html`
- Create: `ui/apps/region-split-ui/src/main.ts`、`src/App.vue`（本 Task 只放三栏空壳）
- Create: `ui/apps/region-split-ui/src/api.ts`
- Create: `ui/apps/region-split-ui/src/state.ts`
- Create: `ui/apps/region-split-ui/src/test-helpers.ts`
- Test: `ui/apps/region-split-ui/src/state.test.ts`

**Interfaces:**
- Consumes: `@region-split/core` 的 `Region` `RegionSplitDoc` `ModelConfigView` 及 `adjustBoundary` `splitRegion` `mergeRegions` `renameRegion` `areAdjacent` `canAdjustBoundary` `canSplitAt`
- Produces:
  - `interface StoreApi`：
    - `upload(file: File): Promise<{ projectId: string; doc: RegionSplitDoc }>`
    - `getProject(projectId: string): Promise<{ projectId: string; doc: RegionSplitDoc }>`
    - `putRegions(projectId: string, regions: Region[]): Promise<{ doc: RegionSplitDoc }>`
    - `analyze(projectId: string): Promise<{ doc: RegionSplitDoc }>`
    - `renameAi(projectId: string, regionId: string): Promise<{ doc: RegionSplitDoc }>`
    - `getModelConfig(): Promise<ModelConfigView>`
    - `putModelConfig(input: { baseUrl: string; model: string; apiKey?: string }): Promise<ModelConfigView>`
    - `testModelConfig(input: { baseUrl: string; model: string; apiKey?: string }): Promise<{ ok: boolean; error?: string }>`
  - `api.ts` 导出实现了 `StoreApi` 的对象 `httpApi`，以及 `imageUrl(projectId: string): string`
  - `test-helpers.ts`（**测试专用，被 Task 8–11 的组件测试共用**）导出：
    - `makeRegion(id: string, y: number, h: number): Region`
    - `makeDoc(regions: Region[], candidateLines?: CandidateLine[]): RegionSplitDoc`
    - `makeFakeApi(initial: () => Region[]): StoreApi`（其中 `putRegions` 为 `vi.fn`，可通过 `(api.putRegions as Mock)` 断言调用次数；`getModelConfig` 默认返回已配置状态）
  - `createStore(api: StoreApi)` 返回：
    - 只读状态 `projectId` `doc` `regions` `selectedIds` `mode`（`"idle" | "split"`）`busy` `error` `pendingRenameIds` `renamingId` `modelConfig` `configDialogOpen` `configTestResult`
    - 计算属性 `selectedRegion`（恰好选中一个时返回该 `Region`，否则 `null`）、`selectedIndex`、`canMerge`、`canNudge`、`canUndo`、`canRedo`、`isModelConfigured`、`candidateLines`
    - 动作 `uploadImage(file)` `load(projectId)` `analyze()` `select(id, additive)` `clearSelection()` `nudge(delta)` `beginSplit()` `cancelSplit()` `commitSplit(y)` `merge()` `rename(id, name)` `startRename(id)` `stopRename()` `aiRename(id)` `undo()` `redo()` `flushPersist()` `loadModelConfig()` `openConfigDialog()` `closeConfigDialog()` `saveModelConfig(input)` `testModelConfig(input)`
- 撤销规则：结构性操作（拆分、合并、重命名、AI 重命名、分析）**每次都压栈**；`nudge` 采用 500ms 合并——距上一次 `nudge` 不足 500ms 时不压新快照。栈上限 50，超出丢弃最旧。执行新操作清空重做栈。
- 落盘规则：结构性操作立即 `putRegions`；`nudge` 延迟 400ms 后 `putRegions`（`flushPersist()` 可立即触发，供测试与页面卸载使用）。落盘失败时设置 `error` 并从服务端重新拉取覆盖本地。

- [ ] **Step 1: 建前端脚手架**

`ui/apps/region-split-ui/package.json`：

```json
{
  "name": "@region-split/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "vue-tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@region-split/core": "workspace:*",
    "vue": "3.5.13"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "5.2.1",
    "@vue/test-utils": "2.4.6",
    "jsdom": "25.0.1",
    "vite": "6.0.7",
    "vue-tsc": "2.2.0"
  }
}
```

`ui/apps/region-split-ui/vite.config.ts`：

```ts
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  server: { port: 5180, proxy: { "/api": "http://127.0.0.1:4800" } },
  test: { environment: "jsdom", include: ["src/**/*.test.ts"] },
});
```

`ui/apps/region-split-ui/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "preserve", "types": ["vite/client"] },
  "include": ["src", "vite.config.ts"]
}
```

`ui/apps/region-split-ui/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8" /><title>UI 区域拆分</title></head>
  <body><div id="app"></div><script type="module" src="/src/main.ts"></script></body>
</html>
```

`ui/apps/region-split-ui/src/main.ts`：

```ts
import { createApp } from "vue";
import App from "./App.vue";

createApp(App).mount("#app");
```

`ui/apps/region-split-ui/src/App.vue`（本 Task 只要能挂载，Task 8–11 逐步填充）：

```vue
<script setup lang="ts">
import { createStore } from "./state.js";
import { httpApi } from "./api.js";

const store = createStore(httpApi);
</script>

<template>
  <div class="layout">
    <header>工具栏（Task 9）</header>
    <main>画布（Task 8）—— 项目 {{ store.projectId.value || "未创建" }}</main>
    <aside>区域列表（Task 9）</aside>
  </div>
</template>

<style>
html, body, #app { height: 100%; margin: 0; font-family: system-ui, sans-serif; }
.layout { display: grid; grid-template-columns: 1fr 300px; grid-template-rows: auto 1fr; height: 100%; }
header { grid-column: 1 / -1; border-bottom: 1px solid #ddd; padding: 8px; }
main { overflow: auto; background: #f0f1f3; }
aside { border-left: 1px solid #ddd; overflow: auto; }
</style>
```

- [ ] **Step 2: 写失败测试** `ui/apps/region-split-ui/src/state.test.ts`

```ts
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createStore } from "./state.js";
import { makeFakeApi, makeRegion } from "./test-helpers.js";

const initial = () => [makeRegion("a", 0, 200), makeRegion("b", 200, 200), makeRegion("c", 400, 200)];

async function loadedStore() {
  const api = makeFakeApi(initial);
  const store = createStore(api);
  await store.load("p1");
  return { store, putRegions: api.putRegions as Mock };
}

describe("createStore", () => {
  beforeEach(() => vi.useFakeTimers());

  it("selects single and additive", async () => {
    const { store } = await loadedStore();
    store.select("a", false);
    expect(store.selectedIds.value).toEqual(["a"]);
    store.select("b", true);
    expect(store.selectedIds.value).toEqual(["a", "b"]);
    store.select("b", true);
    expect(store.selectedIds.value).toEqual(["a"]);
    store.select("c", false);
    expect(store.selectedIds.value).toEqual(["c"]);
  });

  it("nudges the selected boundary and coalesces undo snapshots", async () => {
    const { store } = await loadedStore();
    store.select("a", false);
    store.nudge(1);
    store.nudge(1);
    store.nudge(1);
    expect(store.regions.value[0]!.bounds.h).toBe(203);
    store.undo();
    expect(store.regions.value[0]!.bounds.h).toBe(200);
  });

  it("starts a new undo snapshot after the coalesce window", async () => {
    const { store } = await loadedStore();
    store.select("a", false);
    store.nudge(1);
    vi.advanceTimersByTime(600);
    store.nudge(1);
    expect(store.regions.value[0]!.bounds.h).toBe(202);
    store.undo();
    expect(store.regions.value[0]!.bounds.h).toBe(201);
  });

  it("debounces persistence for nudges and persists structure changes immediately", async () => {
    const { store, putRegions } = await loadedStore();
    store.select("a", false);
    store.nudge(1);
    expect(putRegions).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(putRegions).toHaveBeenCalledTimes(1);

    putRegions.mockClear();
    store.select("b", false);
    store.beginSplit();
    store.commitSplit(300);
    expect(putRegions).toHaveBeenCalledTimes(1);
  });

  it("loads the model configuration and exposes whether it is usable", async () => {
    const { store } = await loadedStore();
    expect(store.isModelConfigured.value).toBe(false);
    await store.loadModelConfig();
    expect(store.modelConfig.value).toMatchObject({ baseUrl: "http://local/v1", model: "test-model" });
    expect(store.isModelConfigured.value).toBe(true);
  });

  it("records the connection test result", async () => {
    const { store } = await loadedStore();
    await store.testModelConfig({ baseUrl: "http://local/v1", model: "m" });
    expect(store.configTestResult.value).toEqual({ ok: true });
  });

  it("splits the selected region and selects the new lower block", async () => {
    const { store } = await loadedStore();
    store.select("b", false);
    store.beginSplit();
    expect(store.mode.value).toBe("split");
    store.commitSplit(300);
    expect(store.mode.value).toBe("idle");
    expect(store.regions.value.map(r => r.id)).toEqual(["a", "b", "b-2", "c"]);
    expect(store.selectedIds.value).toEqual(["b-2"]);
  });

  it("merges only adjacent selections", async () => {
    const { store } = await loadedStore();
    store.select("a", false);
    store.select("c", true);
    expect(store.canMerge.value).toBe(false);
    store.select("b", true);
    expect(store.canMerge.value).toBe(true);
    store.merge();
    expect(store.regions.value).toHaveLength(1);
    expect(store.regions.value[0]!.bounds).toEqual({ x: 0, y: 0, w: 375, h: 600 });
  });

  it("undoes and redoes structural changes", async () => {
    const { store } = await loadedStore();
    store.select("b", false);
    store.rename("b", "会员卡");
    expect(store.regions.value[1]!.displayName).toBe("会员卡");
    expect(store.canUndo.value).toBe(true);
    store.undo();
    expect(store.regions.value[1]!.displayName).toBe("名-b");
    store.redo();
    expect(store.regions.value[1]!.displayName).toBe("会员卡");
  });

  it("clears the redo stack when a new operation happens", async () => {
    const { store } = await loadedStore();
    store.select("b", false);
    store.rename("b", "一");
    store.undo();
    expect(store.canRedo.value).toBe(true);
    store.rename("b", "二");
    expect(store.canRedo.value).toBe(false);
  });

  it("caps the undo stack at 50 entries", async () => {
    const { store } = await loadedStore();
    for (let i = 0; i < 60; i++) store.rename("b", `名字-${i}`);
    let depth = 0;
    while (store.canUndo.value) { store.undo(); depth++; }
    expect(depth).toBe(50);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm -C ui install && pnpm -C ui/apps/region-split-ui test`
Expected: FAIL —— 找不到 `./state.js`

- [ ] **Step 4: 实现** `ui/apps/region-split-ui/src/api.ts`

```ts
import type { ModelConfigView, Region, RegionSplitDoc } from "@region-split/core";

export interface ModelConfigInput { baseUrl: string; model: string; apiKey?: string }

export interface StoreApi {
  upload(file: File): Promise<{ projectId: string; doc: RegionSplitDoc }>;
  getProject(projectId: string): Promise<{ projectId: string; doc: RegionSplitDoc }>;
  putRegions(projectId: string, regions: Region[]): Promise<{ doc: RegionSplitDoc }>;
  analyze(projectId: string): Promise<{ doc: RegionSplitDoc }>;
  renameAi(projectId: string, regionId: string): Promise<{ doc: RegionSplitDoc }>;
  getModelConfig(): Promise<ModelConfigView>;
  putModelConfig(input: ModelConfigInput): Promise<ModelConfigView>;
  testModelConfig(input: ModelConfigInput): Promise<{ ok: boolean; error?: string }>;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `request failed: ${res.status}`);
  return body as T;
}

export const httpApi: StoreApi = {
  async upload(file) {
    const form = new FormData();
    form.append("file", file);
    return json("/api/projects", { method: "POST", body: form });
  },
  getProject(projectId) {
    return json(`/api/projects/${projectId}`);
  },
  putRegions(projectId, regions) {
    return json(`/api/projects/${projectId}/regions`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ regions }),
    });
  },
  analyze(projectId) {
    return json(`/api/projects/${projectId}/analyze`, { method: "POST" });
  },
  renameAi(projectId, regionId) {
    return json(`/api/projects/${projectId}/regions/${regionId}/rename-ai`, { method: "POST" });
  },
  getModelConfig() {
    return json("/api/model-config");
  },
  putModelConfig(input) {
    return json("/api/model-config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  testModelConfig(input) {
    return json("/api/model-config/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  },
};

export function imageUrl(projectId: string): string {
  return `/api/projects/${projectId}/image`;
}
```

`ui/apps/region-split-ui/src/test-helpers.ts`：

```ts
import { vi } from "vitest";
import type { CandidateLine, Region, RegionSplitDoc } from "@region-split/core";
import type { StoreApi } from "./api.js";

export function makeRegion(id: string, y: number, h: number): Region {
  return { id, displayName: `名-${id}`, type: "card", bounds: { x: 0, y, w: 375, h }, confidence: 0.87 };
}

export function makeDoc(regions: Region[], candidateLines: CandidateLine[] = []): RegionSplitDoc {
  return {
    schemaVersion: "1",
    image: { fileName: "s.png", width: 375, height: 600, analyzedScale: 1 },
    regions, candidateLines, updatedAt: "2026-08-11T00:00:00.000Z",
  };
}

export function makeFakeApi(initial: () => Region[], candidateLines: CandidateLine[] = []): StoreApi {
  return {
    putRegions: vi.fn(async (_id: string, regions: Region[]) => ({ doc: makeDoc(regions, candidateLines) })),
    upload: async () => ({ projectId: "p1", doc: makeDoc(initial(), candidateLines) }),
    getProject: async () => ({ projectId: "p1", doc: makeDoc(initial(), candidateLines) }),
    analyze: async () => ({ doc: makeDoc(initial(), candidateLines) }),
    renameAi: async () => ({ doc: makeDoc(initial(), candidateLines) }),
    getModelConfig: async () => ({
      baseUrl: "http://local/v1", model: "test-model", hasApiKey: true, apiKeyMask: "sk-••••abcd",
    }),
    putModelConfig: async input => ({
      baseUrl: input.baseUrl, model: input.model, hasApiKey: true, apiKeyMask: "sk-••••abcd",
    }),
    testModelConfig: async () => ({ ok: true }),
  };
}
```

- [ ] **Step 5: 实现** `ui/apps/region-split-ui/src/state.ts`

```ts
import { computed, ref, shallowRef } from "vue";
import {
  adjustBoundary, areAdjacent, canAdjustBoundary, canSplitAt,
  mergeRegions, renameRegion, splitRegion,
  type ModelConfigView, type Region, type RegionSplitDoc,
} from "@region-split/core";
import type { ModelConfigInput, StoreApi } from "./api.js";

export type { ModelConfigInput, StoreApi };

const UNDO_STACK_LIMIT = 50;
const COALESCE_MS = 500;
const PERSIST_DEBOUNCE_MS = 400;

export function createStore(api: StoreApi) {
  const projectId = ref("");
  const doc = shallowRef<RegionSplitDoc | null>(null);
  const regions = shallowRef<Region[]>([]);
  const selectedIds = ref<string[]>([]);
  const mode = ref<"idle" | "split">("idle");
  const busy = ref(false);
  const error = ref("");
  const pendingRenameIds = ref<string[]>([]);
  const renamingId = ref<string | null>(null);
  const modelConfig = ref<ModelConfigView | null>(null);
  const configDialogOpen = ref(false);
  const configTestResult = ref<{ ok: boolean; error?: string } | null>(null);

  const undoStack: Region[][] = [];
  const redoStack: Region[][] = [];
  let lastNudgeAt = 0;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  const selectedIndex = computed(() =>
    selectedIds.value.length === 1
      ? regions.value.findIndex(region => region.id === selectedIds.value[0])
      : -1);
  const selectedRegion = computed(() =>
    selectedIndex.value >= 0 ? regions.value[selectedIndex.value]! : null);
  const canNudge = computed(() =>
    selectedIndex.value >= 0 && canAdjustBoundary(regions.value, selectedIndex.value));
  const canMerge = computed(() => areAdjacent(regions.value, selectedIds.value));
  const canUndo = computed(() => undoStack.length > 0);
  const canRedo = computed(() => redoStack.length > 0);
  const isModelConfigured = computed(() =>
    Boolean(modelConfig.value?.baseUrl) && Boolean(modelConfig.value?.model));
  const candidateLines = computed(() => doc.value?.candidateLines ?? []);

  function pushUndo() {
    undoStack.push(regions.value.map(region => ({ ...region, bounds: { ...region.bounds } })));
    if (undoStack.length > UNDO_STACK_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }

  async function persistNow() {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    if (!projectId.value) return;
    try {
      const result = await api.putRegions(projectId.value, regions.value);
      doc.value = result.doc;
    } catch (err) {
      error.value = (err as Error).message;
      const fresh = await api.getProject(projectId.value);
      doc.value = fresh.doc;
      regions.value = fresh.doc.regions;
    }
  }

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => { persistTimer = null; void persistNow(); }, PERSIST_DEBOUNCE_MS);
  }

  function setDoc(next: RegionSplitDoc, id?: string) {
    doc.value = next;
    regions.value = next.regions;
    if (id) projectId.value = id;
    selectedIds.value = [];
    mode.value = "idle";
  }

  return {
    projectId, doc, regions, selectedIds, mode, busy, error, pendingRenameIds, renamingId,
    modelConfig, configDialogOpen, configTestResult,
    selectedIndex, selectedRegion, canNudge, canMerge, canUndo, canRedo,
    isModelConfigured, candidateLines,

    startRename(id: string) { renamingId.value = id; },
    stopRename() { renamingId.value = null; },

    async loadModelConfig() {
      try { modelConfig.value = await api.getModelConfig(); }
      catch (err) { error.value = (err as Error).message; }
    },
    openConfigDialog() { configTestResult.value = null; configDialogOpen.value = true; },
    closeConfigDialog() { configDialogOpen.value = false; },
    async saveModelConfig(input: ModelConfigInput) {
      try { modelConfig.value = await api.putModelConfig(input); configDialogOpen.value = false; }
      catch (err) { error.value = (err as Error).message; }
    },
    async testModelConfig(input: ModelConfigInput) {
      configTestResult.value = null;
      try { configTestResult.value = await api.testModelConfig(input); }
      catch (err) { configTestResult.value = { ok: false, error: (err as Error).message }; }
    },

    async uploadImage(file: File) {
      busy.value = true; error.value = "";
      try {
        const result = await api.upload(file);
        setDoc(result.doc, result.projectId);
        undoStack.length = 0; redoStack.length = 0;
      } catch (err) { error.value = (err as Error).message; }
      finally { busy.value = false; }
    },

    async load(id: string) {
      busy.value = true; error.value = "";
      try {
        const result = await api.getProject(id);
        setDoc(result.doc, result.projectId);
        undoStack.length = 0; redoStack.length = 0;
      } catch (err) { error.value = (err as Error).message; }
      finally { busy.value = false; }
    },

    async analyze() {
      if (!projectId.value) return;
      busy.value = true; error.value = "";
      pushUndo();
      try {
        setDoc((await api.analyze(projectId.value)).doc);
      } catch (err) { error.value = (err as Error).message; undoStack.pop(); }
      finally { busy.value = false; }
    },

    select(id: string, additive: boolean) {
      if (!additive) { selectedIds.value = [id]; return; }
      selectedIds.value = selectedIds.value.includes(id)
        ? selectedIds.value.filter(item => item !== id)
        : [...selectedIds.value, id];
    },

    clearSelection() { selectedIds.value = []; mode.value = "idle"; },

    nudge(delta: number) {
      const index = selectedIndex.value;
      if (index < 0 || !canAdjustBoundary(regions.value, index)) return;
      const now = Date.now();
      if (now - lastNudgeAt >= COALESCE_MS) pushUndo();
      lastNudgeAt = now;
      regions.value = adjustBoundary(regions.value, index, delta);
      schedulePersist();
    },

    beginSplit() { if (selectedIndex.value >= 0) mode.value = "split"; },
    cancelSplit() { mode.value = "idle"; },

    commitSplit(y: number) {
      const index = selectedIndex.value;
      if (index < 0 || !canSplitAt(regions.value, index, y)) return;
      pushUndo();
      const next = splitRegion(regions.value, index, y);
      regions.value = next;
      mode.value = "idle";
      const lower = next[index + 1]!;
      selectedIds.value = [lower.id];
      void persistNow();
    },

    merge() {
      if (!areAdjacent(regions.value, selectedIds.value)) return;
      pushUndo();
      const next = mergeRegions(regions.value, selectedIds.value);
      regions.value = next;
      const survivorIds = new Set(next.map(region => region.id));
      selectedIds.value = selectedIds.value.filter(id => survivorIds.has(id)).slice(0, 1);
      void persistNow();
    },

    rename(id: string, displayName: string) {
      pushUndo();
      regions.value = renameRegion(regions.value, id, displayName);
      void persistNow();
    },

    async aiRename(id: string) {
      if (!projectId.value) return;
      pendingRenameIds.value = [...pendingRenameIds.value, id];
      pushUndo();
      try {
        const result = await api.renameAi(projectId.value, id);
        doc.value = result.doc;
        regions.value = result.doc.regions;
      } catch (err) { error.value = (err as Error).message; undoStack.pop(); }
      finally { pendingRenameIds.value = pendingRenameIds.value.filter(item => item !== id); }
    },

    undo() {
      const snapshot = undoStack.pop();
      if (!snapshot) return;
      redoStack.push(regions.value.map(region => ({ ...region, bounds: { ...region.bounds } })));
      regions.value = snapshot;
      lastNudgeAt = 0;
      void persistNow();
    },

    redo() {
      const snapshot = redoStack.pop();
      if (!snapshot) return;
      undoStack.push(regions.value.map(region => ({ ...region, bounds: { ...region.bounds } })));
      regions.value = snapshot;
      lastNudgeAt = 0;
      void persistNow();
    },

    flushPersist: persistNow,
  };
}

export type Store = ReturnType<typeof createStore>;
```

> 注意 `undo()`/`redo()` 里 `pushUndo` 不能复用（它会清空重做栈），所以这两个方法各自直接操作两个栈。
> `state.ts` 中不再单独声明 `renamingId`——它已包含在上面的状态声明里。

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm -C ui/apps/region-split-ui test`
Expected: PASS（11 个用例）

- [ ] **Step 7: Commit**

```bash
git add ui/apps/region-split-ui ui/pnpm-lock.yaml
git commit -m "feat: add region split ui scaffold, api client and store"
```

---

### Task 8: 画布——图片、分段叠加与选中

**Files:**
- Create: `ui/apps/region-split-ui/src/coords.ts`
- Create: `ui/apps/region-split-ui/src/components/ImageCanvas.vue`
- Modify: `ui/apps/region-split-ui/src/App.vue`
- Test: `ui/apps/region-split-ui/src/coords.test.ts`、`ui/apps/region-split-ui/src/components/ImageCanvas.test.ts`

**Interfaces:**
- Consumes: `Store`（Task 7）、`imageUrl`（Task 7）、`makeFakeApi` `makeRegion`（Task 7 的 test-helpers）、`CandidateLine`（core）
- Produces:
  - `toImageY(clientY: number, rectTop: number, displayScale: number): number` —— 四舍五入到整数
  - `snapToCandidates(y: number, lines: CandidateLine[], threshold: number): { y: number; snapped: boolean }` —— 阈值内取 `strength` 最大者，并列取更近者；无命中返回原值且 `snapped` 为 `false`
  - `ImageCanvas.vue`，props `{ store: Store }`。每个区域渲染一个 `div[data-region-id]`，选中时带 `selected` 类。**`displayScale` 在图片尚未测量出宽度时回退为 1**，因此组件测试里坐标 1:1。
- 视觉：区域交替浅色底，底边 1px 分隔线；选中区域底色 `#2f6fed1a`、外框 `#2f6fed`、下边界 3px 蓝线；每个区域左上角标签显示 `序号 displayName`。

- [ ] **Step 1: 写失败测试** `ui/apps/region-split-ui/src/coords.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { snapToCandidates, toImageY } from "./coords.js";

describe("toImageY", () => {
  it("converts a client y into image pixels", () => {
    expect(toImageY(320, 100, 0.5)).toBe(440);
    expect(toImageY(150, 100, 1)).toBe(50);
  });
});

describe("snapToCandidates", () => {
  const lines = [{ y: 100, strength: 0.5 }, { y: 104, strength: 0.9 }, { y: 400, strength: 1 }];
  it("snaps to the strongest line inside the threshold", () => {
    expect(snapToCandidates(101, lines, 12)).toEqual({ y: 104, snapped: true });
  });
  it("keeps the value when nothing is close enough", () => {
    expect(snapToCandidates(200, lines, 12)).toEqual({ y: 200, snapped: false });
  });
  it("prefers the nearer line when strengths tie", () => {
    const tied = [{ y: 90, strength: 0.7 }, { y: 98, strength: 0.7 }];
    expect(snapToCandidates(100, tied, 12)).toEqual({ y: 98, snapped: true });
  });
});
```

- [ ] **Step 2: 写失败测试** `ui/apps/region-split-ui/src/components/ImageCanvas.test.ts`

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ImageCanvas from "./ImageCanvas.vue";
import { createStore } from "../state.js";
import { makeFakeApi, makeRegion } from "../test-helpers.js";

const initial = () => [makeRegion("a", 0, 200), makeRegion("b", 200, 400)];

async function mounted() {
  const store = createStore(makeFakeApi(initial));
  await store.load("p1");
  return { store, wrapper: mount(ImageCanvas, { props: { store } }) };
}

describe("ImageCanvas", () => {
  it("renders one overlay per region with its label", async () => {
    const { wrapper } = await mounted();
    const overlays = wrapper.findAll("[data-region-id]");
    expect(overlays).toHaveLength(2);
    expect(overlays[0]!.attributes("data-region-id")).toBe("a");
    expect(overlays[1]!.text()).toContain("名-b");
  });

  it("selects on click and adds to the selection with ctrl-click", async () => {
    const { store, wrapper } = await mounted();
    await wrapper.findAll("[data-region-id]")[0]!.trigger("click");
    expect(store.selectedIds.value).toEqual(["a"]);
    await wrapper.findAll("[data-region-id]")[1]!.trigger("click", { ctrlKey: true });
    expect(store.selectedIds.value).toEqual(["a", "b"]);
  });

  it("marks the selected overlay", async () => {
    const { store, wrapper } = await mounted();
    store.select("b", false);
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll("[data-region-id]")[1]!.classes()).toContain("selected");
  });

  it("clears the selection when the backdrop is clicked", async () => {
    const { store, wrapper } = await mounted();
    store.select("a", false);
    await wrapper.find("[data-test=backdrop]").trigger("click");
    expect(store.selectedIds.value).toEqual([]);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm -C ui/apps/region-split-ui test`
Expected: FAIL —— 找不到 `./coords.js` 与 `./ImageCanvas.vue`

- [ ] **Step 4: 实现** `ui/apps/region-split-ui/src/coords.ts`

```ts
import type { CandidateLine } from "@region-split/core";

export function toImageY(clientY: number, rectTop: number, displayScale: number): number {
  return Math.round((clientY - rectTop) / displayScale);
}

export function snapToCandidates(
  y: number, lines: CandidateLine[], threshold: number,
): { y: number; snapped: boolean } {
  let best: CandidateLine | null = null;
  for (const line of lines) {
    const distance = Math.abs(line.y - y);
    if (distance > threshold) continue;
    if (
      best === null ||
      line.strength > best.strength ||
      (line.strength === best.strength && distance < Math.abs(best.y - y))
    ) {
      best = line;
    }
  }
  return best ? { y: best.y, snapped: true } : { y, snapped: false };
}
```

- [ ] **Step 5: 实现** `ui/apps/region-split-ui/src/components/ImageCanvas.vue`

```vue
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { imageUrl } from "../api.js";
import type { Store } from "../state.js";

const props = defineProps<{ store: Store }>();

const imgEl = ref<HTMLImageElement>();
const displayWidth = ref(0);

const image = computed(() => props.store.doc.value?.image ?? null);
const displayScale = computed(() => {
  const width = image.value?.width ?? 0;
  return displayWidth.value > 0 && width > 0 ? displayWidth.value / width : 1;
});

function measure() { displayWidth.value = imgEl.value?.clientWidth ?? 0; }
onMounted(() => { measure(); window.addEventListener("resize", measure); });
onUnmounted(() => window.removeEventListener("resize", measure));

function onRegionClick(id: string, event: MouseEvent) {
  props.store.select(id, event.ctrlKey || event.metaKey || event.shiftKey);
}
</script>

<template>
  <div class="canvas" data-test="backdrop" @click.self="props.store.clearSelection()">
    <div v-if="image" class="stage">
      <img ref="imgEl" :src="imageUrl(props.store.projectId.value)" :alt="image.fileName" @load="measure" />
      <div
        v-for="(region, index) in props.store.regions.value"
        :key="region.id"
        class="overlay"
        :class="{ selected: props.store.selectedIds.value.includes(region.id) }"
        :data-region-id="region.id"
        :style="{
          top: `${region.bounds.y * displayScale}px`,
          height: `${region.bounds.h * displayScale}px`,
        }"
        @click.stop="onRegionClick(region.id, $event)"
      >
        <span class="label">{{ index + 1 }} {{ region.displayName }}</span>
      </div>
    </div>
    <p v-else class="empty">先选择一张 UI 效果图</p>
  </div>
</template>

<style scoped>
.canvas { min-height: 100%; padding: 16px; display: flex; justify-content: center; }
.stage { position: relative; width: 100%; max-width: 480px; align-self: flex-start; }
.stage img { display: block; width: 100%; }
.overlay {
  position: absolute; left: 0; right: 0; cursor: pointer;
  border-bottom: 1px solid #00000033; box-sizing: border-box;
}
.overlay:nth-of-type(odd) { background: #00000008; }
.overlay:nth-of-type(even) { background: #00000014; }
.overlay.selected { background: #2f6fed1a; outline: 1px solid #2f6fed; border-bottom: 3px solid #2f6fed; }
.label {
  position: absolute; top: 2px; left: 4px; font-size: 12px; line-height: 16px;
  padding: 0 4px; border-radius: 3px; background: #ffffffd9; color: #333; white-space: nowrap;
}
.empty { color: #888; align-self: center; }
</style>
```

- [ ] **Step 6: 接入 App.vue**

```vue
<script setup lang="ts">
import { httpApi } from "./api.js";
import ImageCanvas from "./components/ImageCanvas.vue";
import { createStore } from "./state.js";

const store = createStore(httpApi);
</script>

<template>
  <div class="layout">
    <header>工具栏（Task 9）</header>
    <main><ImageCanvas :store="store" /></main>
    <aside>区域列表（Task 9）</aside>
  </div>
</template>

<style>
html, body, #app { height: 100%; margin: 0; font-family: system-ui, sans-serif; }
.layout { display: grid; grid-template-columns: 1fr 300px; grid-template-rows: auto 1fr; height: 100%; }
header { grid-column: 1 / -1; border-bottom: 1px solid #ddd; }
main { overflow: auto; background: #f0f1f3; }
aside { border-left: 1px solid #ddd; overflow: auto; }
</style>
```

- [ ] **Step 7: 跑测试确认通过**

Run: `pnpm -C ui/apps/region-split-ui test`
Expected: PASS（新增 7 个用例）

- [ ] **Step 8: Commit**

```bash
git add ui/apps/region-split-ui/src
git commit -m "feat: render region overlays on the image canvas"
```

---

### Task 9: 工具栏、区域列表与键盘微调

**Files:**
- Create: `ui/apps/region-split-ui/src/components/Toolbar.vue`
- Create: `ui/apps/region-split-ui/src/components/RegionList.vue`
- Modify: `ui/apps/region-split-ui/src/App.vue`
- Test: `ui/apps/region-split-ui/src/components/Toolbar.test.ts`、`ui/apps/region-split-ui/src/components/RegionList.test.ts`

**Interfaces:**
- Consumes: `Store`（Task 7）、`makeFakeApi` `makeRegion`（Task 7）
- Produces:
  - `Toolbar.vue`，props `{ store: Store }`，emits `pickFile: [file: File]`。三段结构：
    - 全局行：`input[data-test=file]`、`button[data-test=analyze]`（点击前 `window.confirm("重新分析会覆盖当前所有人工调整，继续？")`；`projectId` 为空或模型未配置时禁用）、`button[data-test=model-config]`（打开配置对话框；模型未配置时附带 `[data-test=model-warning]` 提示徽标）、`button[data-test=undo]`、`button[data-test=redo]`
    - 上下文行：单选显示 `[data-test=nudge-up]` `[data-test=nudge-down]`（`canNudge` 为假时禁用）、`[data-test=split]`、`[data-test=rename]`、`[data-test=ai-rename]`；多选显示 `[data-test=merge]`（`canMerge` 为假时禁用并带 `title="只能合并相邻区域"`）；`mode === "split"` 时改为提示文字与 `[data-test=cancel-split]`
    - 状态行 `[data-test=status]`：单选时显示 `y {y} → {y+h}   h {h}`，否则显示 `↑↓ 微调下边界 · Ctrl+Z 撤销`
  - `RegionList.vue`，props `{ store: Store }`。每行 `[data-test=row][data-region-id]`：序号、`displayName`、`type`、置信度百分比；点击选中（`Ctrl/Shift` 加选）；双击名称或 `store.renamingId` 命中时进入 `input[data-test=rename-input]`，`Enter` 提交，`Esc` 取消；`store.pendingRenameIds` 含该 id 时名称显示 `命名中…`。
  - `App.vue` 挂载 `window` 的 `keydown`：`ArrowUp` → `nudge(-1)`、`ArrowDown` → `nudge(1)`、`Ctrl+Z` → `undo`、`Ctrl+Shift+Z` → `redo`；`event.target` 为 `HTMLInputElement`/`HTMLTextAreaElement` 时直接返回；命中时 `preventDefault()`。挂载时 `loadModelConfig()`，`location.hash` 非空则 `load(hash)`；上传成功后把 `projectId` 写回 `location.hash`。

- [ ] **Step 1: 写失败测试** `ui/apps/region-split-ui/src/components/Toolbar.test.ts`

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import Toolbar from "./Toolbar.vue";
import { createStore } from "../state.js";
import { makeFakeApi, makeRegion } from "../test-helpers.js";

const initial = () => [makeRegion("a", 0, 200), makeRegion("b", 200, 200), makeRegion("c", 400, 200)];

async function mounted() {
  const store = createStore(makeFakeApi(initial));
  await store.load("p1");
  await store.loadModelConfig();
  return { store, wrapper: mount(Toolbar, { props: { store } }) };
}

describe("Toolbar", () => {
  it("shows single-selection actions and hides merge", async () => {
    const { store, wrapper } = await mounted();
    store.select("a", false);
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=split]").exists()).toBe(true);
    expect(wrapper.find("[data-test=merge]").exists()).toBe(false);
  });

  it("shows merge for multi-selection and disables it when not adjacent", async () => {
    const { store, wrapper } = await mounted();
    store.select("a", false);
    store.select("c", true);
    await wrapper.vm.$nextTick();
    const merge = wrapper.find("[data-test=merge]");
    expect(merge.exists()).toBe(true);
    expect(merge.attributes("disabled")).toBeDefined();
    store.select("b", true);
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=merge]").attributes("disabled")).toBeUndefined();
  });

  it("nudges the boundary from the arrow buttons", async () => {
    const { store, wrapper } = await mounted();
    store.select("a", false);
    await wrapper.vm.$nextTick();
    await wrapper.find("[data-test=nudge-down]").trigger("click");
    expect(store.regions.value[0]!.bounds.h).toBe(201);
    await wrapper.find("[data-test=nudge-up]").trigger("click");
    expect(store.regions.value[0]!.bounds.h).toBe(200);
  });

  it("disables the arrows on the last region", async () => {
    const { store, wrapper } = await mounted();
    store.select("c", false);
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=nudge-down]").attributes("disabled")).toBeDefined();
  });

  it("shows the selected geometry in the status line", async () => {
    const { store, wrapper } = await mounted();
    store.select("b", false);
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=status]").text()).toContain("y 200 → 400");
    expect(wrapper.find("[data-test=status]").text()).toContain("h 200");
  });

  it("asks for confirmation before re-analyzing", async () => {
    const { wrapper } = await mounted();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await wrapper.find("[data-test=analyze]").trigger("click");
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("switches to the split hint while in split mode", async () => {
    const { store, wrapper } = await mounted();
    store.select("a", false);
    store.beginSplit();
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=cancel-split]").exists()).toBe(true);
    expect(wrapper.find("[data-test=split]").exists()).toBe(false);
  });

  it("disables undo until something happened", async () => {
    const { store, wrapper } = await mounted();
    expect(wrapper.find("[data-test=undo]").attributes("disabled")).toBeDefined();
    store.select("a", false);
    store.rename("a", "顶部");
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=undo]").attributes("disabled")).toBeUndefined();
  });

  it("warns and blocks analysis when the model is not configured", async () => {
    const store = createStore(makeFakeApi(initial));
    await store.load("p1");
    const wrapper = mount(Toolbar, { props: { store } });
    expect(wrapper.find("[data-test=model-warning]").exists()).toBe(true);
    expect(wrapper.find("[data-test=analyze]").attributes("disabled")).toBeDefined();
  });

  it("opens the model config dialog", async () => {
    const { store, wrapper } = await mounted();
    await wrapper.find("[data-test=model-config]").trigger("click");
    expect(store.configDialogOpen.value).toBe(true);
  });
});
```

- [ ] **Step 2: 写失败测试** `ui/apps/region-split-ui/src/components/RegionList.test.ts`

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import RegionList from "./RegionList.vue";
import { createStore } from "../state.js";
import { makeFakeApi, makeRegion } from "../test-helpers.js";

const initial = () => [makeRegion("a", 0, 300), makeRegion("b", 300, 300)];

async function mounted() {
  const store = createStore(makeFakeApi(initial));
  await store.load("p1");
  return { store, wrapper: mount(RegionList, { props: { store } }) };
}

describe("RegionList", () => {
  it("lists every region with type and confidence", async () => {
    const { wrapper } = await mounted();
    const rows = wrapper.findAll("[data-test=row]");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain("名-a");
    expect(rows[0]!.text()).toContain("card");
    expect(rows[0]!.text()).toContain("87%");
  });

  it("selects on click and adds with ctrl-click", async () => {
    const { store, wrapper } = await mounted();
    await wrapper.findAll("[data-test=row]")[1]!.trigger("click");
    expect(store.selectedIds.value).toEqual(["b"]);
    await wrapper.findAll("[data-test=row]")[0]!.trigger("click", { ctrlKey: true });
    expect(store.selectedIds.value).toEqual(["b", "a"]);
  });

  it("renames inline on double click", async () => {
    const { store, wrapper } = await mounted();
    await wrapper.findAll("[data-test=name]")[0]!.trigger("dblclick");
    const input = wrapper.find("[data-test=rename-input]");
    expect(input.exists()).toBe(true);
    await input.setValue("会员卡");
    await input.trigger("keydown", { key: "Enter" });
    expect(store.regions.value[0]!.displayName).toBe("会员卡");
  });

  it("cancels renaming on escape", async () => {
    const { store, wrapper } = await mounted();
    await wrapper.findAll("[data-test=name]")[0]!.trigger("dblclick");
    const input = wrapper.find("[data-test=rename-input]");
    await input.setValue("不要这个");
    await input.trigger("keydown", { key: "Escape" });
    expect(store.regions.value[0]!.displayName).toBe("名-a");
    expect(wrapper.find("[data-test=rename-input]").exists()).toBe(false);
  });

  it("enters edit mode when the toolbar requests a rename", async () => {
    const { store, wrapper } = await mounted();
    store.startRename("b");
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=rename-input]").exists()).toBe(true);
  });

  it("shows a naming placeholder while the model is running", async () => {
    const { store, wrapper } = await mounted();
    store.pendingRenameIds.value = ["a"];
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll("[data-test=name]")[0]!.text()).toBe("命名中…");
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm -C ui/apps/region-split-ui test`
Expected: FAIL —— 找不到 `Toolbar.vue` 与 `RegionList.vue`

- [ ] **Step 4: 实现** `ui/apps/region-split-ui/src/components/Toolbar.vue`

```vue
<script setup lang="ts">
import { computed } from "vue";
import type { Store } from "../state.js";

const props = defineProps<{ store: Store }>();
const emit = defineEmits<{ pickFile: [file: File] }>();

const selected = computed(() => props.store.selectedRegion.value);
const multi = computed(() => props.store.selectedIds.value.length > 1);
const splitting = computed(() => props.store.mode.value === "split");

function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) emit("pickFile", file);
}

function onAnalyze() {
  if (!window.confirm("重新分析会覆盖当前所有人工调整，继续？")) return;
  void props.store.analyze();
}
</script>

<template>
  <div class="toolbar">
    <div class="row global">
      <input type="file" accept="image/*" data-test="file" @change="onFile" />
      <button
        data-test="analyze"
        :disabled="!props.store.projectId.value || !props.store.isModelConfigured.value"
        @click="onAnalyze"
      >重新分析</button>
      <span class="spacer" />
      <button data-test="model-config" @click="props.store.openConfigDialog()">模型配置</button>
      <span v-if="!props.store.isModelConfigured.value" data-test="model-warning" class="warning">
        未配置模型
      </span>
      <button data-test="undo" :disabled="!props.store.canUndo.value" @click="props.store.undo()">撤销</button>
      <button data-test="redo" :disabled="!props.store.canRedo.value" @click="props.store.redo()">重做</button>
    </div>

    <div class="row context">
      <template v-if="splitting">
        <span>拆分「{{ selected?.displayName }}」—— 移动鼠标选择位置，点击确认</span>
        <button data-test="cancel-split" @click="props.store.cancelSplit()">取消</button>
      </template>
      <template v-else-if="multi">
        <span>已选 {{ props.store.selectedIds.value.length }} 个区域</span>
        <button
          data-test="merge"
          :disabled="!props.store.canMerge.value"
          :title="props.store.canMerge.value ? '' : '只能合并相邻区域'"
          @click="props.store.merge()"
        >合并</button>
      </template>
      <template v-else-if="selected">
        <span>已选：{{ selected.displayName }}</span>
        <button data-test="nudge-up" :disabled="!props.store.canNudge.value" @click="props.store.nudge(-1)">▲</button>
        <button data-test="nudge-down" :disabled="!props.store.canNudge.value" @click="props.store.nudge(1)">▼</button>
        <span class="hint">微调下边界</span>
        <button data-test="split" @click="props.store.beginSplit()">拆分</button>
        <button data-test="rename" @click="props.store.startRename(selected.id)">重命名</button>
        <button
          data-test="ai-rename"
          :disabled="!props.store.isModelConfigured.value"
          @click="props.store.aiRename(selected.id)"
        >AI 重命名</button>
      </template>
    </div>

    <div class="row status" data-test="status">
      <template v-if="selected">
        y {{ selected.bounds.y }} → {{ selected.bounds.y + selected.bounds.h }} &nbsp; h {{ selected.bounds.h }}
      </template>
      <template v-else>↑↓ 微调下边界 · Ctrl+Z 撤销</template>
      <span v-if="props.store.error.value" class="error">{{ props.store.error.value }}</span>
    </div>
  </div>
</template>

<style scoped>
.toolbar { display: flex; flex-direction: column; }
.row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; }
.global { border-bottom: 1px solid #eee; }
.context { min-height: 32px; border-bottom: 1px solid #eee; }
.status { font-size: 12px; color: #666; }
.spacer { flex: 1; }
.hint { font-size: 12px; color: #888; }
.warning { font-size: 12px; color: #e2a400; }
.error { margin-left: 12px; color: #d0454c; }
button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
```

- [ ] **Step 5: 实现** `ui/apps/region-split-ui/src/components/RegionList.vue`

```vue
<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { Store } from "../state.js";

const props = defineProps<{ store: Store }>();

const editingId = ref<string | null>(null);
const draft = ref("");
const inputEl = ref<HTMLInputElement>();

watch(() => props.store.renamingId.value, id => { if (id) beginEdit(id); });

function beginEdit(id: string) {
  const region = props.store.regions.value.find(item => item.id === id);
  if (!region) return;
  editingId.value = id;
  draft.value = region.displayName;
  void nextTick(() => inputEl.value?.focus());
}

function commit() {
  if (editingId.value && draft.value.trim()) {
    props.store.rename(editingId.value, draft.value.trim());
  }
  close();
}

function close() {
  editingId.value = null;
  props.store.stopRename();
}
</script>

<template>
  <ul class="list">
    <li
      v-for="(region, index) in props.store.regions.value"
      :key="region.id"
      data-test="row"
      :data-region-id="region.id"
      class="row"
      :class="{ selected: props.store.selectedIds.value.includes(region.id) }"
      @click="props.store.select(region.id, $event.ctrlKey || $event.metaKey || $event.shiftKey)"
    >
      <span class="index">{{ index + 1 }}</span>
      <input
        v-if="editingId === region.id"
        ref="inputEl"
        v-model="draft"
        data-test="rename-input"
        @click.stop
        @keydown.enter="commit"
        @keydown.esc="close"
        @blur="commit"
      />
      <span v-else data-test="name" class="name" @dblclick.stop="beginEdit(region.id)">
        {{ props.store.pendingRenameIds.value.includes(region.id) ? "命名中…" : region.displayName }}
      </span>
      <span class="type">{{ region.type }}</span>
      <span class="confidence">{{ Math.round(region.confidence * 100) }}%</span>
    </li>
  </ul>
</template>

<style scoped>
.list { list-style: none; margin: 0; padding: 4px; }
.row { display: flex; align-items: center; gap: 6px; padding: 6px; border-radius: 6px; cursor: pointer; }
.row.selected { background: #e8f0fe; }
.index { width: 18px; color: #999; font-size: 12px; }
.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.type { font-size: 11px; color: #888; }
.confidence { font-size: 11px; color: #666; width: 34px; text-align: right; }
input { flex: 1; min-width: 0; }
</style>
```

- [ ] **Step 6: 装配 App.vue（含键盘与 hash）**

```vue
<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { httpApi } from "./api.js";
import ImageCanvas from "./components/ImageCanvas.vue";
import RegionList from "./components/RegionList.vue";
import Toolbar from "./components/Toolbar.vue";
import { createStore } from "./state.js";

const store = createStore(httpApi);

async function onPickFile(file: File) {
  await store.uploadImage(file);
  if (store.projectId.value) location.hash = store.projectId.value;
}

function onKeydown(event: KeyboardEvent) {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  if (event.key === "ArrowUp") { event.preventDefault(); store.nudge(-1); return; }
  if (event.key === "ArrowDown") { event.preventDefault(); store.nudge(1); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) store.redo(); else store.undo();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("beforeunload", store.flushPersist);
  void store.loadModelConfig();
  const hash = location.hash.slice(1);
  if (hash) void store.load(hash);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("beforeunload", store.flushPersist);
});
</script>

<template>
  <div class="layout">
    <header><Toolbar :store="store" @pick-file="onPickFile" /></header>
    <main><ImageCanvas :store="store" /></main>
    <aside><RegionList :store="store" /></aside>
  </div>
</template>

<style>
html, body, #app { height: 100%; margin: 0; font-family: system-ui, sans-serif; }
.layout { display: grid; grid-template-columns: 1fr 300px; grid-template-rows: auto 1fr; height: 100%; }
header { grid-column: 1 / -1; border-bottom: 1px solid #ddd; }
main { overflow: auto; background: #f0f1f3; }
aside { border-left: 1px solid #ddd; overflow: auto; }
</style>
```

- [ ] **Step 7: 跑测试确认通过**

Run: `pnpm -C ui/apps/region-split-ui test`
Expected: PASS（新增 16 个用例）

- [ ] **Step 8: Commit**

```bash
git add ui/apps/region-split-ui/src
git commit -m "feat: add toolbar, region list and keyboard nudging"
```

---

### Task 10: 模型配置对话框

**Files:**
- Create: `ui/apps/region-split-ui/src/components/ModelConfigDialog.vue`
- Modify: `ui/apps/region-split-ui/src/App.vue`
- Test: `ui/apps/region-split-ui/src/components/ModelConfigDialog.test.ts`

**Interfaces:**
- Consumes: `Store` 的 `modelConfig` `configDialogOpen` `configTestResult` `saveModelConfig` `testModelConfig` `closeConfigDialog`（Task 7）
- Produces: `ModelConfigDialog.vue`，props `{ store: Store }`。`store.configDialogOpen` 为假时不渲染任何内容。字段与按钮：
  - `input[data-test=base-url]`、`input[data-test=model-name]`、`input[data-test=api-key][type=password]`
  - API Key 输入框初始为空，`placeholder` 取 `store.modelConfig.apiKeyMask`（已保存时形如 `sk-••••abcd`），旁边提示"留空表示不修改"
  - `button[data-test=test]` → `store.testModelConfig(表单值)`；结果渲染在 `[data-test=test-result]`，成功显示"连接成功"，失败显示"连接失败：<原因>"
  - `button[data-test=save]` → `store.saveModelConfig(表单值)`；`button[data-test=cancel]` → `store.closeConfigDialog()`
  - 打开对话框时表单从 `store.modelConfig` 初始化（`watch` `configDialogOpen` 变为 `true` 时同步）

- [ ] **Step 1: 写失败测试** `ui/apps/region-split-ui/src/components/ModelConfigDialog.test.ts`

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ModelConfigDialog from "./ModelConfigDialog.vue";
import { createStore } from "../state.js";
import { makeFakeApi, makeRegion } from "../test-helpers.js";

const initial = () => [makeRegion("a", 0, 600)];

async function mounted(open = true) {
  const api = makeFakeApi(initial);
  const store = createStore(api);
  await store.loadModelConfig();
  if (open) store.openConfigDialog();
  const wrapper = mount(ModelConfigDialog, { props: { store } });
  await wrapper.vm.$nextTick();
  return { store, api, wrapper };
}

describe("ModelConfigDialog", () => {
  it("renders nothing while closed", async () => {
    const { wrapper } = await mounted(false);
    expect(wrapper.find("[data-test=base-url]").exists()).toBe(false);
  });

  it("prefills the form from the saved config and masks the key", async () => {
    const { wrapper } = await mounted();
    expect((wrapper.find("[data-test=base-url]").element as HTMLInputElement).value).toBe("http://local/v1");
    expect((wrapper.find("[data-test=model-name]").element as HTMLInputElement).value).toBe("test-model");
    const key = wrapper.find("[data-test=api-key]");
    expect((key.element as HTMLInputElement).value).toBe("");
    expect(key.attributes("placeholder")).toBe("sk-••••abcd");
  });

  it("reports a successful connection test", async () => {
    const { wrapper } = await mounted();
    await wrapper.find("[data-test=test]").trigger("click");
    await new Promise(resolve => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=test-result]").text()).toContain("连接成功");
  });

  it("reports a failed connection test with the reason", async () => {
    const api = makeFakeApi(initial);
    api.testModelConfig = async () => ({ ok: false, error: "connect ECONNREFUSED" });
    const store = createStore(api);
    await store.loadModelConfig();
    store.openConfigDialog();
    const wrapper = mount(ModelConfigDialog, { props: { store } });
    await wrapper.vm.$nextTick();
    await wrapper.find("[data-test=test]").trigger("click");
    await new Promise(resolve => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test=test-result]").text()).toContain("connect ECONNREFUSED");
  });

  it("saves the edited values and omits an empty key", async () => {
    const api = makeFakeApi(initial);
    const putModelConfig = vi.fn(api.putModelConfig);
    api.putModelConfig = putModelConfig;
    const store = createStore(api);
    await store.loadModelConfig();
    store.openConfigDialog();
    const wrapper = mount(ModelConfigDialog, { props: { store } });
    await wrapper.vm.$nextTick();
    await wrapper.find("[data-test=base-url]").setValue("http://other/v1");
    await wrapper.find("[data-test=save]").trigger("click");
    expect(putModelConfig).toHaveBeenCalledWith({
      baseUrl: "http://other/v1", model: "test-model", apiKey: undefined,
    });
  });

  it("closes on cancel without saving", async () => {
    const { store, wrapper } = await mounted();
    await wrapper.find("[data-test=cancel]").trigger("click");
    expect(store.configDialogOpen.value).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C ui/apps/region-split-ui test`
Expected: FAIL —— 找不到 `ModelConfigDialog.vue`

- [ ] **Step 3: 实现** `ui/apps/region-split-ui/src/components/ModelConfigDialog.vue`

```vue
<script setup lang="ts">
import { ref, watch } from "vue";
import type { Store } from "../state.js";

const props = defineProps<{ store: Store }>();

const baseUrl = ref("");
const modelName = ref("");
const apiKey = ref("");

watch(() => props.store.configDialogOpen.value, open => {
  if (!open) return;
  baseUrl.value = props.store.modelConfig.value?.baseUrl ?? "";
  modelName.value = props.store.modelConfig.value?.model ?? "";
  apiKey.value = "";
}, { immediate: true });

const formValue = () => ({
  baseUrl: baseUrl.value.trim(),
  model: modelName.value.trim(),
  apiKey: apiKey.value === "" ? undefined : apiKey.value,
});
</script>

<template>
  <div v-if="props.store.configDialogOpen.value" class="backdrop" @click.self="props.store.closeConfigDialog()">
    <div class="dialog">
      <h3>模型配置</h3>

      <label>
        <span>Base URL</span>
        <input v-model="baseUrl" data-test="base-url" placeholder="http://127.0.0.1:11434/v1" />
      </label>

      <label>
        <span>模型名</span>
        <input v-model="modelName" data-test="model-name" placeholder="qwen2.5-vl" />
      </label>

      <label>
        <span>API Key</span>
        <input
          v-model="apiKey"
          data-test="api-key"
          type="password"
          :placeholder="props.store.modelConfig.value?.apiKeyMask || '本地模型可留空'"
        />
      </label>
      <p class="hint">已保存的 Key 不会回传，留空表示保持不变。</p>

      <p
        v-if="props.store.configTestResult.value"
        data-test="test-result"
        :class="props.store.configTestResult.value.ok ? 'ok' : 'fail'"
      >
        {{ props.store.configTestResult.value.ok
          ? "连接成功"
          : `连接失败：${props.store.configTestResult.value.error ?? "未知错误"}` }}
      </p>

      <div class="actions">
        <button data-test="test" @click="props.store.testModelConfig(formValue())">测试连接</button>
        <span class="spacer" />
        <button data-test="cancel" @click="props.store.closeConfigDialog()">取消</button>
        <button data-test="save" @click="props.store.saveModelConfig(formValue())">保存</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed; inset: 0; background: #00000055;
  display: flex; align-items: center; justify-content: center; z-index: 10;
}
.dialog {
  background: #fff; border-radius: 10px; padding: 20px; width: 420px;
  display: flex; flex-direction: column; gap: 10px;
}
h3 { margin: 0 0 4px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
input { padding: 6px 8px; border: 1px solid #ccc; border-radius: 6px; }
.hint { margin: 0; font-size: 12px; color: #888; }
.ok { color: #22a06b; margin: 0; }
.fail { color: #d0454c; margin: 0; word-break: break-all; }
.actions { display: flex; gap: 8px; margin-top: 6px; }
.spacer { flex: 1; }
</style>
```

- [ ] **Step 4: 挂进 App.vue**

在 `App.vue` 的 `import` 中加 `import ModelConfigDialog from "./components/ModelConfigDialog.vue";`，并在模板 `.layout` 内的最后加一行：

```vue
    <ModelConfigDialog :store="store" />
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm -C ui/apps/region-split-ui test`
Expected: PASS（新增 6 个用例）

- [ ] **Step 6: Commit**

```bash
git add ui/apps/region-split-ui/src
git commit -m "feat: add in-app model configuration dialog"
```

---

### Task 11: 拆分模式

**Files:**
- Modify: `ui/apps/region-split-ui/src/components/ImageCanvas.vue`
- Test: `ui/apps/region-split-ui/src/components/ImageCanvas.test.ts`（追加用例）

**Interfaces:**
- Consumes: `toImageY` `snapToCandidates`（Task 8）、`canSplitAt` `MIN_REGION_HEIGHT`（core）、`store.mode` `store.candidateLines` `store.commitSplit`（Task 7）
- Produces：`ImageCanvas` 在 `store.mode === "split"` 时的行为：
  - 舞台上的 `mousemove` 计算 `toImageY(event.clientY, stageRect.top, displayScale)`，再经 `snapToCandidates(y, store.candidateLines, 12)` 吸附
  - 渲染一条水平线 `[data-test=split-line]`；吸附命中时加 `snapped` 类（线加粗），位置非法时加 `invalid` 类（变红）
  - 线旁 `[data-test=split-info]` 实时显示 `y {y} · 上 {上段高} / 下 {下段高}`
  - 合法性由 `canSplitAt(regions, selectedIndex, y)` 判定（保证两侧均 ≥ 8px）
  - 舞台 `click` 时：合法则 `store.commitSplit(y)`，非法则忽略
  - `mode` 切回 `idle` 时清除线
- **常量**：吸附阈值 `SNAP_THRESHOLD = 12`（原图像素），与服务端 `reconcile` 的默认值一致。

- [ ] **Step 1: 追加失败测试到** `ui/apps/region-split-ui/src/components/ImageCanvas.test.ts`

```ts
// 文件顶部的 import 追加：
// import { makeFakeApi, makeRegion } from "../test-helpers.js";  // 已有

async function mountedForSplit() {
  const store = createStore(makeFakeApi(initial, [{ y: 260, strength: 0.9 }]));
  await store.load("p1");
  const wrapper = mount(ImageCanvas, { props: { store } });
  store.select("b", false);
  store.beginSplit();
  await wrapper.vm.$nextTick();
  return { store, wrapper };
}

describe("ImageCanvas split mode", () => {
  it("shows no split line outside split mode", async () => {
    const { wrapper } = await mounted();
    expect(wrapper.find("[data-test=split-line]").exists()).toBe(false);
  });

  it("tracks the pointer and reports both halves", async () => {
    const { wrapper } = await mountedForSplit();
    await wrapper.find("[data-test=stage]").trigger("mousemove", { clientY: 300 });
    expect(wrapper.find("[data-test=split-line]").exists()).toBe(true);
    expect(wrapper.find("[data-test=split-info]").text()).toContain("上 100");
    expect(wrapper.find("[data-test=split-info]").text()).toContain("下 300");
  });

  it("snaps onto a nearby candidate line", async () => {
    const { wrapper } = await mountedForSplit();
    await wrapper.find("[data-test=stage]").trigger("mousemove", { clientY: 255 });
    expect(wrapper.find("[data-test=split-line]").classes()).toContain("snapped");
    expect(wrapper.find("[data-test=split-info]").text()).toContain("y 260");
  });

  it("marks positions too close to an edge as invalid and ignores the click", async () => {
    const { store, wrapper } = await mountedForSplit();
    const stage = wrapper.find("[data-test=stage]");
    await stage.trigger("mousemove", { clientY: 203 });
    expect(wrapper.find("[data-test=split-line]").classes()).toContain("invalid");
    await stage.trigger("click");
    expect(store.regions.value).toHaveLength(2);
    expect(store.mode.value).toBe("split");
  });

  it("commits the split on a valid click", async () => {
    const { store, wrapper } = await mountedForSplit();
    const stage = wrapper.find("[data-test=stage]");
    await stage.trigger("mousemove", { clientY: 300 });
    await stage.trigger("click");
    expect(store.regions.value.map(r => r.id)).toEqual(["a", "b", "b-2"]);
    expect(store.mode.value).toBe("idle");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C ui/apps/region-split-ui test`
Expected: FAIL —— 找不到 `[data-test=stage]` 与 `[data-test=split-line]`

- [ ] **Step 3: 实现——修改** `ImageCanvas.vue`

在 `<script setup>` 追加：

```ts
import { canSplitAt } from "@region-split/core";
import { snapToCandidates, toImageY } from "../coords.js";

const SNAP_THRESHOLD = 12;

const stageEl = ref<HTMLElement>();
const splitY = ref<number | null>(null);
const splitSnapped = ref(false);

const splitting = computed(() => props.store.mode.value === "split");
const splitValid = computed(() =>
  splitY.value !== null &&
  canSplitAt(props.store.regions.value, props.store.selectedIndex.value, splitY.value));
const splitHalves = computed(() => {
  const region = props.store.selectedRegion.value;
  if (!region || splitY.value === null) return null;
  return {
    top: splitY.value - region.bounds.y,
    bottom: region.bounds.y + region.bounds.h - splitY.value,
  };
});

watch(splitting, active => { if (!active) { splitY.value = null; splitSnapped.value = false; } });

function onStageMove(event: MouseEvent) {
  if (!splitting.value) return;
  const rect = stageEl.value?.getBoundingClientRect();
  const raw = toImageY(event.clientY, rect?.top ?? 0, displayScale.value);
  const result = snapToCandidates(raw, props.store.candidateLines.value, SNAP_THRESHOLD);
  splitY.value = result.y;
  splitSnapped.value = result.snapped;
}

function onStageClick() {
  if (!splitting.value || splitY.value === null || !splitValid.value) return;
  props.store.commitSplit(splitY.value);
}
```

（`<script setup>` 顶部的 `vue` import 增加 `watch`。）

模板里给 `.stage` 加上 `ref`、`data-test` 与事件，并在其内部末尾加入分割线：

```vue
    <div
      v-if="image"
      ref="stageEl"
      class="stage"
      data-test="stage"
      :class="{ splitting }"
      @mousemove="onStageMove"
      @click="onStageClick"
    >
      <!-- img 与 overlay 保持不变 -->

      <template v-if="splitting && splitY !== null">
        <div
          data-test="split-line"
          class="split-line"
          :class="{ snapped: splitSnapped, invalid: !splitValid }"
          :style="{ top: `${splitY * displayScale}px` }"
        />
        <span
          data-test="split-info"
          class="split-info"
          :style="{ top: `${splitY * displayScale}px` }"
        >
          y {{ splitY }} · 上 {{ splitHalves?.top }} / 下 {{ splitHalves?.bottom }}
        </span>
      </template>
    </div>
```

样式追加：

```css
.stage.splitting { cursor: crosshair; }
.stage.splitting .overlay { pointer-events: none; }
.split-line { position: absolute; left: 0; right: 0; height: 2px; background: #2f6fed; pointer-events: none; }
.split-line.snapped { height: 4px; }
.split-line.invalid { background: #d0454c; }
.split-info {
  position: absolute; right: 4px; transform: translateY(-140%);
  font-size: 12px; padding: 1px 5px; border-radius: 3px;
  background: #2f6fedee; color: #fff; white-space: nowrap; pointer-events: none;
}
```

> 拆分模式下把 `.overlay` 的 `pointer-events` 关掉，否则区域叠加层会吞掉舞台的 `mousemove` 与 `click`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -C ui/apps/region-split-ui test`
Expected: PASS（新增 5 个用例）

- [ ] **Step 5: Commit**

```bash
git add ui/apps/region-split-ui/src
git commit -m "feat: add split mode with candidate line snapping"
```

---

### Task 12: 候选切分线检测

**Files:**
- Modify: `ui/packages/region-split/src/candidate-lines.ts`（替换 Task 6 的占位实现）
- Test: `ui/packages/region-split/src/candidate-lines.test.ts`

**Interfaces:**
- Consumes: `CandidateLine`（Task 1）
- Produces:
  - `interface RowStat { mean: [number, number, number]; variance: number }`（`mean` 为该行 RGB 均值，`variance` 为该行像素与均值的平均欧氏距离）
  - `rowStats(imagePath: string): Promise<RowStat[]>` —— 用 sharp 读 raw 像素逐行统计
  - `candidatesFromRows(rows: RowStat[], opts?: { uniformVariance?: number; transitionDeltaE?: number }): CandidateLine[]` —— **纯函数，测试主战场**
  - `detectCandidateLines(imagePath: string): Promise<CandidateLine[]>` —— `rowStats` + `candidatesFromRows`
- 算法：
  1. 取所有行 `mean` 的中位数作为**页面背景色**。
  2. **留白带**：连续满足 `variance < uniformVariance`（默认 10）且 `ΔE(mean, 背景色) < 6` 的行构成一条带；带的中位行为候选，`strength = min(1, 带高 / 24)`。
  3. **突变行**：`ΔE(mean[i], mean[i-1]) > transitionDeltaE`（默认 12）的行为候选，`strength = min(1, ΔE / 40)`。
  4. 两类候选合并后按 `y` 升序；相距 < 4px 的候选只保留 `strength` 更大的一条。
  5. ΔE 在 Lab 空间计算（复用本文件内的 `rgbToLab`）。
- **分割线（1–3px 细线）** 会被"突变行"规则捕获（上下各产生一次突变），无需单独规则。

- [ ] **Step 1: 写失败测试** `ui/packages/region-split/src/candidate-lines.test.ts`

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { candidatesFromRows, detectCandidateLines, rowStats, type RowStat } from "./candidate-lines.js";

const uniform = (gray: number): RowStat => ({ mean: [gray, gray, gray], variance: 1 });
const busy = (gray: number): RowStat => ({ mean: [gray, gray, gray], variance: 60 });

describe("candidatesFromRows", () => {
  it("returns the middle of a blank band", () => {
    // 0-9 内容，10-19 背景留白，20-29 内容；背景中位数落在白色
    const rows = [
      ...Array.from({ length: 10 }, () => busy(255)),
      ...Array.from({ length: 10 }, () => uniform(255)),
      ...Array.from({ length: 10 }, () => busy(255)),
    ];
    const found = candidatesFromRows(rows);
    expect(found.some(line => Math.abs(line.y - 14) <= 1)).toBe(true);
  });

  it("gives taller blank bands a higher strength", () => {
    const short = candidatesFromRows([
      ...Array.from({ length: 10 }, () => busy(255)),
      ...Array.from({ length: 6 }, () => uniform(255)),
      ...Array.from({ length: 10 }, () => busy(255)),
    ]);
    const tall = candidatesFromRows([
      ...Array.from({ length: 10 }, () => busy(255)),
      ...Array.from({ length: 24 }, () => uniform(255)),
      ...Array.from({ length: 10 }, () => busy(255)),
    ]);
    expect(tall[0]!.strength).toBeGreaterThan(short[0]!.strength);
  });

  it("detects an abrupt background change", () => {
    const rows = [
      ...Array.from({ length: 20 }, () => busy(255)),
      ...Array.from({ length: 20 }, () => busy(120)),
    ];
    const found = candidatesFromRows(rows);
    expect(found.some(line => Math.abs(line.y - 20) <= 1)).toBe(true);
  });

  it("keeps only the stronger of two candidates closer than 4px", () => {
    const rows = [
      ...Array.from({ length: 20 }, () => busy(255)),
      busy(120), busy(255),
      ...Array.from({ length: 20 }, () => busy(255)),
    ];
    const found = candidatesFromRows(rows);
    const near = found.filter(line => line.y >= 18 && line.y <= 24);
    expect(near).toHaveLength(1);
  });

  it("finds nothing in a completely flat image", () => {
    expect(candidatesFromRows(Array.from({ length: 40 }, () => uniform(255)))).toHaveLength(0);
  });
});

describe("rowStats and detectCandidateLines", () => {
  it("reads per-row statistics from a real image", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rs-cl-"));
    const path = join(dir, "two-tone.png");
    await sharp({ create: { width: 40, height: 60, channels: 3, background: "#ffffff" } })
      .composite([{
        input: { create: { width: 40, height: 30, channels: 3, background: "#303030" } },
        top: 30, left: 0,
      }])
      .png().toFile(path);

    const rows = await rowStats(path);
    expect(rows).toHaveLength(60);
    expect(rows[0]!.mean[0]).toBeCloseTo(255, 0);
    expect(rows[59]!.mean[0]).toBeCloseTo(48, 0);

    const lines = await detectCandidateLines(path);
    expect(lines.some(line => Math.abs(line.y - 30) <= 1)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C ui/packages/region-split test`
Expected: FAIL —— `candidatesFromRows` / `rowStats` 未导出

- [ ] **Step 3: 实现** `ui/packages/region-split/src/candidate-lines.ts`（整体替换占位实现）

```ts
import sharp from "sharp";
import type { CandidateLine } from "./types.js";

export interface RowStat { mean: [number, number, number]; variance: number }

const MERGE_DISTANCE = 4;

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const f = (v: number) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
  const [rl, gl, bl] = [f(r), f(g), f(b)];
  let x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  let y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  let z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  const g2 = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  [x, y, z] = [g2(x), g2(y), g2(z)];
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function deltaE(a: [number, number, number], b: [number, number, number]): number {
  const la = rgbToLab(...a);
  const lb = rgbToLab(...b);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

function medianColor(rows: RowStat[]): [number, number, number] {
  const channel = (index: 0 | 1 | 2) => {
    const values = rows.map(row => row.mean[index]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 0;
  };
  return [channel(0), channel(1), channel(2)];
}

export function candidatesFromRows(
  rows: RowStat[],
  opts: { uniformVariance?: number; transitionDeltaE?: number } = {},
): CandidateLine[] {
  if (rows.length === 0) return [];
  const uniformVariance = opts.uniformVariance ?? 10;
  const transitionDeltaE = opts.transitionDeltaE ?? 12;
  const background = medianColor(rows);
  const found: CandidateLine[] = [];

  // ① 留白带：连续的“纯色且等于页面背景色”的行
  let bandStart: number | null = null;
  const closeBand = (endExclusive: number) => {
    if (bandStart === null) return;
    const height = endExclusive - bandStart;
    // 顶到图片边缘的留白不是模块边界
    if (bandStart > 0 && endExclusive < rows.length) {
      found.push({
        y: Math.floor(bandStart + height / 2),
        strength: Math.min(1, height / 24),
      });
    }
    bandStart = null;
  };
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!;
    const blank = row.variance < uniformVariance && deltaE(row.mean, background) < 6;
    if (blank && bandStart === null) bandStart = y;
    if (!blank) closeBand(y);
  }
  closeBand(rows.length);

  // ② 突变行：与上一行的感知色差超过阈值
  for (let y = 1; y < rows.length; y++) {
    const difference = deltaE(rows[y]!.mean, rows[y - 1]!.mean);
    if (difference > transitionDeltaE) {
      found.push({ y, strength: Math.min(1, difference / 40) });
    }
  }

  // ③ 合并过近的候选，保留更强的一条
  found.sort((a, b) => a.y - b.y);
  const merged: CandidateLine[] = [];
  for (const line of found) {
    const previous = merged[merged.length - 1];
    if (previous && line.y - previous.y < MERGE_DISTANCE) {
      if (line.strength > previous.strength) merged[merged.length - 1] = line;
      continue;
    }
    merged.push(line);
  }
  return merged;
}

export async function rowStats(imagePath: string): Promise<RowStat[]> {
  const { data, info } = await sharp(imagePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const stats: RowStat[] = [];
  for (let y = 0; y < info.height; y++) {
    let r = 0, g = 0, b = 0;
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      r += data[i]!; g += data[i + 1]!; b += data[i + 2]!;
    }
    const mean: [number, number, number] = [r / info.width, g / info.width, b / info.width];
    let spread = 0;
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      spread += Math.hypot(data[i]! - mean[0], data[i + 1]! - mean[1], data[i + 2]! - mean[2]);
    }
    stats.push({ mean, variance: spread / info.width });
  }
  return stats;
}

export async function detectCandidateLines(imagePath: string): Promise<CandidateLine[]> {
  return candidatesFromRows(await rowStats(imagePath));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -C ui/packages/region-split test`
Expected: PASS（新增 6 个用例，且 Task 5 的 analyze 用例仍通过）

- [ ] **Step 5: Commit**

```bash
git add ui/packages/region-split/src
git commit -m "feat: detect candidate split lines by horizontal projection"
```

---

### Task 13: 端到端走查与使用说明

**Files:**
- Create: `ui/README.md`
- Create: `ui/docs/superpowers/plans/2026-08-11-region-split-walkthrough.md`

**Interfaces:**
- Consumes: 前 12 个 Task 的全部产物。
- Produces: 可复现的启动说明与一次真实走查记录。

- [ ] **Step 1: 全量回归**

Run: `pnpm -C ui test`
Expected: 两个包的测试全部 PASS

- [ ] **Step 2: 写 `ui/README.md`**

````markdown
# UI 效果图区域拆分工具

把一张移动端 UI 效果图拆成 5–10 个粗粒度模块并自动命名，人工可微调边界、拆分、合并、重命名。

## 启动

两个终端：

```bash
pnpm -C ui install
pnpm -C ui/packages/region-split dev     # 服务端，默认 127.0.0.1:4800
```

```bash
pnpm -C ui/apps/region-split-ui dev      # 前端，默认 127.0.0.1:5180
```

打开 http://127.0.0.1:5180 。

## 配置模型

点右上角「模型配置」，填 Base URL（OpenAI 兼容端点，如 `http://127.0.0.1:11434/v1`）、模型名和 API Key（本地模型可留空），点「测试连接」确认通了再保存。

也可以用环境变量提供默认值：`UIR_MODEL_BASE_URL` / `UIR_MODEL_API_KEY` / `UIR_MODEL_NAME`。界面里保存过一次后以界面配置为准。

数据写在 `ui/data/`（已 gitignore）：`model-config.json` 存模型配置，`projects/<id>/` 存每个项目的原图、分析图和 `regions.json`。

## 操作

| 操作 | 方式 |
|------|------|
| 选中区域 | 点图上色块或右侧列表；`Ctrl/Shift` 加选 |
| 微调下边界 | 选中后点 `▲` `▼`，或按 `↑` `↓` |
| 拆分 | 选中后点「拆分」→ 移动鼠标（会吸附到检测出的真实分割线）→ 点击确认 |
| 合并 | 选中多个**相邻**区域 → 点「合并」 |
| 重命名 | 点「重命名」或双击列表里的名字 |
| AI 重命名 | 选中后点「AI 重命名」 |
| 撤销 / 重做 | 工具栏按钮或 `Ctrl+Z` / `Ctrl+Shift+Z` |

拆分和合并后新区域会自动交给模型重新命名。所有改动实时落盘，刷新页面（URL 带 `#<projectId>`）可恢复现场。
````

- [ ] **Step 3: 端到端走查（人工执行，把结果写进走查文档）**

准备 3 张真实移动端 UI 效果图，其中至少一张是高度超过 2000px 的长图。逐项记录：

1. 上传后自动分析：模块数是否落在 5–10、有无重叠或缝隙、是否覆盖全图。
2. 人工修正到满意所需的操作次数（目标 ≤ 10 次），记录实际次数与最费劲的环节。
3. 拆分模式下吸附是否命中真实分割位置，有没有还需要逐像素微调的情况。
4. 拆分/合并后自动命名的耗时与名称是否贴切。
5. 连续撤销 10 步以上是否状态正常；刷新页面后是否与落盘 JSON 一致。
6. 故意构造非法操作（把区域压到 8px 以下、合并不相邻区域），确认被拦住且提示清楚。
7. 模型配置：填一个可用端点 → 测试连接成功 → 分析可用；改成错误端点 → 测试连接给出明确失败原因；检查 `GET /api/model-config` 的响应里没有明文 Key。

把上述 7 项的实际结果写入 `ui/docs/superpowers/plans/2026-08-11-region-split-walkthrough.md`，包含每张图的模块数、操作次数和发现的问题清单。

- [ ] **Step 4: Commit**

```bash
git add ui/README.md ui/docs/superpowers/plans/2026-08-11-region-split-walkthrough.md
git commit -m "docs: add usage guide and end-to-end walkthrough results"
```

---

## 计划自检记录

**Spec 覆盖**：§2 Y 轴切分 → Task 3；§3.1 预处理 → Task 5；§3.2 候选线检测 → Task 12；§3.3 AI 分段 → Task 4；§3.4 融合修正 → Task 3；§4 数据结构 → Task 1；§4.1 不变量 → Task 1（校验）+ Task 5（写入时执行）；§5.1 布局 → Task 8/9；§5.2 上下文操作条 → Task 9；§5.3 选中 → Task 8/9；§5.4 编辑操作 → Task 2（纯函数）+ Task 9（微调/重命名）+ Task 11（拆分）；§5.5 模型配置 → Task 4（存储）+ Task 6（路由）+ Task 10（对话框）；§5.6 撤销重做 → Task 7；§6 接口 → Task 6；§6.1 存储 → Task 5 + Task 4；§7 选型 → 全程；§8 实施顺序 → Task 1–11 为第一步（`detectCandidateLines` 先占位返回空数组，吸附自然失效），Task 12 为第二步；§9 验收 → Task 13。§10 非目标未出现在任何 Task 中。

**已知取舍**（实现者不必"修复"）：
- `analyze` 覆盖式写入，不进撤销栈的服务端历史；撤销栈只在前端，刷新页面即清空（落盘结果不受影响）。
- 拆分只支持水平切分；左右分栏布局按 spec §2 属于已知限制。
- 候选线检测在 `analyze` 时执行一次并存进文档，人工拆分时复用；不随人工编辑重算。

**类型一致性**：`Region` / `RegionSplitDoc` / `CandidateLine` / `ModelConfig` / `ModelConfigView` 在 Task 1 与 Task 4 定义后，Task 5–12 全部按同名同形使用；`StoreApi` 在 Task 7 一次性定稿（含模型配置三个方法），后续任务只消费不修改；`store.candidateLines` 与 `snapToCandidates` 的阈值常量在服务端 `reconcile` 与前端拆分模式中同为 12。
