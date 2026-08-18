# Region Colors, Stable Connections, and Canvas Pan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每个区域提供跨组件一致的独立颜色，修复详情连线缺失，并让工作区非交互空白可拖动无限画布。

**Architecture:** 使用 `region.id` 的稳定哈希生成统一区域色，所有区域框、列表端口、SVG 连线和详情节点消费同一颜色函数。列表锚点增加可视边界代理，画布刷新采用 RAF 合并；空白平移通过显式 `data-canvas-pan` / `data-no-canvas-pan` 事件边界实现。

**Tech Stack:** Vue 3、TypeScript、Vitest、Vue Test Utils、CSS 自定义属性、SVG、Pointer Events

---

## 文件结构

- 新建 `apps/region-split-ui/src/region-visual.ts`：稳定区域哈希与调色板映射。
- 新建 `apps/region-split-ui/src/region-visual.test.ts`：颜色稳定性和区分度测试。
- 修改 `apps/region-split-ui/src/components/RegionCanvas.vue` 及测试：原图区域框使用区域色。
- 修改 `apps/region-split-ui/src/components/RegionList.vue` 及测试：列表行、编号、端口使用区域色并提供代理锚点。
- 修改 `apps/region-split-ui/src/canvas/PipelineNode.vue` 及测试：通用节点支持可选强调色。
- 修改 `apps/region-split-ui/src/canvas/PipelineCanvas.vue` 及测试：逐区域彩色连线、稳定刷新和空白平移。
- 修改 `apps/region-split-ui/src/canvas/nodes/RegionsNode.vue` 及测试：声明工作区空白拖动边界并转发布局变化。

### Task 1: 稳定区域颜色函数

**Files:**
- Create: `apps/region-split-ui/src/region-visual.ts`
- Create: `apps/region-split-ui/src/region-visual.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { REGION_COLORS, regionColor, regionSoftColor } from "./region-visual.js";

describe("region visual colors", () => {
  it("returns a stable color for one id", () => {
    expect(regionColor("hero")).toBe(regionColor("hero"));
  });

  it("gives common neighboring ids different colors", () => {
    expect(new Set(["r1", "r2", "r3", "r4"].map(regionColor)).size).toBe(4);
  });

  it("returns the theme accent for an empty id", () => {
    expect(regionColor("")).toBe("var(--accent)");
  });

  it("builds a transparent fill from the assigned palette entry", () => {
    expect(regionSoftColor("hero")).toMatch(/^#[0-9a-f]{8}$/i);
    expect(REGION_COLORS.length).toBeGreaterThanOrEqual(12);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui exec vitest run src/region-visual.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现颜色映射**

```ts
export const REGION_COLORS = [
  "#4d8dff", "#ff5d7d", "#2dcf9f", "#f7b84b",
  "#a978ff", "#32c5ff", "#ff7a45", "#77c66e",
  "#e66bd4", "#49a6a6", "#d8ca52", "#7f8cff",
] as const;

