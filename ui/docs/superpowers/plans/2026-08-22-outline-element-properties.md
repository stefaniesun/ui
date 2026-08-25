# 轮廓图节点属性补全 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三栏工作台的节点属性里补齐四样核心能力——位置尺寸微调、图片切图源文件、图标 SVG 匹配与二次选择、组件/图片的圆角。

**Architecture:** 后端几乎都有了(切图每次检测都在切、图标检索接口在、决策字段在),**缺的是 patch 接口的字段和属性面板的呈现**。所以这份计划主要动前端,核心包只加一个 patch 字段。

**Tech Stack:** Vue 3、Vitest、zod、TypeScript。分支 `dev`。

## 现状(动手前已核实)

用真实项目打 `/page-outline` 得到:

```
image      asset=68bae9a9….png   iconDecision=—         radius=—
icon       asset=4676250e….png   iconDecision=ambiguous radius=—
component  asset=—               iconDecision=—         radius=—
```

| 需求 | 后端 | 前端 |
|---|---|---|
| 1 · 位置尺寸微调 | ✅ patch 支持 `box` | ⚠️ 只有 4 个数字输入框,没有 ± 微调 |
| 2 · 图片切图源文件 | ✅ **每次检测都切**(detect 路由里 `materializeTreeAssets`),`/api/projects/:id/assets/:fileName` 可取 | ❌ 面板里看不到 |
| 3 · 图标 SVG + 二次选择 | ✅ `iconDecision` 三态在节点上;`/api/icons/search?q=&limit=` 返回候选**且带 svg** | ❌ 没有选择入口 |
| 4 · 组件/图片圆角 | ⚠️ `style.borderRadius` 字段在,但**实测取回来是空的** | ❌ 面板里没有 |

**patch 接口是主要瓶颈** —— `pageElementPatchSchema` 现在只允许 `kind` / `text` / `box`:

```ts
export const pageElementPatchSchema = z.object({
  kind: z.enum(elementKinds).optional(),
  text: z.string().optional(),
  box: z.object({ … }).optional(),
}).refine(…, "empty patch");
```

**圆角和图标决策都改不了。** Task 1 先解决它。

> `PageOutlineElement extends Omit<ElementNode, "id" | "parentId">`,所以**元素本身已经带着
> `asset` / `iconDecision` / `style` 全部字段**——只是没地方改、界面上没显示。

## Global Constraints

- **不允许放宽任何断言**。**本项目出过多次假绿**,最近一次是"拖动后不该选中元素"那条:
  单测写了却测不到真实时序,实机一验就露馅。**新测试务必回退验证一次会不会红**,并在报告里写明验过。
- 命令用 `D:/nodejs/corepack.cmd pnpm`,测试要 `cd` 进包目录再跑。
  **根目录跑 `pnpm test` 会多出 4 个 fixture 路径相关的失败**,那是既有问题。
- **改了 `packages/region-split` 必须重启 API**(tsx 不热重载)。Task 1 改了核心包,**走查前务必重启**——这个项目已经因为忘记重启误判过两次。
- 新增 schema 字段一律 `.optional()`,老文件读出来不能炸。
- 收尾:
  ```bash
  cd packages/region-split && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec tsc --noEmit -p tsconfig.json
  ```
  ```bash
  cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json && D:/nodejs/corepack.cmd pnpm build
  ```

---

### Task 1: patch 接口放开圆角与图标决策

**Files:**
- Modify: `packages/region-split/src/page-outline.ts`
- Modify: `packages/region-split/src/page-outline.test.ts`

**Interfaces:**
- Produces:`pageElementPatchSchema` 增加
  - `borderRadius: z.number().int().nonnegative().optional()`
  - `iconDecision: iconDecisionSchema.optional()`

**两条要当心的:**

1. **圆角只对 `component` / `image` 有意义。** 别的类型传了要拒绝——不然会存下一个永远不生效的值,
   人改了没反应还找不到原因。
2. **圆角 0 要删字段而不是存 0。** 这是本项目既有的约定(`setRadius` 就是这么做的),保持一致,
   文档才干净。

- [ ] **Step 1: 写失败的测试**

追加到 `packages/region-split/src/page-outline.test.ts`(沿用该文件已有的构造 helper):

