# AI 高保真 UI 还原 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个可输入单页面多状态截图、自动生成语义区域树和可维护 uni-app 页面、通过 H5/微信小程序截图评分循环优化并输出区域化评审报告的纵向 MVP。

**Architecture:** 使用 pnpm Monorepo 将 Visual IR、模型适配、视觉测量、代码生成、迭代编排和报告解耦。CLI 是唯一稳定入口；所有模块围绕版本化 Visual IR 和 `regionId` 通信，AI 只能按 `PatchPlan` 修改绑定区域，客观评分与代码健康门禁共同决定接受或回退。

**Tech Stack:** Node.js 22、TypeScript、pnpm workspace、Vitest、Zod、Commander、Sharp、pixelmatch、Playwright、Vue 3、uni-app、Vite、ESLint、Stylelint。

---

## 交付拆分

本计划只实现可运行的首个纵向 MVP；完整设计见 `docs/superpowers/specs/2026-07-24-ai-ui-reconstruction-pipeline-design.md`。

后续独立计划：

1. 项目级 Design Token 与跨页面公共组件归纳。
2. 微信开发者工具自动化和小程序正式端门禁增强。
3. Android/iOS 自动化、录屏动效分析和 Web 平台。

## 文件结构

```text
package.json                         根脚本和工具版本约束
pnpm-workspace.yaml                  Workspace 范围
vitest.workspace.ts                 多包测试入口
eslint.config.mjs                   TypeScript/Vue 静态规则
packages/contracts/                 manifest、Visual IR、报告和 PatchPlan 合同
packages/model-adapter/             OpenAI 兼容本地视觉模型与能力探测
packages/visual-engine/             截图测量、区域评分和热力图
packages/codegen/                   Visual IR 到 uni-app 代码
packages/orchestrator/              状态机、门禁、停滞和回退
packages/report/                    静态区域化评审报告
packages/cli/                       doctor/init/analyze/run/review 命令
apps/reference-app/                 生成页面的 uni-app 宿主
fixtures/profile/                   个人中心多状态验收素材和清单
```

### Task 1: 建立可测试的 Monorepo 骨架

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `eslint.config.mjs`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Test: `packages/contracts/src/smoke.test.ts`

- [ ] **Step 1: 写失败的 workspace 冒烟测试**

```ts
// packages/contracts/src/smoke.test.ts
import { describe, expect, it } from 'vitest'
import { CONTRACT_VERSION } from './index'

describe('contracts package', () => {
  it('exposes a stable schema version', () => {
    expect(CONTRACT_VERSION).toBe('1.0.0')
  })
})
```

- [ ] **Step 2: 创建根配置并验证测试因缺少实现失败**

```json
// package.json
{
  "name": "ai-ui-reconstruction",
  "private": true,
  "packageManager": "pnpm@10.13.1",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -b",
    "lint": "eslint .",
    "check": "pnpm lint && pnpm typecheck && pnpm test"
  },
  "devDependencies": {
    "@eslint/js": "latest",
    "@types/node": "latest",
    "eslint": "latest",
    "typescript": "latest",
    "typescript-eslint": "latest",
    "vitest": "latest"
  }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - apps/*
  - packages/*
```

Run: `pnpm install && pnpm test`
Expected: FAIL，提示找不到 `./index`。

- [ ] **Step 3: 添加最小合同包实现**

```ts
// packages/contracts/src/index.ts
export const CONTRACT_VERSION = '1.0.0' as const
```

