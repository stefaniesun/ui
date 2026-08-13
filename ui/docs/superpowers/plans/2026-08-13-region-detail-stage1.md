# 区域详情面板 · 阶段一 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 选中单个区域后，画布右侧出现「区域详情」节点；上段是区域裁图并叠加容器标注，下段是结构树与元素属性，人工可重命名、改类型、删除、框选新增。

**Architecture:** 顶层容器由连通块检测得出，内部主色占比区分 `component` 与 `image`，全部确定性计算，**不调用模型**。元素树存独立文件 `elements.json`，不触碰 `regions.json` 与区域撤销栈。标注框全部按百分比定位，不做任何 `ResizeObserver` 测量。

**Tech Stack:** TypeScript 5.9.2、Vue 3、Fastify 5、sharp 0.33.5、zod 3.25.76、Vitest 2.1.9、pnpm 10.13.1。

**配套设计文档:** `docs/superpowers/specs/2026-08-13-region-detail-design.md`

## Global Constraints

- 新代码注释用中文，与 `packages/region-split/src/*.ts` 现有风格一致：解释**为什么**，不复述代码做了什么。
- 所有坐标一律**原图坐标**，与 `regions`、`candidateLines`、`panels` 同一坐标系。
- 命令一律用 `D:/nodejs/corepack.cmd pnpm ...`。
- 浏览器侧只能从 `@region-split/core/browser` 导入；该入口绝不可引入 `node:fs`、`sharp`、`fastify`。
- 不修改 `regionSplitDocSchema`、`checkInvariants`、`ProjectStore.writeRegions` 的既有行为。
- 不修改 `apps/region-split-ui/src/state.ts` 的任何既有导出成员。
- 不启用 `PipelineNode` 的端口，不画节点间连线。
- 阈值常量必须命名并附实测依据注释，不得内联魔数。
- 每个任务结束时提交；提交信息用英文祈使句，与现有 git 历史一致。

## 实测常量（来自 `test-fixtures/maicai.png`，1170×2532）

| 常量 | 值 | 依据 |
|---|---|---|
| 页边距取样宽度 | `6` | 左右各 6px 中位色得页面底色 `rgb(245,245,245)` |
| 内容掩膜阈值 | `> 8` | 与底色的最大通道差 |
| 顶层块最小尺寸 | 宽 `80` / 高 `24` | 小于此为噪声 |
| `uniformity` 内缩 | `4` | 避开边框与圆角抗锯齿 |
| 位图判定 | `<= 0.1` | 采购横幅实测 `0.02` |
| 扁平容器 | `>= 0.8` | 白卡片实测 `0.83`–`0.96` |
| 区域可解析最小尺寸 | `32` | 更小的区域没有解析价值 |

---

### Task 1: 元素 Schema、不变量与 regionKey

**Files:**
- Create: `packages/region-split/src/element-types.ts`
- Create: `packages/region-split/src/element-types.test.ts`
- Modify: `packages/region-split/src/browser.ts`
- Modify: `packages/region-split/src/index.ts`

**Interfaces:**
- Consumes: `rectSchema`、`Rect`、`InvariantViolation`（`./types.js`）
- Produces: `elementKinds`、`leafKinds`、`ElementKind`、`ElementNode`、`ElementTree`、`ElementsDoc`、`elementNodeSchema`、`elementTreeSchema`、`elementsDocSchema`、`regionKey(bounds: Rect): string`、`checkElementTreeInvariants(tree: ElementTree, region: Rect): InvariantViolation[]`

- [ ] **Step 1: 编写失败测试**

创建 `packages/region-split/src/element-types.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  checkElementTreeInvariants, elementsDocSchema, regionKey,
  type ElementNode, type ElementTree,
} from "./element-types.js";
import type { Rect } from "./types.js";

const region: Rect = { x: 0, y: 100, w: 400, h: 300 };

function node(over: Partial<ElementNode> & Pick<ElementNode, "id" | "box">): ElementNode {
  return {
    parentId: null, kind: "component", displayName: "节点", style: {},
    uniformity: 1, source: "auto", classification: "tool", ...over,
  };
}

const tree = (nodes: ElementNode[]): ElementTree =>
  ({ regionKey: regionKey(region), detectedAt: "2026-08-13T00:00:00.000Z", nodes });

describe("regionKey", () => {
  it("keys a tree by the region's vertical span", () => {
    expect(regionKey({ x: 0, y: 396, w: 1170, h: 222 })).toBe("396-618");
  });
});

describe("checkElementTreeInvariants", () => {
  it("accepts a well formed tree", () => {
    const root = node({ id: "n1", box: { x: 0, y: 100, w: 400, h: 300 } });
    const child = node({ id: "n2", parentId: "n1", kind: "text", box: { x: 10, y: 110, w: 100, h: 40 } });
    expect(checkElementTreeInvariants(tree([root, child]), region)).toEqual([]);
  });

  it("accepts an empty tree", () => {
    expect(checkElementTreeInvariants(tree([]), region)).toEqual([]);
  });

  it("rejects a root that escapes the region", () => {
    const root = node({ id: "n1", box: { x: 0, y: 100, w: 400, h: 900 } });
    expect(checkElementTreeInvariants(tree([root]), region).map(v => v.code))
      .toContain("root-outside-region");
  });

  it("rejects a child that escapes its parent", () => {
    const root = node({ id: "n1", box: { x: 0, y: 100, w: 200, h: 100 } });
    const child = node({ id: "n2", parentId: "n1", kind: "text", box: { x: 150, y: 110, w: 100, h: 40 } });
    expect(checkElementTreeInvariants(tree([root, child]), region).map(v => v.code))
      .toContain("child-outside-parent");
  });

  it("rejects duplicate ids", () => {
    const a = node({ id: "n1", box: { x: 0, y: 100, w: 100, h: 50 } });
    const b = node({ id: "n1", box: { x: 0, y: 200, w: 100, h: 50 } });
    expect(checkElementTreeInvariants(tree([a, b]), region).map(v => v.code))
      .toContain("duplicate-id");
  });

  it("rejects a missing parent", () => {
    const orphan = node({ id: "n2", parentId: "ghost", box: { x: 0, y: 100, w: 100, h: 50 } });
    expect(checkElementTreeInvariants(tree([orphan]), region).map(v => v.code))
      .toContain("missing-parent");
  });

  it("rejects a parent cycle", () => {
    const a = node({ id: "n1", parentId: "n2", box: { x: 0, y: 100, w: 100, h: 50 } });
    const b = node({ id: "n2", parentId: "n1", box: { x: 0, y: 100, w: 100, h: 50 } });
    expect(checkElementTreeInvariants(tree([a, b]), region).map(v => v.code)).toContain("cycle");
  });

  it("rejects overlapping siblings", () => {
    const root = node({ id: "n1", box: { x: 0, y: 100, w: 400, h: 300 } });
    const a = node({ id: "n2", parentId: "n1", kind: "text", box: { x: 0, y: 100, w: 100, h: 50 } });
    const b = node({ id: "n3", parentId: "n1", kind: "text", box: { x: 50, y: 100, w: 100, h: 50 } });
    expect(checkElementTreeInvariants(tree([root, a, b]), region).map(v => v.code))
      .toContain("sibling-overlap");
  });

  it("rejects children hanging off a leaf", () => {
    const root = node({ id: "n1", kind: "image", box: { x: 0, y: 100, w: 400, h: 300 } });
    const child = node({ id: "n2", parentId: "n1", kind: "text", box: { x: 10, y: 110, w: 50, h: 20 } });
    expect(checkElementTreeInvariants(tree([root, child]), region).map(v => v.code))
      .toContain("leaf-with-children");
  });
});

describe("elementsDocSchema", () => {
  it("defaults an empty tree list", () => {
    expect(elementsDocSchema.parse({ schemaVersion: "1" }).trees).toEqual([]);
  });

  // 阶段二、三的字段现在就定义好，避免以后改 schema 破坏已存的文件
  it("accepts stage two and three fields", () => {
    const parsed = elementNodeSchemaCheck();
    expect(parsed.scrollX).toBe(false);
    expect(parsed.positioning).toBe("flow");
  });
});

function elementNodeSchemaCheck() {
  const { elementNodeSchema } = require("./element-types.js") as typeof import("./element-types.js");
  return elementNodeSchema.parse({
    id: "n1", parentId: null, box: { x: 0, y: 0, w: 10, h: 10 },
    kind: "component", displayName: "x", uniformity: 1,
  });
}
```

把最后那个 `require` 改成顶部 import 更干净——在文件顶部的 import 里加上 `elementNodeSchema`，然后把 `elementNodeSchemaCheck` 改成直接调用 `elementNodeSchema.parse(...)` 的普通函数。

- [ ] **Step 2: 运行测试确认红灯**

Run:

```powershell
D:/nodejs/corepack.cmd pnpm --filter @region-split/core test -- src/element-types.test.ts
```

Expected: FAIL，报找不到 `./element-types.js`。

- [ ] **Step 3: 实现 `element-types.ts`**

```ts
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
```

- [ ] **Step 4: 从两个入口导出**

`browser.ts` 与 `index.ts` 各在 `export * from "./reconcile.js";` 之后加一行：

```ts
export * from "./element-types.js";
```

`element-types.ts` 只依赖 `zod` 和 `./types.js`，进浏览器入口是安全的。

- [ ] **Step 5: 运行测试确认绿灯**

Run:

```powershell
D:/nodejs/corepack.cmd pnpm --filter @region-split/core test -- src/element-types.test.ts
D:/nodejs/corepack.cmd pnpm --filter @region-split/core typecheck
```

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```powershell
git add packages/region-split/src/element-types.ts packages/region-split/src/element-types.test.ts packages/region-split/src/browser.ts packages/region-split/src/index.ts
git commit -m "feat: add element tree schema and invariants"
```

---

### Task 2: 顶层容器检测

**Files:**
- Create: `packages/region-split/src/element-detect.ts`
- Create: `packages/region-split/src/element-detect.test.ts`
- 已存在: `packages/region-split/test-fixtures/maicai.png`

**Interfaces:**
- Consumes: `RawImage`（`./panels.js`）、`Rect`（`./types.js`）、`ElementNode`、`ElementTree`、`regionKey`
- Produces: `Rgb`、`CONTENT_THRESHOLD`、`IMAGE_UNIFORMITY_MAX`、`FLAT_UNIFORMITY_MIN`、`regionBackground(raw, rect): Rgb`、`uniformity(raw, rect, inset?): { fill: Rgb; ratio: number }`、`connectedBoxes(raw, rect, background): Rect[]`、`toHex(color: Rgb): string`、`detectTopLevel(raw: RawImage, region: Rect, now: string): ElementTree`

- [ ] **Step 1: 编写失败测试**

创建 `packages/region-split/src/element-detect.test.ts`：

```ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  connectedBoxes, detectTopLevel, regionBackground, toHex, uniformity,
} from "./element-detect.js";
import { checkElementTreeInvariants } from "./element-types.js";
import type { RawImage } from "./panels.js";
import type { Rect } from "./types.js";

const NOW = "2026-08-13T00:00:00.000Z";

async function raw(image: sharp.Sharp): Promise<RawImage> {
  const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** 灰底上两张白卡片 */
const page = () =>
  sharp({ create: { width: 200, height: 300, channels: 3, background: "#f5f5f5" } })
    .composite([
      { input: { create: { width: 160, height: 80, channels: 3, background: "#ffffff" } }, top: 20, left: 20 },
      { input: { create: { width: 160, height: 80, channels: 3, background: "#ffffff" } }, top: 160, left: 20 },
    ]).png();

async function noiseImage(width: number, height: number): Promise<Buffer> {
  const bytes = Buffer.alloc(width * height * 3);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 97) % 256;
  return sharp(bytes, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

describe("toHex", () => {
  it("formats a colour as lowercase hex", () => {
    expect(toHex([255, 255, 255])).toBe("#ffffff");
    expect(toHex([245, 246, 250])).toBe("#f5f6fa");
  });
});

describe("regionBackground", () => {
  it("reads the page colour from the left and right margins", async () => {
    expect(regionBackground(await raw(page()), { x: 0, y: 0, w: 200, h: 300 }))
      .toEqual([245, 245, 245]);
  });
});

describe("uniformity", () => {
  it("returns 1 for a flat rectangle", async () => {
    const result = uniformity(await raw(page()), { x: 20, y: 20, w: 160, h: 80 });
    expect(result.fill).toEqual([255, 255, 255]);
    expect(result.ratio).toBeCloseTo(1, 2);
  });

  it("returns a low ratio for noisy content", async () => {
    const image = await raw(sharp(await noiseImage(60, 60)));
    expect(uniformity(image, { x: 0, y: 0, w: 60, h: 60 }).ratio).toBeLessThan(0.1);
  });
});

describe("connectedBoxes", () => {
  it("finds each card as its own box", async () => {
    expect(connectedBoxes(await raw(page()), { x: 0, y: 0, w: 200, h: 300 }, [245, 245, 245]))
      .toEqual([
        { x: 20, y: 20, w: 160, h: 80 },
        { x: 20, y: 160, w: 160, h: 80 },
      ]);
  });

  it("drops blocks below the minimum size", async () => {
    const image = await raw(
      sharp({ create: { width: 200, height: 100, channels: 3, background: "#f5f5f5" } })
        .composite([{
          input: { create: { width: 20, height: 10, channels: 3, background: "#000000" } },
          top: 10, left: 10,
        }]).png());
    expect(connectedBoxes(image, { x: 0, y: 0, w: 200, h: 100 }, [245, 245, 245])).toEqual([]);
  });
});

describe("detectTopLevel", () => {
  const region: Rect = { x: 0, y: 0, w: 200, h: 300 };

  it("produces a flat tree of containers", async () => {
    const tree = detectTopLevel(await raw(page()), region, NOW);
    expect(tree.regionKey).toBe("0-300");
    expect(tree.detectedAt).toBe(NOW);
    expect(tree.nodes).toHaveLength(2);
    expect(tree.nodes.every(node => node.parentId === null)).toBe(true);
    expect(checkElementTreeInvariants(tree, region)).toEqual([]);
  });

  it("records the flat container background", async () => {
    const tree = detectTopLevel(await raw(page()), region, NOW);
    expect(tree.nodes[0]!.kind).toBe("component");
    expect(tree.nodes[0]!.style.background).toBe("#ffffff");
  });

  // 内部主色占比一个数就把 <div> 和 <img> 分开：实测白卡片 0.83–0.96，位图 0.02
  it("marks a raster block as an image leaf", async () => {
    const image = await raw(
      sharp({ create: { width: 300, height: 200, channels: 3, background: "#f5f5f5" } })
        .composite([{ input: await noiseImage(200, 120), top: 40, left: 50 }]).png());
    const tree = detectTopLevel(image, { x: 0, y: 0, w: 300, h: 200 }, NOW);
    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodes[0]!.kind).toBe("image");
    expect(tree.nodes[0]!.style.background).toBeUndefined();
  });

  it("returns no nodes for a blank region", async () => {
    const image = await raw(
      sharp({ create: { width: 200, height: 100, channels: 3, background: "#f5f5f5" } }).png());
    expect(detectTopLevel(image, { x: 0, y: 0, w: 200, h: 100 }, NOW).nodes).toEqual([]);
  });

  it("gives every node a placeholder name", async () => {
    const tree = detectTopLevel(await raw(page()), region, NOW);
    expect(tree.nodes.every(node => node.displayName.length > 0)).toBe(true);
    expect(tree.nodes.every(node => node.source === "auto")).toBe(true);
  });
});

// 真实截图回归：这些数值是这套算法唯一的事实基准，不得为了让测试变绿而放宽
describe("real screenshot", () => {
  const FIXTURE = join(import.meta.dirname, "..", "test-fixtures", "maicai.png");
  const fixture = async (): Promise<RawImage> => {
    const { data, info } = await sharp(FIXTURE).removeAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: info.channels };
  };

  it("frames the common-service card exactly", async () => {
    const tree = detectTopLevel(await fixture(), { x: 0, y: 1131, w: 1170, h: 255 }, NOW);
    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodes[0]!.box).toEqual({ x: 36, y: 1131, w: 1098, h: 255 });
    expect(tree.nodes[0]!.kind).toBe("component");
  });

  it("frames the card-wallet card exactly", async () => {
    const tree = detectTopLevel(await fixture(), { x: 0, y: 396, w: 1170, h: 222 }, NOW);
    expect(tree.nodes[0]!.box).toEqual({ x: 36, y: 396, w: 1098, h: 222 });
  });

  it("treats the promotional banner as an image", async () => {
    const image = await fixture();
    expect(uniformity(image, { x: 36, y: 1413, w: 1098, h: 216 }).ratio).toBeLessThan(0.1);
    const tree = detectTopLevel(image, { x: 0, y: 1413, w: 1170, h: 216 }, NOW);
    expect(tree.nodes[0]!.kind).toBe("image");
  });

  it("finds three separate coupon cards", async () => {
    const tree = detectTopLevel(await fixture(), { x: 0, y: 921, w: 1170, h: 183 }, NOW);
    expect(tree.nodes).toHaveLength(3);
    expect(tree.nodes.map(node => node.box.x)).toEqual([36, 459, 882]);
  });

  // 已知失败面：白底连白底会并块。如实断言，不要假装不存在——
  // 拆开它是阶段二递归切分的事，阶段一由人工框选处理。
  it("merges the product grid with the tab bar, as expected at this stage", async () => {
    const tree = detectTopLevel(await fixture(), { x: 0, y: 1937, w: 1170, h: 595 }, NOW);
    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodes[0]!.box.h).toBeGreaterThan(500);
  });
});
```

- [ ] **Step 2: 运行测试确认红灯**

Run:

```powershell
D:/nodejs/corepack.cmd pnpm --filter @region-split/core test -- src/element-detect.test.ts
```

Expected: FAIL，报找不到 `./element-detect.js`。

- [ ] **Step 3: 实现 `element-detect.ts`**

```ts
import { regionKey, type ElementNode, type ElementTree } from "./element-types.js";
import type { RawImage } from "./panels.js";
import type { Rect } from "./types.js";

export type Rgb = [number, number, number];

/** 页边距取样宽度。实测左右各 6px 的中位色即页面底色 rgb(245,245,245)。 */
const MARGIN_WIDTH = 6;
/** 与底色的最大通道差超过它就算内容。实测能把白卡片从浅灰底上分出来。 */
export const CONTENT_THRESHOLD = 8;
/** uniformity 的内缩量，避开容器自身的边框和圆角抗锯齿。 */
const UNIFORM_INSET = 4;
/** 小于这个尺寸的连通块是噪声。 */
const MIN_BOX_WIDTH = 80;
const MIN_BOX_HEIGHT = 24;
/** 内部主色占比低于它就是整块位图。实测采购横幅 0.02。 */
export const IMAGE_UNIFORMITY_MAX = 0.1;
/** 高于它就是扁平底色容器，记下 background。实测白卡片下限 0.83。 */
export const FLAT_UNIFORMITY_MIN = 0.8;

export function toHex(color: Rgb): string {
  return `#${color.map(v => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

function medianOfChannel(values: Uint8Array, count: number): number {
  return values.slice(0, count).sort()[Math.floor(count / 2)]!;
}

/**
 * 收集矩形内像素的三通道，返回中位色与"与中位色一致"的像素占比。
 * 用 TypedArray 而不是元组数组：整块区域可能有数百万像素，
 * 每像素分配一个数组会把内存打爆。
 */
function sampleFill(
  raw: RawImage, x0: number, x1: number, y0: number, y1: number,
): { fill: Rgb; ratio: number } {
  const count = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  if (count === 0) return { fill: [0, 0, 0], ratio: 0 };
  const channels = [new Uint8Array(count), new Uint8Array(count), new Uint8Array(count)];
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * raw.width + x) * raw.channels;
      channels[0]![n] = raw.data[i]!;
      channels[1]![n] = raw.data[i + 1]!;
      channels[2]![n] = raw.data[i + 2]!;
      n++;
    }
  }
  const fill = channels.map(channel => medianOfChannel(channel, count)) as Rgb;
  let same = 0;
  for (let k = 0; k < count; k++) {
    const distance = Math.max(
      Math.abs(channels[0]![k]! - fill[0]),
      Math.abs(channels[1]![k]! - fill[1]),
      Math.abs(channels[2]![k]! - fill[2]),
    );
    if (distance <= CONTENT_THRESHOLD) same++;
  }
  return { fill, ratio: same / count };
}

/** 区域左右页边距的代表色 */
export function regionBackground(raw: RawImage, rect: Rect): Rgb {
  const span = Math.min(MARGIN_WIDTH, Math.max(1, Math.floor(rect.w / 4)));
  const count = span * 2 * rect.h;
  const channels = [new Uint8Array(count), new Uint8Array(count), new Uint8Array(count)];
  let n = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let d = 0; d < span; d++) {
      for (const x of [rect.x + d, rect.x + rect.w - 1 - d]) {
        const i = (y * raw.width + x) * raw.channels;
        channels[0]![n] = raw.data[i]!;
        channels[1]![n] = raw.data[i + 1]!;
        channels[2]![n] = raw.data[i + 2]!;
        n++;
      }
    }
  }
  return channels.map(channel => medianOfChannel(channel, n)) as Rgb;
}

/**
 * 内部主色与其占比。这是区分"扁平容器"和"整块位图"的判别量：
 * 实测白卡片 0.83–0.96，采购横幅 0.02，混合内容约 0.64。
 */
export function uniformity(
  raw: RawImage, rect: Rect, inset = UNIFORM_INSET,
): { fill: Rgb; ratio: number } {
  return sampleFill(
    raw,
    rect.x + inset, rect.x + rect.w - inset,
    rect.y + inset, rect.y + rect.h - inset,
  );
}

