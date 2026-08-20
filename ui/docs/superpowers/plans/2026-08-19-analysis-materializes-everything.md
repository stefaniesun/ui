# 区域分析阶段落地全部源文件与属性 Implementation Plan

**Goal:** 区域分析这一步结束时,生成 HTML 所需的东西**全部已经在磁盘上、且人工确认过**——图标有 SVG、文字有字号与字体、图片有切图。生成器只负责拼装,不再临时去找任何东西。

**Architecture:** 沿用已有的「派生物按其来源寻址」缓存模式。**决定**(图标名、字体栈)存进数据当真相,**文件**(SVG、PNG)是从决定派生出来的缓存,键里含它依赖的东西,所以永不过期。

**Tech Stack:** TypeScript、Vue 3、Vitest、zod、Fastify、sharp。

设计依据:`docs/superpowers/specs/2026-08-18-page-emitter-and-assets-design.md` 第 2、3、5 节。

## 现状(动手前已核实)

| 需求 | 现状 |
|---|---|
| **图片 → 切图源文件** | ✅ **已完成**,不用重做。`materializeTreeAssets` 在检测(`server.ts:233`)和保存元素树(`:250`)时都会跑,按框的几何寻址,改框自动重切 |
| **文字 → 字号/字重** | ✅ **已完成**。`DetailNode.vue` 在检测后自动 `measureAllFonts()`,结果落进 `style.fontSize` / `fontWeight` |
| **文字 → 字体族** | ❌ **没有**。全仓搜不到任何 `fontFamily`,生成器也从不输出 `font-family` |
| **图标 → SVG** | ❌ **没有**。全仓搜不到 `iconify` 或 `style.icon` |
| **完成度可见** | ❌ **没有**。没法一眼看出还有哪些元素等着人工确认 |

所以本计划做三件事:**字体族**、**图标 SVG**、**完成度闸门**。

## Global Constraints

- **决定与派生物分开。** 数据里存"挑了哪个图标""选了哪个字体栈";SVG / PNG 文件是从决定派生的缓存,放 `assets/`,**随时可以整个删掉重建**,不是真相源。
- **缓存键必须含它依赖的东西**:切图按框的几何、图标 SVG 按图标名。这样依赖一变键就变,不会留下过期文件。
- **生成器不许发明信息。** 缺什么就按既定的兜底走,不要在 emitter 里就地猜。
- 新字段一律 `.optional()`——已存盘的文件没有它们,读出来不能炸。这条在 `textBox` 和 `repeat.slot` 上已经踩实过两次。
- **不允许放宽任何断言**;每处改动先跑一次确认由红转绿。
- **改了 `packages/region-split` 必须重启 API**(tsx 不热重载)。**走查前务必重启**——上一轮验收就是因为没重启,新路由报 404,差点被误判成"功能没做"。
- 命令用 `D:/nodejs/corepack.cmd pnpm`,测试要 `cd` 进包目录再跑。**根目录跑 `pnpm test` 会多出 4 个 fixture 路径相关的失败**,那是既有问题。
- 收尾两个包都要干净:
  ```bash
  cd packages/region-split && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec tsc --noEmit -p tsconfig.json
  ```
  ```bash
  cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json && D:/nodejs/corepack.cmd pnpm build
  ```

## 本轮不做

- **图像相似度匹配图标**(拿切图和图标库逐个比像素)。已论证不可行:库里二十万个图标逐个渲染比对不现实,而且彩色插画与单色线条图本就不像,相似度分数没有意义。
- **字体族的自动判别**。已实测否定:汉字几乎撑满 em 框,各家字体墨高比例都在 0.92–0.99 的窄带内,这个量不携带字体信息;而且本机根本没装苹方,候选集里没有正确答案。所以字体族**由人选一次**。

---

## 第一件:文字 → 字体族(项目级选一次)

字体族是**整页一个**,不是逐元素的。所以它存在项目文档上,不进元素树。

### Task 1: 项目文档存字体栈

