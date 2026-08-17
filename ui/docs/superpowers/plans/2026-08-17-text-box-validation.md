# 文字框校验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在检测流程里判断每个 `text` 节点的框是否真的只圈住了一行文字,不通过的标记出来并禁止在它上面拟合字号。

**Architecture:** 纯像素判据放在核心包的新模块 `element-text-box.ts`,只依赖行/列投影,不引 sharp(类型 import 除外)。判定结果作为 `textBox` 字段写进节点,由 `analyze-elements.ts` 在模型分类之后填。前端读这个字段:结构树上标存疑,属性面板禁掉"测量"按钮。

**Tech Stack:** TypeScript、Vitest、sharp(仅测试里读 fixture)、Vue 3、zod。

设计依据:`docs/superpowers/specs/2026-08-17-codegen-and-fidelity-design.md` 第 3.1 节。

## Global Constraints

- 基准图 `packages/region-split/test-fixtures/maicai.png`,坐标一律**原图像素**。
- 每个阈值必须在注释里写明实测依据(在哪张图、哪个元素、量到多少)。测试里写死实测数据,不放宽断言。
- `element-text-box.ts` 必须浏览器安全:只能 `import type` 引 `RawImage`,不得引 sharp。
- 改了 `packages/region-split` 必须重启 API(`pnpm --filter @region-split/core dev`),tsx 不热重载。
- 命令一律在 `D:\workspace\ui` 下用 `pnpm` 跑;单个包的测试要 `cd` 进包目录再 `pnpm test`。
- 前端两个 store 严格分离:`element-state.ts` 不得引用 `state.ts`。
- 新增界面元素必须跟随 `refactorStore.rootId` 开关——重构预览态显示的不是真实树。

---

### Task 1: 行投影分段与列游程

**Files:**
- Create: `packages/region-split/src/element-text-box.ts`
- Create: `packages/region-split/src/element-text-box.test.ts`

**Interfaces:**
- Consumes: `Run`、`runsFromOccupancy`、`medianOf` from `./element-runs.js`;`RawImage` type from `./panels.js`;`Rect` type from `./types.js`
- Produces:
  - `export const TEXT_INK_THRESHOLD = 40`
  - `export function inkRows(raw: RawImage, rect: Rect): boolean[]`
  - `export function inkCols(raw: RawImage, rect: Rect): boolean[]`

- [ ] **Step 1: 写失败的测试**

创建 `packages/region-split/src/element-text-box.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { inkCols, inkRows } from "./element-text-box.js";
import { runsFromOccupancy } from "./element-runs.js";
import type { RawImage } from "./panels.js";

async function raw(image: sharp.Sharp): Promise<RawImage> {
  const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** 白底上两个黑块，中间横向留白 20px、纵向留白 10px */
const twoBlocks = () =>
  sharp({ create: { width: 100, height: 50, channels: 3, background: "#ffffff" } })
    .composite([
      { input: { create: { width: 20, height: 20, channels: 3, background: "#101010" } }, top: 10, left: 10 },
      { input: { create: { width: 20, height: 20, channels: 3, background: "#101010" } }, top: 10, left: 50 },
    ]).png();

describe("inkRows", () => {
  it("marks only the rows that carry ink", async () => {
    const rows = inkRows(await raw(twoBlocks()), { x: 0, y: 0, w: 100, h: 50 });
    expect(rows).toHaveLength(50);
    expect(rows[9]).toBe(false);
    expect(rows[10]).toBe(true);
    expect(rows[29]).toBe(true);
    expect(rows[30]).toBe(false);
  });

  // 浅灰的抗锯齿边缘不算墨：阈值只认明显是笔画的像素
  it("ignores near-white pixels", async () => {
    const faint = sharp({ create: { width: 20, height: 10, channels: 3, background: "#f2f2f2" } }).png();
    expect(inkRows(await raw(faint), { x: 0, y: 0, w: 20, h: 10 }).some(Boolean)).toBe(false);
  });
});

describe("inkCols", () => {
  it("separates the two blocks into two runs", async () => {
    const cols = inkCols(await raw(twoBlocks()), { x: 0, y: 0, w: 100, h: 50 });
    expect(runsFromOccupancy(cols)).toEqual([
      { start: 10, end: 30 },
      { start: 50, end: 70 },
    ]);
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
cd packages/region-split && pnpm exec vitest run src/element-text-box.test.ts
```