```ts
describe("圆角与图标决策的校准", () => {
  it("keeps a radius on a component", () => {
    const next = applyPageElementPatch(doc, trees, elementId, { borderRadius: 34 });
    expect(findNode(next, elementId)?.style.borderRadius).toBe(34);
  });

  // 0 是直角，存 0 不如把字段删掉——本项目既有的约定
  it("drops the field when the radius is zero", () => {
    const withRadius = applyPageElementPatch(doc, trees, elementId, { borderRadius: 34 });
    const next = applyPageElementPatch(doc, withRadius, elementId, { borderRadius: 0 });
    expect(findNode(next, elementId)?.style.borderRadius).toBeUndefined();
  });

  // 文字/图标上的圆角永远不生效，存下来只会让人改了没反应还找不到原因
  it("refuses a radius on a kind that cannot show one", () => {
    expect(() => applyPageElementPatch(doc, trees, textElementId, { borderRadius: 8 }))
      .toThrow();
  });

  it("keeps a human icon decision", () => {
    const next = applyPageElementPatch(doc, trees, iconElementId, {
      iconDecision: { kind: "library", iconId: "mdi:gear", query: "gear", candidates: ["mdi:gear"], by: "human" },
    });
    expect(findNode(next, iconElementId)?.iconDecision).toMatchObject({ kind: "library", by: "human" });
  });
});
```

`applyPageElementPatch` / `findNode` / `doc` / `trees` / 各 `elementId` 若在该文件里叫别的名字,
**用真实的名字**,不要新建夹具体系。

- [ ] **Step 2: 跑测试确认失败,再实现**

`supportsBorderRadius(kind)` 这个判据前端已有(`kind === "image" || kind === "component"`),
**核心包里若没有就在 `element-types.ts` 里加一份并让前端 import**,别让两边各写一份——
两处判据一旦分叉,界面允许改的和后端接受的就对不上了。

- [ ] **Step 3: 跑测试并提交**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec tsc --noEmit -p tsconfig.json
```

```bash
git add packages/region-split/src
git commit -m "feat: let the outline patch a radius and an icon decision

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 位置与尺寸微调

**Files:**
- Modify: `apps/region-split-ui/src/components/PageOutline.vue`
- Modify: `apps/region-split-ui/src/components/PageOutline.test.ts`

在四个数字输入框下面加两行按钮:

```
移动   ←  ↑  ↓  →
缩放   宽−  宽+  高−  高+
```

**每次 1px。** 微调就是对着图一点点挪,步子大了不如直接改数字。

**一个必须处理的时序问题(本项目踩过):** 面板是"改完点保存校准"的表单,
而微调按钮如果只改表单里的暂存值,人得记着再点一次保存——按十下就得存十次。

**所以微调按钮直接落盘**(它是离散、明确的动作,而且轮廓图上立刻能看到反馈),
文字和分类仍走保存按钮(那是多次击键的编辑)。

**落盘之后暂存值要重新同步**,否则输入框里显示的还是旧数字——本项目在旧属性面板上
栽过一次:改动被拒绝时输入框残留了非法值,最后是用"局部 draft + watch + emit 后
`nextTick` 重新同步"解决的。**照这个做法。**

- [ ] **Step 1: 写失败的测试**

```ts
  it("nudges the element by one pixel", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    await wrapper.get('[data-test="nudge-right"]').trigger("click");
    expect(wrapper.emitted("patch")![0]).toEqual(["0-1000::ok", { box: { x: 41, y: 100, w: 200, h: 50 } }]);
  });

  it("resizes by one pixel", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    await wrapper.get('[data-test="grow-width"]').trigger("click");
    expect(wrapper.emitted("patch")![0]).toEqual(["0-1000::ok", { box: { x: 40, y: 100, w: 201, h: 50 } }]);
  });

  // 按十下不该要求存十次
  it("saves a nudge without pressing save", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    await wrapper.get('[data-test="nudge-left"]').trigger("click");
    await wrapper.get('[data-test="nudge-left"]').trigger("click");
    expect(wrapper.emitted("patch")).toHaveLength(2);
  });

  // 落盘后输入框要跟着走，否则显示的是旧数字
  it("keeps the number fields in step with a nudge", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    await wrapper.get('[data-test="nudge-down"]').trigger("click");
    await wrapper.setProps({ outline: withBox("0-1000::ok", { x: 40, y: 101, w: 200, h: 50 }) });
    const fields = wrapper.get('[data-test="calibration"]').findAll("input[type=number]");
    expect((fields[1]!.element as HTMLInputElement).value).toBe("101");
  });

  // 尺寸不能缩到看不见
  it("will not shrink below the minimum", async () => {
    const wrapper = mount(PageOutline, {
      props: { projectId: "p1", outline: withBox("0-1000::ok", { x: 40, y: 100, w: 4, h: 50 }), selectedId: "0-1000::ok" },
    });
    await wrapper.get('[data-test="shrink-width"]').trigger("click");
    expect(wrapper.emitted("patch")).toBeFalsy();
  });
```