function hashRegionId(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function regionColor(id: string): string {
  if (!id) return "var(--accent)";
  return REGION_COLORS[hashRegionId(id) % REGION_COLORS.length]!;
}

export function regionSoftColor(id: string): string {
  const color = regionColor(id);
  return color.startsWith("#") ? `${color}26` : "rgb(75 140 255 / 15%)";
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui exec vitest run src/region-visual.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/region-split-ui/src/region-visual.ts apps/region-split-ui/src/region-visual.test.ts
git commit -m "feat: add stable region colors"
```

### Task 2: 原图区域框与列表统一配色

**Files:**
- Modify: `apps/region-split-ui/src/components/RegionCanvas.vue`
- Modify: `apps/region-split-ui/src/components/RegionCanvas.test.ts`
- Modify: `apps/region-split-ui/src/components/RegionList.vue`
- Modify: `apps/region-split-ui/src/components/RegionList.test.ts`

- [ ] **Step 1: 写区域框颜色失败测试**

挂载含 `r1`、`r2` 的 `RegionCanvas`，断言两个区域覆盖元素分别设置：

```ts
expect(boxes[0]!.attributes("style")).toContain(`--region-color: ${regionColor("r1")}`);
expect(boxes[0]!.attributes("style")).toContain(`--region-soft-color: ${regionSoftColor("r1")}`);
expect(boxes[1]!.attributes("style")).toContain(`--region-color: ${regionColor("r2")}`);
```

- [ ] **Step 2: 写列表颜色失败测试**

```ts
const rows = wrapper.findAll("[data-test=row]");
expect(rows[0]!.attributes("style")).toContain(`--region-color: ${regionColor("a")}`);
expect(rows[0]!.get(".region-port").attributes("style")).toContain(regionColor("a"));
expect(rows[1]!.attributes("style")).toContain(`--region-color: ${regionColor("b")}`);
```

- [ ] **Step 3: 运行测试确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui exec vitest run src/components/RegionCanvas.test.ts src/components/RegionList.test.ts`
Expected: FAIL，元素仍使用全局强调色。

- [ ] **Step 4: 应用区域色变量**

在两个组件中导入 `regionColor`、`regionSoftColor`，并为每个区域元素绑定：

```vue
:style="{
  '--region-color': regionColor(region.id),
  '--region-soft-color': regionSoftColor(region.id),
}"
```

CSS 改为：

```css
.region-box { border-color: var(--region-color); background: var(--region-soft-color); }
.row.selected { border-color: var(--region-color); background: var(--region-soft-color); }
.index { color: var(--region-color); }
.region-port { border-color: var(--region-color); }
```

连接端口如果测试需读取内联颜色，绑定 `:style="{ borderColor: regionColor(region.id) }"`。

- [ ] **Step 5: 运行组件测试**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui exec vitest run src/components/RegionCanvas.test.ts src/components/RegionList.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/region-split-ui/src/components/RegionCanvas.vue apps/region-split-ui/src/components/RegionCanvas.test.ts apps/region-split-ui/src/components/RegionList.vue apps/region-split-ui/src/components/RegionList.test.ts
git commit -m "feat: color regions consistently"
```

### Task 3: 详情节点与连线统一配色

**Files:**
- Modify: `apps/region-split-ui/src/canvas/PipelineNode.vue`
- Modify: `apps/region-split-ui/src/canvas/PipelineNode.test.ts`
- Modify: `apps/region-split-ui/src/canvas/PipelineCanvas.vue`
- Modify: `apps/region-split-ui/src/canvas/PipelineCanvas.test.ts`

- [ ] **Step 1: 写节点强调色失败测试**

```ts
const wrapper = mount(PipelineNode, {
  props: {
    nodeId: "detail:r1",
    title: "区域详情",
    position: { x: 0, y: 0 },
    accentColor: "#ff5d7d",
    input: true,
  },
});
expect(wrapper.attributes("style")).toContain("--node-accent: #ff5d7d");
expect(wrapper.get(".port.input").attributes("style")).toContain("#ff5d7d");
```

- [ ] **Step 2: 写逐区域连线颜色失败测试**

打开 `r1`、`r2` 后刷新连接，断言：

```ts
const paths = wrapper.findAll(".links path");
expect(paths[0]!.attributes("stroke")).toBe(regionColor("r1"));
expect(paths[1]!.attributes("stroke")).toBe(regionColor("r2"));
```

- [ ] **Step 3: 运行测试确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui exec vitest run src/canvas/PipelineNode.test.ts src/canvas/PipelineCanvas.test.ts`
Expected: FAIL，节点和路径仍使用全局颜色。

- [ ] **Step 4: 实现节点强调色**

`PipelineNode` 新增：

```ts
accentColor?: string;
```

节点根样式合并 `--node-accent: props.accentColor ?? 'var(--accent)'`。输入端口内联 `borderColor`，高亮边框、状态点和顶部强调线使用 `var(--node-accent)`。

- [ ] **Step 5: 实现逐区域彩色连线**

`PipelineCanvas` 的 link 数据增加 `color: regionColor(region.id)`；SVG：

```vue
<path :d="link.path" :stroke="link.color" />
```

详情 `PipelineNode` 传入 `:accent-color="regionColor(region.id)"`。

- [ ] **Step 6: 运行测试确认通过**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui exec vitest run src/canvas/PipelineNode.test.ts src/canvas/PipelineCanvas.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/region-split-ui/src/canvas/PipelineNode.vue apps/region-split-ui/src/canvas/PipelineNode.test.ts apps/region-split-ui/src/canvas/PipelineCanvas.vue apps/region-split-ui/src/canvas/PipelineCanvas.test.ts
git commit -m "feat: match detail connections to region colors"
```

### Task 4: 修复不可见与丢失连线

**Files:**
- Modify: `apps/region-split-ui/src/components/RegionList.vue`
- Modify: `apps/region-split-ui/src/components/RegionList.test.ts`
- Modify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.vue`
- Modify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts`
- Modify: `apps/region-split-ui/src/canvas/PipelineCanvas.vue`
- Modify: `apps/region-split-ui/src/canvas/PipelineCanvas.test.ts`

- [ ] **Step 1: 写代理锚点失败测试**

将列表容器 rect 设为 `{ top: 100, bottom: 300, right: 420 }`，区域行 rect 分别在顶部外、可视范围、底部外：

```ts
expect(vm.getRegionAnchor("above")).toEqual({ x: 420, y: 100 });
expect(vm.getRegionAnchor("visible")).toEqual({ x: 420, y: 180 });
expect(vm.getRegionAnchor("below")).toEqual({ x: 420, y: 300 });
```

- [ ] **Step 2: 运行列表测试确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui exec vitest run src/components/RegionList.test.ts`
Expected: FAIL，当前直接返回行中心或 `null`。

- [ ] **Step 3: 实现列表边界代理锚点**

为列表添加 ref，并实现：

```ts
const row = rowRefs.get(id)?.getBoundingClientRect();
const viewport = list.value?.getBoundingClientRect();
if (!row || !viewport) return null;
return {
  x: viewport.right,
  y: Math.min(viewport.bottom, Math.max(viewport.top, row.top + row.height / 2)),
};
```

图片加载、区域数组变化和列表滚动均发出 `layoutChange`。`RegionsNode` 原样转发。

- [ ] **Step 4: 写多区域刷新恢复测试**

让 `getRegionAnchor` 首次对 `r2` 返回 `null`，刷新后只有一条线；切换为有效锚点再次调用 `refreshConnections()` 后断言恢复两条线。拖动 workspace 节点后断言 `getRegionAnchor` 被再次调用。

- [ ] **Step 5: 修复刷新时序**

`refreshConnections` 保留 RAF 合并；打开详情后执行两阶段刷新：`nextTick(refreshConnections)`，并在下一动画帧再次测量。节点拖动期间无论节点类型都调用刷新；区域列表布局变化由 `App` 调用公开刷新接口。

- [ ] **Step 6: 运行相关测试**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui exec vitest run src/components/RegionList.test.ts src/canvas/nodes/RegionsNode.test.ts src/canvas/PipelineCanvas.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/region-split-ui/src/components/RegionList.vue apps/region-split-ui/src/components/RegionList.test.ts apps/region-split-ui/src/canvas/nodes/RegionsNode.vue apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts apps/region-split-ui/src/canvas/PipelineCanvas.vue apps/region-split-ui/src/canvas/PipelineCanvas.test.ts
git commit -m "fix: keep region detail connections visible"
```

### Task 5: 工作区空白拖动画布

**Files:**
- Modify: `apps/region-split-ui/src/canvas/PipelineCanvas.vue`
- Modify: `apps/region-split-ui/src/canvas/PipelineCanvas.test.ts`
- Modify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.vue`
- Modify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts`
- Modify: `apps/region-split-ui/src/components/RegionList.vue`

- [ ] **Step 1: 写空白平移失败测试**

在 workspace 插槽提供：

```html
<div data-canvas-pan data-test="blank"><button data-no-canvas-pan>操作</button></div>
```

触发空白 `pointerdown` 与 window `pointermove`，断言 world transform 改变、workspace 节点 style 不变。触发按钮、区域行和图片上的 pointerdown 后移动，断言 transform 不变。

- [ ] **Step 2: 运行画布测试确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui exec vitest run src/canvas/PipelineCanvas.test.ts`
Expected: FAIL，当前只接受 canvas 根和 `.grid`。

- [ ] **Step 3: 实现平移目标判定**

```ts
function canStartPan(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest("[data-no-canvas-pan],button,input,select,textarea,a,[data-node-header]")) return false;
  return target === canvas.value || target.classList.contains("grid") || Boolean(target.closest("[data-canvas-pan]"));
}
```

`startPan` 仅在左键且 `canStartPan(event.target)` 时开始。

- [ ] **Step 4: 标记工作区空白和交互区**

`RegionsNode` 根内容容器设置 `data-canvas-pan`，图片工作区设置 `data-no-canvas-pan`；`RegionList` 的列表行、端口和滚动列表本体设置 `data-no-canvas-pan`，在列表右侧/底部空白包裹层保留 `data-canvas-pan`。`PipelineNode` 标题栏设置 `data-node-header`。

删除阻止所有节点内容 `pointerdown` 冒泡的宽泛处理，只在具体交互控件上阻止或依赖 `data-no-canvas-pan` 判断。

- [ ] **Step 5: 运行组件与画布测试**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui exec vitest run src/canvas/PipelineCanvas.test.ts src/canvas/nodes/RegionsNode.test.ts src/components/RegionList.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/region-split-ui/src/canvas/PipelineCanvas.vue apps/region-split-ui/src/canvas/PipelineCanvas.test.ts apps/region-split-ui/src/canvas/nodes/RegionsNode.vue apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts apps/region-split-ui/src/components/RegionList.vue apps/region-split-ui/src/canvas/PipelineNode.vue
git commit -m "fix: pan canvas from workspace whitespace"
```

### Task 6: 全量验证与推送

**Files:**
- Modify only files above if verification exposes defects.

- [ ] **Step 1: 运行 UI 全量测试**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test`
Expected: 所有测试 PASS，无 Vue 警告和未处理 Promise。

- [ ] **Step 2: 运行类型检查**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui typecheck`
Expected: exit code 0。

- [ ] **Step 3: 运行生产构建**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui build -- --emptyOutDir=false`
Expected: Vite 构建成功。

- [ ] **Step 4: 浏览器验收**

打开至少三个区域详情，确认原图框、列表端口、连线和详情节点各自同色；所有详情都有连线；滚动列表、拖动节点、缩放和平移后连线仍对应；在区域列表右侧空白按住拖动能移动整个画布；点击区域行、图片和按钮不误触平移。

- [ ] **Step 5: 检查并提交修复**

Run: `git diff --check && git status --short`
Expected: 无空白错误；不提交用户本地 `.npmrc` 修改。

若验证产生修复：

```bash
git add apps/region-split-ui/src
git commit -m "fix: stabilize colored region canvas interactions"
```

- [ ] **Step 6: 推送当前分支**

Run: `git push origin feature/region-split`
Expected: 推送成功；若网络失败，保留本地提交并报告错误。