**Files:**
- Modify: `packages/region-split/src/types.ts`
- Modify: `packages/region-split/src/types.test.ts`
- Modify: `packages/region-split/src/server.ts`
- Modify: `packages/region-split/src/server.test.ts`

**Interfaces:**
- Produces:
  - `regionSplitDocSchema` 增加 `fontStack: z.string().optional()`
  - `PUT /api/projects/:projectId/font-stack`,body `{ fontStack: string }`

- [ ] **Step 1: 写失败的测试**

追加到 `packages/region-split/src/types.test.ts`(沿用该文件已有的构造 helper):

```ts
describe("字体栈", () => {
  it("keeps the chosen font stack", () => {
    const doc = regionSplitDocSchema.parse({
      ...baseDoc(), fontStack: '-apple-system, "PingFang SC", sans-serif',
    });
    expect(doc.fontStack).toBe('-apple-system, "PingFang SC", sans-serif');
  });

  // 老文件没有这个字段，读出来不能炸，也不能凭空补一个默认值——
  // "还没选"和"选了某个值"是两回事
  it("stays undefined on a document that never set one", () => {
    expect(regionSplitDocSchema.parse(baseDoc()).fontStack).toBeUndefined();
  });
});
```

追加到 `packages/region-split/src/server.test.ts`:

```ts
  it("stores the chosen font stack", async () => {
    const { projectId } = (await upload(app)).json();
    const res = await app.inject({
      method: "PUT", url: `/api/projects/${projectId}/font-stack`,
      payload: { fontStack: '-apple-system, "PingFang SC", sans-serif' },
    });
    expect(res.statusCode).toBe(200);
    expect(store.readDoc(projectId).fontStack).toBe('-apple-system, "PingFang SC", sans-serif');
  });

  it("rejects an empty font stack", async () => {
    const { projectId } = (await upload(app)).json();
    const res = await app.inject({
      method: "PUT", url: `/api/projects/${projectId}/font-stack`, payload: { fontStack: "  " },
    });
    expect(res.statusCode).toBe(422);
  });
```

若 `baseDoc()` 在 `types.test.ts` 里叫别的名字,用真实的名字,**不要新建夹具体系**。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm exec vitest run src/types.test.ts src/server.test.ts
```

- [ ] **Step 3: 实现**

1. `types.ts` 的 `regionSplitDocSchema` 里加:

```ts
  /**
   * 整页共用的字体栈，人工选一次。
   *
   * **不做自动判别**：实测汉字几乎撑满 em 框，各家字体的墨高比例都在 0.92–0.99
   * 的窄带内，这个量不携带字体信息；而且截图用的苹方本机根本没装，候选集里
   * 没有正确答案。所以这是个判断题，交给人。
   */
  fontStack: z.string().optional(),
```

2. `server.ts` 加路由,**空白串要拒绝**(存一个空的比没有更糟——生成器会写出 `font-family: ;`):

```ts
  app.put<{ Params: ProjectParams; Body: { fontStack?: string } }>(
    "/api/projects/:projectId/font-stack", async (req, reply) => {
      const { projectId } = req.params;
      if (!store.exists(projectId)) return reply.code(404).send({ error: "project not found" });
      const fontStack = req.body?.fontStack?.trim();
      if (!fontStack) return reply.code(422).send({ error: "font stack is empty" });
      store.writeDoc(projectId, { ...store.readDoc(projectId), fontStack });
      return { fontStack };
    });
```

- [ ] **Step 4: 跑测试并提交**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec tsc --noEmit -p tsconfig.json
```