- [ ] **Step 4: 运行基础门禁**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.workspace.ts eslint.config.mjs packages/contracts
git commit -m "chore: scaffold UI reconstruction workspace"
```

### Task 2: 定义 manifest、Visual IR 和语义区域合同

**Files:**
- Create: `packages/contracts/src/manifest.ts`
- Create: `packages/contracts/src/visual-ir.ts`
- Create: `packages/contracts/src/patch-plan.ts`
- Create: `packages/contracts/src/report.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/visual-ir.test.ts`
- Test: `packages/contracts/src/manifest.test.ts`

- [ ] **Step 1: 写区域命名、来源和父子关系失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { VisualIRSchema } from './visual-ir'

it('accepts stable region ids with editable names and aliases', () => {
  const result = VisualIRSchema.parse({
    version: '1.0.0',
    projectId: 'uinotes-demo',
    pageId: 'profile',
    tokens: { colors: {}, typography: {}, spacing: {}, radii: {} },
    states: [{ id: 'default', screenshot: 'reference/default.png' }],
    regions: [{
      regionId: 'owner-services',
      displayName: '车主服务区',
      aliases: ['爱车服务模块'],
      parentId: null,
      bounds: { x: 22, y: 538, width: 358, height: 205 },
      source: 'model',
      confidence: 0.94,
      componentPath: 'src/components/profile/OwnerServices.vue'
    }],
    assets: [],
    interactions: []
  })
  expect(result.regions[0].regionId).toBe('owner-services')
})
```

- [ ] **Step 2: 运行测试确认合同尚不存在**

Run: `pnpm vitest run packages/contracts/src/visual-ir.test.ts`
Expected: FAIL，提示找不到 `VisualIRSchema`。

- [ ] **Step 3: 实现版本化 Zod 合同**

```ts
// packages/contracts/src/visual-ir.ts
import { z } from 'zod'

export const BoundsSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive()
})

export const RegionNodeSchema = z.object({
  regionId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  displayName: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  parentId: z.string().nullable(),
  bounds: BoundsSchema,
  source: z.enum(['tool', 'model', 'human']),
  confidence: z.number().min(0).max(1),
  componentPath: z.string().optional(),
  selector: z.string().optional(),
  lockedByHuman: z.boolean().default(false)
})

export const VisualIRSchema = z.object({
  version: z.literal('1.0.0'),
  projectId: z.string().min(1),
  pageId: z.string().min(1),
  tokens: z.object({
    colors: z.record(z.string(), z.string()),
    typography: z.record(z.string(), z.unknown()),
    spacing: z.record(z.string(), z.number()),
    radii: z.record(z.string(), z.number())
  }),
  states: z.array(z.object({ id: z.string(), screenshot: z.string() })).min(1),
  regions: z.array(RegionNodeSchema).min(1),
  assets: z.array(z.unknown()),
  interactions: z.array(z.unknown())
})

export type VisualIR = z.infer<typeof VisualIRSchema>
export type RegionNode = z.infer<typeof RegionNodeSchema>
```

- [ ] **Step 4: 增加跨字段校验**

校验所有非空 `parentId` 必须引用现有区域、`regionId` 唯一、区域不能形成环、人工锁定名称不能被模型覆盖；manifest 校验截图存在、设备尺寸为正、状态 ID 唯一。

manifest 每张截图必须携带 `screenshotType: 'viewport' | 'fullpage'` 和 `scale`（物理/逻辑像素倍率，如 2、3）字段；Visual IR 中所有 bounds 统一为归一化后的**逻辑像素**。

Run: `pnpm vitest run packages/contracts`
Expected: 合法样本 PASS，重复 ID、悬空父节点和环形关系样本 FAIL。

- [ ] **Step 5: 提交**

```bash
git add packages/contracts
git commit -m "feat: define visual reconstruction contracts"
```

### Task 3: 实现区域名称覆盖和双向定位索引

**Files:**
- Create: `packages/contracts/src/region-index.ts`
- Test: `packages/contracts/src/region-index.test.ts`

- [ ] **Step 1: 写人工名称优先和别名查找失败测试**

```ts
it('resolves a region by id, display name, or alias', () => {
  const index = createRegionIndex(regions)
  expect(index.resolve('owner-services')?.regionId).toBe('owner-services')
  expect(index.resolve('车主服务区')?.regionId).toBe('owner-services')
  expect(index.resolve('爱车服务模块')?.regionId).toBe('owner-services')
})

it('preserves human locked names during model merge', () => {
  const merged = mergeRegionSuggestion(humanLockedRegion, {
    ...humanLockedRegion,
    displayName: '模型新名称',
    source: 'model'
  })
  expect(merged.displayName).toBe('车主服务区')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/contracts/src/region-index.test.ts`
Expected: FAIL，函数未定义。

- [ ] **Step 3: 实现标准化查找、冲突检测和人工锁定合并**

