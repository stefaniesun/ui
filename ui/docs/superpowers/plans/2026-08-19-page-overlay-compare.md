# 整页叠加比对 Implementation Plan

**Goal:** 把整页生成结果和原图叠起来、拖滑块对比,第一次能看出整页还原度几成。

**Architecture:** 画布上新增一个**单例**「整页比对」节点(一个项目只有一页),从工作区节点的导出区打开,用连线连上。预览把生成 HTML 塞进 `iframe` 的 `srcdoc`,盖在整张原图上,透明度由滑块控制。

**Tech Stack:** Vue 3、Vitest、jsdom。

设计依据:`docs/superpowers/specs/2026-08-18-page-emitter-and-assets-design.md` 第 1.3 节、第 9 节子项目 6。

## 前置条件

**动手前先确认 `packages/region-split` 测试全绿**(见 `2026-08-19-fix-page-export-suite.md`)。
那份计划没做完就开始,会分不清失败是谁引入的。

## 现状(已核实)

- `GET /api/projects/:id/page-code` 返回
  `{ html: string; css: string; assets: Array<{ path: string; contentBase64: string }> }`
- 前端 `httpApi.getPageCode(projectId)` 已经能拿到它
- 整页 HTML 里的图片引用是**相对路径** `assets/<ref>.png`
- 工作区节点 `RegionsNode.vue` 里已有「导出整页代码」按钮(下载 zip)
- 单区域的叠加比对在 `CodeNode.vue` 里,结构是
  `<div class="stack" :style="{ aspectRatio }">` 套一张 `<img>` 加一个 `<iframe :srcdoc :style="{opacity}" sandbox="">`
- 整张原图的地址是 `imageUrl(projectId)`(`api.ts` 已导出)

## Global Constraints

- **不要动生成器。** 这份计划只做预览,`emit-page.ts` / `emit-html.ts` / 服务端路由一个字都不该改。
- **不允许放宽任何断言**;每处改动都要跑一次确认**由红转绿**。
- 命令用 `D:/nodejs/corepack.cmd pnpm`;前端测试要 `cd apps/region-split-ui` 再跑。
- **在仓库根目录跑 `pnpm test` 会多出 4 个 fixture 路径相关的失败**,那是既有问题,包目录里跑才准。
- 改了核心包必须重启 API(tsx 不热重载)。**这份计划不改核心包,所以不必重启**——但走查前要确认 API 在跑。
- 新增界面元素要跟随重构预览态的开关(详情节点在 AI 重构会话中展示的是候选树)。本计划不碰详情节点,不涉及。

## 本轮不做

自动像素 diff(算差异百分比)。滑块已经能定位问题,而引入无头浏览器是另一个量级的依赖。
本轮的产出是**人能看出来**,不是**机器算出来**。

---

### Task 1: 把资产引用换成 data URL(纯函数)

**Files:**
- Create: `apps/region-split-ui/src/page-preview.ts`
- Create: `apps/region-split-ui/src/page-preview.test.ts`

**为什么需要这一步:** 整页 HTML 里写的是相对路径 `assets/xxx.png`。预览用的是
`iframe` 的 `srcdoc` **且带 `sandbox=""`**——这种 iframe 没有可用的基地址、也没有同源权限,
相对路径**取不到图**,预览里所有图片都会是破图。所以要在塞进 `srcdoc` 之前,
把这些引用替换成自带内容的 data URL。

**Interfaces:**
- Produces:
  - `export interface PagePreviewInput { html: string; css: string; assets: readonly { path: string; contentBase64: string }[] }`
  - `export function pagePreviewDocument(input: PagePreviewInput): string`

- [ ] **Step 1: 写失败的测试**