```bash
git add packages/region-split/src
git commit -m "feat: store a page-wide font stack on the project

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 2: 界面选字体栈 + 生成器输出它

**Files:**
- Modify: `apps/region-split-ui/src/api.ts`
- Modify: `apps/region-split-ui/src/test-helpers.ts`
- Modify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.vue`
- Modify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts`
- Modify: `packages/region-split/src/emit-page.ts`
- Modify: `packages/region-split/src/emit-page.test.ts`
- Modify: `packages/region-split/src/server.ts`

**候选字体栈**(下拉里就这几项,不要让人自由输入——自由输入必然打错字):

```ts
export const FONT_STACKS = [
  { label: "iOS 系统字体", value: '-apple-system, "PingFang SC", "Helvetica Neue", sans-serif' },
  { label: "Android 系统字体", value: 'Roboto, "Noto Sans CJK SC", "Droid Sans", sans-serif' },
  { label: "思源黑体", value: '"Source Han Sans SC", "Noto Sans SC", sans-serif' },
  { label: "阿里巴巴普惠体", value: '"Alibaba PuHuiTi", sans-serif' },
] as const;
```

放在 `apps/region-split-ui/src/font-stacks.ts`,导出给下拉用。

> **默认选 iOS 那条**,因为基准图是 iOS 截图,原页面用的就是苹方。

- [ ] **Step 1: 写失败的测试**

追加到 `packages/region-split/src/emit-page.test.ts`:

```ts
  it("writes the font stack on the page root", () => {
    const { css } = emitPage({
      ...basePageInput(), fontStack: '-apple-system, "PingFang SC", sans-serif',
    });
    expect(css).toContain('font-family: -apple-system, "PingFang SC", sans-serif');
  });

  // 没选就不写，而不是编一个默认值塞进去——生成器不许发明信息
  it("omits the font family when nothing was chosen", () => {
    expect(emitPage(basePageInput()).css).not.toContain("font-family");
  });
```

追加到 `apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts`(沿用已有挂载写法):

```ts
  it("sends the chosen font stack", async () => {
    const api = stubApi();
    const wrapper = mountNode({ api });
    await wrapper.find('[data-test="font-stack"]').setValue(
      '"Source Han Sans SC", "Noto Sans SC", sans-serif');
    expect(api.putFontStack).toHaveBeenCalledWith(
      "p1", '"Source Han Sans SC", "Noto Sans SC", sans-serif');
  });
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

1. `emit-page.ts`:`EmitPageInput` 加 `fontStack?: string`;有值时在页面根规则上写 `font-family`,**没值就整条不写**。
2. `server.ts` 的 `/page-code` 路由把 `store.readDoc(projectId).fontStack` 传进 `emitPage`。
3. `api.ts` 加 `putFontStack(projectId, fontStack)`;`test-helpers.ts` 桩补上。
4. `RegionsNode.vue` 在「导出整页代码」那一行加一个 `<select data-test="font-stack">`,选项来自 `FONT_STACKS`,改动即 `putFontStack`。当前值从项目文档读;**文档里没有时选中 iOS 那条但不自动写盘**——"还没选"和"选了 iOS"要能区分。

- [ ] **Step 4: 跑测试并提交**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec tsc --noEmit -p tsconfig.json
```

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json
```