```ts
export function normalizeRegionName(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN').replaceAll(/\s+/g, '')
}

export function mergeRegionSuggestion(current: RegionNode, incoming: RegionNode): RegionNode {
  if (current.lockedByHuman) {
    return { ...incoming, displayName: current.displayName, aliases: current.aliases, lockedByHuman: true }
  }
  return incoming
}
```

同名或同别名映射到多个区域时返回明确的歧义错误，不允许静默选择。

- [ ] **Step 4: 验证并提交**

Run: `pnpm vitest run packages/contracts/src/region-index.test.ts`
Expected: PASS。

```bash
git add packages/contracts/src/region-index.*
git commit -m "feat: add semantic region lookup and overrides"
```

### Task 4: 接入本地 OpenAI 兼容多模态模型

**Files:**
- Create: `packages/model-adapter/package.json`
- Create: `packages/model-adapter/src/types.ts`
- Create: `packages/model-adapter/src/openai-compatible.ts`
- Create: `packages/model-adapter/src/probe.ts`
- Create: `packages/model-adapter/src/structured-output.ts`
- Test: `packages/model-adapter/src/probe.test.ts`
- Test: `packages/model-adapter/src/structured-output.test.ts`

- [ ] **Step 1: 写能力降级顺序失败测试**

```ts
it('falls back from json schema to tool calls and records the mode', async () => {
  const transport = createFakeTransport({ jsonSchema: 400, tools: 200 })
  const profile = await probeCapabilities(transport)
  expect(profile.structuredOutput).toBe('tools')
  expect(profile.vision).toBe(true)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/model-adapter/src/probe.test.ts`
Expected: FAIL，探测器未实现。

- [ ] **Step 3: 实现统一接口和能力探测**

```ts
export interface ModelAdapter {
  probe(): Promise<ModelCapabilityProfile>
  analyzeScreens(input: AnalyzeScreensInput): Promise<VisualIR>
  diagnoseDiff(input: DiagnoseDiffInput): Promise<PatchPlan>
  reviewResult(input: ReviewResultInput): Promise<ModelReview>
}

export type StructuredOutputMode = 'json-schema' | 'tools' | 'json-mode' | 'prompt-json'
```

探测请求使用一张 1×1 本地测试图和最小 Schema，按 `json-schema → tools → json-mode → prompt-json` 降级。只允许 `http://127.0.0.1`、`http://localhost` 或 manifest 明确许可的地址（远程中转站必须显式列入白名单，该声明同时作为"截图将离开本地"的知情确认），日志不得输出 API Key 和原始图片 Base64。

探测还需检查模型最大图片输入分辨率是否覆盖参考截图尺寸；超限时返回明确诊断（建议分块或降低预期），不允许静默降采样后继续。

- [ ] **Step 4: 实现 Zod 校验、JSON 提取、一次格式修复和有限重试**

结构化输出最多执行两次业务重试和一次格式修复；持续失败时返回带模式、状态码和 Schema 路径的错误，不返回半合法对象。