`withBox(id, box)` 是个小 helper,把夹具里某个元素的框换掉;该文件已有 `withRegions`,照它写。

- [ ] **Step 2: 跑测试确认失败,再实现,再跑,回退验证一次**

- [ ] **Step 3: 提交**

```bash
git commit -m "feat: nudge an element by a pixel at a time

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 素材区——切图与图标 SVG 的呈现

**Files:**
- Modify: `apps/region-split-ui/src/components/PageOutline.vue`
- Modify: `apps/region-split-ui/src/components/PageOutline.test.ts`
- Modify: `apps/region-split-ui/src/api.ts`(补一个取资产地址的小函数)

**图片和图标的切图后端每次检测都已经切好了**,元素上带着 `asset.ref`,
`/api/projects/:projectId/assets/:fileName` 能取。面板里现在完全看不到。

选中 `image` 或 `icon` 时,属性面板加一块**素材**区:

```
素材
[切图缩略图]   68bae9a9….png   [下载]
```

图标再多一行当前匹配结果:

```
图标   [SVG 预览 或 「未匹配」]   [选择图标]
```

**三条:**

1. **切图缩略图按原始比例显示,不要拉伸** —— 它是用来核对"切对没切对"的,拉伸了就核对不了。
2. `iconDecision.kind` 三态要**分别显示**:`library` 显示 SVG 预览;`crop` 显示「用原图切片」;
   `ambiguous` 显示「**待确认**」并突出。三者是不同的意思,合并显示等于没说。
3. `component` / `grid` / `text` **不显示素材区**,那里本来就没有素材。

- [ ] **Step 1: 写失败的测试**

```ts
  it("shows the crop for an image element", () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline: withAsset(), selectedId: imageId } });
    expect(wrapper.get('[data-test="asset-thumb"]').attributes("src")).toContain("68bae9a9");
  });

  // 三态是三个意思：挑好了 / 明确用切图 / 还没定
  it("calls an undecided icon pending rather than resolved", () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline: withIcon("ambiguous"), selectedId: iconId } });
    expect(wrapper.get('[data-test="icon-status"]').text()).toContain("待确认");
  });

  it("previews the svg once an icon was picked", () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline: withIcon("library"), selectedId: iconId } });
    expect(wrapper.find('[data-test="icon-preview"] svg').exists()).toBe(true);
  });

  it("hides the asset block for a container", () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: componentId } });
    expect(wrapper.find('[data-test="asset-thumb"]').exists()).toBe(false);
  });
```

- [ ] **Step 2: 跑测试确认失败,再实现,再跑,回退验证一次**

- [ ] **Step 3: 提交**

```bash
git commit -m "feat: show the crop and the matched icon in the property panel

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 图标二次选择(弹框)

**Files:**
- Create: `apps/region-split-ui/src/components/IconPickerDialog.vue`
- Create: `apps/region-split-ui/src/components/IconPickerDialog.test.ts`
- Modify: `apps/region-split-ui/src/components/PageOutline.vue`
- Modify: `apps/region-split-ui/src/api.ts`

**弹框形态**(左边原图切片常驻,右边搜索 + 大网格):

```
┌──────────┬──────────────────────────────┐
│ 原图切片  │ [搜索框              ] [搜索] │
│  (常驻)  │ ┌────┬────┬────┬────┬────┐  │
│          │ │ 候 │ 选 │ 网 │ 格 │ …  │  │
│ 当前选中  │ └────┴────┴────┴────┴────┘  │
├──────────┴──────────────────────────────┤
│              [用原图切片]  [取消]  [确定] │
└──────────────────────────────────────────┘
```

**三条不能省:**

1. **原图切片常驻左侧。** 不并排就没法判断像不像,这是整个挑选动作的依据。
2. **打开时用 `iconDecision.keywords` 里第一个含英文字母的词预填并自动搜一次。**
   一进来就有候选可看。没有可用关键词时搜索框留空,提示「模型没给关键词,请手动搜索」。
   > 实测过:关键词里出现过纯中文(模型没给时回落到元素名),而图标库全是英文名,**中文必然零命中**。
