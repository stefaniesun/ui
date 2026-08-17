# Dynamic Region Detail Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 点击区域时按需创建唯一的独立详情节点，并从对应区域列表行连接到该节点；再次点击时定位已有节点。

**Architecture:** 将固定 `detail` 画布状态替换为按 `regionId` 索引的动态详情节点模型。区域列表仅暴露 DOM 锚点与布局变化事件，`PipelineCanvas` 负责节点生命周期、坐标转换、连线和视口定位；`App` 为每个打开区域持有独立 `ElementStore`，避免详情状态串扰。

**Tech Stack:** Vue 3 Composition API、TypeScript 5.9、Vitest、Vue Test Utils、DOM `ResizeObserver`、`localStorage`

---

## 文件结构

- 新建 `apps/region-split-ui/src/canvas/dynamic-detail-state.ts`：动态节点 ID、布局、坐标转换、持久化与清理纯函数。
- 新建 `apps/region-split-ui/src/canvas/dynamic-detail-state.test.ts`：纯函数单元测试。
- 修改 `apps/region-split-ui/src/canvas/canvas-state.ts`：保留通用视口/贝塞尔能力，移除固定详情管线假设。
- 修改 `apps/region-split-ui/src/canvas/canvas-state.test.ts`：调整固定管线测试，保留缩放、适配和贝塞尔测试。
- 修改 `apps/region-split-ui/src/components/RegionList.vue`：区域行打开事件、端口、锚点访问与布局变化通知。
- 修改 `apps/region-split-ui/src/components/RegionList.test.ts`：点击、锚点和滚动通知测试。
- 修改 `apps/region-split-ui/src/canvas/nodes/RegionsNode.vue`：转发打开详情、锚点访问和布局变化。
- 修改 `apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts`：事件与公开方法测试。
- 修改 `apps/region-split-ui/src/canvas/PipelineNode.vue`：可关闭和定位高亮的节点外壳。
- 新建 `apps/region-split-ui/src/canvas/PipelineNode.test.ts`：关闭与高亮测试。
- 修改 `apps/region-split-ui/src/canvas/nodes/DetailNode.vue`：直接接收单个 `Region`。
- 修改 `apps/region-split-ui/src/canvas/nodes/DetailNode.test.ts`：单区域 API 与实例隔离测试。
- 修改 `apps/region-split-ui/src/canvas/PipelineCanvas.vue`：动态节点、连线、拖动、关闭、定位、持久化和失效清理。
- 新建 `apps/region-split-ui/src/canvas/PipelineCanvas.test.ts`：动态画布集成测试。
- 修改 `apps/region-split-ui/src/App.vue`：按区域管理独立 `ElementStore`，连接列表点击与画布 API。
- 修改 `apps/region-split-ui/src/App.test.ts`：按需创建、去重、多实例和区域失效清理测试。

### Task 1: 动态节点状态纯函数

**Files:**
- Create: `apps/region-split-ui/src/canvas/dynamic-detail-state.ts`
- Create: `apps/region-split-ui/src/canvas/dynamic-detail-state.test.ts`
- Modify: `apps/region-split-ui/src/canvas/canvas-state.ts`
- Modify: `apps/region-split-ui/src/canvas/canvas-state.test.ts`

- [ ] **Step 1: 写动态 ID、坐标换算和位置恢复失败测试**

```ts
import { describe, expect, it } from "vitest";
import {
  detailNodeId,
  loadDetailPositions,
  screenPointToWorld,
} from "./dynamic-detail-state.js";

describe("dynamic detail state", () => {
  it("builds stable detail ids", () => {
    expect(detailNodeId("hero")).toBe("detail:hero");
  });

  it("converts a row anchor into world coordinates", () => {
    expect(screenPointToWorld(
      { x: 530, y: 340 },
      { left: 10, top: 20 },
      { x: 100, y: 40, zoom: 2 },
    )).toEqual({ x: 210, y: 140 });
  });

  it("ignores malformed and unknown persisted positions", () => {
    const storage = { getItem: () => JSON.stringify({ kept: { x: 3, y: 4 }, gone: { x: 8, y: 9 }, bad: { x: "x", y: 1 } }) };
    expect(loadDetailPositions(storage, "key", new Set(["kept", "bad"]))).toEqual({ kept: { x: 3, y: 4 } });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- src/canvas/dynamic-detail-state.test.ts`
