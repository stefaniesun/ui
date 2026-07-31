# Structured Visual Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make screenshot analysis produce structured visible content and make Vue/uni-app code generation render that content instead of blank semantic regions.

**Architecture:** Extend VisualIR with strict discriminated content, asset, and interaction schemas; keep the model limited to structured facts; render validated nodes through a focused Vue content renderer. CLI analysis writes validated IR safely, while `run` passes IR assets through codegen and reports real asset/interaction metadata.

**Tech Stack:** TypeScript 5.9, Zod 3, Vitest 2, Vue 3/uni-app, Vite, Playwright, pnpm 10, OpenAI-compatible multimodal structured output.

---

## File map

### Create

- `packages/codegen/src/content-renderer.ts` — render validated VisualIR content nodes to safe Vue/uni-app markup and scoped styles.
- `packages/codegen/src/content-renderer.test.ts` — focused rendering, positioning, token, order, and escaping tests.
- `packages/cli/src/commands/analyze.test.ts` — analysis prompt and preserve-on-failure tests.

### Modify

- `packages/contracts/src/visual-ir.ts` — add content, asset, and interaction schemas plus cross-reference and non-empty-leaf validation.
- `packages/contracts/src/visual-ir.test.ts` — contract acceptance and rejection coverage.
- `packages/contracts/src/contract-boundaries.test.ts` — assert new public contracts remain exported.
- `packages/codegen/src/generate-page.ts` — delegate content generation, pass IR assets to the registry, and fail closed on empty content.
- `packages/codegen/src/generate-page.test.ts` — integration coverage for visible content and asset registry generation.
- `packages/codegen/src/asset-registry.ts` — accept canonical VisualIR assets and emit safe imports/lookup data.
- `packages/codegen/src/index.ts` — export the focused renderer only if needed by tests/consumers.
- `packages/cli/src/commands/analyze.ts` — strengthen visual extraction prompt and write validated IR atomically.
- `packages/cli/src/commands/run.ts` — stop discarding IR assets and populate report asset/interaction fields.
- `packages/cli/src/commands/run.test.ts` — verify generation receives assets and report mapping is deterministic.
- `fixtures/xunlei-member/visual-ir.json` — regenerated structured content from the real reference screenshot.
- `apps/reference-app/src/pages/xunlei-member/index.vue` — regenerated page shell.
- `apps/reference-app/src/components/xunlei-member/*.vue` — regenerated visible components.
- `apps/reference-app/src/assets/registry.ts` — regenerated asset registry.
- `apps/reference-app/src/styles/tokens.scss` — regenerated tokens if model analysis changes them.
- `apps/reference-app/src/pages.json` — regenerated page registration.

## Canonical public shapes

Implement these names consistently:

```ts
export const ContentNodeSchema = z.discriminatedUnion('kind', [
  TextContentSchema,
  AssetContentSchema,
  ControlContentSchema,
  DecorationContentSchema,
])
export const VisualAssetSchema = z.object({
  assetId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  regionId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  role: z.enum(['image', 'icon', 'avatar', 'background']),
  source: z.string().min(1),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
}).strict()
export const VisualInteractionSchema = z.object({
  interactionId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  regionId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  triggerNodeId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  action: z.enum(['tap', 'navigate', 'toggle', 'submit']),
  resultingStateId: z.string().min(1).optional(),
  confidence: z.number().finite().min(0).max(1),
}).strict()
```

`RegionNodeSchema` gains:

```ts
content: z.array(ContentNodeSchema).default([])
decorationOnly: z.boolean().default(false)
```

Content `bounds` are page-level logical pixels. Every content variant includes `nodeId` and `bounds`.

---

### Task 1: Define strict structured-content contracts

**Files:**
- Modify: `packages/contracts/src/visual-ir.test.ts`
- Modify: `packages/contracts/src/contract-boundaries.test.ts`
- Modify: `packages/contracts/src/visual-ir.ts`

- [ ] **Step 1: Add failing valid-content tests**

Extend the fixture region with ordered nodes and add a referenced asset/interaction:

```ts
content: [
  {
    kind: 'text', nodeId: 'page-title', text: '会员中心', role: 'title',
    bounds: { x: 20, y: 64, width: 90, height: 24 },
    typographyToken: 'pageTitle', colorToken: 'textPrimary',
  },
  {
    kind: 'asset', nodeId: 'member-avatar', assetId: 'avatar-default', alt: '会员头像',
    bounds: { x: 20, y: 96, width: 48, height: 48 }, fit: 'cover',
  },
  {
    kind: 'control', nodeId: 'pay-button', control: 'button', label: '立即支付',
    bounds: { x: 20, y: 160, width: 356, height: 48 }, actionId: 'submit-payment',
  },
],
assets: [{
  assetId: 'avatar-default', regionId: 'owner-services', role: 'avatar',
  source: 'src/assets/profile/avatar.png', mediaType: 'image/png',
}],
interactions: [{
  interactionId: 'submit-payment', regionId: 'owner-services', triggerNodeId: 'pay-button',
  action: 'submit', confidence: 0.98,
}],
```

Assert parsing preserves node order and exports `ContentNodeSchema`, `VisualAssetSchema`, and `VisualInteractionSchema`.

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/contracts test -- visual-ir.test.ts contract-boundaries.test.ts
```

Expected: FAIL because structured schemas and region `content` do not exist.

- [ ] **Step 3: Add failing cross-reference and safety tests**

Add table-driven rejection tests for:

```ts
[
  { name: 'duplicate content node', mutate: ir => ir.regions[0]!.content.push(ir.regions[0]!.content[0]!) },
  { name: 'missing asset', mutate: ir => { ir.regions[0]!.content[1]!.assetId = 'missing-asset' } },
  { name: 'unsafe asset path', mutate: ir => { ir.assets[0]!.source = '../secret.png' } },
  { name: 'missing interaction trigger', mutate: ir => { ir.interactions[0]!.triggerNodeId = 'missing-node' } },
  { name: 'out-of-canvas content', mutate: ir => { ir.regions[0]!.content[0]!.bounds.x = 390 } },
  { name: 'empty visible leaf', mutate: ir => { ir.regions[0]!.content = [] } },
]
```

Use a dedicated `decorationOnly: true` case to prove an empty decorative leaf is accepted. Add a parent-with-child case to prove a container may have empty direct content.

- [ ] **Step 4: Implement minimal schemas and refinements**

In `visual-ir.ts`, define strict text, asset, control, and decoration schemas. Add `content` and `decorationOnly` to each region. Replace both `z.unknown()` arrays with strict schemas.

In `VisualIRSchema.superRefine()` build:

```ts
const stateIds = new Set(value.states.map(state => state.id))
const assetIds = new Set<string>()
const contentByRegion = new Map<string, Set<string>>()
const childCounts = new Map(value.regions.map(region => [region.regionId, 0]))
```

Validate uniqueness, canvas containment using root-region maximum extents, asset and interaction references, and empty leaves. Validate assets with `isSafeProjectRelativePath()` plus `^src/assets/`.

- [ ] **Step 5: Run contract tests and verify pass**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 6: Commit contract changes**

```powershell
git add packages/contracts/src/visual-ir.ts packages/contracts/src/visual-ir.test.ts packages/contracts/src/contract-boundaries.test.ts
git commit -m "feat: define structured visual content contracts"
```

---

### Task 2: Render content nodes safely

**Files:**
- Create: `packages/codegen/src/content-renderer.ts`
- Create: `packages/codegen/src/content-renderer.test.ts`
- Modify: `packages/codegen/src/index.ts`

- [ ] **Step 1: Write failing renderer tests**

Create tests that parse a region through `VisualIRSchema`, call:

```ts
renderRegionContent({
  region,
  logicalWidth: 390,
  assetBindings: new Map([['avatar-default', 'avatarDefault']]),
  tokens: ir.tokens,
})
```

Assert the output:

```ts
expect(result.markup).toContain('<text class="content-node content-text" data-content-id="page-title">会员中心</text>')
expect(result.markup).toContain(':src="assets.avatarDefault"')
expect(result.markup).toContain('<button class="content-node content-control" data-content-id="pay-button">立即支付</button>')
expect(result.styles).toContain('left:38.46153846153846rpx')
```

Add an injection case with `<script>{{evil}}</script>` and `" onerror="evil`; assert neither executable tag nor attribute is emitted. Add order assertions using string indexes.

- [ ] **Step 2: Run renderer tests and verify failure**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/codegen test -- content-renderer.test.ts
```

