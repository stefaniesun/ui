# 整页轮廓工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把界面收敛成一条直线:**上传 → 解析(可见进度)→ 三栏工作台校准**。三栏从左到右是 UI 原图、结构树、节点属性。

**Architecture:** 旧的画布(`PipelineCanvas` + 工作区节点)退休,`PageOutline` 成为唯一界面。原图面板改成可缩放可拖动的视口。

**Tech Stack:** Vue 3、Vitest、TypeScript。

设计依据:`docs/superpowers/specs/2026-08-21-page-outline-design.md`。分支 `dev`。

## 现状(动手前已核实)

| 需求 | 现状 |
|---|---|
| 1 · 上传框为移动端比例 | ❌ 上传按钮在 `RegionsNode.vue` 里,挂在旧画布上 |
| 2 · 解析中体现进度 | ✅ **已完成**(提交 `7d1f568`):逐区域跑、框一块块出现、「正在解析 N/M」 |
| 3 · 属性中文 + 类型配色 | ❌ 分类下拉显示的是 `component` / `text` 原文;`x`/`y`/`w`/`h` 也是原文;树里没有类型色 |
| 4 · 拖动 | ✅ **已完成**(提交 `ccedfca`) |
| 4 · 滚轮缩放 | ❌ 完全没有 |
| 5 · 原图占满不留白、不拉伸 | ⚠️ 部分:`height: auto` 不拉伸 ✅,但 `.page-stage` 有 `width: min(100%, 900px); margin: 0 auto`,**宽面板上会留白** ❌ |

**可复用**:`ElementTree.vue` 里已有中文类型名

```ts
const KIND_LABEL: Record<ElementKind, string> = {
  component: "组件", grid: "网格", text: "文字",
  icon: "图标", image: "图片", decoration: "装饰",
};
```

**已知**:`PageOutline` 一旦渲染就整屏盖住画布(`.app-shell > .page-outline { position: absolute; inset: 0; z-index: 20 }`),所以画布现在只在"还没解析"时可见。

## Global Constraints

- **不允许放宽任何断言**;每处改动先跑一次确认由红转绿。**本项目出过多次假绿**,最近一次是"断言 style 变了"被无关的重渲染满足——**新测试务必回退验证一次会不会红**。
- 命令用 `D:/nodejs/corepack.cmd pnpm`,测试要 `cd` 进包目录再跑。
  **根目录跑 `pnpm test` 会多出 4 个 fixture 路径相关的失败**,那是既有问题。
- 本计划**只改前端**,`packages/region-split` 一个字不该动(因此不必重启 API)。
- 收尾:
  ```bash
  cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json && D:/nodejs/corepack.cmd pnpm build
  ```
  ```bash
  cd packages/region-split && D:/nodejs/corepack.cmd pnpm test
  ```

---

### Task 1: 中文属性 + 类型配色

先做这个:纯展示层,风险最低,做完界面立刻好认。

**Files:**
- Create: `apps/region-split-ui/src/element-kind-display.ts`
- Create: `apps/region-split-ui/src/element-kind-display.test.ts`
- Modify: `apps/region-split-ui/src/components/PageOutline.vue`
- Modify: `apps/region-split-ui/src/components/PageOutline.test.ts`
- Modify: `apps/region-split-ui/src/components/ElementTree.vue`(改成引用共享的那份)

**Interfaces:**
- Produces:
  - `export const KIND_LABEL: Record<ElementKind, string>`
  - `export const KIND_COLOR: Record<ElementKind, string>`

- [ ] **Step 1: 写失败的测试**

创建 `apps/region-split-ui/src/element-kind-display.test.ts`:

```ts
import { elementKinds } from "@region-split/core/browser";
import { describe, expect, it } from "vitest";
import { KIND_COLOR, KIND_LABEL } from "./element-kind-display.js";

describe("元素类型的显示", () => {
  it("names every kind in chinese", () => {
    for (const kind of elementKinds) {
      expect(KIND_LABEL[kind]).toBeTruthy();
      expect(KIND_LABEL[kind]).not.toBe(kind);
    }
  });

  // 靠颜色区分类型，两个类型同色就等于没区分
  it("gives every kind its own colour", () => {
    const colors = elementKinds.map(kind => KIND_COLOR[kind]);
    expect(new Set(colors).size).toBe(elementKinds.length);
  });

  it("uses colours the css can take as-is", () => {
    for (const kind of elementKinds) expect(KIND_COLOR[kind]).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
```