Expected: FAIL，模块 `dynamic-detail-state.js` 不存在。

- [ ] **Step 3: 实现动态状态基础 API**

```ts
import type { Point, StorageReader, StorageWriter, Viewport } from "./canvas-state.js";

export type DetailNodeId = `detail:${string}`;
export type DetailPositions = Record<string, Point>;

export function detailNodeId(regionId: string): DetailNodeId {
  return `detail:${regionId}`;
}

export function screenPointToWorld(
  point: Point,
  canvas: { left: number; top: number },
  viewport: Viewport,
): Point {
  return {
    x: (point.x - canvas.left - viewport.x) / viewport.zoom,
    y: (point.y - canvas.top - viewport.y) / viewport.zoom,
  };
}

function validPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<Point>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function loadDetailPositions(
  storage: StorageReader | undefined,
  key: string,
  validIds: ReadonlySet<string>,
): DetailPositions {
  try {
    const parsed = JSON.parse(storage?.getItem(key) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([id, point]) => validIds.has(id) && validPoint(point)));
  } catch { return {}; }
}

export function saveDetailPositions(storage: StorageWriter | undefined, key: string, positions: DetailPositions): void {
  try { storage?.setItem(key, JSON.stringify(positions)); } catch { /* optional persistence */ }
}
```

同时将 `canvas-state.ts` 的 `NodeId` 收窄为固定节点 ID（`"workspace" | "code"`），删除固定 `PIPELINE`/`portAnchors`；保留 `Point`、`Viewport`、`fitBounds`、`bezierPath` 等通用函数。

- [ ] **Step 4: 补充非重叠布局和视口定位测试**

```ts
it("places details downwards and wraps into another column", () => {
  expect(nextDetailPosition({ x: 120, y: 80, width: 1105, height: 700 }, [], { width: 760, height: 600 }, 1500))
    .toEqual({ x: 1345, y: 80 });
  expect(nextDetailPosition(
    { x: 120, y: 80, width: 1105, height: 700 },
    [{ x: 1345, y: 80, width: 760, height: 600 }],
    { width: 760, height: 600 }, 1500,
  )).toEqual({ x: 2185, y: 80 });
});

it("centers a node without changing zoom", () => {
  expect(centerNodeViewport({ x: 1000, y: 500, width: 760, height: 600 }, { width: 1200, height: 800 }, 0.8).zoom).toBe(0.8);
});
```

- [ ] **Step 5: 实现 `nextDetailPosition` 和 `centerNodeViewport`**

使用 `DETAIL_GAP = 80`：第一节点位于工作区右侧；按列向下寻找不相交位置，超过可用画布高度后向右换列。`centerNodeViewport` 返回 `{ x, y, zoom }`，缩放值原样保留。

- [ ] **Step 6: 运行纯函数测试**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- src/canvas/dynamic-detail-state.test.ts src/canvas/canvas-state.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/region-split-ui/src/canvas/dynamic-detail-state.ts apps/region-split-ui/src/canvas/dynamic-detail-state.test.ts apps/region-split-ui/src/canvas/canvas-state.ts apps/region-split-ui/src/canvas/canvas-state.test.ts
git commit -m "refactor: add dynamic detail canvas state"
```

### Task 2: 区域列表打开意图与行锚点

**Files:**
- Modify: `apps/region-split-ui/src/components/RegionList.vue`
- Modify: `apps/region-split-ui/src/components/RegionList.test.ts`
- Modify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.vue`
- Modify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts`

- [ ] **Step 1: 写区域行打开和锚点测试**

测试普通点击区域时同时保持 `store.select(id, false)` 并发出 `open(id)`；`getRegionAnchor(id)` 返回行右边缘中心；列表 `scroll` 发出 `layoutChange`。修饰键多选只改变选择，不发出 `open`，避免多选操作意外创建节点。

```ts
expect(wrapper.emitted("open")?.[0]).toEqual(["r1"]);
expect((wrapper.vm as { getRegionAnchor(id: string): unknown }).getRegionAnchor("r1"))
  .toEqual({ x: 320, y: 64 });
