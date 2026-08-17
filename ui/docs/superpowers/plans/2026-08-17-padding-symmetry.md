# 内边距对称归拢 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把只差一两个像素的对边内边距抹成同一个值,让 `padding` 的取值种数降下来,同时不碰真正不对称的那些。

**Architecture:** 纯几何后处理,放进 `measureLayout` 内部——服务端检测和前端 `recomputeLayout` 都经过它,一处改动两条路径同时生效,不需要两个调用点。

**Tech Stack:** TypeScript、Vitest。

设计依据:`docs/superpowers/specs/2026-08-17-codegen-and-fidelity-design.md` 第 6.3 节第 2 层。

> **范围说明:** 设计文档原本还有"重复组内部间距强制相等"一层,实测发现三个重复组的中心距最大偏差只有 1.25px、**本来就齐**,没有误差可抹;看着不齐的边距源于子块宽度不同,抹平反而会挪错内容。那一层已在设计文档里划掉,本计划不含它。第 3 层"全页归拢"依赖分组粒度的实测,留待后续。

## Global Constraints

- 基准图 `packages/region-split/test-fixtures/maicai.png`,坐标一律**原图像素**。
- 阈值必须在注释里写明实测依据。测试写死实测数据,不放宽断言。
- `element-cut.ts` 必须保持浏览器安全:只能 `import type` 引 `RawImage`,不得引 sharp。
- 改了 `packages/region-split` 必须重启 API,tsx 不热重载。
- 命令在 `D:\workspace\ui` 下跑;单包测试要 `cd` 进包目录。

---

### Task 1: 对边内边距抹平

**Files:**
- Modify: `packages/region-split/src/element-cut.ts`(`measureLayout` 及其上方)
- Modify: `packages/region-split/src/element-cut.test.ts`

**Interfaces:**
- Consumes: 现有 `LayoutInfo`、`Direction`、`Rect`
- Produces:
  - `export const PADDING_SYMMETRY_TOLERANCE = 8`
  - `export function symmetrizePadding(padding: LayoutInfo["padding"]): LayoutInfo["padding"]`
  - `measureLayout` 的返回值中 `padding` 已经过抹平

- [ ] **Step 1: 写失败的测试**

把下面这段追加到 `packages/region-split/src/element-cut.test.ts` 末尾。若顶部的 import 里还没有 `symmetrizePadding` 和 `PADDING_SYMMETRY_TOLERANCE`,一并加进那一行:

```ts
describe("symmetrizePadding", () => {
  // 实测左右差 0/2/3/4/6 是测量噪声，17/20/40 是真实不对称
  it("averages a pair that differs within tolerance", () => {
    expect(symmetrizePadding({ top: 44, right: 38, bottom: 45, left: 32 }))
      .toEqual({ top: 45, right: 35, bottom: 45, left: 35 });
  });

  it("leaves a genuinely asymmetric pair alone", () => {
    expect(symmetrizePadding({ top: 79, right: 58, bottom: 56, left: 38 }))
      .toEqual({ top: 79, right: 58, bottom: 56, left: 38 });
  });

  // 断层就在 6 与 17 之间，阈值 8 两边都要钉住
  it("takes 8 but not 9", () => {
    expect(symmetrizePadding({ top: 0, right: 54, bottom: 0, left: 46 }))
      .toEqual({ top: 0, right: 50, bottom: 0, left: 50 });
    expect(symmetrizePadding({ top: 0, right: 55, bottom: 0, left: 46 }))
      .toEqual({ top: 0, right: 55, bottom: 0, left: 46 });
    expect(PADDING_SYMMETRY_TOLERANCE).toBe(8);
  });

  // 一半是 0 时不能抹：那是"内容贴着一边"，不是噪声
  it("keeps a zero side as zero", () => {
    expect(symmetrizePadding({ top: 0, right: 0, bottom: 0, left: 6 }))
      .toEqual({ top: 0, right: 0, bottom: 0, left: 6 });
  });

  it("handles the two axes independently", () => {
    expect(symmetrizePadding({ top: 10, right: 40, bottom: 12, left: 12 }))
      .toEqual({ top: 11, right: 40, bottom: 11, left: 12 });
  });
});

describe("measureLayout 的内边距", () => {
  // 左 32 / 右 34 差 2，应当被抹成 33
  it("returns symmetrized padding", () => {
    const layout = measureLayout(
      { x: 0, y: 0, w: 100, h: 50 },
      [{ x: 32, y: 10, w: 15, h: 30 }, { x: 52, y: 10, w: 14, h: 30 }],
      "row",
    );
    expect(layout.padding.left).toBe(33);
    expect(layout.padding.right).toBe(33);
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
cd packages/region-split && pnpm exec vitest run src/element-cut.test.ts
```