追加到 `apps/region-split-ui/src/components/PageOutline.test.ts`(沿用该文件已有的 `outline` 夹具与挂载写法):

```ts
  // 下拉里显示 component / text 这种原文，人得先学一遍才看得懂
  it("names the kinds in chinese in the property panel", async () => {
    const wrapper = mount(PageOutline, {
      props: { projectId: "p1", outline, selectedId: "0-1000::ok" },
    });
    const options = wrapper.get('[data-test="calibration-kind"]').findAll("option");
    expect(options.map(option => option.text())).toContain("文字");
    expect(options.map(option => option.text())).not.toContain("text");
  });

  it("labels the box fields in chinese", () => {
    const wrapper = mount(PageOutline, {
      props: { projectId: "p1", outline, selectedId: "0-1000::ok" },
    });
    const text = wrapper.get('[data-test="calibration"]').text();
    for (const label of ["横坐标", "纵坐标", "宽", "高"]) expect(text).toContain(label);
  });

  // 元素框铺满整页，靠类型色才能一眼看出哪块是文字、哪块是图标
  it("tints an element box by its kind", () => {
    const wrapper = mount(PageOutline, {
      props: { projectId: "p1", outline, selectedId: null },
    });
    const box = wrapper.get('[data-test="page-outline"] .element-box');
    expect(box.attributes("style")).toContain(KIND_COLOR.text.slice(1));
  });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm exec vitest run src/element-kind-display.test.ts src/components/PageOutline.test.ts
```

- [ ] **Step 3: 实现**

创建 `apps/region-split-ui/src/element-kind-display.ts`:

```ts
import type { ElementKind } from "@region-split/core/browser";

/** 界面上一律用中文。类型的英文名只在数据里存在，不该出现在人眼前。 */
export const KIND_LABEL: Record<ElementKind, string> = {
  component: "组件", grid: "网格", text: "文字",
  icon: "图标", image: "图片", decoration: "装饰",
};

/**
 * 每个类型一个颜色。元素框铺满整页，颜色是唯一能让人一眼分出
 * "哪块是文字、哪块是图标"的手段——所以**六个颜色必须互不相同**。
 */
export const KIND_COLOR: Record<ElementKind, string> = {
  component: "#55a4ff", grid: "#3ecf8e", text: "#ffd166",
  icon: "#c792ea", image: "#ff8a5b", decoration: "#8a94a6",
};
```

`PageOutline.vue`:

1. 分类下拉的 `<option>` 用 `KIND_LABEL[kind]`,`value` 仍是原 `kind`。
2. 框字段的标签改成中文:`x → 横坐标`、`y → 纵坐标`、`w → 宽`、`h → 高`。
   **`v-for` 的 key 仍用 `x`/`y`/`w`/`h`**——那是数据字段名,只换显示文案。
3. `boxStyle` 里按类型着色。注意现有的 `.element-box.suspicious` 与 `.selected` 是靠 CSS
   覆盖边框的,**类型色不能把它们盖掉**——可疑和选中的优先级更高。
   建议做法:类型色写进 `style` 的 `--kind-color` 自定义属性,基础样式用它,
   `.suspicious` / `.selected` 的规则照旧写死颜色,自然覆盖。

`ElementTree.vue` 里那份 `KIND_LABEL` 删掉,改成从新模块 import,**别留两份**——
两份一旦分叉,两个界面会对同一个类型给出不同的名字。

- [ ] **Step 4: 跑测试确认通过,并回退验证**

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json
```

**把类型着色那行临时删掉,确认对应测试变红,再恢复。** 在报告里写明验过。

- [ ] **Step 5: 提交**

```bash
git add apps/region-split-ui/src
git commit -m "feat: show element kinds in chinese and tint boxes by kind

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 原图占满 + 滚轮缩放

**Files:**
- Modify: `apps/region-split-ui/src/components/PageOutline.vue`
- Modify: `apps/region-split-ui/src/components/PageOutline.test.ts`

**要达到的:**

- **占满面板宽度,不留白** —— 现在 `.page-stage { width: min(100%, 900px); margin: 0 auto }`,
  宽面板上两侧会留空。改成填满可用宽度。