expect(wrapper.emitted("layoutChange")).toHaveLength(1);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- src/components/RegionList.test.ts src/canvas/nodes/RegionsNode.test.ts`
Expected: FAIL，缺少事件和公开方法。

- [ ] **Step 3: 实现 `RegionList` 的接口与端口**

```ts
const emit = defineEmits<{
  hover: [id: string | null];
  open: [id: string];
  layoutChange: [];
}>();

function getRegionAnchor(id: string): { x: number; y: number } | null {
  const rect = rowRefs.get(id)?.getBoundingClientRect();
  return rect ? { x: rect.right, y: rect.top + rect.height / 2 } : null;
}

defineExpose({ getRegionAnchor });
```

`onRowClick` 在无修饰键时执行 `emit("open", id)`；在 `.list` 上监听 `@scroll="emit('layoutChange')"`。每个 `.row` 增加 `span.region-port`，样式定位在行右边缘并使用强调色边框。

- [ ] **Step 4: `RegionsNode` 转发接口**

持有 `RegionList` ref，定义：

```ts
function getRegionAnchor(id: string) {
  return regionList.value?.getRegionAnchor(id) ?? null;
}
defineExpose({ retryAnalysis, markAnalysisFailed: reportAnalysisError, getRegionAnchor });
```

向外转发 `open` 和 `layoutChange` 事件。

- [ ] **Step 5: 运行相关测试**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- src/components/RegionList.test.ts src/canvas/nodes/RegionsNode.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/region-split-ui/src/components/RegionList.vue apps/region-split-ui/src/components/RegionList.test.ts apps/region-split-ui/src/canvas/nodes/RegionsNode.vue apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts
git commit -m "feat: expose region row connection anchors"
```

### Task 3: 可关闭和高亮的节点外壳

**Files:**
- Modify: `apps/region-split-ui/src/canvas/PipelineNode.vue`
- Create: `apps/region-split-ui/src/canvas/PipelineNode.test.ts`

- [ ] **Step 1: 写关闭和高亮测试**

```ts
it("emits close without starting drag", async () => {
  const wrapper = mount(PipelineNode, { props: { nodeId: "detail:r1", title: "区域详情", position: { x: 0, y: 0 }, closable: true } });
  await wrapper.get('[data-test="close-node"]').trigger("pointerdown");
  await wrapper.get('[data-test="close-node"]').trigger("click");
  expect(wrapper.emitted("close")).toEqual([["detail:r1"]]);
  expect(wrapper.emitted("dragStart")).toBeUndefined();
});

it("renders focus highlight", () => {
  const wrapper = mount(PipelineNode, { props: { nodeId: "detail:r1", title: "区域详情", position: { x: 0, y: 0 }, highlighted: true } });
  expect(wrapper.classes()).toContain("is-highlighted");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- src/canvas/PipelineNode.test.ts`
Expected: FAIL，缺少 `closable`、`highlighted` 和 `close`。

- [ ] **Step 3: 实现最小节点外壳能力**

新增布尔 props `closable`、`highlighted`，事件 `close: [nodeId: string]`；标题栏末尾增加关闭按钮并阻止指针事件冒泡。`.is-highlighted` 使用强调色边框和阴影，保留现有 status 样式。

- [ ] **Step 4: 运行测试**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- src/canvas/PipelineNode.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/region-split-ui/src/canvas/PipelineNode.vue apps/region-split-ui/src/canvas/PipelineNode.test.ts
git commit -m "feat: add closeable highlighted canvas nodes"
```

### Task 4: 单区域详情实例隔离

**Files:**
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.vue`
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.test.ts`

- [ ] **Step 1: 将测试改为明确单区域 API**

用 `region: Region` 替换 `selectedRegions: Region[]`。删除“未选中/多选提示”测试，新增两个组件实例分别传入 `r1/store1` 与 `r2/store2`，断言各自调用自己的 `load(projectId, bounds)`，且一个实例选择元素不会改变另一个实例。

- [ ] **Step 2: 运行测试确认旧 API 不匹配**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- src/canvas/nodes/DetailNode.test.ts`
Expected: FAIL，组件仍要求 `selectedRegions`。