创建 `apps/region-split-ui/src/page-preview.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pagePreviewDocument } from "./page-preview.js";

const base = {
  css: ".region { background: #fff; }",
  assets: [{ path: "assets/abc.png", contentBase64: "AAAA" }],
};

describe("pagePreviewDocument", () => {
  // srcdoc + sandbox="" 的 iframe 没有基地址也没有同源权限，相对路径取不到图
  it("swaps a relative asset reference for a data url", () => {
    const doc = pagePreviewDocument({ ...base, html: '<img src="assets/abc.png">' });
    expect(doc).toContain('src="data:image/png;base64,AAAA"');
    expect(doc).not.toContain('src="assets/abc.png"');
  });

  it("swaps every occurrence of the same asset", () => {
    const doc = pagePreviewDocument({
      ...base,
      html: '<img src="assets/abc.png"><img src="assets/abc.png">',
    });
    expect(doc.match(/data:image\/png;base64,AAAA/g)).toHaveLength(2);
  });

  it("leaves an unknown reference alone rather than blanking it", () => {
    const doc = pagePreviewDocument({ ...base, html: '<img src="assets/missing.png">' });
    expect(doc).toContain('src="assets/missing.png"');
  });

  it("inlines the stylesheet", () => {
    expect(pagePreviewDocument({ ...base, html: "<div></div>" }))
      .toContain(".region { background: #fff; }");
  });

  // 预览要和原图逐像素叠，页面自身不能有留白或滚动条
  it("zeroes the document margins", () => {
    const doc = pagePreviewDocument({ ...base, html: "<div></div>" });
    expect(doc).toContain("margin:0");
    expect(doc).toContain("padding:0");
  });

  // 资产名里可能有正则元字符，替换不能用裸正则
  it("handles an asset path with regex metacharacters", () => {
    const doc = pagePreviewDocument({
      html: '<img src="assets/a+b(1).png">',
      css: "",
      assets: [{ path: "assets/a+b(1).png", contentBase64: "BBBB" }],
    });
    expect(doc).toContain("data:image/png;base64,BBBB");
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm exec vitest run src/page-preview.test.ts
```

Expected: FAIL,`Failed to resolve import "./page-preview.js"`。

- [ ] **Step 3: 写实现**

创建 `apps/region-split-ui/src/page-preview.ts`:

```ts
export interface PagePreviewAsset {
  path: string;
  contentBase64: string;
}

export interface PagePreviewInput {
  html: string;
  css: string;
  assets: readonly PagePreviewAsset[];
}

/**
 * 把整页产物组装成能塞进 `iframe srcdoc` 的独立文档。
 *
 * **资产必须内联。** 整页 HTML 里写的是相对路径 `assets/xxx.png`，而预览用的
 * `srcdoc` + `sandbox=""` 的 iframe 既没有基地址也没有同源权限，相对路径一律取不到，
 * 预览里会是一片破图。所以在塞进去之前换成自带内容的 data URL。
 *
 * 认不出来的引用**原样留着**，不要替换成空——破图看得见，空白看不见。
 */
export function pagePreviewDocument(input: PagePreviewInput): string {
  let html = input.html;
  for (const asset of input.assets) {
    // 资产名可能含正则元字符，用 split/join 做字面替换，不构造正则
    html = html.split(asset.path).join(`data:image/png;base64,${asset.contentBase64}`);
  }
  return [
    "<!doctype html><meta charset=\"utf-8\">",
    // 页面要和原图逐像素叠，自身不能有留白或滚动条
    `<style>*{margin:0;padding:0;box-sizing:border-box}html,body{overflow:hidden}${input.css}</style>`,
    html,
  ].join("");
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm exec vitest run src/page-preview.test.ts
```

Expected: 6 passed。

- [ ] **Step 5: 提交**

```bash
git add apps/region-split-ui/src/page-preview.ts apps/region-split-ui/src/page-preview.test.ts
git commit -m "feat: inline page assets for the preview iframe

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 整页比对节点组件

**Files:**
- Create: `apps/region-split-ui/src/canvas/nodes/PageCompareNode.vue`
- Create: `apps/region-split-ui/src/canvas/nodes/PageCompareNode.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `pagePreviewDocument`;`imageUrl` from `../../api.js`
- Produces: 组件,props `{ projectId: string; api: { getPageCode(projectId): Promise<PageCodeOutput> }; imageSize: { w: number; h: number } }`

**为什么要传 `imageSize`:** 叠加层要和原图同宽同比例才能逐像素对上,容器的 `aspect-ratio`
必须等于整图的宽高比。这个尺寸在 `doc.image` 里已有,由上层传进来,组件不自己去取。

- [ ] **Step 1: 写失败的测试**

创建 `apps/region-split-ui/src/canvas/nodes/PageCompareNode.test.ts`:

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import PageCompareNode from "./PageCompareNode.vue";