- **不拉伸** —— 图片保持原始宽高比(`height: auto` 已经做到,**不要引入 `object-fit: fill` 之类**)。
- **滚轮缩放** —— 以**指针位置**为锚点,不是以左上角。否则放大时目标会跑出视野,人得反复拖回来。
- 缩放范围建议 **0.2–4**,超出就夹住。
- 拖动平移已有(提交 `ccedfca`),缩放要和它共存。

**关键:元素框的定位不能改。** 现在 `boxStyle` 用的是**百分比**(`node.box.x / width * 100`),
所以框天然随图片缩放,**缩放只需要改图片容器的尺寸,不用碰 boxStyle**。
若改成按像素定位,缩放时框会和图错开——**不要这么改**。

- [ ] **Step 1: 写失败的测试**

```ts
  it("fills the panel width instead of capping at a fixed size", () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const stage = wrapper.get('[data-test="page-stage"]');
    expect(stage.attributes("style")).not.toContain("900px");
  });

  // 以指针为锚点放大，否则目标会跑出视野，人得反复拖回来
  it("zooms in on the wheel and keeps the pointer anchored", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const panel = wrapper.get('[data-test="image-panel"]');
    Object.assign(panel.element, { scrollLeft: 0, scrollTop: 0, clientWidth: 400, clientHeight: 600 });

    await panel.trigger("wheel", { deltaY: -100, clientX: 200, clientY: 300 });

    const stage = wrapper.get('[data-test="page-stage"]');
    expect(stage.attributes("style")).toMatch(/width:\s*1[0-9]{2}%/);   // 放大到 100% 以上
  });

  it("zooms back out on the opposite wheel direction", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const panel = wrapper.get('[data-test="image-panel"]');
    await panel.trigger("wheel", { deltaY: -100, clientX: 100, clientY: 100 });
    const zoomedIn = wrapper.get('[data-test="page-stage"]').attributes("style");
    await panel.trigger("wheel", { deltaY: 100, clientX: 100, clientY: 100 });
    expect(wrapper.get('[data-test="page-stage"]').attributes("style")).not.toBe(zoomedIn);
  });

  it("clamps the zoom", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
    const panel = wrapper.get('[data-test="image-panel"]');
    for (let i = 0; i < 50; i += 1) await panel.trigger("wheel", { deltaY: -100, clientX: 0, clientY: 0 });
    const width = Number(/width:\s*([\d.]+)%/.exec(wrapper.get('[data-test="page-stage"]').attributes("style") ?? "")?.[1]);
    expect(width).toBeLessThanOrEqual(400);
  });
```

`.page-stage` 需要加 `data-test="page-stage"`。

- [ ] **Step 2: 跑测试确认失败,再实现**

实现要点:

- 用一个 `zoom` ref,`.page-stage` 的宽度写成 `${zoom * 100}%`
- 滚轮处理里 `event.preventDefault()`,**否则页面会跟着滚**
- 锚点算法:记下指针在内容坐标里的位置,缩放后把 `scrollLeft/scrollTop` 调回去,让同一个内容点仍在指针下

- [ ] **Step 3: 跑测试、回退验证、提交**

```bash
git commit -m "feat: fill the panel and zoom the page from the wheel

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 初始上传界面

**Files:**
- Create: `apps/region-split-ui/src/components/UploadPanel.vue`
- Create: `apps/region-split-ui/src/components/UploadPanel.test.ts`
- Modify: `apps/region-split-ui/src/App.vue`

**要达到的:** 还没有项目时,界面就是**一个上传框**,比例接近移动端页面(建议 **9:19.5**,
即常见手机屏比例;宽度取视口高度换算,别写死像素)。支持点击选择与拖放。

**从 `RegionsNode.vue` 搬过来的**:选择图片按钮、拖放区、上传失败的错误提示。
`RegionsNode.vue` 暂时不动(Task 4 再处理)。

- [ ] **Step 1: 写失败的测试**

```ts
  it("keeps the drop zone at a phone-like ratio", () => {
    const wrapper = mount(UploadPanel, { props: { busy: false } });
    expect(wrapper.get('[data-test="upload-zone"]').attributes("style")).toContain("aspect-ratio");
  });

  it("emits the picked file", async () => {
    const wrapper = mount(UploadPanel, { props: { busy: false } });
    const file = new File(["x"], "shot.png", { type: "image/png" });
    const input = wrapper.get('[data-test="upload-input"]');
    Object.defineProperty(input.element, "files", { value: [file] });
    await input.trigger("change");
    expect(wrapper.emitted("pick")![0]).toEqual([file]);
  });

  it("accepts a dropped file", async () => {
    const wrapper = mount(UploadPanel, { props: { busy: false } });
    const file = new File(["x"], "shot.png", { type: "image/png" });
    await wrapper.get('[data-test="upload-zone"]')
      .trigger("drop", { dataTransfer: { files: [file] } });
    expect(wrapper.emitted("pick")![0]).toEqual([file]);
  });

  // 上传中再点一次会重复提交
  it("blocks a second pick while busy", async () => {
    const wrapper = mount(UploadPanel, { props: { busy: true } });
    expect(wrapper.get('[data-test="upload-input"]').attributes("disabled")).toBeDefined();
  });
