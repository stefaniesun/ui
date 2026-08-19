# 修绿整页导出提交 Implementation Plan

**Goal:** 把 `1117b8c feat: export complete page with assets` 修到测试全绿、typecheck 干净。

**Architecture:** 查下来 **6 个失败全部是测试夹具自身的问题,实现代码没有 bug**。这份计划只改测试夹具,**不要动实现**。

**Tech Stack:** TypeScript、Vitest、sharp、zod。

## 现状

```
packages/region-split:  6 failed | 389 passed
packages/region-split typecheck:  FAIL（server.test.ts 两行）
apps/region-split-ui:   全绿
```

## Global Constraints

> **最重要的一条:这三处都要改"夹具",不要改"实现"。**
>
> 尤其是 Task 2——看上去像是生成器少输出了点什么,其实是**测试写的期望值过时了**。
> 把实现改成迎合旧期望,会把一个有用的属性删掉。动手前先跑一次看实际输出。

- **不允许放宽任何断言**(不许把精确比较改成 `toContain` 之类模糊比较、不许删测试)。
- 每处改完都要跑一次确认**由红转绿**,并且**其余用例不能因此变红**。
- 命令用 `D:/nodejs/corepack.cmd pnpm` 调用;核心包测试要 `cd packages/region-split` 再跑。
- 收尾必须两个包都干净:
  ```bash
  cd packages/region-split && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec tsc --noEmit -p tsconfig.json
  ```
  ```bash
  cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json
  ```
- **在仓库根目录跑 `pnpm test` 会多出 4 个 fixture 路径相关的失败**,那是既有问题(测试用相对路径读基准图),**在包目录里跑才是准的**。别被误导。

---

### Task 1: 资产缓存的三条测试(建目录 + 图片文件名)

**Files:**
- Modify: `packages/region-split/src/asset-cache.test.ts`

**失败现象:**

```
→ C:\...\rs-assets-XXXX\20260818-asset1\image.original.png: unable to open for write
```

三条用例全挂在同一处:`reuses a crop for the same project and box`、
`changes the reference after geometry changes`、`rebuilds a deleted cache file from the original image`。

**两个根因(都要修):**

1. **目录还不存在。** 夹具里 `store.projectDir(projectId)` **只是拼路径,不建目录**;
   真正建目录的是 `store.writeDoc()`(`store.ts` 里 `mkdirSync(..., { recursive: true })`)。
   而夹具是**先写图片、后写 doc**,所以写图片时目录还没有。
2. **写错了文件名。** `materializeTreeAssets` 读的是 `store.cleanImagePath(projectId)`
   (= `image.clean.png`,见 `asset-cache.ts:45`),而夹具写的是 `image.original.png`。
   就算目录建好了,裁图时也读不到源图。

- [ ] **Step 1: 先跑一次,记下失败**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm exec vitest run src/asset-cache.test.ts
```

Expected: 3 failed,报 `unable to open for write`。

- [ ] **Step 2: 改夹具**

把 `asset-cache.test.ts` 里 `fixture()` 函数改成**先写 doc 再写图片**,并且**写到缓存真正会读的那个路径**:

```ts
async function fixture() {
  const store = new ProjectStore(mkdtempSync(join(tmpdir(), "rs-assets-")));
  const projectId = "20260818-asset1";
  // 先写 doc：projectDir() 只拼路径不建目录，真正 mkdir 的是 writeDoc
  store.writeDoc(projectId, {
    schemaVersion: "1",
    image: { fileName: "image.png", width: 100, height: 80, analyzedScale: 1, removedChrome: [] },
    regions: [{ id: "r", displayName: "区域", type: "other", bounds: region, confidence: 1, scrollX: false, scrollY: false }],
    candidateLines: [], panels: [], updatedAt: new Date().toISOString(),
  });
  // 裁图读的是 cleanImagePath（image.clean.png），不是原图
  const image = await sharp({ create: { width: 100, height: 80, channels: 3, background: "#3578e5" } }).png().toBuffer();
  await sharp(image).toFile(store.cleanImagePath(projectId));
  return { store, projectId };
}
```

注意 `image.fileName` 改成了 `"image.png"`——它描述的是**上传的原图**,与缓存读的清理图是两回事,
夹具里写 `"image.original.png"` 是个误导。

若文件里 `import` 还没有 `sharp` 之外需要的东西(例如不再用到 `join`),按实际情况调整 import,
**不要留下未使用的 import 让 typecheck 变红**。

- [ ] **Step 3: 跑测试确认转绿**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm exec vitest run src/asset-cache.test.ts
```

Expected: 3 passed。

**如果 `rebuilds a deleted cache file from the original image` 仍然失败**,说明缓存在源图缺失时的
行为和用例期望不一致——**先把实际行为查清楚写进报告,不要直接改实现**,这条用例验的是
"缓存目录删掉能重建",是整个资产方案的立身之本。

- [ ] **Step 4: 提交**

