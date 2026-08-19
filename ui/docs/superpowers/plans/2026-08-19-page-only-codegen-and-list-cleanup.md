# 只从整页生成代码 + 区域列表清理 Implementation Plan

**Goal:** 三件事——(1) 去掉按区域生成代码,代码只能整页生成;(2) 区域列表的颜色点在该区域解析完成后变成实心;(3) 去掉区域类型(`card` / `banner` 那些)的展示与整套概念。

**Architecture:** 三件事互不依赖,但都会碰到测试夹具,所以**按本文顺序做**,每件做完各自全绿再进下一件。

**Tech Stack:** TypeScript、Vue 3、Vitest、zod、Fastify。

## 前置条件

**动手前先把 `2026-08-19-fix-page-export-suite.md` 做完。** 核心包现在有 6 个测试失败、2 个 typecheck 错误,不先修绿的话,后面分不清红是历史遗留还是本次引入。

> 顺带:那份计划 Task 3 要修的 `server.test.ts` 里 `type: "header"` / `"footer"`,会被本文第三件事**整个删掉**。所以**先做那份**,再做这份,不要反过来——反过来会改一段马上要被删的代码。

## Global Constraints

- **不允许放宽任何断言**(不许把精确比较改成模糊比较、不许删测试来换绿)。删除功能时,**对应的测试也要删干净**,不要留下测已删功能的僵尸用例。
- 每件事都要**先跑一次记下现状**,改完再跑确认预期变化。
- 命令用 `D:/nodejs/corepack.cmd pnpm`;测试要 `cd` 进包目录再跑。
- **在仓库根目录跑 `pnpm test` 会多出 4 个 fixture 路径相关的失败**,那是既有问题,包目录里跑才准。
- **改了 `packages/region-split` 必须重启 API**(tsx 不热重载)。本文第二、三件事都改了核心包。
- 收尾必须两个包都干净:
  ```bash
  cd packages/region-split && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec tsc --noEmit -p tsconfig.json
  ```
  ```bash
  cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json && D:/nodejs/corepack.cmd pnpm build
  ```

---

## 第一件:去掉按区域生成代码

代码只能在**所有区域解析完成后从整页生成**。区域详情里的「生成代码」入口、按区域的代码节点、以及服务端的按区域路由全部删掉。

> **一句提醒(执行时不必纠结,记录在案即可):** 按区域那个节点里带着一个**单区域叠加比对**,删掉之后就只剩整页比对了。也就是说以后要定位某个区域的错位,得在整页视图里找。这是刻意的取舍。

### Task 1: 删掉前端的按区域代码节点

**Files:**
- Delete: `apps/region-split-ui/src/canvas/nodes/CodeNode.vue`
- Delete: `apps/region-split-ui/src/canvas/nodes/CodeNode.test.ts`
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.vue`
- Modify: `apps/region-split-ui/src/canvas/PipelineCanvas.vue`
- Modify: `apps/region-split-ui/src/canvas/dynamic-detail-state.ts`
- Modify: `apps/region-split-ui/src/canvas/dynamic-detail-state.test.ts`
- Modify: `apps/region-split-ui/src/canvas/PipelineCanvas.test.ts`
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.test.ts`
- Modify: `apps/region-split-ui/src/App.vue`
- Modify: `apps/region-split-ui/src/api.ts`
- Modify: `apps/region-split-ui/src/test-helpers.ts`

- [ ] **Step 1: 先跑一次记下现状**

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm test
```

记下通过数(应为 306 左右),后面对照。

- [ ] **Step 2: 删除与解绑**

要删干净的东西,逐条核对(用 `grep -rn` 确认没有残留):

1. `CodeNode.vue` 与 `CodeNode.test.ts` 两个文件删除。
2. `DetailNode.vue`:删掉「生成代码」按钮(`data-test="open-code"`)、`emit("open-code")`,以及 `defineEmits` 里的 `"open-code"` 声明。
3. `PipelineCanvas.vue`:删掉 `openCodeIds` / `codePositions` / `openCode()` / `closeCode()`、渲染代码节点的那段 `v-for`、详情→代码的连线、以及 `closeDetail` 里连带关闭代码节点的那段。
   **注意**:详情节点的 `:output` 当初为了代码节点才改成动态的,现在没有下游了,**改回 `false`**。
4. `dynamic-detail-state.ts`:删掉 `codeNodeId`,以及只为代码节点位置存在的 storage key。
5. `api.ts`:删掉 `getCode` 及其类型。**保留 `getPageCode` 和 `getPageArchive`**——整页那条路要留。
6. `App.vue`:删掉与代码节点相关的接线。
7. `test-helpers.ts`:删掉桩里的 `getCode`。
8. 各测试文件里**测已删功能的用例整条删除**,不要留空壳。

**不要动的东西**(容易误删,逐条确认):

- `packages/region-split/src/emit-html.ts` —— **整页生成器内部还在用它**(`emit-page.ts` 就是把它按区域组合起来的),删了整页就崩。
- `PageCompareNode.vue` / `page-preview.ts` / `NodeId` 里的 `"page"` —— 那是整页比对,与本条无关。
- `data-element-id` 属性 —— 整页叠加比对靠它定位元素。

- [ ] **Step 3: 跑测试**

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json && D:/nodejs/corepack.cmd pnpm build
```