Expected: FAIL because `content-renderer.ts` does not exist.

- [ ] **Step 3: Implement the focused renderer**

Export:

```ts
export interface RenderRegionContentInput {
  region: RegionNode
  logicalWidth: number
  assetBindings: ReadonlyMap<string, string>
  tokens: VisualIR['tokens']
}
export interface RenderedRegionContent { markup: string; styles: string; usesAssets: boolean }
export function renderRegionContent(input: RenderRegionContentInput): RenderedRegionContent
```

Generate one class per stable `nodeId`, compute `left/top` relative to `region.bounds`, convert all dimensions with `logicalPxToRpx()`, and allow only validated token variable names. Use text escaping for node text and attribute escaping for alt text. Asset lookup must throw `Missing generated asset binding: <assetId>`.

- [ ] **Step 4: Run renderer tests and verify pass**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit renderer changes**

```powershell
git add packages/codegen/src/content-renderer.ts packages/codegen/src/content-renderer.test.ts packages/codegen/src/index.ts
git commit -m "feat: render structured visual content"
```

---

### Task 3: Integrate content and canonical assets into page generation

**Files:**
- Modify: `packages/codegen/src/asset-registry.ts`
- Modify: `packages/codegen/src/generate-page.ts`
- Modify: `packages/codegen/src/generate-page.test.ts`

- [ ] **Step 1: Add failing integration tests**

Update the shared test IR with `content`, `decorationOnly`, `assets`, and `interactions`. Assert:

```ts
const component = files['src/components/profile/OwnerServices.vue']!
expect(component).toContain('会员中心')
expect(component).toContain('立即支付')
expect(component).toContain("import { assets } from '../../assets/registry'")
expect(files['src/assets/registry.ts']).toContain("avatarDefault")
expect(files['src/assets/registry.ts']).toContain("./profile/avatar.png")
```

Add explicit tests that a non-decorative empty leaf throws `/visible content.*owner-services/i`, while a decorative leaf and an empty parent container generate successfully.

- [ ] **Step 2: Run integration tests and verify failure**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/codegen test -- generate-page.test.ts
```

Expected: FAIL because generated components still contain only child tags and the registry ignores `ir.assets`.

- [ ] **Step 3: Adapt the asset registry**

Change `writeAssetRegistry()` to accept `readonly VisualAsset[]` and return both deterministic camel-case bindings and registry source, or export a helper:

```ts
export function assetBindingName(assetId: string): string
```

Generate static imports from paths relative to `src/assets/registry.ts`; reject collisions after camel-case normalization.

- [ ] **Step 4: Integrate the renderer in `generatePage()`**

For every region:

```ts
const rendered = renderRegionContent({ region, logicalWidth: o.logicalWidth, assetBindings, tokens: ir.tokens })
```

Place rendered content before child components, add the registry import only when `usesAssets`, append node styles to the component style block, and call `writeAssetRegistry(ir.assets)` instead of `o.assets ?? []`. Remove `assets` from `GenerateOptions` so callers cannot override trusted IR assets.

- [ ] **Step 5: Run all codegen tests**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/codegen test
```

Expected: PASS.

- [ ] **Step 6: Commit integration changes**

```powershell
git add packages/codegen/src/asset-registry.ts packages/codegen/src/generate-page.ts packages/codegen/src/generate-page.test.ts
git commit -m "feat: generate visible Vue content from VisualIR"
```

---

### Task 4: Strengthen model analysis and preserve stable IR

**Files:**
- Create: `packages/cli/src/commands/analyze.test.ts`
- Modify: `packages/cli/src/commands/analyze.ts`

- [ ] **Step 1: Extract and test the analysis prompt**

Export `buildAnalysisPrompt(manifest, overrides)` and assert it includes these requirements:

```text
Extract exact visible text including Chinese, currency symbols, numbers, dates, and punctuation.
Represent every visible fact as ordered text, asset, control, or decoration content nodes.
Do not use region displayName as visible text.
Every non-decorative leaf region must have visible content.
Use page-level logical-pixel bounds for content nodes.
```

- [ ] **Step 2: Run the prompt test and verify failure**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/cli test -- analyze.test.ts
```

Expected: FAIL because the prompt builder does not exist.

- [ ] **Step 3: Implement the prompt builder**

Move the inline prompt into `buildAnalysisPrompt()` and retain project ID, page ID, canvas, states, human overrides, stable IDs, tokens, asset slots, and interaction confidence.

- [ ] **Step 4: Add a failing atomic-write test**

Mock model analysis to return invalid structured content. Pre-create `visual-ir.json` with sentinel content, call `analyzePage()`, assert rejection, then assert the sentinel file is unchanged.

- [ ] **Step 5: Implement validated atomic persistence**

Parse the complete merged IR before writing. Write JSON to `visual-ir.json.tmp`, then use `rename()` to replace `visual-ir.json`; remove the temp file in a `finally` block when rename did not complete. Keep the previous component-path and human override behavior.

- [ ] **Step 6: Run CLI analysis tests**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/cli test -- analyze.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit analysis changes**

```powershell
git add packages/cli/src/commands/analyze.ts packages/cli/src/commands/analyze.test.ts
git commit -m "feat: extract structured content during visual analysis"
```

---

### Task 5: Wire structured metadata through `run`

**Files:**
- Modify: `packages/cli/src/commands/run.ts`
- Modify: `packages/cli/src/commands/run.test.ts`

- [ ] **Step 1: Add failing helper tests**

Extract and test pure helpers:

```ts
export function regionAssetSlots(ir: VisualIR, regionId: string): string[]
export function regionInteractions(ir: VisualIR, regionId: string): string[]
```

Assert assets are filtered by `regionId`, interactions are represented deterministically, and unknown regions return empty arrays.

- [ ] **Step 2: Run run-command tests and verify failure**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/cli test -- run.test.ts
```

Expected: FAIL because helpers do not exist and report data is hard-coded empty.

- [ ] **Step 3: Implement metadata helpers and remove asset discard**

Change:

```ts
generatePage(ir, { logicalWidth: manifest.device.width, assets: [] })
```

To:

```ts
generatePage(ir, { logicalWidth: manifest.device.width })
```

Populate report regions with `regionAssetSlots(ir, region.regionId)` and `regionInteractions(ir, region.regionId)`.