Expected: FAIL,`Failed to resolve import "./element-text-box.js"`。

- [ ] **Step 3: 写实现**

创建 `packages/region-split/src/element-text-box.ts`:

```ts
import type { RawImage } from "./panels.js";
import type { Rect } from "./types.js";

/**
 * 只认**明显是笔画**的像素。抗锯齿边缘不算，否则任何一行都会有"墨"，
 * 行投影就永远分不出段。40 与前端量墨迹用的 STROKE_THRESHOLD 是同一个数
 * （实测阈值低于它时，小字的边缘像素占比很高，会把间隙填满）。
 */
export const TEXT_INK_THRESHOLD = 40;

function isInk(raw: RawImage, x: number, y: number): boolean {
  const i = (y * raw.width + x) * raw.channels;
  return Math.max(raw.data[i]!, raw.data[i + 1]!, raw.data[i + 2]!) < 255 - TEXT_INK_THRESHOLD;
}

/** 逐行是否有墨，下标原点是 rect 左上角 */
export function inkRows(raw: RawImage, rect: Rect): boolean[] {
  const rows = new Array<boolean>(Math.max(0, rect.h)).fill(false);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      if (isInk(raw, rect.x + x, rect.y + y)) { rows[y] = true; break; }
    }
  }
  return rows;
}

/** 逐列是否有墨，下标原点是 rect 左上角 */
export function inkCols(raw: RawImage, rect: Rect): boolean[] {
  const cols = new Array<boolean>(Math.max(0, rect.w)).fill(false);
  for (let x = 0; x < rect.w; x++) {
    for (let y = 0; y < rect.h; y++) {
      if (isInk(raw, rect.x + x, rect.y + y)) { cols[x] = true; break; }
    }
  }
  return cols;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd packages/region-split && pnpm exec vitest run src/element-text-box.test.ts
```

Expected: PASS,3 passed。

- [ ] **Step 5: 提交**

```bash
git add packages/region-split/src/element-text-box.ts packages/region-split/src/element-text-box.test.ts
git commit -m "feat: project ink rows and columns of a text box"
```

---

### Task 2: 两条判据合成一次校验

**Files:**
- Modify: `packages/region-split/src/element-text-box.ts`
- Modify: `packages/region-split/src/element-text-box.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `inkRows` / `inkCols`
- Produces:
  - `export const MAX_GLYPH_ASPECT = 1.4`
  - `export interface TextBoxCheck { ok: boolean; bands: number; glyphAspect: number; reason?: "multi-band" | "wide-glyph" }`
  - `export function checkTextBox(raw: RawImage, rect: Rect): TextBoxCheck`

- [ ] **Step 1: 写失败的测试**

把下面这段追加到 `packages/region-split/src/element-text-box.test.ts` 末尾:

```ts
import { checkTextBox } from "./element-text-box.js";
import { readFile } from "node:fs/promises";

/** 基准图上的真实文字框，坐标是原图像素 */
const FIXTURE = "test-fixtures/maicai.png";
async function fixture(): Promise<RawImage> {
  return raw(sharp(await readFile(FIXTURE)));
}