- [ ] **Step 3: 修改 `DetailNode` props 和内部派生值**

```ts
const props = defineProps<{
  projectId: string;
  region: Region;
  elementStore: ElementStore;
  hoveredId?: string | null;
}>();
const region = computed<Rect>(() => props.region.bounds);
```

模板始终渲染详情内容，标题使用 `props.region.displayName`；区域变化 watcher 保持现有加载、重构清理、取色重置行为。

- [ ] **Step 4: 运行详情测试**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- src/canvas/nodes/DetailNode.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/region-split-ui/src/canvas/nodes/DetailNode.vue apps/region-split-ui/src/canvas/nodes/DetailNode.test.ts
git commit -m "refactor: isolate detail node by region"
```

### Task 5: 动态画布节点生命周期与连线

**Files:**
- Modify: `apps/region-split-ui/src/canvas/PipelineCanvas.vue`
- Create: `apps/region-split-ui/src/canvas/PipelineCanvas.test.ts`

- [ ] **Step 1: 写按需创建、去重、关闭和失效清理测试**

将画布 API 设计为：

```ts
interface DetailCanvasItem {
  region: Region;
  elementStore: ElementStore;
  hoveredId: string | null;
}

openDetail(regionId: string): void;
closeDetail(regionId: string): void;
refreshConnections(): void;
```

测试 props `regions` 初始不渲染详情；调用 `openDetail("r1")` 后只出现一个 `data-node-id="detail:r1"`；再次调用数量仍为一；打开 `r2` 后两个节点同时存在；关闭 `r1` 后只剩 `r2`；从 `regions` 移除 `r2` 后其节点自动清理。

- [ ] **Step 2: 运行测试确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- src/canvas/PipelineCanvas.test.ts`
Expected: FAIL，当前画布仅支持固定 `showDetail`。

- [ ] **Step 3: 实现动态集合和节点渲染**

`PipelineCanvas` 接收 `regions`、`projectId`、`getRegionAnchor`、`createElementStore`；内部维护 `openRegionIds`、`detailPositions`、`highlightedRegionId` 和每区域 store Map。`openDetail` 使用 region ID 去重，首次调用创建独立 store 与非重叠位置，再次调用仅定位和高亮。详情通过作用域插槽输出：

```vue
<slot
  name="detail"
  :region="region"
  :element-store="elementStores.get(region.id)!"
  :hovered-id="detailHoverIds.get(region.id) ?? null"
  :set-hovered-id="(id: string | null) => detailHoverIds.set(region.id, id)"
/>
```

- [ ] **Step 4: 写连线坐标测试**

为 `getRegionAnchor` 返回两个不同屏幕坐标，断言两条 SVG path 的 `M x y` 分别对应换算后的列表行右侧中心，终点分别是各详情节点 `position + PORT_Y`。改变 viewport、模拟列表滚动后调用 `refreshConnections()`，断言路径重算且仍对齐。

- [ ] **Step 5: 实现锚点测量与帧合并**

使用 `requestAnimationFrame` 合并刷新：读取 `getRegionAnchor(regionId)`，经 `screenPointToWorld` 转为世界坐标；终点为 `{ x: detailPosition.x, y: detailPosition.y + 21 }`；缺失锚点时不生成该 path。工作区/详情节点 `ResizeObserver`、窗口 resize、节点拖动和公开 `refreshConnections` 均触发刷新，不调用 `fitAll()`。

- [ ] **Step 6: 写定位和持久化测试**

断言再次打开已有节点后 viewport 的 zoom 不变，节点位于视口中心，并出现 `is-highlighted`；推进假定计时器后高亮消失。拖动结束写入键 `region-split:detail-node-positions:<projectId>:v1`；重新挂载恢复有效区域位置、忽略未知区域和损坏 JSON。

- [ ] **Step 7: 实现定位、高亮和项目级持久化**

`focusDetail(regionId)` 调用 `centerNodeViewport`，高亮持续 900ms；卸载时清理 timer、RAF 和 observers。项目 ID 变化时关闭所有旧项目详情并从新项目存储恢复位置候选，但仍不自动打开节点。