```

- [ ] **Step 2: 跑测试确认失败,再实现**

`App.vue`:没有 `store.projectId` 时渲染 `UploadPanel`,有了之后渲染 `PageOutline`。

- [ ] **Step 3: 跑测试、提交**

```bash
git commit -m "feat: start from a phone-shaped upload panel

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 画布退休

**Files:**
- Modify: `apps/region-split-ui/src/App.vue`
- Modify: `apps/region-split-ui/src/components/PageOutline.vue`
- Delete: `apps/region-split-ui/src/canvas/`(整目录)及其测试
- Modify: 其余引用画布的文件(用 grep 找全)

**画布已经是死代码**——`PageOutline` 整屏覆盖它,只在"还没解析"时露出来,而 Task 3 把那一段也接管了。

**但工作区节点上还挂着几个仍然有用的功能,先搬再删:**

| 功能 | 搬到哪 |
|---|---|
| 目标字体下拉(`font-stack`) | 轮廓图工具条 |
| 导出整页代码(`export-page`) | 轮廓图工具条 |
| 整页比对(`open-page-compare`) | 轮廓图工具条 |
| 待办统计(`analysis-stats` / `analysis-todos`) | 轮廓图工具条,放在「可疑项 N / M」旁边 |
| 刷新模型配置(`refresh-model-config`) | 轮廓图工具条 |
| 区域列表 | **不搬**——结构树已经能定位,区域退到幕后是设计文档第 2 节定的 |
| 上传 | 已由 Task 3 接管 |

> **先确认再删。** 删之前跑一遍:
> ```bash
> cd apps/region-split-ui && grep -rn "canvas/" src/ | grep -v "\.test\."
> ```
> 把清单记进报告,逐个确认都已搬走或确实不再需要。

- [ ] **Step 1: 先搬,跑测试确认功能都还在**
- [ ] **Step 2: 再删,跑测试与 build**
- [ ] **Step 3: 提交(搬和删分两个提交)**

---

### Task 5: 真浏览器走查

前端改动不必重启 API,但**要确认 API 在跑**。

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm dev
```

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm dev
```

逐条确认并记录:

1. 首屏就是一个**手机比例的上传框**,没有画布;
2. 上传后自动开始解析,**框一块块出现**,文案是「正在解析 N/M」;
3. 解析完成后三栏齐全:**左原图、中结构树、右节点属性**;
4. 原图**占满左栏、两侧不留白、没有被拉伸**(和原图对比长宽比);
5. **滚轮能放大缩小,放大时指针指着的地方不跑**;拖动能平移;
6. 元素框**按类型显示不同颜色**;可疑的仍然突出(类型色没盖掉可疑标记);
7. 属性面板里分类下拉是**中文**,坐标字段是**中文**;
8. 字体下拉、导出整页代码、整页比对、待办统计**都还能用**。

**做不到的如实写明卡在哪**,不要声称看到了实际没看到的东西。

报告写进 `D:\workspace\.superpowers\sdd\outline-workspace-report.md`:
每个任务改了什么、红→绿证据(含回退验证)、测试与 typecheck 与 build 结果、
删画布前那份 grep 清单、走查逐条结果、任何偏离本文的决定及理由。

---

## 完成标准

- 前端测试全绿,`vue-tsc --noEmit` 无输出,`pnpm build` 成功;`packages/region-split` 未改动且测试全绿。
- 首屏是手机比例的上传框;解析中进度可见;完成后三栏齐全。
- 原图占满左栏、不留白、不拉伸;滚轮以指针为锚点缩放;拖动可平移。
- 界面上**看不到任何英文类型名**;六个类型颜色互不相同。
- `grep -rn "canvas/" src/` 零命中,且字体、导出、比对、待办四项功能仍可用。