Expected: 全绿(通过数会**下降**,因为删了用例——这是预期的);typecheck 无输出;build 成功。
**在报告里写明删了几条用例、通过数从几变成几。**

- [ ] **Step 4: 提交**

```bash
git add -A apps/region-split-ui/src
git commit -m "refactor: drop per-region code generation from the ui

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 删掉服务端的按区域代码路由

**Files:**
- Modify: `packages/region-split/src/server.ts`(`/api/projects/:projectId/code` 路由,约第 140 行起)
- Modify: `packages/region-split/src/server.test.ts`

- [ ] **Step 1: 删除**

删掉 `GET /api/projects/:projectId/code` 整条路由。**保留** `/page-code`、`/page-archive`(若有)与 `/assets/:fileName`。

`server.test.ts` 里针对这条路由的用例整条删除。

> 删完之后 `emitHtml` 在服务端**只剩 `emit-page.ts` 一个调用方**,这是对的,不要因此把它也删了。

- [ ] **Step 2: 跑测试**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: 全绿,typecheck 无输出。

- [ ] **Step 3: 提交**

```bash
git add packages/region-split/src/server.ts packages/region-split/src/server.test.ts
git commit -m "refactor: drop the per-region code route

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 第二件:解析完成的区域,颜色点变实心

现在区域列表右侧的颜色点是**空心圈**(`.region-port` 用 `border` 画圈、`background` 是画布底色)。要改成:**该区域已解析 → 实心**。

**难点在于列表并不知道哪些区域解析过。** 元素树在服务端的 `elements.json` 里,而区域列表只拿到 `regions`。所以要加一个轻量接口把"哪些区域已解析"告诉前端。

### Task 3: 服务端给出已解析的区域

**Files:**
- Modify: `packages/region-split/src/server.ts`
- Modify: `packages/region-split/src/server.test.ts`

**Interfaces:**
- Produces: `GET /api/projects/:projectId/parsed-regions` → `{ regionKeys: string[] }`

- [ ] **Step 1: 写失败的测试**

追加到 `packages/region-split/src/server.test.ts`(沿用该文件已有的 `upload()` 与建树写法):

```ts
  it("lists which regions already have an element tree", async () => {
    const { app, projectId } = await projectWithElements();
    const res = await app.inject({
      method: "GET", url: `/api/projects/${projectId}/parsed-regions`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().regionKeys).toContain("0-338");
  });

  // 一棵树都没有时是空数组，不是 404——"还没解析"是正常状态
  it("returns an empty list for a project with no trees", async () => {
    const { projectId } = (await upload(app)).json();
    const res = await app.inject({
      method: "GET", url: `/api/projects/${projectId}/parsed-regions`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().regionKeys).toEqual([]);
  });
```