const payload = {
  html: '<section class="region"><img src="assets/a.png"></section>',
  css: ".region { background: #fff; }",
  assets: [{ path: "assets/a.png", contentBase64: "AAAA" }],
};
const stubApi = (result: typeof payload | Error = payload) => ({
  getPageCode: vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  }),
});
const mountNode = (api = stubApi()) => mount(PageCompareNode, {
  props: { projectId: "p1", api, imageSize: { w: 1170, h: 2532 } },
});

describe("PageCompareNode", () => {
  it("offers to build the comparison before anything is loaded", () => {
    expect(mountNode().find('[data-test="build-page"]').exists()).toBe(true);
  });

  it("renders the page over the original at the image aspect ratio", async () => {
    const api = stubApi();
    const wrapper = mountNode(api);
    await wrapper.find('[data-test="build-page"]').trigger("click");
    await nextTick(); await nextTick();
    expect(api.getPageCode).toHaveBeenCalledWith("p1");
    expect(wrapper.find('[data-test="page-stack"]').attributes("style"))
      .toContain("1170 / 2532");
    // 资产已内联，否则 sandbox 的 iframe 里全是破图
    expect(wrapper.find('[data-test="page-frame"]').attributes("srcdoc"))
      .toContain("data:image/png;base64,AAAA");
  });

  it("moves the overlay opacity", async () => {
    const wrapper = mountNode();
    await wrapper.find('[data-test="build-page"]').trigger("click");
    await nextTick(); await nextTick();
    await wrapper.find('[data-test="page-opacity"]').setValue("30");
    expect(wrapper.find('[data-test="page-frame"]').attributes("style")).toContain("0.3");
  });

  // 有区域没解析时服务端会拒绝，得说人话而不是把原始错误甩出来
  it("explains that some region has not been parsed", async () => {
    const wrapper = mountNode(stubApi(new Error("region not parsed")));
    await wrapper.find('[data-test="build-page"]').trigger("click");
    await nextTick(); await nextTick();
    expect(wrapper.find('[data-test="page-error"]').text()).toContain("还有区域没有解析");
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm exec vitest run src/canvas/nodes/PageCompareNode.test.ts
```

Expected: FAIL,找不到 `./PageCompareNode.vue`。

- [ ] **Step 3: 写实现**

创建 `apps/region-split-ui/src/canvas/nodes/PageCompareNode.vue`。
**结构照 `CodeNode.vue` 的叠加视图**(`.stack` + `<img>` + `<iframe>`),差别只有三处:
盖的是整张原图、宽高比取整图、srcdoc 走 `pagePreviewDocument`。

```vue
<script setup lang="ts">
import { computed, ref } from "vue";
import { imageUrl } from "../../api.js";
import { pagePreviewDocument } from "../../page-preview.js";

interface PageCode {
  html: string;
  css: string;
  assets: { path: string; contentBase64: string }[];
}

const props = defineProps<{
  projectId: string;
  api: { getPageCode(projectId: string): Promise<PageCode> };
  imageSize: { w: number; h: number };
}>();

const code = ref<PageCode | null>(null);
const error = ref("");
const busy = ref(false);
/** 生成结果盖在原图上的不透明度，0 只看原图、100 只看生成结果 */
const opacity = ref(50);

const srcdoc = computed(() => code.value ? pagePreviewDocument(code.value) : "");

async function build() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    code.value = await props.api.getPageCode(props.projectId);
  } catch (err) {
    const message = (err as Error).message;
    // 最常见的失败是有区域还没解析，说人话而不是甩原始错误
    error.value = message.includes("not parsed")
      ? "还有区域没有解析，整页要等所有区域都解析完"
      : message;
    code.value = null;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page-compare" @pointerdown.stop @click.stop>
    <div class="bar">
      <button data-test="build-page" :disabled="busy" @click="build">
        {{ busy ? "生成中…" : code ? "重新生成" : "生成整页比对" }}
      </button>
      <label v-if="code" class="slider">
        叠加
        <input
          data-test="page-opacity" type="range" min="0" max="100"
          :value="opacity" @input="opacity = Number(($event.target as HTMLInputElement).value)"
        >
        <span class="value">{{ opacity }}%</span>
      </label>
      <span v-if="error" data-test="page-error" class="error">{{ error }}</span>
    </div>

    <section v-if="code" class="compare">
      <header>生成结果叠在原图上——拖滑块看哪里错位</header>
      <div class="scroll">
        <div
          data-test="page-stack" class="stack"
          :style="{ aspectRatio: `${props.imageSize.w} / ${props.imageSize.h}` }"
        >
          <img class="source" :src="imageUrl(props.projectId)" alt="整页原图">
          <iframe
            data-test="page-frame" class="frame" :srcdoc="srcdoc"
            :style="{ opacity: opacity / 100 }" title="整页生成结果" sandbox=""
          />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page-compare { display: flex; flex-direction: column; }
.bar { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-bottom: 1px solid var(--border); font-size: 10px; }
.slider { display: flex; align-items: center; gap: 5px; color: var(--text-dim); }
.slider input { width: 110px; }
.slider .value { width: 30px; }
.error { margin-left: auto; color: var(--danger); }
.compare header { height: 26px; display: flex; align-items: center; padding: 0 9px; border-bottom: 1px solid var(--border); color: var(--text-dim); background: var(--bg-node-header); font-size: 10px; }
/* 整页很高，节点里滚动看，不要把节点撑到几千像素 */
.scroll { max-height: 620px; overflow-y: auto; }
/* 两层必须同宽同比例，才能逐像素对上 */
.stack { position: relative; width: 100%; background: #0a0d13; }
.source { display: block; width: 100%; height: auto; }
.frame { position: absolute; left: 0; top: 0; width: 100%; height: 100%; border: 0; background: transparent; }
</style>
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json
```

Expected: 全部 PASS,typecheck 无输出。

- [ ] **Step 5: 提交**

```bash
git add apps/region-split-ui/src/canvas/nodes/PageCompareNode.vue apps/region-split-ui/src/canvas/nodes/PageCompareNode.test.ts
git commit -m "feat: add a whole-page overlay comparison node

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 入口、画布注册与连线

**Files:**
- Modify: `apps/region-split-ui/src/canvas/canvas-state.ts`
- Modify: `apps/region-split-ui/src/canvas/canvas-state.test.ts`
- Modify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.vue`
- Modify: `apps/region-split-ui/src/canvas/PipelineCanvas.vue`
- Modify: `apps/region-split-ui/src/canvas/PipelineCanvas.test.ts`
- Modify: `apps/region-split-ui/src/App.vue`

**设计:整页比对是单例。** 一个项目只有一页,所以它是**固定节点**(像 `workspace`),
不是按区域动态生成的那种。加进 `NodeId` 与 `DEFAULT_NODE_POSITIONS`。

> 参考:代码产出节点当初做成了按区域动态的,因为**每个区域一份**;整页只有一份,别照搬。

- [ ] **Step 1: 写失败的测试**

追加到 `apps/region-split-ui/src/canvas/canvas-state.test.ts`:

```ts
  // 整页只有一份，所以是固定节点，不是按区域动态生成的
  it("gives the page compare node a default position", () => {
    expect(DEFAULT_NODE_POSITIONS.page).toBeDefined();
  });
```

追加到 `apps/region-split-ui/src/canvas/PipelineCanvas.test.ts`(照该文件已有用例的挂载写法):

```ts
  it("opens the page compare node on demand and links it", async () => {
    const wrapper = mount(PipelineCanvas, {
      props: {
        regions: [], projectId: "p1", getRegionAnchor: () => null,
        createElementStore: () => ({ marker: true }) as never,
      },
      global: { stubs: { PipelineNode: false } },
    });
    expect(wrapper.find('[data-node-id="page"]').exists()).toBe(false);

    await wrapper.get('[data-test="open-page-compare"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-node-id="page"]').exists()).toBe(true);
    expect(wrapper.findAll(".links path").length).toBeGreaterThan(0);
  });
```

若 `[data-test="open-page-compare"]` 在这个挂载里不可达(它在工作区插槽内容里),
就按该文件已有测试传插槽的写法把入口按钮所在的组件塞进去,**或者**改成直接调用
组件暴露的方法——**在报告里说明你选了哪种以及为什么**。

- [ ] **Step 2: 跑测试确认它失败**

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm exec vitest run src/canvas/canvas-state.test.ts src/canvas/PipelineCanvas.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 写实现**

1. `canvas-state.ts`:`NodeId` 加 `"page"`,`DEFAULT_NODE_POSITIONS` 加一项(放在工作区右侧,
   不要和详情节点的默认位置重叠)。
   **`loadNodePositions` 按 `Object.keys(fallback)` 遍历,老的本地存储里没有 `page` 会自动取默认值,
   不用升存储键版本号**——自己读一遍确认这个推断成立。

2. `RegionsNode.vue`:在「导出整页代码」按钮**旁边**加一个「整页比对」按钮,
   `data-test="open-page-compare"`,点了 `emit("open-page-compare")`。
   禁用条件与导出按钮保持一致(照它现在的 `:disabled` 写)。

3. `PipelineCanvas.vue`:
   - 加 `pageOpen: ref<boolean>`,`openPageCompare()` 打开(已开则聚焦,照 `openDetail` 的写法)
   - `v-if="pageOpen"` 渲染一个 `PipelineNode`,`node-id="page"`,标题「整页比对」,
     `:input="true" :output="false"`,里面放 `PageCompareNode`
   - **连线**:从**工作区节点的输出口**连到整页节点的输入口。
     工作区右边缘是 `fixedPositions.workspace.x + WORKSPACE.width`,端口圆心在节点顶部 `21px`
     (和现有连线一致)。颜色用一个中性色(不属于任何区域,别用 `regionColor`)。
   - 工作区节点的 `:output` 现在写死 `false`,开着整页节点时要变成 `true`
   - `fitAll` / `occupiedDetailBounds` 之类收集节点范围的地方要把它算进去
   - `nodePosition(nodeId)` 已经能处理固定节点,确认 `"page"` 走得通

4. `App.vue`:把 `RegionsNode` 的 `@open-page-compare` 接到画布暴露的方法上
   (照现有 `openDetail` 之类的接法);`PageCompareNode` 需要的 `api` 用 `httpApi`、
   `imageSize` 用 `doc.image` 里的宽高。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json && D:/nodejs/corepack.cmd pnpm build
```

Expected: 全部 PASS,typecheck 无输出,build 成功。

- [ ] **Step 5: 提交**

```bash
git add apps/region-split-ui/src/canvas/ apps/region-split-ui/src/App.vue
git commit -m "feat: open the page comparison from the workspace and link it

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 真浏览器走查——这一步才是本计划的产出

**Files:** 无(只写报告)

前三个任务只是把工具装好。**这个子项目真正要交付的,是"整页还原度几成"这个观察。**

- [ ] **Step 1: 起服务**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm dev
```

另开终端:

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm dev
```

- [ ] **Step 2: 走一遍**

打开 `http://localhost:5180`,上传 `packages/region-split/test-fixtures/maicai.png`,等分析完成。
**把每个区域都解析一遍**(整页导出要求所有区域都有元素树,少一个会被服务端拒绝)。
然后在工作区点「整页比对」。

确认:

1. 画布上出现「整页比对」节点,和工作区之间有一根连线;
2. 点「生成整页比对」后出现叠加视图,能上下滚动看完整页;
3. 拖滑块:0% 只见原图,100% 只见生成结果;
4. 图片**不是破图**——如果是,说明 Task 1 的资产内联没生效,回去查;
5. 故意留一个区域不解析,再点一次,应当看到「还有区域没有解析」而不是原始报错。

- [ ] **Step 3: 写下观察——这是验收的核心**

在报告里逐区域记录,**要具体**:

- 哪些区域**对得准**(拖到 50% 时边界基本重合)
- 哪些**明显错位**,错在哪个方向、目测差多少
- 有没有**整体性的偏移**(比如越往下越偏——那通常意味着某个区域的高度算错了,误差在累积)
- 文字、图标、图片各自的表现(本轮文字应该有真实内容了,图标是切图)

**不要写"基本没问题"这种话。** 这一步的价值全在具体:哪一块差多少,才知道下一步该修什么。

- [ ] **Step 4: 写报告**

写进 `D:\workspace\.superpowers\sdd\page-overlay-report.md`:三个任务各改了什么、
测试命令与输出、typecheck 与 build 结果、**第 3 步的逐区域观察**、
任何偏离本计划的决定及理由。

---

## 完成标准

- `apps/region-split-ui` 测试全绿,`vue-tsc --noEmit` 无输出,`pnpm build` 成功。
- `packages/region-split` **一个字没改**,其测试与 typecheck 保持全绿。
- 画布上「整页比对」节点可打开、有连线、能拖滑块、图片不是破图。
- **报告里有逐区域的错位观察**,具体到方向和大致像素数。