/** 与底色不同的像素的四连通块外接矩形，按从上到下、从左到右排序 */
export function connectedBoxes(raw: RawImage, rect: Rect, background: Rgb): Rect[] {
  const { w, h } = rect;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((rect.y + y) * raw.width + (rect.x + x)) * raw.channels;
      const distance = Math.max(
        Math.abs(raw.data[i]! - background[0]),
        Math.abs(raw.data[i + 1]! - background[1]),
        Math.abs(raw.data[i + 2]! - background[2]),
      );
      if (distance > CONTENT_THRESHOLD) mask[y * w + x] = 1;
    }
  }

  const seen = new Uint8Array(w * h);
  const boxes: Rect[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || seen[start] === 1) continue;
    let minX = w, maxX = -1, minY = h, maxY = -1;
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % w;
      const y = (index - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const neighbours = [
        x > 0 ? index - 1 : -1,
        x < w - 1 ? index + 1 : -1,
        y > 0 ? index - w : -1,
        y < h - 1 ? index + w : -1,
      ];
      for (const next of neighbours) {
        if (next >= 0 && mask[next] === 1 && seen[next] === 0) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    const box: Rect = {
      x: rect.x + minX, y: rect.y + minY, w: maxX - minX + 1, h: maxY - minY + 1,
    };
    if (box.w >= MIN_BOX_WIDTH && box.h >= MIN_BOX_HEIGHT) boxes.push(box);
  }
  return boxes.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * 阶段一只产出顶层容器，是一棵扁平的树（全部 parentId 为 null）。
 * 递归切分留到阶段二——先把界面跑通，再加深算法。
 */
export function detectTopLevel(raw: RawImage, region: Rect, now: string): ElementTree {
  const background = regionBackground(raw, region);
  const nodes: ElementNode[] = connectedBoxes(raw, region, background).map((box, index) => {
    const { fill, ratio } = uniformity(raw, box);
    const isImage = ratio <= IMAGE_UNIFORMITY_MAX;
    return {
      id: `n${index + 1}`,
      parentId: null,
      box,
      kind: isImage ? "image" : "component",
      displayName: `节点 ${index + 1}`,
      style: ratio >= FLAT_UNIFORMITY_MIN ? { background: toHex(fill) } : {},
      uniformity: ratio,
      source: "auto",
      classification: "tool",
      scrollX: false,
      scrollY: false,
      positioning: "flow",
    };
  });
  return { regionKey: regionKey(region), detectedAt: now, nodes };
}
```

- [ ] **Step 4: 运行测试确认绿灯**

Run:

```powershell
D:/nodejs/corepack.cmd pnpm --filter @region-split/core test -- src/element-detect.test.ts
D:/nodejs/corepack.cmd pnpm --filter @region-split/core typecheck
```

Expected: 全部 PASS。

真实截图那几条若不通过，先判断是**实现有 bug** 还是**断言写错了**：把该区域检测出的 box 打印出来与本计划顶部的实测常量表核对。**不要为了让测试变绿而放宽数值**。

- [ ] **Step 5: 从服务端入口导出**

`packages/region-split/src/index.ts` 末尾追加：

```ts
export * from "./element-detect.js";
```

不要加进 `browser.ts`——调用方需要 `sharp` 才能构造 `RawImage`，浏览器侧用不到。

- [ ] **Step 6: 提交**

```powershell
git add packages/region-split/test-fixtures/maicai.png packages/region-split/src/element-detect.ts packages/region-split/src/element-detect.test.ts packages/region-split/src/index.ts
git commit -m "feat: detect top level containers in a region"
```

---

### Task 3: 持久化与检测编排

**Files:**
- Modify: `packages/region-split/src/store.ts`
- Modify: `packages/region-split/src/store.test.ts`
- Create: `packages/region-split/src/analyze-elements.ts`
- Create: `packages/region-split/src/analyze-elements.test.ts`
- Modify: `packages/region-split/src/index.ts`

**Interfaces:**
- Produces: `ProjectStore.elementsPath`、`readElements`、`readElementTree(projectId, key)`、`writeElementTree(projectId, tree, region)`、`MIN_ANALYZABLE_SIZE`、`detectElements(deps: { store: ProjectStore }, projectId: string, region: Rect): Promise<ElementTree>`

- [ ] **Step 1: 编写 store 失败测试**

在 `packages/region-split/src/store.test.ts` 末尾追加。该文件顶部已有 `freshStore()` 与 `doc()` 两个辅助，复用它们：

```ts
describe("element trees", () => {
  const region = { x: 0, y: 100, w: 375, h: 200 };
  const seeded = () => {
    const store = freshStore();
    store.writeDoc("p1", doc());
    return store;
  };
  const tree = (nodes: ElementNode[]): ElementTree =>
    ({ regionKey: regionKey(region), detectedAt: "2026-08-13T00:00:00.000Z", nodes });
  const root: ElementNode = {
    id: "n1", parentId: null, box: { x: 0, y: 100, w: 375, h: 200 },
    kind: "component", displayName: "根", style: {}, uniformity: 1,
    source: "auto", classification: "tool",
    scrollX: false, scrollY: false, positioning: "flow",
  };

  it("returns null before anything has been detected", () => {
    expect(seeded().readElementTree("p1", regionKey(region))).toBeNull();
  });

  it("round trips a tree", () => {
    const store = seeded();
    store.writeElementTree("p1", tree([root]), region);
    expect(store.readElementTree("p1", regionKey(region))!.nodes).toHaveLength(1);
  });

  it("replaces the tree for the same region key", () => {
    const store = seeded();
    store.writeElementTree("p1", tree([root]), region);
    store.writeElementTree("p1", tree([{ ...root, displayName: "改过" }]), region);
    const stored = store.readElements("p1");
    expect(stored.trees).toHaveLength(1);
    expect(stored.trees[0]!.nodes[0]!.displayName).toBe("改过");
  });

  it("keeps trees for different regions side by side", () => {
    const store = seeded();
    const other = { x: 0, y: 300, w: 375, h: 100 };
    store.writeElementTree("p1", tree([root]), region);
    store.writeElementTree("p1", {
      regionKey: regionKey(other), detectedAt: "2026-08-13T00:00:00.000Z",
      nodes: [{ ...root, box: { x: 0, y: 300, w: 375, h: 100 } }],
    }, other);
    expect(store.readElements("p1").trees).toHaveLength(2);
  });

  it("refuses a tree that violates an invariant", () => {
    const store = seeded();
    expect(() => store.writeElementTree(
      "p1", tree([{ ...root, box: { x: 0, y: 100, w: 375, h: 900 } }]), region,
    )).toThrow(/invariant/);
  });
});
```

文件顶部 import 补上：

```ts
import { regionKey, type ElementNode, type ElementTree } from "./element-types.js";
```

- [ ] **Step 2: 编写编排失败测试**

创建 `packages/region-split/src/analyze-elements.test.ts`：

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { createProject } from "./analyze.js";
import { detectElements } from "./analyze-elements.js";
import { ProjectStore } from "./store.js";

async function seeded() {
  const store = new ProjectStore(mkdtempSync(join(tmpdir(), "rs-el-")));
  const buffer = await sharp({
    create: { width: 400, height: 300, channels: 3, background: "#f5f5f5" },
  }).composite([
    { input: { create: { width: 340, height: 140, channels: 3, background: "#ffffff" } }, top: 30, left: 30 },
  ]).png().toBuffer();
  const { projectId } = await createProject({ store }, { fileName: "s.png", buffer });
  return { store, projectId };
}

const REGION = { x: 0, y: 0, w: 400, h: 300 };

describe("detectElements", () => {
  it("produces and persists a tree", async () => {
    const { store, projectId } = await seeded();
    const tree = await detectElements({ store }, projectId, REGION);
    expect(tree.nodes).toHaveLength(1);
    expect(store.readElementTree(projectId, "0-300")!.nodes).toHaveLength(1);
  });

  it("re-detecting replaces the previous tree", async () => {
    const { store, projectId } = await seeded();
    await detectElements({ store }, projectId, REGION);
    await detectElements({ store }, projectId, REGION);
    expect(store.readElements(projectId).trees).toHaveLength(1);
  });

  it("refuses a region that is too small", async () => {
    const { store, projectId } = await seeded();
    await expect(detectElements({ store }, projectId, { x: 0, y: 0, w: 20, h: 20 }))
      .rejects.toThrow(/too small/);
  });
});
```

- [ ] **Step 3: 运行测试确认红灯**

Run:

```powershell
D:/nodejs/corepack.cmd pnpm --filter @region-split/core test -- src/store.test.ts src/analyze-elements.test.ts
```

Expected: FAIL。

- [ ] **Step 4: 在 `store.ts` 中实现**

补充 import：

```ts
import {
  checkElementTreeInvariants, elementsDocSchema,
  type ElementsDoc, type ElementTree,
} from "./element-types.js";
import type { Rect } from "./types.js";
```

在 `private docPath(...)` 之后追加：

```ts
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
```

- [ ] **Step 5: 实现 `analyze-elements.ts`**

```ts
import sharp from "sharp";
import { ensureCleanImage } from "./analyze.js";
import { detectTopLevel } from "./element-detect.js";
import type { ElementTree } from "./element-types.js";
import type { ProjectStore } from "./store.js";
import type { Rect } from "./types.js";

/** 小于这个尺寸的区域没有解析价值 */
export const MIN_ANALYZABLE_SIZE = 32;

export async function detectElements(
  deps: { store: ProjectStore },
  projectId: string,
  region: Rect,
): Promise<ElementTree> {
  if (region.w < MIN_ANALYZABLE_SIZE || region.h < MIN_ANALYZABLE_SIZE) {
    throw new Error("region is too small to analyse");
  }
  const { store } = deps;
  // 用清理图：模型和人工都不该再看到手机系统外壳
  await ensureCleanImage(store, projectId);
  const { data, info } = await sharp(store.cleanImagePath(projectId))
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const tree = detectTopLevel(
    { data, width: info.width, height: info.height, channels: info.channels },
    region, new Date().toISOString(),
  );
  return store.writeElementTree(projectId, tree, region);
}
```

- [ ] **Step 6: 运行测试确认绿灯并导出**

`packages/region-split/src/index.ts` 末尾追加：

```ts
export * from "./analyze-elements.js";
```

Run:

```powershell
D:/nodejs/corepack.cmd pnpm --filter @region-split/core test
D:/nodejs/corepack.cmd pnpm --filter @region-split/core typecheck
```

Expected: 全部 PASS。

- [ ] **Step 7: 提交**

```powershell
git add packages/region-split/src/store.ts packages/region-split/src/store.test.ts packages/region-split/src/analyze-elements.ts packages/region-split/src/analyze-elements.test.ts packages/region-split/src/index.ts
git commit -m "feat: persist and orchestrate element detection"
```

---

### Task 4: 服务端路由

**Files:**
- Modify: `packages/region-split/src/server.ts`
- Modify: `packages/region-split/src/server.test.ts`

**Interfaces:**
- Produces: `GET /api/projects/:projectId/elements?y=&h=`、`POST /api/projects/:projectId/elements/detect`、`PUT /api/projects/:projectId/elements`

- [ ] **Step 1: 编写失败测试**

在 `packages/region-split/src/server.test.ts` 末尾追加。该文件顶部已有 `makeApp()` 与 `upload(app)`，`upload` 建的测试图是 375×400：

```ts
describe("element routes", () => {
  async function project() {
    const { app } = makeApp();
    const created = await upload(app);
    return { app, projectId: created.json().projectId as string };
  }
  const REGION = { x: 0, y: 0, w: 375, h: 400 };
  const node = (over: Record<string, unknown>) => ({
    parentId: null, kind: "component", displayName: "x", style: {},
    uniformity: 1, source: "manual", classification: "human",
    scrollX: false, scrollY: false, positioning: "flow", ...over,
  });

  it("returns null before detection", async () => {
    const { app, projectId } = await project();
    const res = await app.inject({
      method: "GET", url: `/api/projects/${projectId}/elements?y=0&h=400`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tree).toBeNull();
  });

  it("404s for an unknown project", async () => {
    const { app } = makeApp();
    const res = await app.inject({
      method: "POST", url: "/api/projects/ghost/elements/detect", payload: { region: REGION },
    });
    expect(res.statusCode).toBe(404);
  });

  it("detects and then reads back a tree", async () => {
    const { app, projectId } = await project();
    const detect = await app.inject({
      method: "POST", url: `/api/projects/${projectId}/elements/detect`, payload: { region: REGION },
    });
    expect(detect.statusCode).toBe(200);
    const read = await app.inject({
      method: "GET", url: `/api/projects/${projectId}/elements?y=0&h=400`,
    });
    expect(read.json().tree.regionKey).toBe("0-400");
  });

  // 检测不依赖模型配置：没配模型也必须拿得到层级
  it("detects without a configured model", async () => {
    const { app } = makeApp(undefined, false);
    const created = await upload(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${created.json().projectId}/elements/detect`,
      payload: { region: REGION },
    });
    expect(res.statusCode).toBe(200);
  });

  it("saves an edited tree", async () => {
    const { app, projectId } = await project();
    const res = await app.inject({
      method: "PUT", url: `/api/projects/${projectId}/elements`,
      payload: {
        region: REGION,
        tree: {
          regionKey: "0-400", detectedAt: "2026-08-13T00:00:00.000Z",
          nodes: [node({ id: "n1", box: { x: 0, y: 0, w: 50, h: 50 } })],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tree.nodes).toHaveLength(1);
  });

  it("422s a tree whose child escapes its parent", async () => {
    const { app, projectId } = await project();
    const res = await app.inject({
      method: "PUT", url: `/api/projects/${projectId}/elements`,
      payload: {
        region: REGION,
        tree: {
          regionKey: "0-400", detectedAt: "2026-08-13T00:00:00.000Z",
          nodes: [
            node({ id: "n1", box: { x: 0, y: 0, w: 50, h: 50 } }),
            node({ id: "n2", parentId: "n1", kind: "text", box: { x: 40, y: 0, w: 50, h: 50 } }),
          ],
        },
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it("400s a region smaller than the minimum", async () => {
    const { app, projectId } = await project();
    const res = await app.inject({
      method: "POST", url: `/api/projects/${projectId}/elements/detect`,
      payload: { region: { x: 0, y: 0, w: 10, h: 10 } },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

`makeApp` 的签名是 `makeApp(m: SegmentModel = model(), configured = true)`，所以第四条用 `makeApp(undefined, false)` 造未配置模型的实例。

- [ ] **Step 2: 运行测试确认红灯**

Run:

```powershell
D:/nodejs/corepack.cmd pnpm --filter @region-split/core test -- src/server.test.ts
```

Expected: FAIL，元素路由全部 404。

- [ ] **Step 3: 在 `server.ts` 中实现**

补充 import：

```ts
import { MIN_ANALYZABLE_SIZE, detectElements } from "./analyze-elements.js";
import { elementTreeSchema, regionKey } from "./element-types.js";
import type { Rect } from "./types.js";
```

在图片路由之前插入：

```ts
  app.get<{ Params: ProjectParams; Querystring: { y?: string; h?: string } }>(
    "/api/projects/:projectId/elements", async (req, reply) => {
      const { projectId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      const y = Number(req.query.y);
      const h = Number(req.query.h);
      if (!Number.isInteger(y) || !Number.isInteger(h)) {
        return reply.code(400).send({ error: "invalid region" });
      }
      // 没解析过返回 null 而不是 404：这是正常状态，不是错误。
      // 键只由纵向跨度决定，x/w 传 0 是刻意的。
      return { tree: store.readElementTree(projectId, regionKey({ x: 0, y, w: 0, h })) };
    });

  app.post<{ Params: ProjectParams; Body: { region: Rect } }>(
    "/api/projects/:projectId/elements/detect", async (req, reply) => {
      const { projectId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      const region = req.body?.region;
      if (!region || region.w < MIN_ANALYZABLE_SIZE || region.h < MIN_ANALYZABLE_SIZE) {
        return reply.code(400).send({ error: "region is too small to analyse" });
      }
      // 检测是纯本地像素计算，不需要模型配置——没配模型也该拿得到层级。
      try {
        return { tree: await detectElements({ store }, projectId, region) };
      } catch (err) {
        return reply.code(502).send({ error: (err as Error).message });
      }
    });

  app.put<{ Params: ProjectParams; Body: { region: Rect; tree: unknown } }>(
    "/api/projects/:projectId/elements", async (req, reply) => {
      const { projectId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      const parsed = elementTreeSchema.safeParse(req.body?.tree);
      if (!parsed.success || !req.body?.region) {
        return reply.code(422).send({ error: "invalid element tree" });
      }
      try {
        return { tree: store.writeElementTree(projectId, parsed.data, req.body.region) };
      } catch (err) {
        return reply.code(422).send({ error: (err as Error).message });
      }
    });
```

- [ ] **Step 4: 运行测试确认绿灯**

Run:

```powershell
D:/nodejs/corepack.cmd pnpm --filter @region-split/core test
D:/nodejs/corepack.cmd pnpm --filter @region-split/core typecheck
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```powershell
git add packages/region-split/src/server.ts packages/region-split/src/server.test.ts
git commit -m "feat: add element tree routes"
```

---

### Task 5: 前端 API 与元素 store

**Files:**
- Modify: `apps/region-split-ui/src/api.ts`
- Create: `apps/region-split-ui/src/element-state.ts`
- Create: `apps/region-split-ui/src/element-state.test.ts`

**Interfaces:**
- Produces: `StoreApi.getElements/detectElements/putElements`、`regionImageUrl(projectId, region)`、`createElementStore(api: StoreApi): ElementStore`

`element-state.ts` 是**独立的 store**，不动 `state.ts` 的任何既有成员。

- [ ] **Step 1: 扩展 `api.ts`**

类型 import 改为：

```ts
import type {
  ElementTree, ModelConfigView, Rect, Region, RegionSplitDoc,
} from "@region-split/core/browser";
```

`StoreApi` 接口追加：

```ts
  getElements(projectId: string, y: number, h: number): Promise<{ tree: ElementTree | null }>;
  detectElements(projectId: string, region: Rect): Promise<{ tree: ElementTree }>;
  putElements(projectId: string, region: Rect, tree: ElementTree): Promise<{ tree: ElementTree }>;
```

`httpApi` 追加实现：

```ts
  getElements(projectId, y, h) {
    return json(`/api/projects/${projectId}/elements?y=${y}&h=${h}`);
  },
  detectElements(projectId, region) {
    return json(`/api/projects/${projectId}/elements/detect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ region }),
    });
  },
  putElements(projectId, region, tree) {
    return json(`/api/projects/${projectId}/elements`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ region, tree }),
    });
  },
```

文件末尾追加：

```ts
/** 区域裁图。服务端的 image 路由已支持 rect 查询参数。 */
export function regionImageUrl(projectId: string, region: Rect): string {
  return `/api/projects/${projectId}/image?rect=${region.x},${region.y},${region.w},${region.h}`;
}
```

- [ ] **Step 2: 编写失败测试**

创建 `apps/region-split-ui/src/element-state.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import { createElementStore } from "./element-state.js";
import type { StoreApi } from "./api.js";
import type { ElementNode, ElementTree, Rect } from "@region-split/core/browser";

const REGION: Rect = { x: 0, y: 0, w: 400, h: 300 };

function node(over: Partial<ElementNode> & Pick<ElementNode, "id">): ElementNode {
  return {
    parentId: null, box: { x: 0, y: 0, w: 100, h: 100 }, kind: "component",
    displayName: "节点", style: {}, uniformity: 1, source: "auto",
    classification: "tool", scrollX: false, scrollY: false, positioning: "flow", ...over,
  };
}
const tree = (nodes: ElementNode[]): ElementTree =>
  ({ regionKey: "0-300", detectedAt: "2026-08-13T00:00:00.000Z", nodes });

function fakeApi(over: Partial<StoreApi> = {}): StoreApi {
  return {
    upload: vi.fn(), getProject: vi.fn(), putRegions: vi.fn(), analyze: vi.fn(),
    renameAi: vi.fn(), getModelConfig: vi.fn(),
    getElements: vi.fn(async () => ({ tree: null })),
    detectElements: vi.fn(async () => ({ tree: tree([node({ id: "n1" })]) })),
    putElements: vi.fn(async (_id, _region, next) => ({ tree: next })),
    ...over,
  } as unknown as StoreApi;
}
const loaded = (nodes: ElementNode[]) =>
  fakeApi({ getElements: vi.fn(async () => ({ tree: tree(nodes) })) });

describe("createElementStore", () => {
  it("starts empty", () => {
    const store = createElementStore(fakeApi());
    expect(store.tree.value).toBeNull();
    expect(store.busy.value).toBe(false);
    expect(store.selectedNode.value).toBeNull();
  });

  it("loads an existing tree", async () => {
    const store = createElementStore(loaded([node({ id: "n1" })]));
    await store.load("p1", REGION);
    expect(store.tree.value!.nodes).toHaveLength(1);
  });

  it("clears the tree when the region has none", async () => {
    const store = createElementStore(fakeApi());
    await store.load("p1", REGION);
    expect(store.tree.value).toBeNull();
  });

  it("detects a tree", async () => {
    const store = createElementStore(fakeApi());
    await store.detect("p1", REGION);
    expect(store.tree.value!.nodes).toHaveLength(1);
  });

  it("exposes the selected node", async () => {
    const store = createElementStore(loaded([node({ id: "n1", displayName: "卡片" })]));
    await store.load("p1", REGION);
    store.select("n1");
    expect(store.selectedNode.value!.displayName).toBe("卡片");
  });

  it("renames a node", async () => {
    const store = createElementStore(loaded([node({ id: "n1" })]));
    await store.load("p1", REGION);
    await store.rename("p1", REGION, "n1", "购物车");
    expect(store.tree.value!.nodes[0]!.displayName).toBe("购物车");
  });

  it("changes a kind and marks it human", async () => {
    const store = createElementStore(loaded([node({ id: "n1" })]));
    await store.load("p1", REGION);
    await store.setKind("p1", REGION, "n1", "text");
    expect(store.tree.value!.nodes[0]!.kind).toBe("text");
    expect(store.tree.value!.nodes[0]!.classification).toBe("human");
  });

  // 删除一层是最常见的修正动作：子节点上提到父节点，不能级联删掉
  it("lifts children to the grandparent when a node is removed", async () => {
    const store = createElementStore(loaded([
      node({ id: "n1" }),
      node({ id: "n2", parentId: "n1" }),
      node({ id: "n3", parentId: "n2" }),
    ]));
    await store.load("p1", REGION);
    await store.removeNode("p1", REGION, "n2");
    expect(store.tree.value!.nodes.map(item => item.id)).toEqual(["n1", "n3"]);
    expect(store.tree.value!.nodes.find(item => item.id === "n3")!.parentId).toBe("n1");
  });

  it("clears the selection when the selected node is removed", async () => {
    const store = createElementStore(loaded([node({ id: "n1" })]));
    await store.load("p1", REGION);
    store.select("n1");
    await store.removeNode("p1", REGION, "n1");
    expect(store.selectedNode.value).toBeNull();
  });

  // 新增容器要接管被它完整包含的兄弟——这正是"补一层不可见容器"
  it("adopts fully contained siblings when a container is added", async () => {
    const store = createElementStore(loaded([
      node({ id: "n1", box: { x: 0, y: 0, w: 400, h: 300 } }),
      node({ id: "n2", parentId: "n1", kind: "text", box: { x: 10, y: 10, w: 50, h: 20 } }),
      node({ id: "n3", parentId: "n1", kind: "text", box: { x: 10, y: 40, w: 50, h: 20 } }),
      node({ id: "n4", parentId: "n1", kind: "icon", box: { x: 300, y: 10, w: 50, h: 50 } }),
    ]));
    await store.load("p1", REGION);
    await store.addContainer("p1", REGION, { x: 5, y: 5, w: 70, h: 70 });
    const added = store.tree.value!.nodes.find(item => item.source === "manual")!;
    expect(added.parentId).toBe("n1");
    expect(store.tree.value!.nodes.filter(item => item.parentId === added.id)
      .map(item => item.id).sort()).toEqual(["n2", "n3"]);
  });

  it("keeps the local edit and reports the error when saving fails", async () => {
    const api = loaded([node({ id: "n1" })]);
    (api as { putElements: unknown }).putElements =
      vi.fn(async () => { throw new Error("422 nope"); });
    const store = createElementStore(api);
    await store.load("p1", REGION);
    await store.rename("p1", REGION, "n1", "改过");
    expect(store.tree.value!.nodes[0]!.displayName).toBe("改过");
    expect(store.error.value).toContain("422");
  });
});
```

- [ ] **Step 3: 运行测试确认红灯**

Run:

```powershell
D:/nodejs/corepack.cmd pnpm --filter @region-split/ui test -- src/element-state.test.ts
```

Expected: FAIL，报找不到 `./element-state.js`。

- [ ] **Step 4: 实现 `element-state.ts`**

```ts
import { computed, ref, shallowRef } from "vue";
import type { ElementKind, ElementNode, ElementTree, Rect } from "@region-split/core/browser";
import type { StoreApi } from "./api.js";

/**
 * 元素编辑独立于区域编辑：不共用撤销栈，也不进 state.ts。
 * 元素的每个动作都可直接反向操作（删除→重新框选，新增→删除），不需要撤销栈；
 * 混进区域的 Region[] 栈只会让两种状态互相污染。
 */
export function createElementStore(api: StoreApi) {
  const tree = shallowRef<ElementTree | null>(null);
  const busyLabel = ref("");
  const error = ref("");
  const selectedId = ref<string | null>(null);
  const busy = computed(() => busyLabel.value !== "");
  const nodes = computed(() => tree.value?.nodes ?? []);
  const selectedNode = computed(() =>
    nodes.value.find(node => node.id === selectedId.value) ?? null);

  function nextId(existing: ElementNode[]): string {
    const used = new Set(existing.map(node => node.id));
    let n = existing.length + 1;
    while (used.has(`n${n}`)) n++;
    return `n${n}`;
  }

  const contains = (outer: Rect, inner: Rect) =>
    inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w
    && inner.y + inner.h <= outer.y + outer.h;

  async function commit(projectId: string, region: Rect, next: ElementNode[]): Promise<void> {
    const current = tree.value;
    if (!current) return;
    // 先落本地再落盘：保存失败时保留本地编辑不回滚，只报错，
    // 与 state.ts 里 persistNow 的做法一致。
    tree.value = { ...current, nodes: next };
    error.value = "";
    try {
      tree.value = (await api.putElements(projectId, region, { ...current, nodes: next })).tree;
    } catch (err) {
      error.value = (err as Error).message;
    }
  }

  return {
    tree, nodes, busy, busyLabel, error, selectedId, selectedNode,

    select(id: string | null) { selectedId.value = id; },

    async load(projectId: string, region: Rect) {
      busyLabel.value = "载入元素…"; error.value = "";
      try {
        tree.value = (await api.getElements(projectId, region.y, region.h)).tree;
        selectedId.value = null;
      } catch (err) { error.value = (err as Error).message; }
      finally { busyLabel.value = ""; }
    },

    async detect(projectId: string, region: Rect) {
      if (busy.value) return;
      busyLabel.value = "解析元素中…"; error.value = "";
      try {
        tree.value = (await api.detectElements(projectId, region)).tree;
        selectedId.value = null;
      } catch (err) { error.value = (err as Error).message; }
      finally { busyLabel.value = ""; }
    },

    async rename(projectId: string, region: Rect, id: string, displayName: string) {
      if (displayName.trim() === "") return;
      await commit(projectId, region, nodes.value.map(node =>
        node.id === id ? { ...node, displayName: displayName.trim() } : node));
    },

    async setKind(projectId: string, region: Rect, id: string, kind: ElementKind) {
      await commit(projectId, region, nodes.value.map(node =>
        node.id === id ? { ...node, kind, classification: "human" as const } : node));
    },

    /** 删除一层：子节点上提到父节点，不级联删除 */
    async removeNode(projectId: string, region: Rect, id: string) {
      const target = nodes.value.find(node => node.id === id);
      if (!target) return;
      const next = nodes.value
        .filter(node => node.id !== id)
        .map(node => node.parentId === id ? { ...node, parentId: target.parentId } : node);
      if (selectedId.value === id) selectedId.value = null;
      await commit(projectId, region, next);
    },

    /**
     * 框选新增一层容器：父节点取包含该矩形的**最深**节点，
     * 被该矩形完整包含的现有兄弟自动成为它的子节点。
     * 这正是补一层不可见容器——它在图上不留痕迹，原理上无法检测，只能人工加。
     */
    async addContainer(projectId: string, region: Rect, box: Rect) {
      const current = tree.value;
      if (!current) return;
      const parent = nodes.value
        .filter(node => contains(node.box, box))
        .sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)[0] ?? null;
      const id = nextId(nodes.value);
      const added: ElementNode = {
        id, parentId: parent?.id ?? null, box, kind: "component",
        displayName: "新建容器", style: {}, uniformity: 1,
        source: "manual", classification: "human",
        scrollX: false, scrollY: false, positioning: "flow",
      };
      const next = nodes.value.map(node =>
        node.parentId === (parent?.id ?? null) && contains(box, node.box)
          ? { ...node, parentId: id }
          : node);
      await commit(projectId, region, [...next, added]);
      selectedId.value = id;
    },
  };
}

export type ElementStore = ReturnType<typeof createElementStore>;
```

- [ ] **Step 5: 运行测试确认绿灯**

Run:

```powershell
D:/nodejs/corepack.cmd pnpm --filter @region-split/ui test -- src/element-state.test.ts
D:/nodejs/corepack.cmd pnpm --filter @region-split/ui typecheck
```

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```powershell
git add apps/region-split-ui/src/api.ts apps/region-split-ui/src/element-state.ts apps/region-split-ui/src/element-state.test.ts
git commit -m "feat: add element store and api"
```

---

### Task 6: 结构树与属性面板两个展示组件

**Files:**
- Create: `apps/region-split-ui/src/components/ElementTree.vue`
- Create: `apps/region-split-ui/src/components/ElementTree.test.ts`
- Create: `apps/region-split-ui/src/components/ElementProperties.vue`
- Create: `apps/region-split-ui/src/components/ElementProperties.test.ts`

两个组件都是**纯展示 + 事件**，不碰 store 也不碰画布，可以单独挂载测试。

- [ ] **Step 1: 编写失败测试**

创建 `apps/region-split-ui/src/components/ElementTree.test.ts`：

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ElementTree from "./ElementTree.vue";
import type { ElementNode } from "@region-split/core/browser";

function node(over: Partial<ElementNode> & Pick<ElementNode, "id">): ElementNode {
  return {
    parentId: null, box: { x: 0, y: 0, w: 100, h: 100 }, kind: "component",
    displayName: "节点", style: {}, uniformity: 1, source: "auto",
    classification: "tool", scrollX: false, scrollY: false, positioning: "flow", ...over,
  };
}
const nodes = [
  node({ id: "n1", displayName: "卡片" }),
  node({ id: "n2", parentId: "n1", displayName: "文字", kind: "text" }),
];
const mountTree = (props: Record<string, unknown> = {}) =>
  mount(ElementTree, { props: { nodes, selectedId: null, hoveredId: null, ...props } });

describe("ElementTree", () => {
  it("renders one row per node", () => {
    const wrapper = mountTree();
    expect(wrapper.findAll('[data-test="element-row"]')).toHaveLength(2);
    expect(wrapper.text()).toContain("卡片");
    expect(wrapper.text()).toContain("文字");
  });

  it("indents children below their parent", () => {
    const rows = mountTree().findAll('[data-test="element-row"]');
    expect(rows[0]!.attributes("style")).toContain("--depth: 0");
    expect(rows[1]!.attributes("style")).toContain("--depth: 1");
  });

  it("shows a placeholder when nothing is parsed", () => {
    expect(mountTree({ nodes: [] }).text()).toContain("尚未解析");
  });

  it("emits select when a row is clicked", async () => {
    const wrapper = mountTree();
    await wrapper.findAll('[data-test="element-row"]')[1]!.trigger("click");
    expect(wrapper.emitted("select")![0]).toEqual(["n2"]);
  });

  it("emits hover on enter and leave", async () => {
    const wrapper = mountTree();
    const row = wrapper.findAll('[data-test="element-row"]')[0]!;
    await row.trigger("mouseenter");
    await row.trigger("mouseleave");
    expect(wrapper.emitted("hover")).toEqual([["n1"], [null]]);
  });

  it("shows the remove button only on the selected row", async () => {
    const wrapper = mountTree({ selectedId: "n2" });
    expect(wrapper.findAll('[data-test="element-remove"]')).toHaveLength(1);
    await wrapper.find('[data-test="element-remove"]').trigger("click");
    expect(wrapper.emitted("remove")![0]).toEqual(["n2"]);
  });

  it("emits rename on double click", async () => {
    const wrapper = mountTree();
    await wrapper.findAll('[data-test="element-name"]')[0]!.trigger("dblclick");
    expect(wrapper.emitted("rename")![0]).toEqual(["n1"]);
  });

  it("marks an uncertain node", () => {
    const wrapper = mountTree({ nodes: [node({ id: "n1", classification: "uncertain" })] });
    expect(wrapper.find('[data-test="element-row"]').classes()).toContain("uncertain");
  });
});
```

创建 `apps/region-split-ui/src/components/ElementProperties.test.ts`：

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ElementProperties from "./ElementProperties.vue";
import type { ElementNode } from "@region-split/core/browser";

const node: ElementNode = {
  id: "n1", parentId: null, box: { x: 36, y: 396, w: 1098, h: 222 },
  kind: "component", displayName: "卡券资产", style: { background: "#ffffff" },
  uniformity: 0.93, source: "auto", classification: "tool",
  scrollX: false, scrollY: false, positioning: "flow",
};

describe("ElementProperties", () => {
  it("prompts when nothing is selected", () => {
    expect(mount(ElementProperties, { props: { node: null } }).text())
      .toContain("选择一个元素查看属性");
  });

  it("shows the measured geometry", () => {
    const text = mount(ElementProperties, { props: { node } }).text();
    expect(text).toContain("36");
    expect(text).toContain("396");
    expect(text).toContain("1098");
    expect(text).toContain("222");
  });

  it("shows the background and uniformity", () => {
    const text = mount(ElementProperties, { props: { node } }).text();
    expect(text).toContain("#ffffff");
    expect(text).toContain("0.93");
  });

  it("emits rename when the name input changes", async () => {
    const wrapper = mount(ElementProperties, { props: { node } });
    const input = wrapper.find('[data-test="property-name"]');
    await input.setValue("资产卡片");
    await input.trigger("change");
    expect(wrapper.emitted("rename")![0]).toEqual(["n1", "资产卡片"]);
  });

  it("emits set-kind when the kind select changes", async () => {
    const wrapper = mount(ElementProperties, { props: { node } });
    await wrapper.find('[data-test="property-kind"]').setValue("grid");
    expect(wrapper.emitted("set-kind")![0]).toEqual(["n1", "grid"]);
  });

  // 位置尺寸是测量结果，不接受人工改
  it("renders geometry as read only text, not inputs", () => {
    const wrapper = mount(ElementProperties, { props: { node } });
    expect(wrapper.find('[data-test="property-box"]').element.tagName).not.toBe("INPUT");
  });
});
```

- [ ] **Step 2: 运行测试确认红灯**

Run:

```powershell
D:/nodejs/corepack.cmd pnpm --filter @region-split/ui test -- src/components/ElementTree.test.ts src/components/ElementProperties.test.ts
```

Expected: FAIL，两个组件都不存在。

- [ ] **Step 3: 实现 `ElementTree.vue`**

```vue
<script setup lang="ts">
import { computed } from "vue";
import type { ElementKind, ElementNode } from "@region-split/core/browser";

const props = defineProps<{
  nodes: ElementNode[];
  selectedId: string | null;
  hoveredId: string | null;
}>();
const emit = defineEmits<{
  select: [id: string];
  hover: [id: string | null];
  remove: [id: string];
  rename: [id: string];
}>();

const KIND_LABEL: Record<ElementKind, string> = {
  component: "组件", grid: "网格", text: "文字",
  icon: "图标", image: "图片", decoration: "装饰",
};

/** 按父子关系展平成深度优先序，深度用于缩进 */
const rows = computed(() => {
  const childrenOf = new Map<string | null, ElementNode[]>();
  for (const node of props.nodes) {
    const list = childrenOf.get(node.parentId) ?? [];
    list.push(node);
    childrenOf.set(node.parentId, list);
  }
  const out: { node: ElementNode; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const node of childrenOf.get(parentId) ?? []) {
      out.push({ node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
});
</script>

<template>
  <div class="element-tree">
    <p v-if="rows.length === 0" class="empty">尚未解析</p>
    <div
      v-for="{ node, depth } in rows"
      :key="node.id"
      data-test="element-row"
      class="row"
      :class="{
        selected: node.id === props.selectedId,
        hovered: node.id === props.hoveredId,
        uncertain: node.classification === 'uncertain',
      }"
      :style="{ '--depth': depth }"
      @click="emit('select', node.id)"
      @mouseenter="emit('hover', node.id)"
      @mouseleave="emit('hover', null)"
    >
      <span class="kind" :class="`kind-${node.kind}`">{{ KIND_LABEL[node.kind] }}</span>
      <span
        data-test="element-name"
        class="name"
        @dblclick.stop="emit('rename', node.id)"
      >{{ node.displayName }}</span>
      <button
        v-if="node.id === props.selectedId"
        data-test="element-remove"
        class="remove"
        title="删除这一层，子节点上提"
        @click.stop="emit('remove', node.id)"
      >×</button>
    </div>
  </div>
</template>

<style scoped>
.element-tree { height: 100%; padding: 6px; overflow: auto; background: var(--bg-node); }
.empty { padding: 24px; color: var(--text-faint); font-size: 10px; text-align: center; }
.row { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; padding: 5px 6px 5px calc(6px + var(--depth) * 14px); border: 1px solid transparent; border-radius: 5px; background: var(--bg-inset); color: var(--text-dim); cursor: pointer; font-size: 11px; }
.row.hovered { border-color: var(--border-strong); background: #303540; }
.row.selected { border-color: var(--accent); background: var(--accent-soft); }
.row.uncertain { box-shadow: inset 0 0 0 1px var(--warn); }
.kind { flex: none; padding: 1px 5px; border: 1px solid var(--border-strong); border-radius: 4px; color: var(--text-faint); font-size: 9px; }
.kind-grid { border-color: var(--ok); color: var(--ok); }
.kind-image { border-color: var(--warn); color: var(--warn); }
.name { flex: 1; min-width: 0; overflow: hidden; color: var(--text); text-overflow: ellipsis; white-space: nowrap; }
.remove { flex: none; min-height: 0; padding: 0 6px; border-color: var(--danger); color: var(--danger); }
</style>
```

- [ ] **Step 4: 实现 `ElementProperties.vue`**

```vue
<script setup lang="ts">
import { elementKinds, type ElementKind, type ElementNode } from "@region-split/core/browser";

const props = defineProps<{ node: ElementNode | null }>();
const emit = defineEmits<{
  rename: [id: string, displayName: string];
  "set-kind": [id: string, kind: ElementKind];
}>();

const KIND_LABEL: Record<ElementKind, string> = {
  component: "组件", grid: "网格", text: "文字",
  icon: "图标", image: "图片", decoration: "装饰",
};

function onRename(event: Event) {
  const value = (event.target as HTMLInputElement).value.trim();
  if (props.node && value) emit("rename", props.node.id, value);
}
function onKind(event: Event) {
  const value = (event.target as HTMLSelectElement).value as ElementKind;
  if (props.node) emit("set-kind", props.node.id, value);
}
</script>

<template>
  <div class="properties">
    <p v-if="!props.node" class="empty">选择一个元素查看属性</p>
    <template v-else>
      <label class="field">
        <span>名称</span>
        <input
          data-test="property-name"
          :value="props.node.displayName"
          @change="onRename"
        />
      </label>
      <label class="field">
        <span>类型</span>
        <select data-test="property-kind" :value="props.node.kind" @change="onKind">
          <option v-for="kind in elementKinds" :key="kind" :value="kind">
            {{ KIND_LABEL[kind] }}
          </option>
        </select>
      </label>
      <!-- 位置尺寸是测量结果，只读；人工要改形状请用框选新增 -->
      <div class="field">
        <span>位置尺寸</span>
        <code data-test="property-box">
          {{ props.node.box.x }}, {{ props.node.box.y }}
          · {{ props.node.box.w }}×{{ props.node.box.h }}
        </code>
      </div>
      <div class="field">
        <span>背景色</span>
        <code>
          <i
            v-if="props.node.style.background"
            class="swatch"
            :style="{ background: props.node.style.background }"
          />
          {{ props.node.style.background ?? "—" }}
        </code>
      </div>
      <div class="field">
        <span>主色占比</span>
        <code>{{ props.node.uniformity.toFixed(2) }}</code>
      </div>
      <div class="field">
        <span>来源</span>
        <code>{{ props.node.source === "manual" ? "人工新增" : "自动检测" }}</code>
      </div>
    </template>
  </div>
</template>

<style scoped>
.properties { height: 100%; padding: 8px; overflow: auto; border-left: 1px solid var(--border); background: var(--bg-node); }
.empty { padding: 24px 8px; color: var(--text-faint); font-size: 10px; text-align: center; }
.field { display: flex; align-items: center; gap: 8px; min-height: 30px; margin-bottom: 4px; font-size: 10px; }
.field > span { flex: none; width: 60px; color: var(--text-faint); }
.field input, .field select { flex: 1; min-width: 0; height: 26px; min-height: 26px; font-size: 10px; }
.field code { flex: 1; min-width: 0; display: flex; align-items: center; gap: 5px; overflow: hidden; color: var(--text-dim); text-overflow: ellipsis; white-space: nowrap; }
.swatch { flex: none; width: 11px; height: 11px; border: 1px solid var(--border-strong); border-radius: 3px; }
</style>
```

`elementKinds` 是值不是类型，必须从 `@region-split/core/browser` 以值导入——Task 1 已经把 `element-types.js` 加进了 `browser.ts`。

- [ ] **Step 5: 运行测试确认绿灯**

Run:

```powershell
D:/nodejs/corepack.cmd pnpm --filter @region-split/ui test -- src/components/ElementTree.test.ts src/components/ElementProperties.test.ts
D:/nodejs/corepack.cmd pnpm --filter @region-split/ui typecheck
```

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```powershell
git add apps/region-split-ui/src/components/ElementTree.vue apps/region-split-ui/src/components/ElementTree.test.ts apps/region-split-ui/src/components/ElementProperties.vue apps/region-split-ui/src/components/ElementProperties.test.ts
git commit -m "feat: add element tree and property components"
```

---

### Task 7: 详情节点接进画布

**Files:**
- Create: `apps/region-split-ui/src/components/ElementOverlay.vue`
- Create: `apps/region-split-ui/src/components/ElementOverlay.test.ts`
- Create: `apps/region-split-ui/src/canvas/nodes/DetailNode.vue`
- Create: `apps/region-split-ui/src/canvas/nodes/DetailNode.test.ts`
- Modify: `apps/region-split-ui/src/canvas/canvas-state.ts`
- Modify: `apps/region-split-ui/src/canvas/canvas-state.test.ts`
- Modify: `apps/region-split-ui/src/canvas/PipelineCanvas.vue`
- Modify: `apps/region-split-ui/src/App.vue`

- [ ] **Step 1: 扩展 `canvas-state.ts` 并补测试**

```ts
export type NodeId = "workspace" | "detail";
```

```ts
export const DEFAULT_NODE_POSITIONS: NodePositions = {
  workspace: { x: 120, y: 80 },
  detail: { x: 1345, y: 80 },
};
```

`NODE_POSITIONS_STORAGE_KEY` **保持 `:v2` 不变**：`loadNodePositions` 按 `fallback` 的键遍历，旧存档缺 `detail` 时自动回落到缺省值；升版本号只会白白丢掉用户摆好的 workspace 位置。

在 `canvas-state.test.ts` 末尾追加：

```ts
describe("two node positions", () => {
  it("places the detail node to the right of the workspace", () => {
    expect(DEFAULT_NODE_POSITIONS.detail.x)
      .toBeGreaterThan(DEFAULT_NODE_POSITIONS.workspace.x);
  });

  it("falls back for a node missing from an older payload", () => {
    const storage = { getItem: () => JSON.stringify({ workspace: { x: 5, y: 6 } }) };
    const loaded = loadNodePositions(storage, "k", DEFAULT_NODE_POSITIONS);
    expect(loaded.workspace).toEqual({ x: 5, y: 6 });
    expect(loaded.detail).toEqual(DEFAULT_NODE_POSITIONS.detail);
  });
});
```

- [ ] **Step 2: 改造 `PipelineCanvas.vue`**

props 增加：

```ts
const props = withDefaults(defineProps<{
  status?: "idle" | "active" | "done" | "warn";
  detailStatus?: "idle" | "active" | "done" | "warn";
  showDetail?: boolean;
}>(), { status: "idle", detailStatus: "idle", showDetail: false });
```

拖拽改为按 nodeId 写入：

```ts
let interaction: null | {
  kind: "pan" | "node";
  nodeId: NodeId;
  start: Point;
  origin: Point;
} = null;

function onNodeDragStart(event: PointerEvent, nodeId: string) {
  if (event.button !== 0) return;
  const id = nodeId as NodeId;
  interaction = {
    kind: "node", nodeId: id, start: pointerPoint(event), origin: { ...positions[id] },
  };
  rootEl.value?.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}
```

`onCanvasPointerDown` 里构造 pan 时补 `nodeId: "workspace"`（pan 分支不读它，类型需要）。`onPointerMove` 的 node 分支改为：

```ts
    positions[interaction.nodeId] = {
      x: interaction.origin.x + dx / viewport.zoom,
      y: interaction.origin.y + dy / viewport.zoom,
    };
```

`contentBounds()` 改为两个节点的并集：

```ts
const DETAIL_WIDTH = 760;

function contentBounds() {
  const measure = (id: NodeId, fallbackWidth: number) => {
    const node = workspaceEl.value?.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    return {
      ...positions[id],
      width: node?.offsetWidth || fallbackWidth,
      height: node?.offsetHeight || fallbackSize.height,
    };
  };
  const boxes = [measure("workspace", fallbackSize.width)];
  if (props.showDetail) boxes.push(measure("detail", DETAIL_WIDTH));
  const left = Math.min(...boxes.map(box => box.x));
  const top = Math.min(...boxes.map(box => box.y));
  const right = Math.max(...boxes.map(box => box.x + box.width));
  const bottom = Math.max(...boxes.map(box => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
```

模板中在 workspace 节点之后追加第二个节点。**端口保持关闭，不画连线**：

```html
        <PipelineNode
          v-if="props.showDetail"
          node-id="detail"
          title="区域详情"
          :position="positions.detail"
          :width="760"
          :min-height="420"
          :status="props.detailStatus"
          :input="false"
          :output="false"
          @drag-start="onNodeDragStart"
        >
          <template #status><slot name="detail-status" /></template>
          <slot name="detail" />
        </PipelineNode>
```

- [ ] **Step 3: 编写 `ElementOverlay` 失败测试**

创建 `apps/region-split-ui/src/components/ElementOverlay.test.ts`：

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ElementOverlay from "./ElementOverlay.vue";
import type { ElementNode, Rect } from "@region-split/core/browser";

const region: Rect = { x: 0, y: 100, w: 400, h: 300 };
function node(over: Partial<ElementNode> & Pick<ElementNode, "id">): ElementNode {
  return {
    parentId: null, box: { x: 20, y: 120, w: 100, h: 60 }, kind: "component",
    displayName: "节点", style: {}, uniformity: 1, source: "auto",
    classification: "tool", scrollX: false, scrollY: false, positioning: "flow", ...over,
  };
}
const base = {
  projectId: "p1", region, nodes: [node({ id: "n1" })],
  selectedId: null, hoveredId: null,
};
const mountOverlay = (props: Record<string, unknown> = {}) =>
  mount(ElementOverlay, { props: { ...base, ...props } });

describe("ElementOverlay", () => {
  it("keeps the frame at the region aspect ratio", () => {
    const style = mountOverlay().find('[data-test="element-stage"]').attributes("style")!;
    expect(style).toContain("400 / 300");
  });

  it("draws one box per node", () => {
    expect(mountOverlay().findAll('[data-test="element-box"]')).toHaveLength(1);
  });

  // 全部按百分比定位，不做任何测量——图始终占满容器宽度，比例与区域一致
  it("positions a box relative to the region origin in percent", () => {
    const style = mountOverlay().find('[data-test="element-box"]').attributes("style")!;
    expect(style).toContain("left: 5%");
    expect(style).toContain("top: 6.66667%");
    expect(style).toContain("width: 25%");
    expect(style).toContain("height: 20%");
  });

  it("tags the box with its kind", () => {
    const wrapper = mountOverlay({ nodes: [node({ id: "n1", kind: "image" })] });
    expect(wrapper.find('[data-test="element-box"]').classes()).toContain("kind-image");
  });

  it("emits select on click", async () => {
    const wrapper = mountOverlay();
    await wrapper.find('[data-test="element-box"]').trigger("click");
    expect(wrapper.emitted("select")![0]).toEqual(["n1"]);
  });

  it("emits add-container after a drag", async () => {
    const wrapper = mountOverlay();
    const stage = wrapper.find('[data-test="element-stage"]');
    await stage.trigger("pointerdown", { button: 0, clientX: 0, clientY: 0 });
    await stage.trigger("pointermove", { clientX: 60, clientY: 60 });
    await stage.trigger("pointerup");
    expect(wrapper.emitted("add-container")).toBeTruthy();
  });

  it("ignores a drag too small to be intentional", async () => {
    const wrapper = mountOverlay();
    const stage = wrapper.find('[data-test="element-stage"]');
    await stage.trigger("pointerdown", { button: 0, clientX: 0, clientY: 0 });
    await stage.trigger("pointerup");
    expect(wrapper.emitted("add-container")).toBeFalsy();
  });

  it("stops pointer events from reaching the canvas", () => {
    const wrapper = mountOverlay();
    const event = new PointerEvent("pointerdown", { bubbles: true, button: 0 });
    const stopped = vi.spyOn(event, "stopPropagation");
    wrapper.find('[data-test="element-stage"]').element.dispatchEvent(event);
    expect(stopped).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: 实现 `ElementOverlay.vue`**

```vue
<script setup lang="ts">
import { computed, ref } from "vue";
import type { ElementNode, Rect } from "@region-split/core/browser";
import { regionImageUrl } from "../api.js";

const props = defineProps<{
  projectId: string;
  region: Rect;
  nodes: ElementNode[];
  selectedId: string | null;
  hoveredId: string | null;
}>();
const emit = defineEmits<{
  select: [id: string];
  hover: [id: string | null];
  "add-container": [box: Rect];
}>();

/** 小于这个像素的拖拽当作误触 */
const MIN_DRAG = 8;

const stageEl = ref<HTMLElement | null>(null);
const dragBox = ref<Rect | null>(null);
let dragStart: { x: number; y: number } | null = null;

const src = computed(() => regionImageUrl(props.projectId, props.region));

/**
 * 全部按百分比定位，不做任何 ResizeObserver 测量。
 * 前提是图始终占满容器宽度、容器宽高比等于区域宽高比——所以这里
 * 绝不能给图加 max-height 配 object-fit，那会让图的渲染矩形不再等于容器矩形，
 * 标注就必须改回测量式定位。
 */
function boxStyle(box: Rect) {
  return {
    left: `${((box.x - props.region.x) / props.region.w) * 100}%`,
    top: `${((box.y - props.region.y) / props.region.h) * 100}%`,
    width: `${(box.w / props.region.w) * 100}%`,
    height: `${(box.h / props.region.h) * 100}%`,
  };
}

function toImage(event: PointerEvent): { x: number; y: number } {
  const rect = stageEl.value!.getBoundingClientRect();
  const scaleX = rect.width > 0 ? props.region.w / rect.width : 1;
  const scaleY = rect.height > 0 ? props.region.h / rect.height : 1;
  return {
    x: props.region.x + Math.round((event.clientX - rect.left) * scaleX),
    y: props.region.y + Math.round((event.clientY - rect.top) * scaleY),
  };
}

function onDown(event: PointerEvent) {
  if (event.button !== 0) return;
  dragStart = toImage(event);
  dragBox.value = null;
  stageEl.value?.setPointerCapture?.(event.pointerId);
}

function onMove(event: PointerEvent) {
  if (!dragStart) return;
  const now = toImage(event);
  dragBox.value = {
    x: Math.min(dragStart.x, now.x), y: Math.min(dragStart.y, now.y),
    w: Math.abs(now.x - dragStart.x), h: Math.abs(now.y - dragStart.y),
  };
}

function onUp() {
  const box = dragBox.value;
  dragStart = null;
  dragBox.value = null;
  if (box && box.w >= MIN_DRAG && box.h >= MIN_DRAG) emit("add-container", box);
}

function onCancel() {
  dragStart = null;
  dragBox.value = null;
}

defineExpose({ cancel: onCancel });
</script>

<template>
  <div
    ref="stageEl"
    data-test="element-stage"
    class="stage"
    :style="{ aspectRatio: `${props.region.w} / ${props.region.h}` }"
    @pointerdown.stop="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onCancel"
  >
    <img class="crop" :src="src" alt="区域原图" />
    <div
      v-for="node in props.nodes"
      :key="node.id"
      data-test="element-box"
      class="box"
      :class="[`kind-${node.kind}`, {
        selected: node.id === props.selectedId,
        hovered: node.id === props.hoveredId,
      }]"
      :style="boxStyle(node.box)"
      @click.stop="emit('select', node.id)"
      @mouseenter="emit('hover', node.id)"
      @mouseleave="emit('hover', null)"
    />
    <div v-if="dragBox" class="draft" :style="boxStyle(dragBox)" />
  </div>
</template>

<style scoped>
.stage { position: relative; width: 100%; overflow: hidden; background: #0a0d13; cursor: crosshair; touch-action: none; }
.crop { display: block; width: 100%; height: auto; }
.box { position: absolute; border: 1px solid #4c8dff88; }
.box.kind-image { border-style: dashed; border-color: #e2a40099; }
.box.kind-grid { border-color: #3ecf8e99; }
.box.hovered { background: #4c8dff1a; }
.box.selected { border: 2px solid var(--accent); background: #4c8dff28; }
.draft { position: absolute; border: 1px dashed var(--accent); background: #4c8dff22; pointer-events: none; }
</style>
```

- [ ] **Step 5: 编写 `DetailNode` 失败测试**

创建 `apps/region-split-ui/src/canvas/nodes/DetailNode.test.ts`：

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import DetailNode from "./DetailNode.vue";
import { createElementStore } from "../../element-state.js";
import type { StoreApi } from "../../api.js";
import type { Region } from "@region-split/core/browser";

function stubStore() {
  return createElementStore({
    upload: vi.fn(), getProject: vi.fn(), putRegions: vi.fn(), analyze: vi.fn(),
    renameAi: vi.fn(), getModelConfig: vi.fn(),
    getElements: vi.fn(async () => ({ tree: null })),
    detectElements: vi.fn(), putElements: vi.fn(),
  } as unknown as StoreApi);
}

const region = (id: string, y: number, h: number): Region => ({
  id, displayName: id, type: "other", bounds: { x: 0, y, w: 400, h },
  confidence: 1, scrollX: false, scrollY: false,
});

const mountNode = (over: Record<string, unknown> = {}) =>
  mount(DetailNode, {
    props: { projectId: "p1", selectedRegions: [], elementStore: stubStore(), ...over },
    global: { stubs: { ElementOverlay: true, ElementTree: true, ElementProperties: true } },
  });

describe("DetailNode", () => {
  it("asks for a selection when nothing is selected", () => {
    expect(mountNode().text()).toContain("选择一个区域查看详情");
  });

  it("asks for a single selection when several are selected", () => {
    const wrapper = mountNode({ selectedRegions: [region("a", 0, 100), region("b", 100, 100)] });
    expect(wrapper.text()).toContain("请选择单个区域");
    expect(wrapper.find('[data-test="detect-elements"]').exists()).toBe(false);
  });

  it("offers detection for a single region", () => {
    const wrapper = mountNode({ selectedRegions: [region("a", 0, 300)] });
    expect(wrapper.find('[data-test="detect-elements"]').text()).toBe("解析元素");
  });

  // 上下结构：图在上、树与属性在下
  it("stacks the image above the tree and properties", () => {
    const wrapper = mountNode({ selectedRegions: [region("a", 0, 300)] });
    expect(wrapper.find('[data-test="detail-image"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="detail-inspector"]').exists()).toBe(true);
  });

  it("stops pointer events from reaching the canvas", () => {
    const wrapper = mountNode({ selectedRegions: [region("a", 0, 300)] });
    const event = new PointerEvent("pointerdown", { bubbles: true });
    const stopped = vi.spyOn(event, "stopPropagation");
    wrapper.find(".detail-node").element.dispatchEvent(event);
    expect(stopped).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: 实现 `DetailNode.vue`**

```vue
<script setup lang="ts">
import { computed, watch } from "vue";
import type { ElementKind, Rect, Region } from "@region-split/core/browser";
import ElementOverlay from "../../components/ElementOverlay.vue";
import ElementProperties from "../../components/ElementProperties.vue";
import ElementTree from "../../components/ElementTree.vue";
import type { ElementStore } from "../../element-state.js";

const props = defineProps<{
  projectId: string;
  selectedRegions: Region[];
  elementStore: ElementStore;
  hoveredId?: string | null;
}>();
const emit = defineEmits<{ hover: [id: string | null] }>();

const single = computed(() =>
  props.selectedRegions.length === 1 ? props.selectedRegions[0]! : null);
const region = computed<Rect | null>(() => single.value?.bounds ?? null);

// 选中的区域一变就重新载入。边界变了 regionKey 就失配，界面自然回到"未解析"——
// 区域范围变了，树本来就该重算。
watch(region, async next => {
  if (next && props.projectId) await props.elementStore.load(props.projectId, next);
}, { immediate: true });

const act = <T extends unknown[]>(fn: (id: string, r: Rect, ...args: T) => unknown) =>
  (...args: T) => { if (region.value) void fn(props.projectId, region.value, ...args); };

const detect = () => {
  if (region.value) void props.elementStore.detect(props.projectId, region.value);
};
const onRemove = act(props.elementStore.removeNode);
const onSetKind = act<[string, ElementKind]>(props.elementStore.setKind);
const onAddContainer = act<[Rect]>(props.elementStore.addContainer);
const onRenameValue = act<[string, string]>(props.elementStore.rename);

/** 树上双击只给 id，名字从当前节点取，弹一个输入框 */
function onRenamePrompt(id: string) {
  const current = props.elementStore.nodes.value.find(node => node.id === id);
  const next = window.prompt("元素名称", current?.displayName ?? "");
  if (next !== null) onRenameValue(id, next);
}
</script>

<template>
  <div class="detail-node" @pointerdown.stop @click.stop>
    <p v-if="props.selectedRegions.length === 0" class="hint">选择一个区域查看详情</p>
    <p v-else-if="props.selectedRegions.length > 1" class="hint">请选择单个区域</p>
    <template v-else-if="region">
      <div class="bar">
        <button
          data-test="detect-elements"
          :disabled="props.elementStore.busy.value"
          @click="detect"
        >{{ props.elementStore.tree.value ? "重新解析" : "解析元素" }}</button>
        <span class="label">{{ single?.displayName }}</span>
        <span class="label">{{ region.w }}×{{ region.h }}</span>
        <span v-if="props.elementStore.busy.value" class="label">
          {{ props.elementStore.busyLabel.value }}
        </span>
        <span v-if="props.elementStore.error.value" class="error">
          {{ props.elementStore.error.value }}
        </span>
      </div>

      <section data-test="detail-image" class="image-section">
        <header>区域原图</header>
        <ElementOverlay
          :project-id="props.projectId"
          :region="region"
          :nodes="props.elementStore.nodes.value"
          :selected-id="props.elementStore.selectedId.value"
          :hovered-id="props.hoveredId ?? null"
          @select="props.elementStore.select"
          @hover="emit('hover', $event)"
          @add-container="onAddContainer"
        />
      </section>

      <section data-test="detail-inspector" class="inspector">
        <ElementTree
          :nodes="props.elementStore.nodes.value"
          :selected-id="props.elementStore.selectedId.value"
          :hovered-id="props.hoveredId ?? null"
          @select="props.elementStore.select"
          @hover="emit('hover', $event)"
          @remove="onRemove"
          @rename="onRenamePrompt"
        />
        <ElementProperties
          :node="props.elementStore.selectedNode.value"
          @rename="onRenameValue"
          @set-kind="onSetKind"
        />
      </section>
    </template>
  </div>
</template>

<style scoped>
.detail-node { margin: -14px; overflow: hidden; border-radius: 0 0 9px 9px; background: var(--bg-inset); }
.hint { min-height: 380px; display: grid; place-content: center; margin: 0; color: var(--text-faint); background: #0e1118; font-size: 11px; }
.bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--border); background: var(--bg-node-header); }
.bar button { height: 28px; min-height: 28px; padding: 0 12px; font-size: 11px; }
.label { color: var(--text-faint); font-size: 10px; }
.error { margin-left: auto; color: var(--danger); font-size: 10px; }
.image-section header,
.inspector header { height: 26px; display: flex; align-items: center; padding: 0 9px; border-bottom: 1px solid var(--border); color: var(--text-dim); background: var(--bg-node-header); font-size: 10px; }
.image-section { background: #0a0d13; }
/* 上下结构：图占满宽度，高度由区域宽高比决定，不设上限；
   下段是固定高度的树与属性检查器。 */
.inspector { height: 320px; display: grid; grid-template-columns: minmax(0, 1fr) 300px; border-top: 1px solid var(--border); }
</style>
```

- [ ] **Step 7: 接进 `App.vue`**

补充 import 与状态：

```ts
import DetailNode from "./canvas/nodes/DetailNode.vue";
import { createElementStore } from "./element-state.js";
```

```ts
const elementStore = createElementStore(httpApi);
const hoveredElementId = ref<string | null>(null);
const selectedRegions = computed(() =>
  store.regions.value.filter(region => store.selectedIds.value.includes(region.id)));
const detailStatus = computed(() =>
  elementStore.tree.value ? "done" : selectedRegions.value.length === 1 ? "active" : "idle");
```

给 `PipelineCanvas` 加开关与插槽（保留 `#status` 与 `RegionsNode` 原样）：

```html
    <PipelineCanvas
      :status="workspaceStatus"
      :detail-status="detailStatus"
      :show-detail="analyzed"
    >
      …原有 #status 与 RegionsNode 保持不动…
      <template #detail-status>
        {{ elementStore.tree.value ? `${elementStore.nodes.value.length} 个元素` : "待解析" }}
      </template>
      <template #detail>
        <DetailNode
          :project-id="store.projectId.value"
          :selected-regions="selectedRegions"
          :element-store="elementStore"
          :hovered-id="hoveredElementId"
          @hover="hoveredElementId = $event"
        />
      </template>
    </PipelineCanvas>
```

在 `onKeydown` 的 `Escape` 分支之前插入元素删除：

```ts
  if (event.key === "Delete" && elementStore.selectedId.value && selectedRegions.value.length === 1) {
    event.preventDefault();
    void elementStore.removeNode(
      store.projectId.value, selectedRegions.value[0]!.bounds, elementStore.selectedId.value,
    );
    return;
  }
```

**不要**让 `Ctrl+Z` 接管元素编辑：撤销栈仍然只属于区域。

- [ ] **Step 8: 运行全部测试与构建**

Run:

```powershell
D:/nodejs/corepack.cmd pnpm test
D:/nodejs/corepack.cmd pnpm typecheck
D:/nodejs/corepack.cmd pnpm --filter @region-split/ui build
git diff --check
```

Expected: 全部通过。特别确认 `App.test.ts`、`RegionsNode.test.ts`、`RegionList.test.ts`、`RegionCanvas.test.ts`、`state.test.ts` 无一回归——区域拆分的既有行为一行都不该变。

- [ ] **Step 9: 目视验收（不可跳过）**

上一版界面就是因为只跑测试没看效果而崩掉的。**测试全绿不等于界面能用**，提交前必须逐条看过。

Run:

```powershell
D:/nodejs/corepack.cmd pnpm --filter @region-split/core dev
```

在浏览器里上传 `packages/region-split/test-fixtures/maicai.png`，等区域分析完成，然后逐条确认：

1. 画布右侧出现「区域详情」节点，标题栏可拖动，只有它移动。
2. 未选中区域时显示「选择一个区域查看详情」；多选时显示「请选择单个区域」。
3. 选中「常用服务」，上段出现该区域裁图，**不变形、不拉伸、不留黑边**，宽度占满节点。
4. 依次改选「采购横幅」（很扁）和「商品推荐」（很高），**上段高度跟着变，比例始终正确，下段的树与属性区高度不变**。
5. 点「解析元素」，图上出现容器标注框，树里出现对应行。
6. 采购横幅那块的类型显示为「图片」，常用服务、卡券资产显示为「组件」。
7. 点击树行，图上对应框高亮；反过来点图上的框，树里对应行高亮；属性面板显示坐标尺寸、背景色、主色占比。
8. 属性面板改名字、改类型，树和图立刻跟着变。
9. 选中一行按 `Delete`，该行消失。
10. 在图上拖一个框，出现「新建容器」节点，被它完整包含的兄弟缩进到它下面。
11. 刷新页面重新选中该区域，上面所有编辑结果仍在。
12. 按 `Ctrl+Z`，撤销的是区域边界而不是元素编辑。
13. 点「适应窗口」，两个节点都完整落在视口内，没有互相重叠。
14. 浏览器控制台没有报错或 Vue 警告。

任何一条不符**先修再提交**。第 3、4 条最关键——上一版就栽在图的尺寸处理上。

- [ ] **Step 10: 提交并推送**

```powershell
git add apps/region-split-ui/src/components/ElementOverlay.vue apps/region-split-ui/src/components/ElementOverlay.test.ts apps/region-split-ui/src/canvas/nodes/DetailNode.vue apps/region-split-ui/src/canvas/nodes/DetailNode.test.ts apps/region-split-ui/src/canvas/canvas-state.ts apps/region-split-ui/src/canvas/canvas-state.test.ts apps/region-split-ui/src/canvas/PipelineCanvas.vue apps/region-split-ui/src/App.vue
git commit -m "feat: add region detail node with element inspector"
git push
```

Expected: 推送成功；若网络重置，保留本地提交并报告，不修改 git config。

---

## 阶段一完成后

界面经人工确认可用之后再开始阶段二（容器内递归切分、布局方向/gap/padding、网格与滚动判定）。阶段二的实施计划届时另写，不要在本阶段提前实现——先把能看见的东西做对。