Run: `pnpm vitest run packages/model-adapter`
Expected: 四种模式、超时、无效 JSON、Schema 不匹配和脱敏日志测试全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/model-adapter
git commit -m "feat: add local multimodal model adapter"
```

### Task 5: 实现确定性视觉测量和区域评分

**Files:**
- Create: `packages/visual-engine/package.json`
- Create: `packages/visual-engine/src/image.ts`
- Create: `packages/visual-engine/src/color.ts`
- Create: `packages/visual-engine/src/geometry.ts`
- Create: `packages/visual-engine/src/regions.ts`
- Create: `packages/visual-engine/src/score.ts`
- Create: `packages/visual-engine/src/heatmap.ts`
- Test: `packages/visual-engine/src/score.test.ts`
- Test: `packages/visual-engine/src/regions.test.ts`

- [ ] **Step 1: 写区域裁切和加权评分失败测试**

```ts
it('weights critical regions and reports geometry errors', async () => {
  const result = await scorePage(reference, actual, {
    regions: [{ regionId: 'account-summary', bounds, critical: true }],
    weights: { geometry: 0.30, visual: 0.30, content: 0.15, consistency: 0.15, state: 0.10 }
  })
  expect(result.regions[0].regionId).toBe('account-summary')
  expect(result.regions[0].geometry.meanAbsoluteErrorPx).toBeGreaterThan(0)
  expect(result.total).toBeGreaterThanOrEqual(0)
  expect(result.total).toBeLessThanOrEqual(1)
})
```

- [ ] **Step 2: 准备 64×64 可审查基准图并确认测试失败**

测试图由测试代码使用 Sharp 生成纯色卡片、文本占位矩形和已知偏移，不提交难以审查的二进制快照。

Run: `pnpm vitest run packages/visual-engine/src/score.test.ts`
Expected: FAIL，评分器未实现。

- [ ] **Step 3: 实现图像归一化、裁切、pixelmatch、颜色 ΔE 和几何误差**

```ts
export interface RegionScore {
  regionId: string
  geometry: { meanAbsoluteErrorPx: number; score: number }
  visual: { pixelDiffRatio: number; score: number }
  color: { meanDeltaE: number; score: number }
  content: { ocrMatch: number | null; score: number }
  total: number
  severeDefects: string[]
}
```

所有输入先归一到 manifest 指定尺寸和 sRGB；参考图按 `scale` 归一到逻辑像素并按系统栏策略处理状态栏；动态遮罩区域不计分。

OCR 通过 provider 接口注入，测试使用确定性 fake provider，避免测试依赖外部程序。**生产 provider 接入本地 PaddleOCR**（或 RapidOCR 等 ONNX 发行版），承担文字内容与像素级边界框测量；多模态模型不得作为文案匹配的测量来源（同源测量偏差：同一模型读两侧图，识别错误相互抵消不可见）。OCR 引擎不可用时 content 维度置 null 并按剩余权重归一化，不记 0 分。

参考图侧的全部测量（OCR、颜色、几何）在 analyze 阶段执行一次并冻结进 Visual IR，迭代各轮只测量实现截图，对照冻结目标比较。

- [ ] **Step 4: 生成透明差异热力图和区域 JSON**

热力图中相同像素透明，差异像素按强度从黄到红；同时写入每个 `regionId` 的裁切图，供模型诊断和人工报告使用。

Run: `pnpm vitest run packages/visual-engine`
Expected: 已知偏移、颜色变化、遮罩和关键区域权重测试全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/visual-engine
git commit -m "feat: add deterministic visual scoring engine"
```

### Task 6: 生成可维护的 uni-app 页面结构

**Files:**
- Create: `packages/codegen/package.json`
- Create: `packages/codegen/src/generate-page.ts`
- Create: `packages/codegen/src/component-policy.ts`
- Create: `packages/codegen/src/token-writer.ts`
- Create: `packages/codegen/src/asset-registry.ts`
- Test: `packages/codegen/src/generate-page.test.ts`
- Create: `apps/reference-app/package.json`
- Create: `apps/reference-app/src/pages/profile/index.vue`
- Create: `apps/reference-app/src/components/profile/AccountSummary.vue`
- Create: `apps/reference-app/src/components/profile/ActionGrid.vue`
- Create: `apps/reference-app/src/components/profile/OwnerServices.vue`
- Create: `apps/reference-app/src/components/navigation/PrimaryTabBar.vue`
- Create: `apps/reference-app/src/styles/tokens.scss`
- Create: `apps/reference-app/src/assets/registry.ts`

- [ ] **Step 1: 写组件边界与反模式失败测试**

```ts
it('generates named regions and data-driven action grids', async () => {
  const files = await generatePage(profileVisualIR)
  expect(files['src/pages/profile/index.vue']).toContain('data-region-id="owner-services"')
  expect(files['src/components/profile/ActionGrid.vue']).toContain('v-for="item in items"')
  expect(Object.values(files).join('\n')).not.toContain('background-image: url("reference/default.png")')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/codegen/src/generate-page.test.ts`
Expected: FAIL，生成器未实现。

- [ ] **Step 3: 实现页面编排、业务区块、通用组件和资产注册表生成**

