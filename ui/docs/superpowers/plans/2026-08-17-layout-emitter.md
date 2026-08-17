# 布局代码生成与叠加比对 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把一个区域的元素树变成能在浏览器里打开的 `index.html` + `style.css`,并在画布上新开一个节点,把生成结果和区域原图叠起来比对,量出还原度。

**Architecture:** 生成器是核心包里的**纯函数**——输入元素树,输出两个字符串,不读图不写盘,可单测。服务端加一条只读路由。前端在画布上新增第三个节点「代码产出」,与「图片区域对照」「区域详情」用贝塞尔连线串起来。

**Tech Stack:** TypeScript、Vitest、Fastify、Vue 3。

设计依据:`docs/superpowers/specs/2026-08-17-codegen-and-fidelity-design.md` 第 1、2、7 节。

## Global Constraints

- **单位只用比例。** `ratio = px / designWidth`,Web 端落成 `vw`(保留 4 位小数)。**纵向也用 `vw`,不能用 `vh`**——页面是可滚动长页,`vh` 随设备高度变,用 `vw` 才保住设计稿宽高比。
- **跨端安全子集**:只用 `div` / `span` / `img`,布局只用 flex 与 absolute。**禁用 grid、伪元素、复杂选择器、`position: fixed`。** 用了就不再是"机械替换成 WXML",而是有损翻译。
- **emitter 不许发明信息。** 缺什么就是缺什么(留占位并在 CSS 注释里标出),不得在生成器里就地猜。要补的信息属于 schema。
- `emit-html.ts` 必须**浏览器安全**:只能 `import type`,不得引 sharp 或任何 node 内置模块。
- 每个阈值常量的注释里写明依据。测试写死实测数据,**不放宽断言**。
- 改了 `packages/region-split` 必须重启 API,tsx 不热重载。
- 命令在 `D:\workspace\ui` 下跑,用 `D:/nodejs/corepack.cmd pnpm` 调用;单包测试先 `cd` 进包目录。
- 新增界面元素要跟随 `refactorStore.rootId` 开关——重构预览态展示的不是真实树。

## 本轮不做

文字内容(只用节点名占位)、字号(留空)、图标与图片资源(空框占位)、交互语义、小程序/RN emitter、自动像素 diff。这些各有独立子项目。

---

### Task 1: 单位换算与叶子生成

**Files:**
- Create: `packages/region-split/src/emit-html.ts`
- Create: `packages/region-split/src/emit-html.test.ts`

**Interfaces:**
- Consumes: `ElementNode`、`ElementTree` from `./element-types.js`;`Rect` from `./types.js`
- Produces:
  - `export function toVw(px: number, designWidth: number): string`
  - `export interface EmitInput { designWidth: number; region: Rect; tree: ElementTree }`
  - `export interface EmitResult { html: string; css: string }`
  - `export function emitHtml(input: EmitInput): EmitResult`

- [ ] **Step 1: 写失败的测试**

创建 `packages/region-split/src/emit-html.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emitHtml, toVw } from "./emit-html.js";
import type { ElementNode, ElementTree } from "./element-types.js";

const REGION = { x: 0, y: 100, w: 1170, h: 300 };

function node(over: Partial<ElementNode> & Pick<ElementNode, "id">): ElementNode {
  return {
    parentId: null, box: { x: 0, y: 100, w: 100, h: 50 }, kind: "component",
    displayName: "节点", style: {}, uniformity: 1, source: "auto",
    classification: "tool", scrollX: false, scrollY: false, positioning: "flow", ...over,
  };
}
const tree = (nodes: ElementNode[]): ElementTree =>
  ({ regionKey: "100-400", detectedAt: "2026-08-17T00:00:00.000Z", nodes });

const emit = (nodes: ElementNode[]) =>
  emitHtml({ designWidth: 1170, region: REGION, tree: tree(nodes) });

describe("toVw", () => {
  // 1170 宽的设计稿：117px 正好是 10vw
  it("turns a pixel length into a share of the design width", () => {
    expect(toVw(117, 1170)).toBe("10vw");
  });

  it("keeps four decimals so rounding never accumulates", () => {
    expect(toVw(1, 1170)).toBe("0.0855vw");
  });

  it("emits a bare zero", () => {
    expect(toVw(0, 1170)).toBe("0");
  });
});

describe("emitHtml", () => {
  it("gives every node a class keyed by its id", () => {
    const { html } = emit([node({ id: "n1" })]);
    expect(html).toContain('class="e-n1"');
  });

  // 位置相对区域原点，不是原图坐标——一个区域生成一份独立的页面
  it("sizes a node from its box, relative to the region", () => {
    const { css } = emit([node({ id: "n1", box: { x: 117, y: 200, w: 234, h: 50 } })]);
    expect(css).toContain("width: 20vw");
    expect(css).toContain("height: 4.2735vw");
  });

  it("renders text as a span carrying its name", () => {
    const { html } = emit([node({ id: "n1", kind: "text", displayName: "联系客服" })]);
    expect(html).toContain("<span");
    expect(html).toContain("联系客服");
    expect(html).toContain('data-todo="text"');
  });

  // 图标和图片这一轮只出占位框，资源导出是另一个子项目
  it("renders an icon as an empty box flagged for assets", () => {
    const { html } = emit([node({ id: "n1", kind: "icon", displayName: "扫一扫" })]);
    expect(html).toContain('data-todo="asset"');
    expect(html).not.toContain("<img");
  });

  it("writes the measured colours and radius", () => {
    const { css } = emit([node({
      id: "n1", kind: "image",
      style: { background: "#ffffff", color: "#191919", borderRadius: 34 },
    })]);
    expect(css).toContain("background: #ffffff");
    expect(css).toContain("color: #191919");
    expect(css).toContain("border-radius: 2.906vw");
  });

  it("escapes text that would otherwise break the markup", () => {
    const { html } = emit([node({ id: "n1", kind: "text", displayName: "<b>&x</b>" })]);
    expect(html).toContain("&lt;b&gt;&amp;x&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });

  // 只用 div/span/img，用了别的就不再是"机械替换成 WXML"
  it("uses only the cross-platform safe tags", () => {
    const { html } = emit([
      node({ id: "n1" }),
      node({ id: "n2", parentId: "n1", kind: "text" }),
      node({ id: "n3", parentId: "n1", kind: "icon" }),
    ]);
    const tags = [...html.matchAll(/<([a-z]+)/g)].map(m => m[1]);
    expect([...new Set(tags)].sort()).toEqual(["div", "section", "span"]);
  });

  it("carries the region background onto the section", () => {
    const { css } = emit([node({ id: "n1" })]);
    expect(css).toContain(".region {");
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm exec vitest run src/emit-html.test.ts
```