3. **「用原图切片」是明确按钮。** 实测 20 个图标里 18 个是彩色插画,库里根本没有对位物,
   挑不到是常见结果,得是正当选择而不是"关掉弹框什么都不做"。

后端接口现成:`GET /api/icons/search?q=&limit=` 返回 `{ candidates: [{ id, name, svg }] }`。

确认后走 Task 1 放开的 patch 写 `iconDecision`,`by: "human"`。

- [ ] **Step 1: 写失败的测试**(照上面三条各写一条,外加"确定时带上候选列表""关闭时不渲染")
- [ ] **Step 2: 跑测试确认失败,再实现,再跑,回退验证一次**
- [ ] **Step 3: 提交**

```bash
git commit -m "feat: pick an icon in a dialog beside its crop

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 圆角

**Files:**
- Modify: `apps/region-split-ui/src/components/PageOutline.vue`
- Modify: `apps/region-split-ui/src/components/PageOutline.test.ts`

**只对 `component` / `image` 显示**,判据用 Task 1 统一后的那份,别再写一遍。

一个数字输入 + `−` / `+` 按钮,和位置尺寸微调一样**直接落盘**。

**动手前先查清一件事:** 实测取回来的 `style.borderRadius` 是空的。
**是检测阶段没测,还是测了之后被清掉了?** 本项目曾有过 `clearTreeBorderRadii` 在载入时清空圆角的做法。
**先查清楚再动手**,并把结论写进报告——如果是被清掉的,那"人工改完下次打开还在不在"就是个必须回答的问题。

- [ ] **Step 1: 写失败的测试**

```ts
  it("offers a radius for a component", () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: componentId } });
    expect(wrapper.find('[data-test="radius"]').exists()).toBe(true);
  });

  // 文字/图标上的圆角不生效，给了输入框就是误导
  it("hides the radius for a text element", () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::ok" } });
    expect(wrapper.find('[data-test="radius"]').exists()).toBe(false);
  });

  it("saves a radius change straight away", async () => {
    const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: componentId } });
    await wrapper.get('[data-test="radius-plus"]').trigger("click");
    expect(wrapper.emitted("patch")![0]![1]).toMatchObject({ borderRadius: 1 });
  });
```

- [ ] **Step 2: 跑测试确认失败,再实现,再跑,回退验证一次**
- [ ] **Step 3: 提交**

```bash
git commit -m "feat: edit the corner radius of a component or image

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 真浏览器走查

**Task 1 改了核心包,先重启 API。**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm dev
```

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm dev
```

打开 `http://localhost:5180/#project=<data/projects 下任一个>`。
**hash 是挂载时读一次的**——如果地址栏已经是这个 hash,直接改地址不会重载,要**强制刷新**。
(我验收时在这里栽过一次,差点误判成功能坏了。)

逐条确认并记录:

1. 选中元素后,**移动 ← ↑ ↓ → 和缩放 宽± 高±** 都在,点一下框在图上动 1px;
2. 连点五下,**不需要点保存**,而且输入框里的数字跟着走;
3. 选中一张图片,素材区显示**切图缩略图**,比例正常没被拉伸,能下载;
4. 选中一个图标,状态显示为**待确认 / 已匹配 / 用原图切片**三者之一,不是笼统一句话;
5. 点「选择图标」出**弹框**,左边是原图切片,右边一进来就有候选;
6. 挑一个确认后,**面板里的 SVG 预览跟着变**,刷新页面仍在;
7. 选中一个组件,**圆角输入框在**;选中文字元素,**圆角不显示**;
8. 改圆角立刻生效,刷新页面仍在(**这条对应 Task 5 那个"是不是被清掉"的问题**)。

**做不到的如实写明卡在哪**,不要声称看到了实际没看到的东西。

报告写进 `D:\workspace\.superpowers\sdd\outline-properties-report.md`:
每个任务改了什么、红→绿证据(含回退验证)、两个包的测试与 typecheck 与 build 结果、
**Task 5 那个圆角为空的原因查清了没有**、走查逐条结果、任何偏离本文的决定及理由。

---

## 完成标准

- 两个包测试全绿,两个 typecheck 无输出,前端 build 成功。
- 微调按钮点一下即生效,不需要单独保存,数字框同步。
- 图片与图标能看到切图;图标能重新挑,挑完 SVG 预览更新且刷新后仍在。
- 圆角只在组件/图片上出现,改完刷新仍在。
- 界面上**看不到任何英文类型名**,图标三态分别显示。