生成的页面只负责区域顺序、状态和事件装配；重复宫格使用类型化数组驱动。每个根区域带稳定 `data-region-id` 和 `aria-label`。样式尺寸按 `750 / 设备逻辑宽度` 将 Visual IR 逻辑像素换算为 rpx 写入（token-writer 统一负责换算，组件内不出现手工换算）。样式值优先引用 `tokens.scss`，图标通过语义键读取：

```ts
export const assetRegistry = {
  'icon.notice': '/static/icons/notice.svg',
  'service.refuel': '/static/services/refuel.png',
  'tab.home': '/static/tabs/home.svg'
} as const
```

- [ ] **Step 4: 实现代码健康策略**

`component-policy.ts` 检测并拒绝整图背景、超过阈值的绝对定位、大量重复数值、重复宫格模板和缺少 `regionId` 映射。单文件超过 300 行发出失败诊断，不自动粗暴拆分。

Run: `pnpm vitest run packages/codegen && pnpm typecheck`
Expected: 生成快照、反模式和类型检查全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/codegen apps/reference-app
git commit -m "feat: generate maintainable semantic UI regions"
```

### Task 7: 实现 H5 固定环境渲染与区域几何采集

**Files:**
- Create: `packages/visual-engine/src/renderers/types.ts`
- Create: `packages/visual-engine/src/renderers/h5.ts`
- Create: `packages/visual-engine/src/browser/collect-regions.ts`
- Test: `packages/visual-engine/src/renderers/h5.test.ts`
- Create: `apps/reference-app/src/dev-fixtures/profile.ts`

- [ ] **Step 1: 写固定设备和区域采集失败测试**

```ts
it('captures a deterministic page and named region bounds', async () => {
  const result = await renderer.capture({
    url: '/#/pages/profile/index?fixture=default',
    viewport: { width: 396, height: 842, deviceScaleFactor: 1 },
    regionIds: ['account-summary', 'owner-services', 'primary-tabbar']
  })
  expect(result.image.width).toBe(396)
  expect(result.regions.map(item => item.regionId)).toEqual([
    'account-summary', 'owner-services', 'primary-tabbar'
  ])
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec playwright install chromium && pnpm vitest run packages/visual-engine/src/renderers/h5.test.ts`
Expected: FAIL，H5 renderer 未实现。

- [ ] **Step 3: 实现 Playwright 渲染器**

固定 viewport、语言、时区、颜色模式、动画、日期和 fixture 数据；等待字体和图片加载完成；禁用 CSS 动画后截图。通过 `[data-region-id]` 采集运行时边界并与 Visual IR 对齐。

渲染器按 manifest `screenshotType` 支持 viewport 和 fullPage 两种截图模式，与参考图形态一致才可比。reference-app 内置一款开源中文字体（MiSans / HarmonyOS Sans / Noto Sans SC 之一）并通过 `@font-face` 强制加载作为测量基线，不依赖 Windows 系统默认中文字体（微软雅黑与参考图的 PingFang SC 度量差异会造成系统性偏差）。

- [ ] **Step 4: 验证稳定性**

连续截图三次并比较哈希；相同环境必须一致。若字体或异步图片未就绪，渲染器应失败并指出资源，而不是提交波动截图。确定性承诺范围为**同机器可复现**，不承诺跨机器逐像素一致。

Run: `pnpm vitest run packages/visual-engine/src/renderers/h5.test.ts`
Expected: PASS，三次截图哈希一致。

- [ ] **Step 5: 提交**

```bash
git add packages/visual-engine apps/reference-app/src/dev-fixtures
git commit -m "feat: add deterministic H5 visual renderer"
```

### Task 8: 实现受控 AI 迭代、门禁和回退

**Files:**
- Create: `packages/orchestrator/package.json`
- Create: `packages/orchestrator/src/state-machine.ts`
- Create: `packages/orchestrator/src/gates.ts`
- Create: `packages/orchestrator/src/patch-runner.ts`
- Create: `packages/orchestrator/src/snapshot-store.ts`
- Create: `packages/orchestrator/src/run.ts`
- Test: `packages/orchestrator/src/run.test.ts`
- Test: `packages/orchestrator/src/gates.test.ts`

- [ ] **Step 1: 写接受、回退和停滞失败测试**

```ts
it('reverts a patch that improves one region but regresses the page', async () => {
  const result = await runIteration(contextWithScores({ before: 0.86, after: 0.82 }))
  expect(result.decision).toBe('revert')
  expect(result.stableSnapshotId).toBe('round-0')
})

it('stops after two rounds below 0.5 percent improvement', () => {
  expect(shouldStop([0.860, 0.863, 0.866], 8)).toEqual({ stop: true, reason: 'stalled' })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/orchestrator`
Expected: FAIL，状态机未实现。

- [ ] **Step 3: 实现状态机和 PatchPlan 文件白名单**

状态严格流经 `INGEST → ANALYZE → GENERATE → RENDER → MEASURE → DIAGNOSE → PATCH → REGRESSION`。PatchRunner 在隔离快照中应用补丁，只允许修改 `PatchPlan.allowedFiles`，并验证目标 `regionIds` 的组件映射。

补丁载荷格式为**文件路径 → 完整新内容**（白名单内整文件重写），不采用 unified diff——LLM 生成 diff 的行号对齐不可靠，整文件重写由白名单限制影响范围，再由 component-policy、类型检查和视觉回归兜底。

- [ ] **Step 4: 实现综合门禁**

通过条件：综合分数 ≥ 0.88、关键区域 ≥ 0.85、几何平均误差 ≤ 4px、OCR ≥ 0.98、严重缺陷为零、类型/静态/组件契约通过。未通过但仍有 ≥ 0.5% 改善时继续；连续两轮停滞或达到八轮时保留历史最佳轮次。

- [ ] **Step 5: 验证回退不丢失记录并提交**

Run: `pnpm vitest run packages/orchestrator`
Expected: 成功、继续、停滞、上限、模型异常和回退测试全部 PASS。

```bash
git add packages/orchestrator
git commit -m "feat: orchestrate guarded AI refinement loops"
```

### Task 9: 生成按语义区域沟通的人工评审报告

**Files:**
- Create: `packages/report/package.json`
- Create: `packages/report/src/generate-report.ts`
- Create: `packages/report/src/templates/report.html.ts`
- Create: `packages/report/src/feedback.ts`
- Test: `packages/report/src/generate-report.test.ts`

- [ ] **Step 1: 写区域展示和反馈解析失败测试**

```ts
it('renders region names, aliases, metrics, component paths and feedback controls', async () => {
  const html = await generateReport(reportFixture)
  expect(html).toContain('车主服务区')
  expect(html).toContain('owner-services')
  expect(html).toContain('爱车服务模块')
  expect(html).toContain('OwnerServices.vue')
  expect(html).toContain('data-feedback-region="owner-services"')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/report`
Expected: FAIL，报告生成器未实现。

- [ ] **Step 3: 实现自包含静态报告**

报告并排显示参考图、最佳实现图和热力图；覆盖层绘制带 `displayName/regionId` 的区域框。点击区域显示字体、颜色、几何、OCR、绑定组件、资产槽位、修改历史和交互置信度。反馈导出为结构化 JSON：

```ts
export interface RegionFeedback {
  regionId: string
  message: string
  renameTo?: string
  aliases?: string[]
  assetOverrides?: Record<string, string>
}
```

- [ ] **Step 4: 验证 HTML 安全和无服务器打开**

对显示名称、别名和反馈内容进行 HTML 转义；图片使用相对路径，不嵌入超大 Base64。用 Playwright 打开 `file://` 报告并截图验证区域点击。

Run: `pnpm vitest run packages/report`
Expected: 内容、XSS 转义、交互和反馈导出测试全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/report
git commit -m "feat: add semantic visual review reports"
```

### Task 10: 串联 CLI 和个人中心纵向验收

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/commands/doctor.ts`
- Create: `packages/cli/src/commands/init.ts`
- Create: `packages/cli/src/commands/analyze.ts`
- Create: `packages/cli/src/commands/run.ts`
- Create: `packages/cli/src/commands/review.ts`
- Test: `packages/cli/src/cli.test.ts`
- Create: `fixtures/profile/manifest.yaml`
- Create: `fixtures/profile/region-overrides.json`
- Create: `fixtures/profile/reference/default.png`
- Create: `fixtures/profile/README.txt`

- [ ] **Step 1: 写命令注册和恢复执行失败测试**

```ts
it('exposes the complete MVP workflow', async () => {
  const output = await runCli(['--help'])
  expect(output).toContain('doctor')
  expect(output).toContain('init')
  expect(output).toContain('analyze')
  expect(output).toContain('run')
  expect(output).toContain('review')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/cli`
Expected: FAIL，CLI 尚未实现。

- [ ] **Step 3: 实现五个命令并串联模块**

```text
ui-rebuild doctor
ui-rebuild init profile
ui-rebuild analyze fixtures/profile
ui-rebuild run fixtures/profile --target h5 --max-rounds 8
ui-rebuild review fixtures/profile
```

`doctor` 返回模型（含结构化模式、视觉输入、最大图片分辨率）、本地 OCR 引擎（PaddleOCR）、Node、Chromium、微信开发者工具（安装状态 + 服务端口是否开启 + 登录态）和内置测量字体状态；`run` 将每轮状态写入 `.ui-rebuild/runs/<runId>`，中断后可用 `--resume <runId>` 恢复。日志以 `runId/round/regionId` 作为上下文字段。

MVP 阶段质量门禁仅以 H5 为准：`--target wechat` 返回明确的"尚未支持"错误，不静默回退到 H5 执行。微信端自动化在后续独立计划中落地。

- [ ] **Step 4: 用用户提供的个人中心截图建立验收 fixture**

仅在用户确认可纳入仓库且拥有使用权限时保存参考截图；否则使用同结构的自制测试图，并在 `README.txt` 记录如何将截图放入 `reference/default.png`。`region-overrides.json` 至少包含 `account-summary`、`creator-actions`、`points-overview`、`personal-tools`、`owner-services` 和 `primary-tabbar` 的中文名及别名。

- [ ] **Step 5: 运行完整纵向验证**

Run: `pnpm check`
Expected: lint、类型和全部单元/集成测试 PASS。

Run: `pnpm --filter @ui-rebuild/cli start doctor`
Expected: 输出模型结构化模式、视觉输入能力、Chromium 和微信工具状态；未安装项给出明确诊断但不伪报成功。

Run: `pnpm --filter @ui-rebuild/cli start run fixtures/profile --target h5 --max-rounds 3`
Expected: 生成 Visual IR、区域组件、三轮以内的截图/评分记录、最佳快照和静态评审报告。

- [ ] **Step 6: 人工检查代码健康性和区域沟通闭环**

打开报告，点击“车主服务区”，提交“第二行图标间距缩小 4px”；导出反馈后再次运行，确认 PatchPlan 只允许修改 `OwnerServices.vue` 或对应间距 Token，且整页回归完成。

- [ ] **Step 7: 提交纵向 MVP**

```bash
git add packages/cli fixtures package.json pnpm-lock.yaml
git commit -m "feat: complete semantic UI reconstruction MVP"
```

## 最终验收清单

- [ ] `pnpm check` 全部通过。
- [ ] Visual IR 能表达多状态、区域树、资产槽位和交互置信度。
- [ ] 人工名称及别名不会被模型覆盖。
- [ ] 生成页面使用语义组件和数据驱动宫格，无整图背景和整页绝对定位。
- [ ] H5 固定环境截图可重复。
- [ ] 每个差异指标可定位到 `regionId` 和组件路径。
- [ ] 退化补丁自动回退并保留完整记录。
- [ ] 连续两轮提升低于 0.5% 或达到八轮时停止。
- [ ] 最佳轮次达到 0.88 时进入人工评审；未达到时输出瓶颈而非伪报成功。
- [ ] 人工可通过中文区域名、稳定 ID 或别名提交限定范围反馈。
- [ ] 替换图标/图片后无需修改页面结构即可重跑回归。
- [ ] 文案匹配率由本地 OCR（PaddleOCR）测量，多模态模型不作为文案门禁的测量来源。
- [ ] 参考图测量在 analyze 阶段冻结一次，迭代过程中不重复测量参考图。
- [ ] 所有 bounds 为逻辑像素，生成样式为 rpx，换算集中在 token-writer。
- [ ] `--target wechat` 在 MVP 阶段返回明确的"尚未支持"，不静默回退。