Expected: FAIL,`Failed to resolve import "./emit-html.js"`。

- [ ] **Step 3: 写实现**

创建 `packages/region-split/src/emit-html.ts`:

```ts
import { leafKinds, type ElementNode, type ElementTree } from "./element-types.js";
import type { Rect } from "./types.js";

/**
 * 长度一律换算成**占设计稿宽度的比例**。
 *
 * 这是跨端零误差的关键:同一个比例在 Web 落成 `vw`、小程序落成 `rpx`
 * (`ratio × 750`)、RN 落成 `ratio × 屏宽`——三者是同一个线性映射的三种写法,
 * 换算常数精确,不存在舍入漂移。写死 `px` 才是误差来源:到小程序必须按屏宽
 * 重算一遍,那一步才丢精度。
 *
 * **纵向也用 `vw`,绝不能用 `vh`。** 页面是可滚动长页,`vh` 随设备高度变;
 * 用 `vw` 表达纵向尺寸才保住了设计稿的宽高比。
 *
 * 保留 4 位小数:1170 宽的图上 1px = 0.0855vw,4 位足以让最小单位不丢。
 */
export function toVw(px: number, designWidth: number): string {
  if (px === 0) return "0";
  const value = (px / designWidth) * 100;
  return `${Number(value.toFixed(4))}vw`;
}

export interface EmitInput {
  /** 设计稿宽度,取原图宽度 */
  designWidth: number;
  /** 这一份产出对应的区域,节点坐标会换算成相对它的偏移 */
  region: Rect;
  tree: ElementTree;
}

export interface EmitResult {
  html: string;
  css: string;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => ESCAPES[ch]!);
}

/** 叶子用什么标签:文字是 span,其余都是 div。三种标签就是跨端安全子集的全部。 */
function tagOf(node: ElementNode): "span" | "div" {
  return node.kind === "text" ? "span" : "div";
}

function childrenOf(nodes: ElementNode[], parentId: string | null): ElementNode[] {
  return nodes
    .filter(node => node.parentId === parentId)
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
}

/**
 * 生成一个区域的 HTML 与 CSS。
 *
 * 节点坐标换算成**相对区域原点**的偏移——一个区域生成一份独立的页面,
 * 这样它能和该区域的裁图直接叠起来比对。
 *
 * 本轮不产出文字内容与图标资源:文字用节点名占位并打 `data-todo="text"`,
 * 图标图片出空框打 `data-todo="asset"`。这两样是 IR 的缺口,属于各自的子项目,
 * **不能在生成器里就地猜**。
 */
export function emitHtml(input: EmitInput): EmitResult {
  const { designWidth, region, tree } = input;
  const px = (value: number) => toVw(value, designWidth);
  const rules: string[] = [];

  rules.push([
    ".region {",
    "  position: relative;",
    `  width: ${px(region.w)};`,
    `  height: ${px(region.h)};`,
    ...(tree.background ? [`  background: ${tree.background};`] : []),
    "}",
  ].join("\n"));

  const renderNode = (node: ElementNode, depth: number): string => {
    const pad = "  ".repeat(depth + 1);
    const kids = childrenOf(tree.nodes, node.id);
    const declarations = [
      `  width: ${px(node.box.w)};`,
      `  height: ${px(node.box.h)};`,
      `  left: ${px(node.box.x - region.x)};`,
      `  top: ${px(node.box.y - region.y)};`,
      "  position: absolute;",
      ...(node.style.background ? [`  background: ${node.style.background};`] : []),
      ...(node.style.color ? [`  color: ${node.style.color};`] : []),
      ...(node.style.borderRadius
        ? [`  border-radius: ${px(node.style.borderRadius)};`] : []),
    ];
    rules.push(`/* ${node.displayName} */\n.e-${node.id} {\n${declarations.join("\n")}\n}`);

    const todo = leafKinds.includes(node.kind)
      ? ` data-todo="${node.kind === "text" ? "text" : "asset"}"`
      : "";
    const tag = tagOf(node);
    const body = node.kind === "text" ? escapeHtml(node.displayName) : "";
    const inner = kids.length > 0
      ? `\n${kids.map(kid => renderNode(kid, depth + 1)).join("\n")}\n${pad}`
      : body;
    return `${pad}<${tag} class="e-${node.id}"${todo}>${inner}</${tag}>`;
  };

  const roots = childrenOf(tree.nodes, null);
  const html = [
    '<section class="region">',
    ...roots.map(root => renderNode(root, 0)),
    "</section>",
  ].join("\n");

  return { html, css: rules.join("\n\n") };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm exec vitest run src/emit-html.test.ts
```

Expected: PASS,12 passed。

- [ ] **Step 5: 提交**

```bash
git add packages/region-split/src/emit-html.ts packages/region-split/src/emit-html.test.ts
git commit -m "feat: emit a region's element tree as html and css"
```

---

### Task 2: flex 复现得了就用 flex,复现不了退回绝对定位

**Files:**
- Modify: `packages/region-split/src/emit-html.ts`
- Modify: `packages/region-split/src/emit-html.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `emitHtml`
- Produces:
  - `export const FLEX_TOLERANCE = 2`
  - `export function flexDeviation(parent: Rect, children: Rect[], layout: LayoutInfo): number`

- [ ] **Step 1: 写失败的测试**

追加到 `packages/region-split/src/emit-html.test.ts`:

```ts
import { FLEX_TOLERANCE, flexDeviation } from "./emit-html.js";