```bash
git add packages/region-split/src/asset-cache.test.ts
git commit -m "test: create the project dir and clean image before cropping

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 文字字面量那条测试(期望值过时)

**Files:**
- Modify: `packages/region-split/src/emit-html.test.ts:37`

**失败现象:**

```
expected '<section class="region">\n  <span cla…' to contain '<span class="e-label">立即购买</span>'
```

**这条容易误诊,先看清楚:** 生成器**已经正确渲染了文字字面量**。实际输出是

```html
<section class="region">
  <span class="e-label" data-element-id="label">立即购买</span>
</section>
```

期望字符串里少了 `data-element-id="label"` 这个属性,所以 `toContain` 匹配不上。
**是期望值过时,不是实现少输出。**

> **绝对不要**为了让这条过而把 `data-element-id` 从生成器里删掉。那个属性是元素与
> 生成结果之间的对应关系,叠加比对要靠它定位。

- [ ] **Step 1: 先跑一次,自己看一眼实际输出**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm exec vitest run src/emit-html.test.ts -t "renders recognized text"
```

Expected: 1 failed。确认实际输出里确实有 `data-element-id="label"`。

- [ ] **Step 2: 改期望值**

把 `emit-html.test.ts:37` 那条断言改成包含真实属性的完整标签:

```ts
    expect(html).toContain('<span class="e-label" data-element-id="label">立即购买</span>');
```

**保持 `toContain` + 完整标签字符串**,不要拆成几个零散的 `toContain`——那样就测不出属性顺序
和标签结构了,等于放宽。

- [ ] **Step 3: 跑测试确认转绿**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm exec vitest run src/emit-html.test.ts
```

Expected: 全部 passed。

- [ ] **Step 4: 提交**

```bash
git add packages/region-split/src/emit-html.test.ts
git commit -m "test: expect the element id attribute the emitter actually writes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 整页导出的两条测试(区域类型 + 区域必须铺满整图)

**Files:**
- Modify: `packages/region-split/src/server.test.ts`(约 143–145 行那段夹具)

**失败现象:**

```
ZodError: received "header", code invalid_enum_value
Error: invariant violated: last-not-bottom   （store.ts:172）
```

**两个根因(都要修):**

1. **区域类型不合法。** `"header"` / `"footer"` 不在 `regionTypes` 里。合法值是:
   `status-bar / nav-bar / banner / card / grid / list / form / tabs / text-block / action-bar / tab-bar / other`。
   这同时也是 typecheck 报的那两行错(`server.test.ts:143,144`)。
2. **区域没铺满整张图。** 上传的夹具图是 **375×400**(见同文件 `upload()`),
   而两个区域只覆盖 `y 0..200`,末个区域够不到底 → `last-not-bottom` 不变量拒绝写入。

- [ ] **Step 1: 先跑一次,记下失败**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm exec vitest run src/server.test.ts
```

Expected: 2 failed,分别报 `invalid_enum_value` 和 `last-not-bottom`。

- [ ] **Step 2: 改夹具**

把那两个区域改成合法类型、并且**纵向铺满 400**:

```ts
    doc.regions = [
      { id: "a", displayName: "顶部", type: "nav-bar", bounds: { x: 0, y: 0, w: 375, h: 200 }, confidence: 1, scrollX: false, scrollY: false },
      { id: "b", displayName: "底部", type: "tab-bar", bounds: { x: 0, y: 200, w: 375, h: 200 }, confidence: 1, scrollX: false, scrollY: false },
    ];
```

**注意**:改了区域高度之后,同一个测试里后面若有断言依赖 `100` 这个高度(例如生成的 CSS 里的
`height: …vw`、或写元素树时用的 `regionKey`),**要跟着改成新的实测值**,不要放宽断言。
`regionKey` 是 `"{y}-{y+h}"`,所以两个区域的键会变成 `0-200` 和 `200-400`。

- [ ] **Step 3: 跑测试确认转绿**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm exec vitest run src/server.test.ts && D:/nodejs/corepack.cmd pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: 全部 passed,typecheck 无输出。

- [ ] **Step 4: 提交**

```bash
git add packages/region-split/src/server.test.ts
git commit -m "test: give the page export fixture valid types that tile the image

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 收尾核验

- [ ] **Step 1: 两个包全绿**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec tsc --noEmit -p tsconfig.json
```

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json && D:/nodejs/corepack.cmd pnpm build
```

Expected: 核心包 395 passed(现在 389 + 修好的 6),前端不受影响,两个 typecheck 无输出,build 成功。

- [ ] **Step 2: 写报告**

写进 `D:\workspace\.superpowers\sdd\page-export-fix-report.md`:

- 三处各改了什么、红→绿的证据(改前的失败输出 + 改后的通过输出)
- **有没有动过任何实现文件**(应该是没有;若动了,写明为什么、以及为什么不是"改实现迎合旧测试")
- Task 1 Step 3 里那个"缓存删掉能重建"的用例,是直接就绿了还是查了别的东西
- Task 3 里有没有连带改到别的断言,改了哪些、新的实测值是多少

---

## 完成标准

- `packages/region-split` 395 passed,`tsc --noEmit` 无输出。
- `apps/region-split-ui` 全绿,`vue-tsc --noEmit` 无输出,`pnpm build` 成功。
- **实现文件一个字没改**(`asset-cache.ts` / `emit-html.ts` / `emit-page.ts` / `server.ts` 等)。
- 没有任何断言被放宽或删除。