Expected: FAIL,`symmetrizePadding is not a function`。

- [ ] **Step 3: 写实现**

在 `packages/region-split/src/element-cut.ts` 里,`measureLayout` 的**上方**插入:

```ts
/**
 * 对边内边距差到多少以内算测量噪声。
 *
 * 实测差值分布是明显双峰的，断层就在中间——
 * 左右差 `0×21 2 3 4 6 | 17 20 40`，上下差 `0×21 1 1 1 3 | 23 41 44`。
 * 取 8：噪声侧最大 6（1.33 倍余量），真实不对称侧最小 17（0.47 倍余量）。
 * 超过 8 的是真的不对称，抹平会把内容挪错位。
 */
export const PADDING_SYMMETRY_TOLERANCE = 8;

/**
 * 把只差一两像素的对边内边距抹成同一个值。
 *
 * 设计稿里的内边距是离散的少数几档，测量值是连续的——同一个卡片量出左 32 右 34
 * 只是抖动，写进 CSS 就成了两个不同的数。两根轴各自独立处理。
 *
 * **一边是 0 时不抹。** 那是"内容贴着这一边"，是真实的单边布局，不是噪声。
 */
export function symmetrizePadding(
  padding: LayoutInfo["padding"],
): LayoutInfo["padding"] {
  const pair = (a: number, b: number): [number, number] => {
    if (a === 0 || b === 0) return [a, b];
    if (Math.abs(a - b) > PADDING_SYMMETRY_TOLERANCE) return [a, b];
    const mean = Math.round((a + b) / 2);
    return [mean, mean];
  };
  const [top, bottom] = pair(padding.top, padding.bottom);
  const [left, right] = pair(padding.left, padding.right);
  return { top, right, bottom, left };
}
```

然后把 `measureLayout` 结尾的 `return` 改成先抹平。原代码:

```ts
  return {
    direction,
    gap: Math.max(0, Math.round(medianOf(gaps))),
    padding: {
      top: Math.max(0, top), right: Math.max(0, right),
      bottom: Math.max(0, bottom), left: Math.max(0, left),
    },
  };
```

改为:

```ts
  return {
    direction,
    gap: Math.max(0, Math.round(medianOf(gaps))),
    padding: symmetrizePadding({
      top: Math.max(0, top), right: Math.max(0, right),
      bottom: Math.max(0, bottom), left: Math.max(0, left),
    }),
  };
```

放在 `measureLayout` 内部而不是调用点,是因为服务端的 `detectElementTree` 和前端的 `recomputeLayout` 都经过它——一处改动两条路径同时生效,不会出现"检测时抹了、人工改完又没抹"的不一致。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd packages/region-split && pnpm test && pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: 全部 PASS,typecheck 无输出。

若 `element-detect.test.ts` 或 `element-layout.test.ts` 里有断言写死了未抹平的 padding,**不要放宽断言**:按新的实测值改数字,并在该测试上方注明"内边距已过对称抹平"。

- [ ] **Step 5: 量一遍效果**

在 `packages/region-split` 目录下建临时脚本 `check.ts`:

```ts
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { detectElementTree } from "./src/element-detect.js";

const P = "../../data/projects/20260813-o11j2v/";
const { data, info } = await sharp(P + "image.clean.png").removeAlpha().raw()
  .toBuffer({ resolveWithObject: true });
const raw = { data, width: info.width, height: info.height, channels: info.channels };
const { regions } = JSON.parse(await readFile(P + "regions.json", "utf8"));
const pads: number[] = [];
for (const r of regions) for (const n of detectElementTree(raw, r.bounds, "now").nodes) {
  if (!n.layout) continue;
  const p = n.layout.padding;
  pads.push(p.top, p.right, p.bottom, p.left);
}
console.log("padding 取值种数：", new Set(pads).size, "／共", pads.length, "个值");
```

```bash
cd packages/region-split && pnpm exec tsx check.ts && rm check.ts
```

Expected: 种数从 **15** 降下来。降幅记进提交信息;若种数没有变化,说明抹平一次也没触发——回头核对阈值和 0 值豁免这两条,不要直接放过。

> 若 `data/projects/20260813-o11j2v/` 不存在(换了机器或清过数据),先在界面上传 `test-fixtures/maicai.png` 跑一次分析,再把脚本里的项目 id 换成新建的那个。

- [ ] **Step 6: 提交**

```bash
git add packages/region-split/src/element-cut.ts packages/region-split/src/element-cut.test.ts
git commit -m "feat: average near-equal opposite paddings"
```

---

## 完成标准

- `pnpm -r test` 全绿,`pnpm -r typecheck` 无输出。
- 基准图上 `padding` 的取值种数低于 15。
- 左 38 / 右 58 这种真实不对称的容器保持原值不变。