若 `projectWithElements` 这个 helper 在该文件里叫别的名字,用真实的名字;**不要新建一套夹具体系**。第一条用例里的 `"0-338"` 要换成该 helper 实际写入的 `regionKey`。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm exec vitest run src/server.test.ts
```

Expected: FAIL,404。

- [ ] **Step 3: 实现**

在 `server.ts` 里加一条只读路由。`store.readElements(projectId)` 一次就能拿到全部树,**不要逐区域调 `readElementTree`**——那是 N 次读同一个文件:

```ts
  app.get<{ Params: ProjectParams }>(
    "/api/projects/:projectId/parsed-regions", async (req, reply) => {
      const { projectId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      // 一次读出整份文档；逐区域调 readElementTree 会把同一个文件读 N 遍
      return { regionKeys: store.readElements(projectId).trees.map(tree => tree.regionKey) };
    });
```

- [ ] **Step 4: 跑测试并提交**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec tsc --noEmit -p tsconfig.json
```

```bash
git add packages/region-split/src/server.ts packages/region-split/src/server.test.ts
git commit -m "feat: list the regions that already have an element tree

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 4: 列表颜色点按解析状态实心

**Files:**
- Modify: `apps/region-split-ui/src/api.ts`
- Modify: `apps/region-split-ui/src/components/RegionList.vue`
- Modify: `apps/region-split-ui/src/components/RegionList.test.ts`
- Modify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.vue`
- Modify: `apps/region-split-ui/src/test-helpers.ts`

**关键:什么时候刷新这个状态。** 至少这三个时机要刷新,否则点会停在旧状态:

1. 项目载入后
2. 某个区域**解析完成**后
3. 区域列表变化后(拆分/合并会改 `regionKey`,旧的键就不再对应任何区域)

- [ ] **Step 1: 写失败的测试**

追加到 `apps/region-split-ui/src/components/RegionList.test.ts`(沿用已有的挂载写法):

```ts
  // 空心 = 还没解析，实心 = 已解析。这是列表上唯一能看出进度的地方
  it("fills the port of a parsed region", () => {
    const wrapper = mountList({ parsedRegionKeys: ["0-100"] });
    const ports = wrapper.findAll('[data-test="region-port"]');
    expect(ports[0]!.classes()).toContain("parsed");
  });

  it("leaves an unparsed region hollow", () => {
    const wrapper = mountList({ parsedRegionKeys: [] });
    expect(wrapper.find('[data-test="region-port"]').classes()).not.toContain("parsed");
  });
```

`mountList` 里的区域要保证 `bounds` 能算出 `regionKey === "0-100"`(即 `y: 0, h: 100`);
若该文件的 helper 名字或区域夹具不同,按真实情况调整,**断言的形状不要变**。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm exec vitest run src/components/RegionList.test.ts
```

Expected: FAIL,找不到 `[data-test="region-port"]` 或没有 `parsed` 类。

- [ ] **Step 3: 实现**

1. `api.ts` 加:

```ts
  getParsedRegions(projectId: string): Promise<{ regionKeys: string[] }>;
```

```ts
  getParsedRegions(projectId) {
    return json(`/api/projects/${projectId}/parsed-regions`);
  },
```

2. `RegionsNode.vue`:拉取并持有 `parsedRegionKeys`,在上面说的三个时机刷新,作为 prop 传给 `RegionList`。

3. `RegionList.vue`:props 加 `parsedRegionKeys: string[]`,给那个点加 `data-test` 与状态类。
   `regionKey` 的算法是 `` `${bounds.y}-${bounds.y + bounds.h}` ``,**从 `@region-split/core/browser` 导入现成的 `regionKey`,不要在组件里手写字符串拼接**——两处算法一旦分叉,点就会永远是空心的。

```vue
      <span
        data-test="region-port"
        class="region-port"
        :class="{ parsed: props.parsedRegionKeys.includes(regionKey(region.bounds)) }"
        :style="{ borderColor: regionColor(region.id) }"
        aria-hidden="true"
      />
```

样式里补一条(空心靠 `background` 是画布底色,实心就是把它填成区域色):

```css
.region-port.parsed { background: var(--region-color); }
```

4. `test-helpers.ts` 的桩补上 `getParsedRegions`。

- [ ] **Step 4: 跑测试并提交**

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json
```

```bash
git add apps/region-split-ui/src
git commit -m "feat: fill the region port once that region is parsed

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 第三件:去掉区域类型这个概念

区域列表里 `card` / `banner` / `grid` 那一列要去掉,**连同背后的整套概念**:schema 字段、模型返回值、prompt 里的说明。

> **注意范围**:要删的是**区域**的 `type`(`regionTypes`,在 `types.ts` 里)。
> **元素**的 `kind`(`component` / `text` / `icon` …,在 `element-types.ts` 里)是另一回事,**不要动**。

### Task 5: 核心包删掉区域类型

**Files:**
- Modify: `packages/region-split/src/types.ts`
- Modify: `packages/region-split/src/model.ts`
- Modify: `packages/region-split/src/model.test.ts`
- Modify: 其余所有构造 `Region` 的测试与夹具(用 grep 找全)

- [ ] **Step 1: 找全所有用到的地方**

```bash
cd packages/region-split && grep -rn "regionTypes\|RegionType\|type: \"" src/ | grep -v "element" | head -40
```

把清单记进报告。

- [ ] **Step 2: 删除**

1. `types.ts`:删掉 `regionTypes` 常量、`RegionType` 类型、`regionSchema` 里的 `type` 字段、`Region` 接口里的 `type`。
   **老的 `regions.json` 里仍有 `type` 字段**——zod 默认忽略多余键,所以老文件照常读得出来,不用做迁移。**自己验证一下这个推断**(写一条测试:带 `type` 的旧数据能解析,且解析结果里没有 `type`)。
2. `model.ts`:删掉 `regionTypes` 的 import、两处 `type: z.enum(regionTypes)`、`SegmentResult` 之类接口里的 `type`,以及 **prompt 文本里让模型给 `type` 的那句**。
   **prompt 和 schema 必须一起改** —— 这个项目踩过:schema 加了字段但 prompt 没写,模型不返回,字段静默为空。
3. 所有构造 `Region` 的测试夹具删掉 `type:` 那一项。

- [ ] **Step 3: 跑测试**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: 全绿,typecheck 无输出。

> `2026-08-19-fix-page-export-suite.md` Task 3 修的那两行 `type: "header"` / `"footer"`,到这一步会被整行删掉——**这是预期的**,不是白做:那份计划先让仓库回到绿,本文再做删除,顺序不能反。

- [ ] **Step 4: 提交**

```bash
git add packages/region-split/src
git commit -m "refactor: drop the region type concept

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 6: 前端删掉区域类型的展示

**Files:**
- Modify: `apps/region-split-ui/src/components/RegionList.vue`
- Modify: `apps/region-split-ui/src/components/RegionList.test.ts`
- Modify: 其余引用 `region.type` 的前端文件(用 grep 找全)

- [ ] **Step 1: 找全**

```bash
cd apps/region-split-ui && grep -rn "\.type\b" src/ | grep -iv "element\|kind\|contentType\|mimeType" | head -20
```

- [ ] **Step 2: 删除**

1. `RegionList.vue`:删掉 `<span class="type">{{ region.type }}</span>` 那一行,以及样式里的 `.type` 规则。
2. 测试里断言类型展示的用例整条删除。
3. 其余引用一并清理。

- [ ] **Step 3: 跑测试并提交**

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json && D:/nodejs/corepack.cmd pnpm build
```

```bash
git add apps/region-split-ui/src
git commit -m "refactor: stop showing the region type in the list

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: 真浏览器走查

**改了核心包必须重启 API。** 起两个服务,打开 `http://localhost:5180`,上传 `packages/region-split/test-fixtures/maicai.png`,等分析完成。

确认:

1. **区域列表里没有 `card` / `banner` 那一列了**;
2. **所有区域的颜色点都是空心**;
3. 打开一个区域详情,点「重新解析」,解析完成后**这个区域的点变成实心**,其余仍空心;
4. **区域详情里没有「生成代码」按钮了**,画布上也开不出按区域的代码节点;
5. 工作区的「导出整页代码」和「整页比对」**仍然可用**;
6. 拆分或合并一个区域后,点的状态**跟着更新**(旧 `regionKey` 失效,应变回空心)。

第 6 条最容易漏——`regionKey` 是按几何算的,区域边界一改键就变了。

**做不到就如实写明卡在哪**,不要声称看到了实际没看到的东西。

写报告到 `D:\workspace\.superpowers\sdd\page-only-codegen-report.md`:每件事改了什么、删了几条用例、通过数变化、typecheck 与 build 结果、走查逐条结果、任何偏离本文的决定及理由。

---

## 完成标准

- 两个包测试全绿,两个 typecheck 无输出,前端 build 成功。
- `grep -rn "CodeNode\|getCode\|codeNodeId\|open-code"` 在 `src/` 下**零命中**(整页的 `getPageCode` 除外)。
- `grep -rn "regionTypes\|RegionType"` 在 `src/` 下**零命中**。
- `emit-html.ts`、`page-preview.ts`、`PageCompareNode.vue`、`data-element-id` **都还在**。
- 走查第 3、6 两条(解析后变实心、改区域后回空心)有明确结论。