- [ ] **Step 4: Run CLI tests**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/cli test
```

Expected: PASS.

- [ ] **Step 5: Commit run changes**

```powershell
git add packages/cli/src/commands/run.ts packages/cli/src/commands/run.test.ts
git commit -m "feat: preserve visual assets through refinement"
```

---

### Task 6: Re-analyze and regenerate the real Xunlei fixture

**Files:**
- Modify: `fixtures/xunlei-member/visual-ir.json`
- Modify: `apps/reference-app/src/pages/xunlei-member/index.vue`
- Modify: `apps/reference-app/src/components/xunlei-member/*.vue`
- Modify: `apps/reference-app/src/assets/registry.ts`
- Modify: `apps/reference-app/src/styles/tokens.scss`
- Modify: `apps/reference-app/src/pages.json`

- [ ] **Step 1: Run the real visual analysis**

With the existing model environment configured, run:

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/cli exec ui-rebuild analyze fixtures/xunlei-member
```

Expected: command succeeds and `fixtures/xunlei-member/visual-ir.json` validates against the new schema.

- [ ] **Step 2: Inspect facts rather than accepting placeholders**

Verify the generated JSON contains Chinese visible content and key facts from the reference image:

```powershell
Select-String -Path fixtures/xunlei-member/visual-ir.json -Pattern '会员|支付|权益|价格|立即'
```

Expected: multiple matches in `content[].text` or `content[].label`; no visible copy is derived only from English `displayName` values.

- [ ] **Step 3: Verify asset closure**

Run the contracts parser through the CLI test/build path and verify every `content[kind=asset].assetId` resolves to `assets[]`, every source exists, and all sources stay under `apps/reference-app/src/assets/` after materialization. If the model identifies a slot but no local source is available, analysis must fail with the specific asset ID rather than generate an empty image.

- [ ] **Step 4: Run generation without refinement first**

Run the project command that invokes `generatePage()` for the fixture, or the `run` command with its initial generation stage. Confirm generated components contain `<text>`, `<image>`, or `<button>` in addition to semantic child components.

- [ ] **Step 5: Commit regenerated source and fixture**

```powershell
git add fixtures/xunlei-member/visual-ir.json apps/reference-app/src/pages/xunlei-member apps/reference-app/src/components/xunlei-member apps/reference-app/src/assets/registry.ts apps/reference-app/src/styles/tokens.scss apps/reference-app/src/pages.json
git commit -m "feat: regenerate Xunlei page with visible content"
```

---

### Task 7: Perform end-to-end H5 acceptance

**Files:**
- Generated: `apps/reference-app/dist/**`
- Generated: `fixtures/xunlei-member/.ui-rebuild/review/report.html`
- Generated: `fixtures/xunlei-member/.ui-rebuild/review/images/*.png`

- [ ] **Step 1: Run targeted workspace verification**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/contracts test
corepack pnpm@10.13.1 --filter @ui-rebuild/codegen test
corepack pnpm@10.13.1 --filter @ui-rebuild/cli test
```

Expected: all tests PASS.

- [ ] **Step 2: Run repository static checks**

```powershell
corepack pnpm@10.13.1 lint
corepack pnpm@10.13.1 typecheck
```

Expected: both commands exit 0 with no new diagnostics.

- [ ] **Step 3: Build H5**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/reference-app build:h5
```

Expected: `apps/reference-app/dist/index.html` and hashed assets are emitted.

- [ ] **Step 4: Run the full real-image refinement flow**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/cli exec ui-rebuild run fixtures/xunlei-member --max-rounds 3
```

Expected: initial generation, H5 render, screenshot capture, OCR/visual scoring, bounded diagnosis, regression/revert, and report generation complete without blank content.

- [ ] **Step 5: Start HTML preview and inspect browser evidence**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/reference-app exec vite preview --host 127.0.0.1 --port 4173
```

Using Playwright, assert:

```ts
await expect(page.locator('body')).toContainText(/会员|支付|权益/)
await expect(page.locator('[data-content-id]')).not.toHaveCount(0)
await expect(page.locator('image, img, button, uni-button')).not.toHaveCount(0)
```

Capture `actual.png` at 390×844 and open `http://127.0.0.1:4173` in the IDE browser.

- [ ] **Step 6: Review visual artifacts**

Open:

```text
fixtures/xunlei-member/.ui-rebuild/review/report.html
```

Expected: reference, actual, and heatmap render; actual is not a plain white page; report contains real asset slots and interactions. Record the final run ID and score without claiming improvement unless the measured score increased.

- [ ] **Step 7: Commit final verified changes**

```powershell
git status --short
git add packages/contracts packages/codegen packages/cli fixtures/xunlei-member/visual-ir.json apps/reference-app/src docs/superpowers/specs/2026-07-31-structured-visual-content-design.md docs/superpowers/plans/2026-07-31-structured-visual-content.md
git commit -m "feat: generate visible pages from structured visual content"
```

Do not add `dist`, run snapshots, screenshots, caches, `.codebuddy`, or unrelated pre-existing workspace changes unless they are already tracked and intentionally part of this feature.

## Self-review

- Spec coverage: contracts, exact text/assets/controls/decorations, strict references, safe generation, empty-leaf failure, atomic persistence, run metadata, real Xunlei analysis, H5/browser/report acceptance are each mapped to tasks.
- Placeholder scan: no implementation step delegates unspecified error handling or tests; all commands and expected outcomes are explicit.
- Type consistency: `ContentNodeSchema`, `VisualAssetSchema`, `VisualInteractionSchema`, `renderRegionContent()`, `regionAssetSlots()`, and `regionInteractions()` retain one spelling and signature throughout.