```bash
git add packages/region-split/src apps/region-split-ui/src
git commit -m "feat: choose a font stack and emit it on the page

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 第二件:图标 → SVG 落地

**决定是图标名,文件是从名字派生的 SVG。两个都存。**

- 只存名字 → 生成时要现取,把外部依赖塞进了生成路径
- 只存文件 → 磁盘上剩一堆认不出来的 SVG,没法换风格、没法知道当初挑的是哪个

### Task 3: 本地图标索引与检索

**Files:**
- Create: `packages/region-split/src/icon-search.ts`
- Create: `packages/region-split/src/icon-search.test.ts`
- Modify: `packages/region-split/package.json`

**依赖:** 装 `@iconify/json`(离线数据包,含 200+ 图标集)。

> **先确认体积**。全量包很大;如果超过可接受范围,改用按需的单集包(如 `@iconify-json/mdi`、
> `@iconify-json/tabler`、`@iconify-json/ri`),在报告里写明装了哪些、总共多大。
> **不要装阿里 iconfont**:素材虽多但大量是用户上传、版权状态不明,商用有风险。

**Interfaces:**
- Produces:
  - `export interface IconCandidate { name: string; body: string }`
  - `export function searchIcons(keywords: readonly string[], limit?: number): IconCandidate[]`
  - `export function loadIconSvg(name: string): string | null`

`name` 用 `集名:图标名` 形式(如 `mdi:qrcode-scan`);`body` 是可直接内联的完整 `<svg>` 字符串。

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from "vitest";
import { loadIconSvg, searchIcons } from "./icon-search.js";

describe("searchIcons", () => {
  it("finds something for a common keyword", () => {
    const hits = searchIcons(["qrcode"]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.name).toMatch(/^[a-z0-9-]+:[a-z0-9-]+$/);
  });

  it("respects the limit", () => {
    expect(searchIcons(["arrow"], 5).length).toBeLessThanOrEqual(5);
  });

  it("returns nothing for a keyword that matches nothing", () => {
    expect(searchIcons(["zzzzznotanicon"])).toEqual([]);
  });
});

describe("loadIconSvg", () => {
  it("returns an inlinable svg for a known name", () => {
    const name = searchIcons(["qrcode"])[0]!.name;
    const svg = loadIconSvg(name)!;
    expect(svg).toMatch(/^<svg[\s>]/);
    expect(svg).toContain("</svg>");
  });

  it("returns null for an unknown name", () => {
    expect(loadIconSvg("nosuchset:nosuchicon")).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败,再实现**

实现要点:

- **`fill` 要能被 `currentColor` 覆盖。** Iconify 的图标体多数用 `currentColor`,但有的写死了颜色——
  实现里把顶层 `fill` 统一成 `currentColor`,**并在报告里写明你怎么处理写死颜色的那些**。
  这一步做不到,生成出来的图标就只能是图标库自带的颜色,我们量的墨色白测了。
- 检索按关键词匹配图标名与它的别名,大小写不敏感。
- **不要在这里做图像相似度匹配**(见"本轮不做")。

- [ ] **Step 3: 跑测试并提交**

```bash
git add packages/region-split/src/icon-search.ts packages/region-split/src/icon-search.test.ts packages/region-split/package.json
git commit -m "feat: search a local icon index by keyword

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 4: schema 与 SVG 缓存

**Files:**
- Modify: `packages/region-split/src/element-types.ts`
- Modify: `packages/region-split/src/element-types.test.ts`
- Modify: `packages/region-split/src/asset-cache.ts`
- Modify: `packages/region-split/src/asset-cache.test.ts`

**Interfaces:**
- Produces:
  - `style.icon?: { source: "iconify"; name: string; keywords: string[]; by: "model" | "human" }`
  - `export function iconFileName(name: string): string`(SHA1(name) + `.svg`)
  - `export async function materializeIconSvg(store, projectId, name): Promise<string | null>` —— 返回缓存文件名

- [ ] **Step 1: 写失败的测试**

```ts
// element-types.test.ts
describe("图标引用", () => {
  it("keeps the chosen icon and who chose it", () => {
    const parsed = elementNodeSchema.parse({
      id: "n1", parentId: null, box: { x: 0, y: 0, w: 10, h: 10 },
      kind: "icon", displayName: "扫码", uniformity: 1,
      style: { icon: { source: "iconify", name: "mdi:qrcode-scan", keywords: ["qrcode"], by: "human" } },
    });
    expect(parsed.style.icon?.name).toBe("mdi:qrcode-scan");
    expect(parsed.style.icon?.by).toBe("human");
  });

  // 没挑过图标和挑过是两回事，不给默认值
  it("stays undefined when no icon was chosen", () => {
    const parsed = elementNodeSchema.parse({
      id: "n1", parentId: null, box: { x: 0, y: 0, w: 10, h: 10 },
      kind: "icon", displayName: "扫码", uniformity: 1,
    });
    expect(parsed.style.icon).toBeUndefined();
  });
});
```