describe("flexDeviation", () => {
  const layout = (over: Partial<import("./element-cut.js").LayoutInfo> = {}) => ({
    direction: "row" as const, gap: 20,
    padding: { top: 0, right: 10, bottom: 0, left: 10 }, ...over,
  });

  // 等距等宽：flex 摆出来和实测一模一样
  it("is zero when flex reproduces the measured positions", () => {
    const deviation = flexDeviation(
      { x: 0, y: 0, w: 200, h: 50 },
      [{ x: 10, y: 0, w: 50, h: 50 }, { x: 80, y: 0, w: 50, h: 50 }],
      layout(),
    );
    expect(deviation).toBe(0);
  });

  // 子块宽度不同导致边距不等：flex 用同一个 gap 摆，后面的会越差越远
  it("grows with the drift a single gap cannot express", () => {
    const deviation = flexDeviation(
      { x: 0, y: 0, w: 400, h: 50 },
      [
        { x: 10, y: 0, w: 50, h: 50 },
        { x: 80, y: 0, w: 30, h: 50 },
        { x: 140, y: 0, w: 50, h: 50 },
      ],
      layout(),
    );
    // 第三块实测 140，flex 摆到 10+50+20+30+20 = 130，差 10
    expect(deviation).toBe(10);
  });

  it("measures a column along the vertical axis", () => {
    const deviation = flexDeviation(
      { x: 0, y: 0, w: 50, h: 200 },
      [{ x: 0, y: 10, w: 50, h: 40 }, { x: 0, y: 70, w: 50, h: 40 }],
      layout({ direction: "column", gap: 20, padding: { top: 10, right: 0, bottom: 0, left: 0 } }),
    );
    expect(deviation).toBe(0);
  });
});