- [ ] **Step 8: 运行画布测试**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- src/canvas/PipelineCanvas.test.ts src/canvas/dynamic-detail-state.test.ts`
Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add apps/region-split-ui/src/canvas/PipelineCanvas.vue apps/region-split-ui/src/canvas/PipelineCanvas.test.ts
git commit -m "feat: render dynamic region detail nodes"
```

### Task 6: 应用接线与多详情验收

**Files:**
- Modify: `apps/region-split-ui/src/App.vue`
- Modify: `apps/region-split-ui/src/App.test.ts`

- [ ] **Step 1: 写应用级按需创建和定位测试**

测试分析完成后没有详情节点；点击区域 `r1` 创建 `detail:r1`；点击 `r2` 后两者并存；再次点击 `r1` 不增加节点并触发高亮；每个 `DetailNode` 收到对应 Region 和不同 `ElementStore`。

- [ ] **Step 2: 运行测试确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- src/App.test.ts`
Expected: FAIL，应用仍固定渲染唯一详情节点。

- [ ] **Step 3: 接线 `RegionsNode` 与 `PipelineCanvas`**

`App.vue` 删除全局 `elementStore`、`selectedRegions`、`detailStatus` 和固定详情 props。增加 `pipelineCanvas` ref：

```ts
function openRegionDetail(id: string) {
  pipelineCanvas.value?.openDetail(id);
}
function getRegionAnchor(id: string) {
  return regionsNode.value?.getRegionAnchor(id) ?? null;
}
```

传入 `:regions="store.regions.value"`、`:project-id="store.projectId.value"`、`:get-region-anchor="getRegionAnchor"`、`:create-element-store="() => createElementStore(httpApi)"`；`RegionsNode @open="openRegionDetail" @layout-change="pipelineCanvas?.refreshConnections()"`。使用动态详情作用域插槽渲染 `DetailNode`。

- [ ] **Step 4: 调整键盘删除行为**

删除 `App` 中依赖唯一 element store 的 Delete 分支。元素删除继续由详情树的删除操作执行；在多个详情并存时不让全局键盘事件猜测目标节点。保留区域 undo/redo、Escape 和边界调整快捷键。

- [ ] **Step 5: 保持代码节点兼容**

现有唯一 `CodeNode` 暂时保留，但不再与动态详情连线。它继续依据全局 `selectedIds` 显示当前单选区域，符合设计中“代码节点不扩展为多实例”的范围限制。删除固定 `detail -> code` 画布连线，避免产生错误的关联表达。

- [ ] **Step 6: 运行应用测试**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- src/App.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/region-split-ui/src/App.vue apps/region-split-ui/src/App.test.ts
git commit -m "feat: connect regions to independent detail nodes"
```

### Task 7: 回归验证与交互验收

**Files:**
- Modify only if verification exposes a defect in files already listed above.

- [ ] **Step 1: 运行 UI 全量测试**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test`
Expected: 全部 PASS，无未处理 Promise 或 Vue 警告。

- [ ] **Step 2: 运行类型检查**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui typecheck`
Expected: exit code 0。

- [ ] **Step 3: 运行生产构建**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui build -- --emptyOutDir=false`
Expected: Vite build 成功。

- [ ] **Step 4: 浏览器验收**

启动 API 和 UI 后验证：初始无详情节点；依次点击至少三个区域会出现三个独立详情节点和三条对应连线；列表滚动、画布缩放/平移和节点拖动时连线保持对齐；再次点击已有区域定位并高亮；关闭后可重新创建；每个详情节点独立解析元素且互不覆盖。

- [ ] **Step 5: 检查变更完整性**

Run: `git diff --check && git status --short`
Expected: 无空白错误；只包含本功能预期变更，保留用户已有 `.npmrc` 修改不纳入提交。

- [ ] **Step 6: 最终提交并推送当前分支**

```bash
git add apps/region-split-ui/src
git commit -m "test: cover dynamic region detail workflow"
git push origin feature/region-split
```

若没有额外修复导致工作区无新变更，则跳过空提交，直接推送此前任务提交。