```ts
// asset-cache.test.ts —— 沿用该文件已有的 fixture()
describe("materializeIconSvg", () => {
  // 键按图标名寻址：名字一变就是另一个文件，永不过期
  it("caches an svg under a name-addressed file", async () => {
    const { store, projectId } = await fixture();
    const ref = await materializeIconSvg(store, projectId, "mdi:qrcode-scan");
    expect(ref).toBe(iconFileName("mdi:qrcode-scan"));
    expect(await materializeIconSvg(store, projectId, "mdi:qrcode-scan")).toBe(ref);
  });

  it("rebuilds a deleted cache file", async () => {
    const { store, projectId } = await fixture();
    const ref = await materializeIconSvg(store, projectId, "mdi:qrcode-scan");
    rmSync(join(store.assetsDir(projectId), ref!));
    expect(await materializeIconSvg(store, projectId, "mdi:qrcode-scan")).toBe(ref);
  });

  it("returns null for an unknown icon", async () => {
    const { store, projectId } = await fixture();
    expect(await materializeIconSvg(store, projectId, "nosuchset:nope")).toBeNull();
  });
});
```

若 `store.assetsDir()` 不存在,用 `asset-cache.ts` 里现有的取资产目录的写法。

- [ ] **Step 2: 跑测试确认失败,再实现**

**缓存键用图标名的 SHA1**,和切图用框的几何是同一个模式:键里含它依赖的东西,依赖一变键就变。

- [ ] **Step 3: 跑测试并提交**

```bash
git add packages/region-split/src
git commit -m "feat: cache an icon svg addressed by its name

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 5: 模型给关键词、服务端出候选

**Files:**
- Modify: `packages/region-split/src/model.ts`
- Modify: `packages/region-split/src/model.test.ts`
- Modify: `packages/region-split/src/analyze-elements.ts`
- Modify: `packages/region-split/src/server.ts`
- Modify: `packages/region-split/src/server.test.ts`

**分工:模型判断"这是什么",代码做检索。**

1. `model.ts`:叶子分类的返回里加 `iconKeywords?: string[]`,**prompt 里同时写清楚**——
   "kind 为 icon 时,给 2–4 个描述这个图标的**英文**关键词"。
   > **prompt 和 schema 必须一起改。** 这个项目踩过:schema 加了字段但 prompt 没写,
   > 模型不返回,字段静默为空。
2. `analyze-elements.ts`:把关键词落到 `style.icon = { source: "iconify", name: "", keywords, by: "model" }`。
   **`name` 此时为空**——模型只给关键词,不许它直接给图标名(它会编造不存在的名字)。
3. `server.ts` 加 `GET /api/projects/:id/icon-candidates?keywords=a,b&limit=8` → `{ candidates: IconCandidate[] }`。

- [ ] 按前面几个任务同样的节奏:先写失败测试、跑、实现、跑、提交。

```bash
git commit -m "feat: ask the model for icon keywords and serve candidates

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 6: 界面挑图标

**Files:**
- Modify: `apps/region-split-ui/src/api.ts`、`test-helpers.ts`
- Modify: `apps/region-split-ui/src/element-state.ts`、`element-state.test.ts`
- Modify: `apps/region-split-ui/src/components/ElementProperties.vue`、`ElementProperties.test.ts`
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.vue`

属性面板里 `icon` 类型的元素多一行:

```
[原图切片]  →  [当前选中的图标]  [换一个]
```

**「原图切片」必须一直钉在候选旁边** —— 否则人根本没法判断像不像。这一条不能省。

「换一个」弹候选网格(来自 `icon-candidates` 接口),附一个搜索框让人手输关键词。
选中后 `elementStore.setIcon(...)` 写 `style.icon = { …, name, by: "human" }`。

- [ ] 同样的节奏:先写失败测试、跑、实现、跑、提交。

```bash
git commit -m "feat: pick an icon beside its crop

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 7: 生成器内联 SVG,没挑就回落切图

**Files:**
- Modify: `packages/region-split/src/emit-html.ts`、`emit-html.test.ts`
- Modify: `packages/region-split/src/server.ts`

**两条路始终有一条通:**