describe("emitHtml 的布局选择", () => {
  const parent = node({
    id: "p", box: { x: 0, y: 100, w: 200, h: 50 },
    layout: { direction: "row", gap: 20, padding: { top: 0, right: 10, bottom: 0, left: 10 } },
  });

  it("uses flex when it reproduces the measured positions", () => {
    const { css } = emit([
      parent,
      node({ id: "a", parentId: "p", box: { x: 10, y: 100, w: 50, h: 50 } }),
      node({ id: "b", parentId: "p", box: { x: 80, y: 100, w: 50, h: 50 } }),
    ]);
    expect(css).toContain("display: flex");
    expect(css).toContain("flex-direction: row");
    expect(css).toContain("gap: 1.7094vw");
    // 走 flex 的子块不再写绝对定位
    expect(css).not.toMatch(/\.e-a \{[^}]*position: absolute/);
  });

  // 复现不了就退回绝对定位，并把偏差写进注释——那是"这一层还没解析对"的信号
  it("falls back to absolute and records the deviation", () => {
    const { css } = emit([
      node({
        id: "p", box: { x: 0, y: 100, w: 400, h: 50 },
        layout: { direction: "row", gap: 20, padding: { top: 0, right: 10, bottom: 0, left: 10 } },
      }),
      node({ id: "a", parentId: "p", box: { x: 10, y: 100, w: 50, h: 50 } }),
      node({ id: "b", parentId: "p", box: { x: 80, y: 100, w: 30, h: 50 } }),
      node({ id: "c", parentId: "p", box: { x: 140, y: 100, w: 50, h: 50 } }),
    ]);
    expect(css).toContain("flex 复现不了");
    expect(css).toContain("10px");
    expect(css).toMatch(/\.e-a \{[^}]*position: absolute/);
  });

  it("keeps an absolute node absolute even inside a flex parent", () => {
    const { css } = emit([
      parent,
      node({ id: "a", parentId: "p", box: { x: 10, y: 100, w: 50, h: 50 } }),
      node({ id: "b", parentId: "p", box: { x: 80, y: 100, w: 50, h: 50 } }),
      node({ id: "badge", parentId: "p", box: { x: 50, y: 100, w: 10, h: 10 }, positioning: "absolute" }),
    ]);
    expect(css).toMatch(/\.e-badge \{[^}]*position: absolute/);
  });

  it("takes 2px of drift but not 3", () => {
    expect(FLEX_TOLERANCE).toBe(2);
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm exec vitest run src/emit-html.test.ts
```

Expected: FAIL,`flexDeviation is not a function`。

- [ ] **Step 3: 写实现**

在 `packages/region-split/src/emit-html.ts` 的 import 区加:

```ts
import type { LayoutInfo } from "./element-cut.js";
import type { Rect } from "./types.js";
```

在 `emitHtml` 之前加:

```ts
/**
 * flex 摆出来的位置与实测最多差多少还算可用。
 *
 * 取 2px:再小会因为 padding/gap 各自的四舍五入频繁误判,再大就开始容忍
 * 肉眼看得出的错位。这个数字是**判据的松紧**,不是测量出来的物理量。
 */
export const FLEX_TOLERANCE = 2;

/**
 * 按 flex 摆这批子块,与实测位置的最大偏差。
 *
 * flex 用**同一个 gap** 把子块等距摆开,可子块各自收紧到自己的内容、宽度不同,
 * 实测边距因此未必相等——偏差会沿主轴累积。实测「常用服务」那类重复组按 gap
 * 生成时第 3 格偏 16.5px、第 4 格偏 17px。
 *
 * 交叉轴不参与:子块在交叉轴上由 align 与自身尺寸决定,不受 gap 影响。
 */
export function flexDeviation(
  parent: Rect, children: Rect[], layout: LayoutInfo,
): number {
  if (children.length === 0) return 0;
  const horizontal = layout.direction === "row";
  const startOf = (box: Rect) => horizontal ? box.x : box.y;
  const sizeOf = (box: Rect) => horizontal ? box.w : box.h;

  const sorted = [...children].sort((a, b) => startOf(a) - startOf(b));
  let cursor = (horizontal ? parent.x : parent.y)
    + (horizontal ? layout.padding.left : layout.padding.top);
  let worst = 0;
  for (const child of sorted) {
    worst = Math.max(worst, Math.abs(startOf(child) - cursor));
    cursor += sizeOf(child) + layout.gap;
  }
  return worst;
}
```

然后改 `emitHtml` 里的 `renderNode`,把原来那段 `declarations` 换成按父节点的排布方式分流:

```ts
  const renderNode = (node: ElementNode, depth: number, flexParent: boolean): string => {
    const pad = "  ".repeat(depth + 1);
    const kids = childrenOf(tree.nodes, node.id);

    // 这个容器的子块能不能用 flex 摆对
    const flowKids = kids.filter(kid => kid.positioning === "flow");
    const deviation = node.layout && flowKids.length > 1
      ? flexDeviation(node.box, flowKids.map(kid => kid.box), node.layout)
      : 0;
    const useFlex = node.layout !== undefined && flowKids.length > 1
      && deviation <= FLEX_TOLERANCE;

    // 父节点走 flex 且自己是流内节点时，位置由 flex 决定，不写绝对定位
    const positioned = !flexParent || node.positioning === "absolute";
    const declarations = [
      `  width: ${px(node.box.w)};`,
      `  height: ${px(node.box.h)};`,
      ...(positioned ? [
        "  position: absolute;",
        `  left: ${px(node.box.x - region.x)};`,
        `  top: ${px(node.box.y - region.y)};`,
      ] : []),
      ...(useFlex ? [
        "  display: flex;",
        `  flex-direction: ${node.layout!.direction};`,
        `  gap: ${px(node.layout!.gap)};`,
        `  padding: ${px(node.layout!.padding.top)} ${px(node.layout!.padding.right)}`
          + ` ${px(node.layout!.padding.bottom)} ${px(node.layout!.padding.left)};`,
        "  box-sizing: border-box;",
      ] : []),
      ...(node.style.background ? [`  background: ${node.style.background};`] : []),
      ...(node.style.color ? [`  color: ${node.style.color};`] : []),
      ...(node.style.borderRadius
        ? [`  border-radius: ${px(node.style.borderRadius)};`] : []),
    ];

    const note = node.layout && flowKids.length > 1 && !useFlex
      ? `\n/* flex 复现不了这一层：最大偏差 ${Math.round(deviation)}px，改用绝对定位。`
        + "\n   偏差大说明这一层的结构还没解析对，值得回去看框。 */"
      : "";
    rules.push(`/* ${node.displayName} */${note}\n.e-${node.id} {\n${declarations.join("\n")}\n}`);

    const todo = leafKinds.includes(node.kind)
      ? ` data-todo="${node.kind === "text" ? "text" : "asset"}"`
      : "";
    const tag = tagOf(node);
    const body = node.kind === "text" ? escapeHtml(node.displayName) : "";
    const inner = kids.length > 0
      ? `\n${kids.map(kid => renderNode(kid, depth + 1, useFlex)).join("\n")}\n${pad}`
      : body;
    return `${pad}<${tag} class="e-${node.id}"${todo}>${inner}</${tag}>`;
  };
```

以及最后那句根节点调用改成:

```ts
    ...roots.map(root => renderNode(root, 0, false)),
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: 全部 PASS,typecheck 无输出。

- [ ] **Step 5: 提交**

```bash
git add packages/region-split/src/emit-html.ts packages/region-split/src/emit-html.test.ts
git commit -m "feat: fall back to absolute positioning when flex cannot reproduce the boxes"
```

---

### Task 3: 重复组按 pitch 出等宽格子

**Files:**
- Modify: `packages/region-split/src/emit-html.ts`
- Modify: `packages/region-split/src/emit-html.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `renderNode` 分流、`ElementNode.repeat`
- Produces: 带 `repeat` 的容器产出等宽格子而非 `gap`

- [ ] **Step 1: 写失败的测试**

追加到 `packages/region-split/src/emit-html.test.ts`:

```ts
describe("重复组", () => {
  /**
   * 实测「常用服务」那类宫格：中心距恒为 219.75，但子块各自收紧到内容，
   * 宽度是 141/105/103/140/105，边距因此不等（97/116/98/97）。
   * 按 gap 生成会让第 3 格偏 16.5px、第 4 格偏 17px。
   */
  const grid = () => [
    node({
      id: "g", kind: "grid", box: { x: 36, y: 100, w: 1098, h: 255 },
      layout: { direction: "row", gap: 98, padding: { top: 59, right: 42, bottom: 18, left: 38 } },
      repeat: { count: 5, templateId: "c1", pitch: 219.75 },
    }),
    node({ id: "c1", parentId: "g", box: { x: 74, y: 192, w: 141, h: 132 } }),
    node({ id: "c2", parentId: "g", box: { x: 312, y: 192, w: 105, h: 132 } }),
    node({ id: "c3", parentId: "g", box: { x: 533, y: 192, w: 103, h: 132 } }),
    node({ id: "c4", parentId: "g", box: { x: 734, y: 192, w: 140, h: 132 } }),
    node({ id: "c5", parentId: "g", box: { x: 971, y: 192, w: 105, h: 132 } }),
  ];

  it("gives each cell the pitch as its width", () => {
    const { css } = emit(grid());
    // 219.75 / 1170 * 100 = 18.7821vw
    expect(css).toContain("width: 18.7821vw");
    expect(css).toContain(".e-g > * {");
  });

  it("centres the content inside each cell", () => {
    const { css } = emit(grid());
    expect(css).toMatch(/\.e-g > \* \{[^}]*justify-content: center/);
  });

  // gap 对重复组只是参考值，绝不能拿它定位
  it("does not position a repeat group with gap", () => {
    const { css } = emit(grid());
    const rule = /\.e-g \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).not.toContain("gap:");
  });

  it("says in a comment that the group is a repeat", () => {
    expect(emit(grid()).css).toContain("5 项重复");
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm exec vitest run src/emit-html.test.ts
```

Expected: FAIL,找不到 `width: 18.7821vw`。

- [ ] **Step 3: 写实现**

在 `packages/region-split/src/emit-html.ts` 的 `renderNode` 里,把判定 `useFlex` 的那几行改成先看 `repeat`:

```ts
    // 重复组按 pitch 出等宽格子：中心距是齐的，边距不齐（子块宽度不同）。
    // 实测按 gap 生成会让第 3 格偏 16.5px、第 4 格偏 17px——gap 对重复组
    // 只是参考值，不得用来定位。
    const asRepeat = node.repeat !== undefined && flowKids.length > 1;

    const deviation = !asRepeat && node.layout && flowKids.length > 1
      ? flexDeviation(node.box, flowKids.map(kid => kid.box), node.layout)
      : 0;
    const useFlex = asRepeat
      || (node.layout !== undefined && flowKids.length > 1 && deviation <= FLEX_TOLERANCE);
```

把 `declarations` 里那段 `useFlex` 分支改成区分两种 flex:

```ts
      ...(useFlex ? [
        "  display: flex;",
        `  flex-direction: ${node.layout?.direction ?? "row"};`,
        ...(asRepeat ? [] : [`  gap: ${px(node.layout!.gap)};`]),
        ...(node.layout ? [
          `  padding: ${px(node.layout.padding.top)} ${px(node.layout.padding.right)}`
            + ` ${px(node.layout.padding.bottom)} ${px(node.layout.padding.left)};`,
        ] : []),
        "  box-sizing: border-box;",
      ] : []),
```

在 `rules.push(...)` 那一句之后加上格子规则:

```ts
    if (asRepeat) {
      const pitch = node.repeat!.pitch;
      rules.push([
        `/* ${node.displayName}：${node.repeat!.count} 项重复，按中心距出等宽格子。`,
        "   子块宽度不同，用 gap 会让位置沿主轴累积偏移。 */",
        `.e-${node.id} > * {`,
        `  width: ${px(pitch)};`,
        "  display: flex;",
        "  justify-content: center;",
        "  align-items: center;",
        "  flex: 0 0 auto;",
        "}",
      ].join("\n"));
    }
```

注意 `note` 的条件也要排除重复组,否则重复组会同时打上"flex 复现不了"的注释:

```ts
    const note = !asRepeat && node.layout && flowKids.length > 1 && !useFlex
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: 全部 PASS,typecheck 无输出。

- [ ] **Step 5: 提交**

```bash
git add packages/region-split/src/emit-html.ts packages/region-split/src/emit-html.test.ts
git commit -m "feat: lay repeat groups out on their pitch instead of a gap"
```

---

### Task 4: 服务端路由

**Files:**
- Modify: `packages/region-split/src/server.ts`
- Modify: `packages/region-split/src/server.test.ts`
- Modify: `packages/region-split/src/browser.ts`

**Interfaces:**
- Consumes: Task 3 的 `emitHtml`
- Produces: `GET /api/projects/:projectId/code?y=&h=` → `{ html, css } | { error }`

- [ ] **Step 1: 写失败的测试**

追加到 `packages/region-split/src/server.test.ts` 的顶层 `describe` 内(沿用该文件已有的建 app / 建项目 helper,不要新造):

```ts
  it("emits code for a region that has been parsed", async () => {
    const { app, projectId } = await projectWithElements();
    const res = await app.inject({
      method: "GET", url: `/api/projects/${projectId}/code?y=0&h=338`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { html: string; css: string };
    expect(body.html).toContain('<section class="region">');
    expect(body.css).toContain(".region {");
  });

  // 没解析过不是错误，是正常状态——和读元素树的路由保持一致
  it("returns 404 for a region with no element tree", async () => {
    const { app, projectId } = await projectWithElements();
    const res = await app.inject({
      method: "GET", url: `/api/projects/${projectId}/code?y=9000&h=100`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a malformed region", async () => {
    const { app, projectId } = await projectWithElements();
    const res = await app.inject({
      method: "GET", url: `/api/projects/${projectId}/code?y=abc&h=100`,
    });
    expect(res.statusCode).toBe(400);
  });
```

若该文件里还没有 `projectWithElements` 这样的 helper,用文件中已有的、能建出"含元素树的项目"的那套写法替代;**不要新建一套 fixture 体系**。

- [ ] **Step 2: 跑测试确认它失败**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm exec vitest run src/server.test.ts
```

Expected: FAIL,404 或路由不存在。

- [ ] **Step 3: 写实现**

在 `packages/region-split/src/server.ts` 的 import 区加:

```ts
import { emitHtml } from "./emit-html.js";
```

在 `/api/projects/:projectId/elements` 的 GET 路由**之后**插入:

```ts
  app.get<{ Params: ProjectParams; Querystring: { y?: string; h?: string } }>(
    "/api/projects/:projectId/code", async (req, reply) => {
      const { projectId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      const y = Number(req.query.y);
      const h = Number(req.query.h);
      if (!Number.isInteger(y) || !Number.isInteger(h)) {
        return reply.code(400).send({ error: "invalid region" });
      }
      const tree = store.readElementTree(projectId, regionKey({ x: 0, y, w: 0, h }));
      // 没解析过就没有代码可出。这里用 404 而不是 null：读元素树时 null 是正常状态，
      // 而"要代码"是个明确的请求，拿不到就是拿不到。
      if (!tree) return reply.code(404).send({ error: "region not parsed" });
      const doc = store.readDoc(projectId);
      return emitHtml({
        designWidth: doc.image.width,
        region: { x: 0, y, w: doc.image.width, h },
        tree,
      });
    });
```

`store.readDoc(projectId)` 返回 `RegionSplitDoc`,`doc.image.width` 就是原图宽度(基准图上是 1170)——设计稿宽度取它。

在 `packages/region-split/src/browser.ts` 里把 emitter 的类型导出加上,供前端复用类型(**只导出类型与纯函数,不要引入任何 node 依赖**):

```ts
export { emitHtml, toVw, type EmitInput, type EmitResult } from "./emit-html.js";
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: 全部 PASS。前端的 build 也要过:

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm build
```

Expected: 成功。**如果失败并提示打包进了 sharp / fastify / node 内置模块**,说明 `browser.ts` 的导出把服务端依赖拉进来了——检查 `emit-html.ts` 是不是只有 `import type`。

- [ ] **Step 5: 提交**

```bash
git add packages/region-split/src/server.ts packages/region-split/src/server.test.ts packages/region-split/src/browser.ts
git commit -m "feat: serve generated code for a parsed region"
```

---

### Task 5: 画布新增第三个节点并连线

**Files:**
- Modify: `apps/region-split-ui/src/canvas/canvas-state.ts`
- Modify: `apps/region-split-ui/src/canvas/canvas-state.test.ts`
- Modify: `apps/region-split-ui/src/canvas/PipelineCanvas.vue`
- Modify: `apps/region-split-ui/src/canvas/PipelineNode.vue`

**Interfaces:**
- Consumes: 现有 `NodeId`、`DEFAULT_NODE_POSITIONS`、`PipelineNode` 的 `input`/`output` prop
- Produces:
  - `NodeId` 增加 `"code"`
  - `export function portAnchors(positions, widths): { from: Point; to: Point }[]`
  - `export function bezierPath(from: Point, to: Point): string`
  - `PipelineCanvas` 暴露具名插槽 `code` 与 `code-status`,prop `showCode` / `codeStatus`

- [ ] **Step 1: 写失败的测试**

追加到 `apps/region-split-ui/src/canvas/canvas-state.test.ts`:

```ts
import { bezierPath, portAnchors, DEFAULT_NODE_POSITIONS } from "./canvas-state.js";

describe("端口与连线", () => {
  it("defaults the code node to the right of the detail node", () => {
    expect(DEFAULT_NODE_POSITIONS.code.x)
      .toBeGreaterThan(DEFAULT_NODE_POSITIONS.detail.x);
  });

  // 输出口在节点右边缘，输入口在左边缘，圆心都在顶部 21px（与 .port 的 CSS 对齐）
  it("anchors ports on the node edges at the header line", () => {
    const [first] = portAnchors(
      { workspace: { x: 0, y: 0 }, detail: { x: 500, y: 40 }, code: { x: 1000, y: 80 } },
      { workspace: 400, detail: 300, code: 300 },
    );
    expect(first).toEqual({ from: { x: 400, y: 21 }, to: { x: 500, y: 61 } });
  });

  it("links workspace to detail and detail to code", () => {
    expect(portAnchors(
      { workspace: { x: 0, y: 0 }, detail: { x: 500, y: 0 }, code: { x: 1000, y: 0 } },
      { workspace: 400, detail: 300, code: 300 },
    )).toHaveLength(2);
  });

  // 控制点水平伸出，得到 ComfyUI 那种左右拉开的曲线
  it("draws a cubic curve with horizontal handles", () => {
    expect(bezierPath({ x: 0, y: 0 }, { x: 200, y: 100 }))
      .toBe("M 0 0 C 100 0, 100 100, 200 100");
  });

  // 两点很近时仍要有可见的弧度，否则退化成直线看不出是连线
  it("keeps a minimum handle length when the nodes are close", () => {
    expect(bezierPath({ x: 0, y: 0 }, { x: 20, y: 0 }))
      .toBe("M 0 0 C 60 0, -40 0, 20 0");
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm exec vitest run src/canvas/canvas-state.test.ts
```

Expected: FAIL,`portAnchors is not a function`。

- [ ] **Step 3: 写实现**

在 `apps/region-split-ui/src/canvas/canvas-state.ts` 里:

```ts
export type NodeId = "workspace" | "detail" | "code";
```

```ts
export const DEFAULT_NODE_POSITIONS: NodePositions = {
  workspace: { x: 120, y: 80 },
  detail: { x: 1345, y: 80 },
  code: { x: 2185, y: 80 },
};
```

`loadNodePositions` 按 `Object.keys(fallback)` 遍历,已存的旧位置里没有 `code` 会自动取默认值,**不需要升存储键的版本号**。

在文件末尾追加:

```ts
/**
 * 端口圆心到节点顶部的距离。与 `PipelineNode.vue` 里 `.port { top: 21px }` 对齐——
 * 改那边就要改这里，否则连线会从圆点旁边穿出去。
 */
const PORT_Y = 21;

/** 管线顺序：区域对照 → 区域详情 → 代码产出 */
const PIPELINE: readonly [NodeId, NodeId][] = [
  ["workspace", "detail"],
  ["detail", "code"],
];

/** 每条连线的起止点，坐标在世界空间里（与节点位置同一套） */
export function portAnchors(
  positions: NodePositions, widths: Record<NodeId, number>,
): { from: Point; to: Point }[] {
  return PIPELINE.map(([from, to]) => ({
    from: { x: positions[from].x + widths[from], y: positions[from].y + PORT_Y },
    to: { x: positions[to].x, y: positions[to].y + PORT_Y },
  }));
}

/** 控制点最短伸出长度。太短会退化成直线，看不出是一根连线。 */
const MIN_HANDLE = 60;

/**
 * ComfyUI 那种连线：三次贝塞尔，两个控制点**水平**伸出。
 * 水平伸出是关键——竖直或斜向的控制点会让线在节点上方绕出难看的弧。
 */
export function bezierPath(from: Point, to: Point): string {
  const handle = Math.max(MIN_HANDLE, Math.abs(to.x - from.x) * 0.5);
  return `M ${from.x} ${from.y} C ${from.x + handle} ${from.y},`
    + ` ${to.x - handle} ${to.y}, ${to.x} ${to.y}`;
}
```

在 `apps/region-split-ui/src/canvas/PipelineCanvas.vue` 里:

1. import 补上 `bezierPath, portAnchors`。
2. 加宽度常量与 props:

```ts
/** 代码产出节点的宽度，与模板里 PipelineNode 的 :width 保持一致 */
const CODE_WIDTH = 760;
```

props 增加 `showCode?: boolean` 与 `codeStatus?: string`(照现有 `showDetail` / `detailStatus` 的写法)。

3. 加连线数据:

```ts
const linkPaths = computed(() => {
  const widths = {
    workspace: fallbackSize.value.width, detail: DETAIL_WIDTH, code: CODE_WIDTH,
  } as Record<NodeId, number>;
  const anchors = portAnchors(positions, widths);
  // 只画两端都显示着的连线
  const visible = [props.showDetail, props.showDetail && props.showCode];
  return anchors.filter((_, i) => visible[i]).map(a => bezierPath(a.from, a.to));
});
```

4. 在 `.world` 内、**节点之前**插入 SVG 层(在节点之前才会被节点盖住,连线看起来是从圆点后面穿出的):

```vue
      <svg class="links" aria-hidden="true">
        <path v-for="(d, i) in linkPaths" :key="i" :d="d" />
      </svg>
```

5. 加节点块,放在 detail 那块之后:

```vue
        <PipelineNode
          v-if="props.showCode"
          node-id="code"
          title="代码产出"
          :position="positions.code"
          :width="CODE_WIDTH"
          :min-height="420"
          :status="props.codeStatus"
          :input="true"
          :output="false"
          @drag-start="onNodeDragStart"
        >
          <template #status><slot name="code-status" /></template>
          <slot name="code" />
        </PipelineNode>
```

6. 把已有两个节点的端口打开:`workspace` 改成 `:output="true"`,`detail` 改成 `:input="true" :output="true"`。

7. `fitAll` 里把新节点算进去,在 `if (props.showDetail) ...` 那句之后加:

```ts
  if (props.showCode) boxes.push(measure("code", CODE_WIDTH));
```

8. 样式里加:

```css
.links { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; z-index: 0; }
.links path { fill: none; stroke: var(--border-strong); stroke-width: 2; }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json
```

Expected: 全部 PASS,typecheck 无输出。

- [ ] **Step 5: 提交**

```bash
git add apps/region-split-ui/src/canvas/canvas-state.ts apps/region-split-ui/src/canvas/canvas-state.test.ts apps/region-split-ui/src/canvas/PipelineCanvas.vue apps/region-split-ui/src/canvas/PipelineNode.vue
git commit -m "feat: add a code node and wire the three nodes together"
```

---

### Task 6: 代码产出节点与叠加比对

**Files:**
- Create: `apps/region-split-ui/src/canvas/nodes/CodeNode.vue`
- Create: `apps/region-split-ui/src/canvas/nodes/CodeNode.test.ts`
- Modify: `apps/region-split-ui/src/api.ts`
- Modify: `apps/region-split-ui/src/App.vue`

**Interfaces:**
- Consumes: Task 4 的路由、Task 5 的 `code` 插槽
- Produces: 无(终点任务)

- [ ] **Step 1: 写失败的测试**

创建 `apps/region-split-ui/src/canvas/nodes/CodeNode.test.ts`:

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import CodeNode from "./CodeNode.vue";
import type { Region } from "@region-split/core/browser";

const region = (y: number, h: number): Region => ({
  id: "r1", displayName: "账户顶部", type: "other", bounds: { x: 0, y, w: 1170, h },
  confidence: 1, scrollX: false, scrollY: false,
});

const stubApi = (code: { html: string; css: string } | null = null) => ({
  getCode: vi.fn(async () => {
    if (!code) throw new Error("region not parsed");
    return code;
  }),
});

const mountNode = (over: Record<string, unknown> = {}, api = stubApi()) =>
  mount(CodeNode, { props: { projectId: "p1", selectedRegions: [], api, ...over } });

describe("CodeNode", () => {
  it("asks for a selection when nothing is selected", () => {
    expect(mountNode().text()).toContain("选择一个区域");
  });

  it("asks for a single selection when several are selected", () => {
    expect(mountNode({ selectedRegions: [region(0, 100), region(100, 100)] }).text())
      .toContain("请选择单个区域");
  });

  it("generates on demand and renders the result in an iframe", async () => {
    const api = stubApi({ html: "<section class=\"region\"></section>", css: ".region {}" });
    const wrapper = mountNode({ selectedRegions: [region(0, 338)] }, api);
    await wrapper.find('[data-test="generate-code"]').trigger("click");
    await nextTick(); await nextTick();
    expect(api.getCode).toHaveBeenCalledWith("p1", 0, 338);
    expect(wrapper.find('[data-test="code-frame"]').attributes("srcdoc"))
      .toContain('class="region"');
  });

  // 没解析过是最常见的失败，要说人话而不是抛原始错误
  it("explains that the region has not been parsed yet", async () => {
    const wrapper = mountNode({ selectedRegions: [region(0, 338)] }, stubApi(null));
    await wrapper.find('[data-test="generate-code"]').trigger("click");
    await nextTick(); await nextTick();
    expect(wrapper.find('[data-test="code-error"]').text()).toContain("先在区域详情里解析元素");
  });

  it("moves the overlay opacity", async () => {
    const api = stubApi({ html: "<section></section>", css: "" });
    const wrapper = mountNode({ selectedRegions: [region(0, 338)] }, api);
    await wrapper.find('[data-test="generate-code"]').trigger("click");
    await nextTick(); await nextTick();
    const slider = wrapper.find('[data-test="overlay-opacity"]');
    await slider.setValue("30");
    expect(wrapper.find('[data-test="code-frame"]').attributes("style")).toContain("0.3");
  });

  // 换区域后旧的产出必须清掉，否则会把上一个区域的代码当成这个区域的
  it("drops the previous output when the region changes", async () => {
    const api = stubApi({ html: "<section></section>", css: "" });
    const wrapper = mountNode({ selectedRegions: [region(0, 338)] }, api);
    await wrapper.find('[data-test="generate-code"]').trigger("click");
    await nextTick(); await nextTick();
    await wrapper.setProps({ selectedRegions: [region(400, 200)] });
    await nextTick();
    expect(wrapper.find('[data-test="code-frame"]').exists()).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm exec vitest run src/canvas/nodes/CodeNode.test.ts
```

Expected: FAIL,找不到 `./CodeNode.vue`。

- [ ] **Step 3: 写实现**

先在 `apps/region-split-ui/src/api.ts` 的 `StoreApi` 接口里加:

```ts
  getCode(projectId: string, y: number, h: number): Promise<{ html: string; css: string }>;
```

并在 `httpApi` 里实现:

```ts
  getCode(projectId, y, h) {
    return json(`/api/projects/${projectId}/code?y=${y}&h=${h}`);
  },
```

创建 `apps/region-split-ui/src/canvas/nodes/CodeNode.vue`:

```vue
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Rect, Region } from "@region-split/core/browser";
import { regionImageUrl } from "../../api.js";

const props = defineProps<{
  projectId: string;
  selectedRegions: Region[];
  api: { getCode(projectId: string, y: number, h: number): Promise<{ html: string; css: string }> };
}>();

const single = computed(() =>
  props.selectedRegions.length === 1 ? props.selectedRegions[0]! : null);
const region = computed<Rect | null>(() => single.value?.bounds ?? null);

const code = ref<{ html: string; css: string } | null>(null);
const error = ref("");
const busy = ref(false);
/** 生成结果盖在原图上的不透明度，0 只看原图、100 只看生成结果 */
const opacity = ref(50);

// 换区域后旧产出必须清掉，否则会把上一个区域的代码当成这个区域的
watch(region, () => { code.value = null; error.value = ""; });

/**
 * 生成结果塞进 iframe 的 srcdoc。
 *
 * 用 iframe 而不是直接插进页面：生成的 CSS 用的是 `vw`，那是**视口**宽度的比例。
 * 只有把它放进一个宽度等于区域显示宽度的独立文档里，`100vw` 才等于区域宽度，
 * 才能和下面那张区域裁图逐像素对齐。直接插进本页面的话 `vw` 会算成整个窗口宽度。
 */
const srcdoc = computed(() => code.value
  ? `<!doctype html><meta charset="utf-8">`
    + `<style>*{margin:0;padding:0}html,body{overflow:hidden}${code.value.css}</style>`
    + code.value.html
  : "");

const sourceUrl = computed(() =>
  region.value ? regionImageUrl(props.projectId, region.value) : "");

async function generate() {
  const rect = region.value;
  if (!rect || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    code.value = await props.api.getCode(props.projectId, rect.y, rect.h);
  } catch (err) {
    const message = (err as Error).message;
    // 没解析过是最常见的失败，说人话而不是把原始错误甩出来
    error.value = message.includes("not parsed")
      ? "这个区域还没有元素树，先在区域详情里解析元素"
      : message;
    code.value = null;
  } finally {
    busy.value = false;
  }
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="code-node" @pointerdown.stop @click.stop>
    <p v-if="!single" class="hint">
      {{ props.selectedRegions.length > 1 ? "请选择单个区域" : "选择一个区域生成代码" }}
    </p>
    <template v-else>
      <div class="bar">
        <button data-test="generate-code" :disabled="busy" @click="generate">
          {{ busy ? "生成中…" : "生成代码" }}
        </button>
        <template v-if="code">
          <label class="slider">
            叠加
            <input
              data-test="overlay-opacity" type="range" min="0" max="100"
              :value="opacity" @input="opacity = Number(($event.target as HTMLInputElement).value)"
            >
            <span class="value">{{ opacity }}%</span>
          </label>
          <button @click="download('index.html', code.html)">下载 HTML</button>
          <button @click="download('style.css', code.css)">下载 CSS</button>
        </template>
        <span v-if="error" data-test="code-error" class="error">{{ error }}</span>
      </div>

      <section v-if="code && region" class="compare">
        <header>生成结果叠在原图上——拖滑块看哪里错位</header>
        <div class="stack" :style="{ aspectRatio: `${region.w} / ${region.h}` }">
          <img class="source" :src="sourceUrl" alt="区域原图">
          <iframe
            data-test="code-frame" class="frame" :srcdoc="srcdoc"
            :style="{ opacity: opacity / 100 }" title="生成结果"
          />
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.code-node { display: flex; flex-direction: column; }
.hint { margin: 0; padding: 18px 12px; color: var(--text-dim); font-size: 11px; }
.bar { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-bottom: 1px solid var(--border); font-size: 10px; }
.slider { display: flex; align-items: center; gap: 5px; color: var(--text-dim); }
.slider input { width: 110px; }
.slider .value { width: 30px; }
.error { margin-left: auto; color: var(--danger); }
.compare header { height: 26px; display: flex; align-items: center; padding: 0 9px; border-bottom: 1px solid var(--border); color: var(--text-dim); background: var(--bg-node-header); font-size: 10px; }
/* 两层必须同宽同比例，才能逐像素对上 */
.stack { position: relative; width: 100%; overflow: hidden; background: #0a0d13; }
.source { display: block; width: 100%; height: auto; }
.frame { position: absolute; left: 0; top: 0; width: 100%; height: 100%; border: 0; background: transparent; }
</style>
```

在 `apps/region-split-ui/src/App.vue` 里 import 并挂上:

```ts
import CodeNode from "./canvas/nodes/CodeNode.vue";
```

给 `<PipelineCanvas>` 加 `:show-code="analyzed"`,并在 `#detail` 那个 template 之后加:

```vue
      <template #code-status>
        {{ selectedRegions.length === 1 ? selectedRegions[0]!.displayName : "待选择" }}
      </template>
      <template #code>
        <CodeNode
          :project-id="store.projectId.value"
          :selected-regions="selectedRegions"
          :api="httpApi"
        />
      </template>
```

`httpApi` 该文件顶部已经 import 了(`import { httpApi } from "./api.js"`),直接用,不要新建实例。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json && D:/nodejs/corepack.cmd pnpm build
```

Expected: 全部 PASS,typecheck 无输出,build 成功。

- [ ] **Step 5: 在真浏览器里走一遍**

起两个服务(**改了核心包必须重启 API**):

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm dev
```

另开终端:

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm dev
```

打开 `http://localhost:5180`,上传 `packages/region-split/test-fixtures/maicai.png`,等分析完成。确认:

1. 画布上有**三个节点**,「图片区域对照」→「区域详情」→「代码产出」之间有**两根贝塞尔连线**,拖动任一节点连线跟着动;
2. 选中一个区域,在「区域详情」里点"解析元素";
3. 到「代码产出」点"生成代码",下面出现叠加视图;
4. 拖动叠加滑块,0% 时只见原图、100% 时只见生成结果,中间能看出哪些框对得上、哪些错位;
5. 点"下载 HTML"能存下文件。

**把 4 的观察写进报告**:哪些结构对得准、哪些明显错位、错位大概多少。这是这一轮真正的产出——第一次能量出还原度。

- [ ] **Step 6: 提交**

```bash
git add apps/region-split-ui/src/canvas/nodes/CodeNode.vue apps/region-split-ui/src/canvas/nodes/CodeNode.test.ts apps/region-split-ui/src/api.ts apps/region-split-ui/src/App.vue
git commit -m "feat: add a code node with an overlay comparison"
```

---

## 完成标准

- `pnpm -r test` 全绿,`pnpm -r typecheck` 无输出,前端 `pnpm build` 成功。
- 画布上三个节点由两根贝塞尔连线串起,拖动时连线跟随。
- 选中一个已解析的区域能生成代码,叠加视图可拖动对比,两个文件可下载。
- 生成的 HTML 只含 `section` / `div` / `span` 三种标签,CSS 里没有 `px` 作为尺寸单位。
- 走查报告里写明了实际对齐情况——哪里准、哪里错位、错多少。