describe("checkTextBox", () => {
  // 实测：5 段，段宽 34/32/34/13/18，中位数 32 / 墨高 34 = 0.94
  it("accepts a clean single line", async () => {
    const check = checkTextBox(await fixture(), { x: 74, y: 1290, w: 142, h: 34 });
    expect(check.ok).toBe(true);
    expect(check.bands).toBe(1);
    expect(check.glyphAspect).toBeCloseTo(0.94, 2);
  });

  // 实测：5 段，段宽中位数 49 / 墨高 51 = 0.96。大字也得过
  it("accepts a larger single line", async () => {
    const check = checkTextBox(await fixture(), { x: 269, y: 236, w: 239, h: 51 });
    expect(check.ok).toBe(true);
  });

  // 实测：墨迹 476..478 与 528..561 两段，框上方多包了 50px 空白
  it("rejects a box that swallowed blank space", async () => {
    const check = checkTextBox(await fixture(), { x: 74, y: 475, w: 141, h: 87 });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("multi-band");
    expect(check.bands).toBe(2);
  });

  // 实测：列投影只有 1 段、整条 216 宽连成一片，216 / 90 = 2.40
  it("rejects a box whose content is not glyph-shaped", async () => {
    const check = checkTextBox(await fixture(), { x: 36, y: 1821, w: 216, h: 90 });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("wide-glyph");
    expect(check.glyphAspect).toBeCloseTo(2.4, 1);
  });

  // 只卡上界：西文字形本来就窄，卡下界会把正常西文全部误判
  it("does not reject narrow glyphs", async () => {
    const narrow = await raw(
      sharp({ create: { width: 60, height: 40, channels: 3, background: "#ffffff" } })
        .composite([0, 20, 40].map(left => ({
          input: { create: { width: 6, height: 30, channels: 3, background: "#101010" } },
          top: 5, left,
        }))).png());
    const check = checkTextBox(narrow, { x: 0, y: 0, w: 60, h: 40 });
    expect(check.glyphAspect).toBeLessThan(0.5);
    expect(check.ok).toBe(true);
  });

  it("rejects a box with no ink at all", async () => {
    const blank = await raw(
      sharp({ create: { width: 40, height: 20, channels: 3, background: "#ffffff" } }).png());
    expect(checkTextBox(blank, { x: 0, y: 0, w: 40, h: 20 }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
cd packages/region-split && pnpm exec vitest run src/element-text-box.test.ts
```

Expected: FAIL,`checkTextBox is not a function`(或 import 解析失败)。

- [ ] **Step 3: 写实现**

在 `packages/region-split/src/element-text-box.ts` 顶部把 import 改成:

```ts
import { medianOf, runsFromOccupancy } from "./element-runs.js";
import type { RawImage } from "./panels.js";
import type { Rect } from "./types.js";
```

然后在文件末尾追加:

```ts
/**
 * 列游程的段宽中位数最多是墨高的多少倍。
 *
 * 字与字之间必然有空隙，所以一行文字的列投影一定分得开、每段大致是一个字形宽。
 * 分不开、或者每段宽得离谱，说明框里的东西不是字。实测——
 * 联系客服 32/34 = 0.94、登录/注册 49/51 = 0.96 通过；
 * 猜你喜欢的框列投影只有 1 段、216/90 = 2.40 拒绝。
 * 取 1.4 落在两者之间，两侧各留约 1.46 倍与 0.58 倍余量。
 *
 * **只卡上界。** 西文字形本来就窄（`l`、`i` 的段宽远小于墨高），卡下界会把
 * 正常的西文文字全部误判。要拒绝的是"宽得不像字形"的东西。
 */
export const MAX_GLYPH_ASPECT = 1.4;

export interface TextBoxCheck {
  /** 这个框能不能用来拟合字号 */
  ok: boolean;
  /** 行投影的墨迹段数。单行文字应当是 1 */
  bands: number;
  /** 列游程段宽中位数 / 墨高 */
  glyphAspect: number;
  reason?: "multi-band" | "wide-glyph";
}

/**
 * 判断一个框是不是真的只圈住了一行文字。
 *
 * 不通过的框**不要在上面拟合字号**——实测「猜你喜欢」那种框会算出 96px。
 * 这里只做判断不做修正:框错了该由人来改,自动挪框会把错误藏起来。
 */
export function checkTextBox(raw: RawImage, rect: Rect): TextBoxCheck {
  const bandRuns = runsFromOccupancy(inkRows(raw, rect));
  const colRuns = runsFromOccupancy(inkCols(raw, rect));
  const bands = bandRuns.length;

  if (bands === 0 || colRuns.length === 0) {
    return { ok: false, bands, glyphAspect: 0, reason: "multi-band" };
  }

  // 墨高取行投影的实际跨度，不取框高——框可能比内容大
  const inkHeight = bandRuns[bandRuns.length - 1]!.end - bandRuns[0]!.start;
  const widths = colRuns.map(run => run.end - run.start);
  const glyphAspect = inkHeight > 0 ? medianOf(widths) / inkHeight : 0;

  if (bands > 1) return { ok: false, bands, glyphAspect, reason: "multi-band" };
  if (glyphAspect > MAX_GLYPH_ASPECT) {
    return { ok: false, bands, glyphAspect, reason: "wide-glyph" };
  }
  return { ok: true, bands, glyphAspect };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd packages/region-split && pnpm exec vitest run src/element-text-box.test.ts
```

Expected: PASS,9 passed。若 `glyphAspect` 的实测值与断言差超过 0.05,**不要放宽断言**——先把实际算出的数打印出来,确认是不是 `TEXT_INK_THRESHOLD` 或墨高取法的问题,再决定改代码还是改断言,并把新的实测值写进注释。

- [ ] **Step 5: 提交**

```bash
git add packages/region-split/src/element-text-box.ts packages/region-split/src/element-text-box.test.ts
git commit -m "feat: judge whether a box holds a single line of text"
```

---

### Task 3: schema 增加 textBox 字段

**Files:**
- Modify: `packages/region-split/src/element-types.ts:24-37`
- Modify: `packages/region-split/src/element-types.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `TextBoxCheck` 形状
- Produces: `ElementNode.textBox?: { ok: boolean; bands: number; glyphAspect: number; reason?: "multi-band" | "wide-glyph" }`

- [ ] **Step 1: 写失败的测试**

把下面这段追加到 `packages/region-split/src/element-types.test.ts` 末尾:

```ts
describe("textBox 字段", () => {
  const node = (over: Record<string, unknown>) => elementNodeSchema.parse({
    id: "n1", parentId: null, box: { x: 0, y: 0, w: 10, h: 10 },
    kind: "text", displayName: "文字", uniformity: 1, ...over,
  });

  it("keeps a failed check with its reason", () => {
    const parsed = node({
      textBox: { ok: false, bands: 2, glyphAspect: 0.9, reason: "multi-band" },
    });
    expect(parsed.textBox).toEqual({
      ok: false, bands: 2, glyphAspect: 0.9, reason: "multi-band",
    });
  });

  it("keeps a passing check without a reason", () => {
    expect(node({ textBox: { ok: true, bands: 1, glyphAspect: 0.94 } }).textBox?.ok).toBe(true);
  });

  // 没检查过和检查通过是两回事，不能给默认值
  it("stays undefined when the box was never checked", () => {
    expect(node({}).textBox).toBeUndefined();
  });

  it("keeps the empty-box reason distinct from multi-band", () => {
    const parsed = node({ textBox: { ok: false, bands: 0, glyphAspect: 0, reason: "no-ink" } });
    expect(parsed.textBox?.reason).toBe("no-ink");
  });

  it("rejects an unknown reason", () => {
    expect(() => node({ textBox: { ok: false, bands: 1, glyphAspect: 2, reason: "什么" } }))
      .toThrow();
  });
});
```

若该文件顶部尚未 import `elementNodeSchema`,在 import 块里补上它(与已有的 `elementTreeSchema` 等同一行)。

- [ ] **Step 2: 跑测试确认它失败**

```bash
cd packages/region-split && pnpm exec vitest run src/element-types.test.ts
```

Expected: FAIL,第一条断言得到 `undefined`——zod 默认剥掉未声明的字段。

- [ ] **Step 3: 写实现**

在 `packages/region-split/src/element-types.ts` 的 `elementNodeSchema` 里,紧跟在 `classification` 那一项之后插入:

```ts
  /**
   * 文字框的几何校验结果。**没有这个字段表示还没检查过**，
   * 与"检查通过"是两回事，所以不给默认值。
   * `ok: false` 的框不要在上面拟合字号——实测会算出 96px 这种离谱值。
   */
  textBox: z.object({
    ok: z.boolean(),
    bands: z.number().int().nonnegative(),
    glyphAspect: z.number().nonnegative(),
    reason: z.enum(["no-ink", "multi-band", "wide-glyph"]).optional(),
  }).optional(),
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd packages/region-split && pnpm exec vitest run src/element-types.test.ts && pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: 测试 PASS;typecheck 无输出。

- [ ] **Step 5: 提交**

```bash
git add packages/region-split/src/element-types.ts packages/region-split/src/element-types.test.ts
git commit -m "feat: carry the text box check on the node"
```

---

### Task 4: 接进检测流程

**Files:**
- Modify: `packages/region-split/src/analyze-elements.ts`
- Modify: `packages/region-split/src/analyze-elements.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `checkTextBox`、Task 3 的 `textBox` 字段
- Produces: `detectElements` 返回的树里,每个 `kind === "text"` 的节点都带 `textBox`

- [ ] **Step 1: 写失败的测试**

把下面这段追加到 `packages/region-split/src/analyze-elements.test.ts` 末尾。若文件顶部还没有 `detectElements` 的 import,一并补上:

```ts
describe("文字框校验接进检测", () => {
  it("checks every text node and leaves the others alone", async () => {
    const nodes = [
      { id: "n1", kind: "text" as const },
      { id: "n2", kind: "icon" as const },
    ];
    const checked = markTextBoxes(
      blankImage(200, 100),
      nodes.map(n => ({
        parentId: null, box: { x: 0, y: 0, w: 40, h: 20 }, displayName: "x",
        style: {}, uniformity: 1, source: "auto" as const,
        classification: "model" as const, scrollX: false, scrollY: false,
        positioning: "flow" as const, ...n,
      })),
    );
    expect(checked[0]!.textBox).toBeDefined();
    expect(checked[1]!.textBox).toBeUndefined();
  });
});
```

在同一文件顶部的 helper 区加上:

```ts
import { markTextBoxes } from "./analyze-elements.js";
import type { RawImage } from "./panels.js";

/** 全白的假图：这条测试只关心"哪些节点被检查了"，不关心检查结果 */
function blankImage(width: number, height: number): RawImage {
  return { data: new Uint8Array(width * height * 3).fill(255), width, height, channels: 3 };
}
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
cd packages/region-split && pnpm exec vitest run src/analyze-elements.test.ts
```

Expected: FAIL,`markTextBoxes is not exported`。

- [ ] **Step 3: 写实现**

在 `packages/region-split/src/analyze-elements.ts` 的 import 区加入:

```ts
import { checkTextBox } from "./element-text-box.js";
```

在 `groupForClassification` 之后、`detectElements` 之前加入:

```ts
/**
 * 给每个文字节点填上框校验结果。
 *
 * 必须在模型分类**之后**跑:`kind` 是模型定的,检测阶段还不知道谁是文字。
 * 只判断不修正——框错了该由人来改,自动挪框会把错误藏起来。
 */
export function markTextBoxes(raw: RawImage, nodes: ElementNode[]): ElementNode[] {
  return nodes.map(node => node.kind === "text"
    ? { ...node, textBox: checkTextBox(raw, node.box) }
    : node);
}
```

并在 import 区补上 `RawImage` 的类型引用:

```ts
import type { RawImage } from "./panels.js";
```

然后在 `detectElements` 里,把最后那两句改成先跑校验。原代码:

```ts
  const kept = flattened.size === 0
    ? tree.nodes
    : tree.nodes.filter(node => !flattened.has(node.id));
  return store.writeElementTree(projectId, { ...tree, nodes: kept }, region);
```

改为:

```ts
  const kept = flattened.size === 0
    ? tree.nodes
    : tree.nodes.filter(node => !flattened.has(node.id));
  const raw: RawImage = {
    data, width: info.width, height: info.height, channels: info.channels,
  };
  return store.writeElementTree(
    projectId, { ...tree, nodes: markTextBoxes(raw, kept) }, region);
```

注意没有模型时的那条提前返回也要带上校验——把:

```ts
  if (!model) return store.writeElementTree(projectId, tree, region);
```

改为(此时没有 `text` 节点,`markTextBoxes` 是空操作,但保持两条路径一致,以后模型侧改了也不会漏):

```ts
  if (!model) {
    const raw: RawImage = {
      data, width: info.width, height: info.height, channels: info.channels,
    };
    return store.writeElementTree(
      projectId, { ...tree, nodes: markTextBoxes(raw, tree.nodes) }, region);
  }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd packages/region-split && pnpm test && pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: 全部 PASS,typecheck 无输出。

- [ ] **Step 5: 提交**

```bash
git add packages/region-split/src/analyze-elements.ts packages/region-split/src/analyze-elements.test.ts
git commit -m "feat: check text boxes during element detection"
```

---

### Task 5: 界面上标出存疑并禁掉字号测量

**Files:**
- Modify: `apps/region-split-ui/src/components/ElementTree.vue`
- Modify: `apps/region-split-ui/src/components/ElementTree.test.ts`
- Modify: `apps/region-split-ui/src/components/ElementProperties.vue`
- Modify: `apps/region-split-ui/src/components/ElementProperties.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `ElementNode.textBox`
- Produces: 无(终点任务)

- [ ] **Step 1: 写失败的测试**

把下面这段追加到 `apps/region-split-ui/src/components/ElementTree.test.ts` 的顶层 `describe` 内:

```ts
  it("flags a text node whose box failed the check", () => {
    const wrapper = mountTree({
      nodes: [node({
        id: "n1", kind: "text",
        textBox: { ok: false, bands: 2, glyphAspect: 0.9, reason: "multi-band" },
      })],
    });
    expect(wrapper.find('[data-test="text-box-suspect"]').exists()).toBe(true);
  });

  it("does not flag a text node that passed", () => {
    const wrapper = mountTree({
      nodes: [node({ id: "n1", kind: "text", textBox: { ok: true, bands: 1, glyphAspect: 0.94 } })],
    });
    expect(wrapper.find('[data-test="text-box-suspect"]').exists()).toBe(false);
  });

  // 没检查过不等于有问题，不能标
  it("does not flag an unchecked node", () => {
    const wrapper = mountTree({ nodes: [node({ id: "n1", kind: "text" })] });
    expect(wrapper.find('[data-test="text-box-suspect"]').exists()).toBe(false);
  });
```

把下面这段追加到 `apps/region-split-ui/src/components/ElementProperties.test.ts` 的顶层 `describe` 内。该文件没有 mount 包装函数,顶层有个 `const node: ElementNode`,沿用它派生:

```ts
  const textNode = (over: Partial<ElementNode>): ElementNode =>
    ({ ...node, kind: "text", displayName: "联系客服", ...over });

  it("blocks font measurement on a suspect box and says why", () => {
    const wrapper = mount(ElementProperties, {
      props: {
        node: textNode({
          textBox: { ok: false, bands: 2, glyphAspect: 0.9, reason: "multi-band" },
        }),
      },
    });
    expect(wrapper.find('[data-test="measure-font"]').attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-test="font-blocked"]').text()).toContain("这个框不止一行文字");
  });

  it("names the other reason", () => {
    const wrapper = mount(ElementProperties, {
      props: {
        node: textNode({
          textBox: { ok: false, bands: 1, glyphAspect: 2.4, reason: "wide-glyph" },
        }),
      },
    });
    expect(wrapper.find('[data-test="font-blocked"]').text()).toContain("不像字形");
  });

  it("allows font measurement on a box that passed", () => {
    const wrapper = mount(ElementProperties, {
      props: { node: textNode({ textBox: { ok: true, bands: 1, glyphAspect: 0.94 } }) },
    });
    expect(wrapper.find('[data-test="measure-font"]').attributes("disabled")).toBeUndefined();
    expect(wrapper.find('[data-test="font-blocked"]').exists()).toBe(false);
  });

  // 没检查过不等于有问题
  it("allows font measurement on an unchecked box", () => {
    const wrapper = mount(ElementProperties, { props: { node: textNode({}) } });
    expect(wrapper.find('[data-test="measure-font"]').attributes("disabled")).toBeUndefined();
  });
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
cd apps/region-split-ui && pnpm exec vitest run src/components/ElementTree.test.ts src/components/ElementProperties.test.ts
```

Expected: FAIL,找不到 `[data-test="text-box-suspect"]` 与 `[data-test="font-blocked"]`。

- [ ] **Step 3: 写实现**

在 `ElementTree.vue` 里,节点名称那一行的末尾(与 kind 标签同级)加上:

```vue
        <span
          v-if="node.textBox && !node.textBox.ok"
          data-test="text-box-suspect"
          class="suspect"
          :title="suspectTitle(node.textBox)"
        >框存疑</span>
```

在该组件的 `<script setup>` 里加上标题文案函数(三种 reason 各说各的,别把空框说成"不止一行"):

```ts
type TextBoxCheck = NonNullable<ElementNode["textBox"]>;

function suspectTitle(check: TextBoxCheck): string {
  switch (check.reason) {
    case "no-ink": return "框里没有墨迹，这里没有文字";
    case "multi-band": return `框里有 ${check.bands} 段墨迹，不止一行文字`;
    default: return `框里的内容宽高比 ${check.glyphAspect.toFixed(2)}，不像字形`;
  }
}
```

并在该组件的 `<style scoped>` 里加:

```css
.suspect { margin-left: 6px; padding: 0 4px; border-radius: 3px; color: var(--warn); background: #e2a4001f; font-size: 9px; }
```

在 `ElementProperties.vue:323` 那个按钮上加禁用条件。它已经有 `data-test="measure-font"`,只改 `:disabled` 和 `@click` 两处:

```vue
            <button data-test="measure-font" class="wide" :disabled="props.disabled || fontBlocked !== ''" @click="!props.disabled && fontBlocked === '' && emit('measure-font')">
              渲染比对测字号字重
            </button>
```

在 `<script setup>` 里加上:

```ts
/**
 * 框没通过校验就不给测字号——在一个圈错的框上量出来的字号是错的，
 * 写进去比空着更糟：后面的全页字号归拢会被它带偏。
 */
const fontBlocked = computed(() => {
  const check = props.node?.textBox;
  if (!check || check.ok) return "";
  switch (check.reason) {
    case "no-ink": return "这个框里没有墨迹，先确认它是不是文字";
    case "multi-band": return "这个框不止一行文字，先把框改对再测字号";
    default: return "这个框里的内容不像字形，先确认它是不是文字";
  }
});
```

紧挨着已有的 `data-test="font-note"` 那一行(`ElementProperties.vue:328`)之前加:

```vue
        <p v-if="fontBlocked" data-test="font-blocked" class="note blocked">{{ fontBlocked }}</p>
```

复用已有的 `.note` 排版,只加一条颜色覆盖到 `<style scoped>`:

```css
.blocked { color: var(--warn); }
```

`computed` 该文件已从 vue 引入,无需再加。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd apps/region-split-ui && pnpm test && pnpm exec vue-tsc --noEmit -p tsconfig.json
```

Expected: 全部 PASS,typecheck 无输出。

- [ ] **Step 5: 在真浏览器里看一眼**

```bash
pnpm --filter @region-split/core dev
```

另开一个终端:

```bash
pnpm --filter region-split-ui dev
```

打开 `http://localhost:5180`,上传 `packages/region-split/test-fixtures/maicai.png`,等自动分析完成,选中「优惠券」那个区域(纵向 338–646),点"解析元素"。

确认:
1. 结构树里名为「优惠券码」「省钱卡」「买菜币」「我的钱包」「礼品卡」这类节点带上了"框存疑"标记;
2. 选中其中一个,属性面板的"测量"按钮是灰的,下面有一行说明;
3. 选中「联系客服」(纵向 1104–1413 区域内)这类正常文字节点,没有标记、"测量"可用。

**改了核心包必须重启 API**,否则服务端跑的还是旧代码,`textBox` 字段根本不会出现。

- [ ] **Step 6: 提交**

```bash
git add apps/region-split-ui/src/components/ElementTree.vue apps/region-split-ui/src/components/ElementTree.test.ts apps/region-split-ui/src/components/ElementProperties.vue apps/region-split-ui/src/components/ElementProperties.test.ts
git commit -m "feat: flag suspect text boxes and block fitting on them"
```

---

## 完成标准

- `pnpm -r test` 全绿,`pnpm -r typecheck` 无输出。
- 在基准图上重新检测后,**6 个**框带 `textBox.ok === false`:5 个 h=87 的(优惠券码/省钱卡/买菜币/我的钱包/礼品卡,`multi-band`)和 1 个 h=90 的「猜你喜欢」(`wide-glyph`,2.40)。22 个正常框零误报。

  > 早先这条写的是"10 个高度 87/90 的框全部 `ok:false`",**是错的**——那是只查了两个样本就外推到整组。另外 4 个 h=90 的(水果鲜花/蔬菜豆制品/肉禽蛋/海鲜水产)行投影是 `27..61`,墨迹只有 34px、干净一段,确实只圈了一行文字,只是框比内容高 56px。**放行是对的**:字号拟合走墨迹包围盒高度而不是框高,框高多余不影响结果。
- 界面上存疑节点有标记,且无法在它们上面测字号。