```
挑了图标（style.icon.name 非空）→ 内联 <svg>，fill: currentColor，颜色用量到的 style.color
没挑                          → PNG 切图，<img src>（现状不变）
```

**必须内联,不能 `<img src="x.svg">`** —— `<img>` 里的 SVG **上不了色**,我们量的墨色就白测了。

> 兜底不是将就:实测 20 个图标里 **18 个是彩色插画**,库里本来就没有对应物,切图反而更像。

- [ ] **测试要覆盖三种情况**:挑了图标→内联 svg 且带 `currentColor`;没挑→仍是 `<img>`;
  图标名指向一个不存在的图标→**回落切图而不是空白**。

```bash
git commit -m "feat: inline a chosen icon and fall back to its crop

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 第三件:完成度闸门

"分析这一步就要完成"要能**看得出来**,否则没人知道还差什么。

### Task 8: 待办统计与整页生成前的提示

**Files:**
- Modify: `packages/region-split/src/server.ts`、`server.test.ts`
- Modify: `apps/region-split-ui/src/api.ts`、`test-helpers.ts`
- Modify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.vue`、`RegionsNode.test.ts`

**Interfaces:**
- Produces:`GET /api/projects/:id/pending` →

```ts
{
  unparsedRegions: number;   // 还没解析的区域数
  iconsWithoutName: number;  // kind 为 icon 但没挑图标的元素数
  textWithoutSize: number;   // kind 为 text、textBox 通过、但没有 fontSize 的元素数
  fontStackChosen: boolean;  // 项目是否选过字体栈
}
```

**`textWithoutSize` 只数 `textBox?.ok !== false` 的**——框本来就不合格的元素不该算进待办,
那是另一类问题(框要先改对),混在一起会让这个数字永远清不掉。

界面上放在「导出整页代码」旁边,还有待办就显示出来,例如
`还有 3 个区域未解析 · 7 个图标未选 · 未选字体`。

**只提示,不阻断。** 人可能就是想先看看半成品长什么样;把导出按钮禁掉会挡住这个正当用法。

- [ ] 同样的节奏:先写失败测试、跑、实现、跑、提交。

```bash
git commit -m "feat: report what still needs a human decision

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: 真浏览器走查

**改了核心包,先重启 API。** 起两个服务,打开
`http://localhost:5180/#project=<某个已有项目 id>`(hash 能直接打开已有项目,不用重新上传)。

逐条确认并**写下结果**:

1. 工作区能选字体栈,选完刷新页面仍是选中的那个;
2. 解析一个区域后,某个图标元素的属性面板里出现图标行,**左边是原图切片**;
3. 点「换一个」出候选,选一个之后**元素解析图上的显示跟着变**;
4. 生成整页代码,CSS/HTML 里那个图标是**内联 `<svg>`**、带 `currentColor`,而不是 `<img>`;
5. 没挑图标的元素仍然是 PNG 切图,**不是空白**;
6. 待办统计的数字和实际情况对得上,挑完一个图标数字减一;
7. **在整页比对里看一眼**:换成库图标之后,和原图差多少——**这条要具体写,别写"差不多"**。

**做不到就如实写明卡在哪**,不要声称看到了实际没看到的东西。

报告写到 `D:\workspace\.superpowers\sdd\analysis-materialize-report.md`:每个任务改了什么、
测试命令与输出、两个 typecheck 与 build 结果、装了哪些图标包共多大、
写死颜色的 SVG 怎么处理的、走查逐条结果、任何偏离本文的决定及理由。

---

## 完成标准

- 两个包测试全绿,两个 typecheck 无输出,前端 build 成功。
- 挑过图标的元素,整页产物里是**内联 `<svg>` 且能被 `color` 改色**;没挑的仍是 PNG 切图。
- `assets/` 目录整个删掉后重新生成整页,产物**完全一致**(缓存是派生物,不是真相)。
- 选过的字体栈出现在整页 CSS 的根规则上;没选过时**不输出 `font-family`**。
- 待办接口的四个数字与实际一致。
- 走查报告里第 7 条有**具体的差异描述**。
