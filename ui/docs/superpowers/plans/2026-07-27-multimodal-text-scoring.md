# Multimodal Text Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default external OCR score with region-based multimodal text extraction and deterministic local matching, while keeping the command provider as an explicit fallback.

**Architecture:** Shared Zod contracts define extracted text and frozen baseline metadata. A model-adapter extractor produces validated facts only; visual-engine owns versioned caching, frozen baselines, Hungarian matching, deterministic scoring, and stable failures. CLI selects the extractor, enforces trusted HTTPS origins and fail-closed gates, then passes detailed diagnostics to the report package.

**Tech Stack:** TypeScript 5.9, Node.js 22, Zod 3, Sharp 0.34, Vitest 2, pnpm 10, OpenAI-compatible Chat Completions.

---

## File map

### Create

- `packages/contracts/src/text-extraction.ts` — canonical `TextItem`, baseline, diagnostic, and error schemas.
- `packages/model-adapter/src/text-extractor.ts` — model-backed structured text extractor and stable adapter error mapping.
- `packages/model-adapter/src/text-extractor.test.ts` — extraction prompt, schema, nullable field, and error tests.
- `packages/visual-engine/src/text-cache.ts` — versioned file cache keyed by image and extractor identity.
- `packages/visual-engine/src/text-cache.test.ts` — hit, miss, corruption, and invalidation tests.
- `packages/visual-engine/src/text-match.ts` — normalization, critical text recognition, Hungarian assignment, and pair costs.
- `packages/visual-engine/src/text-match.test.ts` — deterministic matching tests.
- `packages/visual-engine/src/text-score.ts` — content, position, font-size, color, completeness, and region score calculations.
- `packages/visual-engine/src/text-score.test.ts` — scoring and weight-renormalization tests.

### Modify

- `packages/contracts/src/index.ts` — export text contracts.
- `packages/contracts/src/report.ts` — replace the single OCR metric with structured text metrics.
- `packages/contracts/src/contract-boundaries.test.ts` — validate report text diagnostics.
- `packages/model-adapter/src/types.ts` — expose the text extraction operation on `ModelAdapter`.
- `packages/model-adapter/src/adapter.ts` — implement text extraction through the existing structured-output pipeline.
- `packages/model-adapter/src/index.ts` — export model extractor APIs.
- `packages/visual-engine/src/ocr.ts` — adapt the command fallback to the common extraction contract.
- `packages/visual-engine/src/reference.ts` — freeze successful region text baselines instead of swallowing failures.
- `packages/visual-engine/src/score.ts` — call the extractor, compute deterministic text scores, and fail closed.
- `packages/visual-engine/src/index.ts` — export new cache/matching/scoring APIs.
- `packages/visual-engine/src/score.test.ts` — integration tests for frozen baseline and gate behavior.
- `packages/visual-engine/src/artifacts.test.ts` — assert detailed text diagnostics are serialized.
- `packages/cli/src/runtime.ts` — parse trusted origins and construct the model extractor safely.
- `packages/cli/src/commands/doctor.ts` — treat multimodal extraction as default and OCR command as optional fallback.
- `packages/cli/src/commands/run.ts` — wire extractor/cache/frozen baseline/report data.
- `packages/cli/src/cli.test.ts` — provider selection and trusted-origin tests.
- `packages/report/src/generate-report.ts` — accept and render text sub-scores and item differences.
- `packages/report/src/validate.ts` — validate new report fields.
- `packages/report/src/generate-report.test.ts` — verify diagnostic rendering and escaping.

## Constants and public signatures

Use these exact version constants throughout the implementation:

```ts
export const TEXT_EXTRACTION_SCHEMA_VERSION = '1.0.0'
export const TEXT_EXTRACTION_PROMPT_VERSION = '1.0.0'
export const TEXT_CONFIDENCE_THRESHOLD = 0.6
```

The common extractor boundary is:

```ts
export interface TextExtractor {
  readonly identity: {
    provider: 'model' | 'command'
    model: string
    schemaVersion: string
    promptVersion: string
  }
  extract(input: {
    regionId: string
    image: Buffer
    width: number
    height: number
    signal?: AbortSignal
  }): Promise<TextItem[]>
}
```

The visual engine cache boundary is:

```ts
export interface TextExtractionCache {
  get(key: TextCacheKey): Promise<TextItem[] | null>
  set(key: TextCacheKey, items: readonly TextItem[]): Promise<void>
}
```

---

### Task 1: Define shared text extraction contracts

**Files:**
- Create: `packages/contracts/src/text-extraction.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/report.ts`
- Test: `packages/contracts/src/contract-boundaries.test.ts`

- [ ] **Step 1: Write failing contract tests**

Add tests that parse a valid normalized item and reject invalid bounds, confidence, empty text, missing nullable fields, and incomplete report diagnostics:

```ts
import {
  ReviewReportSchema,
  TextItemSchema,
  TextExtractionFailureSchema,
} from './index.js'

it('accepts normalized extracted text', () => {
  expect(TextItemSchema.parse({
    text: '¥99.00',
    bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.04 },
    fontSize: 16,
    color: '#112233',
    confidence: 0.95,
  })).toMatchObject({ text: '¥99.00', confidence: 0.95 })
})

it.each([
  { text: '', bounds: { x: 0, y: 0, width: 1, height: 1 }, fontSize: null, color: null, confidence: 1 },
  { text: 'x', bounds: { x: -0.1, y: 0, width: 1, height: 1 }, fontSize: null, color: null, confidence: 1 },
  { text: 'x', bounds: { x: 0.8, y: 0, width: 0.3, height: 1 }, fontSize: null, color: null, confidence: 1 },
  { text: 'x', bounds: { x: 0, y: 0, width: 1, height: 1 }, fontSize: null, color: null, confidence: 1.1 },
])('rejects invalid text item %#', item => {
  expect(() => TextItemSchema.parse(item)).toThrow()
})

it('requires stable extraction failure context', () => {
  expect(TextExtractionFailureSchema.parse({
    code: 'text-extraction-failed',
    reason: 'schema-invalid',
    regionId: 'hero',
    stage: 'actual',
    message: 'invalid model output',
  })).toBeDefined()
})
```

Update the existing valid `ReviewReportSchema` fixture to include:

```ts
text: {
  score: 0.9,
  content: 1,
  position: 0.8,
  fontSize: null,
  color: null,
  missing: [],
  added: [],
  lowConfidence: [],
  matches: [],
  extraction: { provider: 'model', model: 'test-model', cacheHit: false },
}
```

- [ ] **Step 2: Run contract tests and verify failure**

Run:

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/contracts test -- contract-boundaries.test.ts
```

Expected: FAIL because `TextItemSchema` and report `text` diagnostics do not exist.

- [ ] **Step 3: Implement the canonical schemas**

Create `text-extraction.ts` with strict Zod schemas. Refine bounds so `x + width <= 1` and `y + height <= 1`; require positive width/height; allow only `null` or positive finite `fontSize`; normalize color later rather than accepting arbitrary objects.

```ts
import { z } from 'zod'

const unit = z.number().finite().min(0).max(1)
const normalizedBounds = z.object({
  x: unit,
  y: unit,
  width: z.number().finite().positive().max(1),
  height: z.number().finite().positive().max(1),
}).strict().refine(value => value.x + value.width <= 1 && value.y + value.height <= 1, {
  message: 'normalized bounds must remain inside the region image',
})

export const TEXT_EXTRACTION_SCHEMA_VERSION = '1.0.0'
export const TEXT_EXTRACTION_PROMPT_VERSION = '1.0.0'
export const TEXT_CONFIDENCE_THRESHOLD = 0.6

export const TextItemSchema = z.object({
  text: z.string().trim().min(1),
  bounds: normalizedBounds,
  fontSize: z.number().finite().positive().nullable(),
  color: z.string().trim().min(1).nullable(),
  confidence: unit,
}).strict()

export const TextItemListSchema = z.object({ items: z.array(TextItemSchema) }).strict()

export const RegionTextBaselineSchema = z.object({
  regionId: z.string().min(1),
  imageHash: z.string().regex(/^[a-f0-9]{64}$/u),
  model: z.string().min(1),
  schemaVersion: z.literal(TEXT_EXTRACTION_SCHEMA_VERSION),
  promptVersion: z.literal(TEXT_EXTRACTION_PROMPT_VERSION),
  items: z.array(TextItemSchema),
  extractedAt: z.string().datetime(),
}).strict()

export const TextExtractionFailureSchema = z.object({
  code: z.literal('text-extraction-failed'),
  reason: z.enum([
    'timeout', 'network', 'http', 'protocol', 'schema-invalid',
    'crop-failed', 'region-missing', 'baseline-incompatible', 'command-failed',
  ]),
  regionId: z.string().min(1),
  stage: z.enum(['reference', 'actual']),
  message: z.string().min(1),
}).strict()

export type TextItem = z.output<typeof TextItemSchema>
export type RegionTextBaseline = z.output<typeof RegionTextBaselineSchema>
export type TextExtractionFailure = z.output<typeof TextExtractionFailureSchema>
```

Add report schemas for `content`, `position`, nullable `fontSize`/`color`, missing/added/low-confidence strings, match diagnostics, and extraction identity/cache state. Export everything from `index.ts`.

- [ ] **Step 4: Run contract tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit contracts**

```powershell
git add packages/contracts/src/text-extraction.ts packages/contracts/src/index.ts packages/contracts/src/report.ts packages/contracts/src/contract-boundaries.test.ts
git commit -m "feat: define text extraction contracts"
```

---

### Task 2: Add model-backed structured text extraction

**Files:**
- Create: `packages/model-adapter/src/text-extractor.ts`
- Create: `packages/model-adapter/src/text-extractor.test.ts`
- Modify: `packages/model-adapter/src/types.ts`
- Modify: `packages/model-adapter/src/adapter.ts`
- Modify: `packages/model-adapter/src/index.ts`

- [ ] **Step 1: Write failing adapter tests**

Use a fake `ModelTransport` with a successful capability probe followed by a `text_items` response. Assert one image, schema name `text_items`, prompt version and region ID are present, and the result is validated:

```ts
it('extracts structured text facts from one region image', async () => {
  const transport = fakeTransport([
    probeResponses.jsonSchema,
    { ok: true, status: 200, output: JSON.stringify({ items: [{
      text: 'Total',
      bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
      fontSize: null,
      color: '#ffffff',
      confidence: 0.9,
    }] }) },
  ])
  const adapter = new OpenAICompatibleModelAdapter(transport)
  const result = await adapter.extractText({
    regionId: 'summary',
    image: modelImage,
  })
  expect(result[0]?.text).toBe('Total')
  expect(transport.calls?.at(-1)?.schemaName).toBe('text_items')
  expect(transport.calls?.at(-1)?.prompt).toContain('summary')
})
```

Add cases for omitted `fontSize`, malformed bounds, protocol error, and timeout. Missing nullable fields must fail; transport failures must retain `StructuredOutputError.kind` without leaking headers or API keys.

- [ ] **Step 2: Run the adapter test and verify failure**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/model-adapter test -- text-extractor.test.ts
```

Expected: FAIL because `extractText` does not exist.

- [ ] **Step 3: Implement the operation and extractor wrapper**

Extend `ModelAdapter`:

```ts
export interface ExtractTextInput {
  regionId: string
  image: ModelImage
  signal?: AbortSignal
}

export interface ModelAdapter {
  // existing methods
  extractText(input: ExtractTextInput): Promise<TextItem[]>
}
```

Implement `extractText` in `OpenAICompatibleModelAdapter` using the existing private `request` method and `TextItemListSchema`:

```ts
async extractText(input: ExtractTextInput): Promise<TextItem[]> {
  const result = await this.request(
    'text_items',
    textExtractionPrompt(input.regionId),
    [input.image],
    TextItemListSchema,
    input.signal,
  )
  return result.items
}
```

In `text-extractor.ts`, export `ModelTextExtractor` implementing the common `TextExtractor`. Convert the `Buffer` to `ModelImage`, set identity from constructor inputs, and call `adapter.extractText`. The prompt must state: return visible text only; bounds are normalized to the crop; do not infer hidden text; return `null` for unknown font size/color; confidence is `[0,1]`; preserve punctuation, currency and numeric formatting.

- [ ] **Step 4: Run adapter tests, typecheck, and lint**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/model-adapter test
corepack pnpm@10.13.1 --filter @ui-rebuild/model-adapter typecheck
corepack pnpm@10.13.1 --filter @ui-rebuild/model-adapter lint
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit model extraction**

```powershell
git add packages/model-adapter/src
git commit -m "feat: extract region text with multimodal model"
```

---

### Task 3: Implement versioned successful-result caching

**Files:**
- Create: `packages/visual-engine/src/text-cache.ts`
- Create: `packages/visual-engine/src/text-cache.test.ts`
- Modify: `packages/visual-engine/src/index.ts`

- [ ] **Step 1: Write failing cache tests**

Use a temporary directory. Verify exact-key hits, image/model/schema/prompt invalidation, corrupt cache miss, and no file written for an extraction failure:

```ts
it('returns data only for the exact versioned key', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'text-cache-'))
  const cache = new FileTextExtractionCache(root)
  const key = {
    imageHash: 'a'.repeat(64), regionId: 'hero', provider: 'model' as const,
    model: 'gpt-test', schemaVersion: '1.0.0', promptVersion: '1.0.0',
  }
  await cache.set(key, [item])
  await expect(cache.get(key)).resolves.toEqual([item])
  await expect(cache.get({ ...key, promptVersion: '1.0.1' })).resolves.toBeNull()
})
```

- [ ] **Step 2: Run the cache test and verify failure**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine test -- text-cache.test.ts
```

Expected: FAIL because the cache does not exist.

- [ ] **Step 3: Implement deterministic keys and atomic writes**

Define:

```ts
export interface TextCacheKey {
  imageHash: string
  regionId: string
  provider: 'model' | 'command'
  model: string
  schemaVersion: string
  promptVersion: string
}

export function hashImage(image: Buffer): string {
  return createHash('sha256').update(image).digest('hex')
}
```

Hash the canonical JSON form of `TextCacheKey` for the filename. Parse cached files through `TextItemListSchema`. Treat missing, corrupt, or incompatible files as misses. Write to a random sibling temporary file and rename atomically; remove the temporary file in `finally`. Expose only `get` and `set`, so callers cannot cache failures.

- [ ] **Step 4: Run cache tests and package checks**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine test -- text-cache.test.ts
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine typecheck
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine lint
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit cache support**

```powershell
git add packages/visual-engine/src/text-cache.ts packages/visual-engine/src/text-cache.test.ts packages/visual-engine/src/index.ts
git commit -m "feat: cache versioned text extraction results"
```

---

### Task 4: Implement deterministic text matching

**Files:**
- Create: `packages/visual-engine/src/text-match.ts`
- Create: `packages/visual-engine/src/text-match.test.ts`
- Modify: `packages/visual-engine/src/index.ts`

- [ ] **Step 1: Write failing matching tests**

Cover NFKC, whitespace collapse, English case folding, punctuation preservation, critical-value recognition, confidence filtering, and order-independent assignment:

```ts
it('normalizes compatibility text without dropping punctuation', () => {
  expect(normalizeText('  ＡＢＣ   ¥ 99.00 ')).toBe('abc ¥ 99.00')
})

it.each(['¥99.00', '2026-07-27', '18%', 'A-1024', '12345'])('marks %s as critical', value => {
  expect(isCriticalText(value)).toBe(true)
})

it('finds the same global assignment regardless of input order', () => {
  const first = matchTextItems(referenceItems, actualItems)
  const second = matchTextItems([...referenceItems].reverse(), [...actualItems].reverse())
  expect(canonicalPairs(first)).toEqual(canonicalPairs(second))
})
```

Assert items below `TEXT_CONFIDENCE_THRESHOLD` appear in `lowConfidence` and are not paired.

- [ ] **Step 2: Run matching tests and verify failure**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine test -- text-match.test.ts
```

Expected: FAIL because matching functions do not exist.

- [ ] **Step 3: Implement normalization, cost, and Hungarian assignment**

Use exact weights:

```ts
const PAIR_WEIGHTS = { text: 0.55, position: 0.25, fontSize: 0.12, color: 0.08 }
```

Implement normalized Levenshtein distance for text; normalized center/size distance for position; relative absolute difference for font size; and `deltaE76 / 100` clamped to `[0,1]` for color. Renormalize available weights when font size or color is `null`.

For critical text, normalized inequality sets text distance to `1`. Add dummy rows/columns with unmatched cost `1` so the Hungarian solver can represent missing and added items. Sort inputs by a stable key before solving and sort outputs by reference index/text to make ties deterministic.

Return:

```ts
export interface TextMatchResult {
  matches: Array<{ reference: TextItem; actual: TextItem; cost: number; critical: boolean }>
  missing: TextItem[]
  added: TextItem[]
  lowConfidence: TextItem[]
}
```

- [ ] **Step 4: Run matching tests and package checks**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine test -- text-match.test.ts
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine typecheck
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine lint
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit matching**

```powershell
git add packages/visual-engine/src/text-match.ts packages/visual-engine/src/text-match.test.ts packages/visual-engine/src/index.ts
git commit -m "feat: add deterministic text matching"
```

---

### Task 5: Implement region text scoring

**Files:**
- Create: `packages/visual-engine/src/text-score.ts`
- Create: `packages/visual-engine/src/text-score.test.ts`
- Modify: `packages/visual-engine/src/index.ts`

- [ ] **Step 1: Write failing score tests**

Assert exact content, position, font, and color produce `1`; missing font/color renormalizes; missing/added items lower content; critical mismatches yield zero pair content; and empty reference/actual lists have explicit behavior:

```ts
it('renormalizes unavailable font and color dimensions', () => {
  const result = scoreRegionText(
    [{ ...item, fontSize: null, color: null }],
    [{ ...item, fontSize: null, color: null }],
  )
  expect(result.total).toBe(1)
  expect(result.fontSize).toBeNull()
  expect(result.color).toBeNull()
})

it('penalizes missing and added text deterministically', () => {
  const result = scoreRegionText([item], [item, { ...item, text: 'extra' }])
  expect(result.content).toBeLessThan(1)
  expect(result.added).toHaveLength(1)
})
```

Define empty/empty as a valid `1` content score; nonempty/empty and empty/nonempty must score below `1` and report all missing/added items.

- [ ] **Step 2: Run score tests and verify failure**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine test -- text-score.test.ts
```

Expected: FAIL because `scoreRegionText` does not exist.

- [ ] **Step 3: Implement exact score composition**

Use:

```ts
const REGION_TEXT_WEIGHTS = { content: 0.50, position: 0.25, fontSize: 0.15, color: 0.10 }
```

Content combines matched text similarity and completeness using the count of reference, missing, and added items. Position uses normalized center and size differences. Font uses relative size error. Color uses Lab/Delta E. Clamp all sub-scores to `[0,1]`; return `null` for dimensions unavailable in every match; renormalize only available dimensions.

Return the structured fields required by the Task 1 report contract, including stable match summaries and extraction metadata supplied by the caller.

- [ ] **Step 4: Run score tests and package checks**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine test -- text-score.test.ts
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine typecheck
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine lint
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit scoring**

```powershell
git add packages/visual-engine/src/text-score.ts packages/visual-engine/src/text-score.test.ts packages/visual-engine/src/index.ts
git commit -m "feat: score extracted region text locally"
```

---

### Task 6: Freeze reference text and fail closed during page scoring

**Files:**
- Modify: `packages/visual-engine/src/reference.ts`
- Modify: `packages/visual-engine/src/score.ts`
- Modify: `packages/visual-engine/src/score.test.ts`
- Modify: `packages/visual-engine/src/artifacts.test.ts`

- [ ] **Step 1: Write failing frozen-reference integration tests**

Create a fake extractor with call counters. Verify reference extraction occurs once per region, actual extraction occurs per unique crop, cache hits avoid calls, extraction failures reject with structured context, and the reference baseline is never replaced by actual results:

```ts
it('freezes reference text once and reuses it across scoring rounds', async () => {
  const extractor = fakeExtractor([referenceItems, firstActualItems, secondActualItems])
  const frozen = await freezeReference(referencePng, normalization, regions, {
    textExtractor: extractor,
    textCache: new MemoryTextExtractionCache(),
  })
  await scoreAgainstFrozenReference(frozen, firstActualPng, scoreOptions(extractor))
  await scoreAgainstFrozenReference(frozen, secondActualPng, scoreOptions(extractor))
  expect(frozen.regions.get('hero')?.textBaseline.items).toEqual(referenceItems)
})

it('fails the formal score when one region extraction fails', async () => {
  await expect(scoreAgainstFrozenReference(frozen, actualPng, scoreOptions(failingExtractor)))
    .rejects.toMatchObject({
      failure: { code: 'text-extraction-failed', regionId: 'hero', stage: 'actual' },
    })
})
```

- [ ] **Step 2: Run integration tests and verify failure**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine test -- score.test.ts artifacts.test.ts
```

Expected: FAIL because frozen text baselines and structured failures do not exist.

- [ ] **Step 3: Replace OCR scoring with extraction scoring**

Change `FrozenReferenceRegion` from `ocrBaseline: unknown | null` to:

```ts
textBaseline: RegionTextBaseline
```

Change `freezeReference` options to require `textExtractor` and accept `textCache`. For each crop: hash, cache lookup, extraction, cache successful results, then store complete version metadata. Remove the catch that silently stores `null`.

Replace `OcrProvider`, `ocr`, and `requireOcr` in `score.ts` with `TextExtractor`, `textCache`, and required text scoring. On actual extraction, use the aligned actual region crop, score against `baseline.textBaseline.items`, and store detailed results in `RegionScore.content`.

Introduce:

```ts
export class TextExtractionGateError extends Error {
  constructor(readonly failure: TextExtractionFailure, options?: ErrorOptions) {
    super(`${failure.regionId}: ${failure.message}`, options)
    this.name = 'TextExtractionGateError'
  }
}
```

Map model/command/cache/crop errors to stable reasons, without including request headers, API keys, or raw prompts. Every region must have a complete baseline and actual extraction before the page can return a score.

- [ ] **Step 4: Run visual-engine tests and checks**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine test
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine typecheck
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine lint
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit frozen scoring integration**

```powershell
git add packages/visual-engine/src/reference.ts packages/visual-engine/src/score.ts packages/visual-engine/src/score.test.ts packages/visual-engine/src/artifacts.test.ts
git commit -m "feat: gate scores on frozen text extraction"
```

---

### Task 7: Adapt the command OCR fallback to the common extractor contract

**Files:**
- Modify: `packages/visual-engine/src/ocr.ts`
- Create: `packages/visual-engine/src/ocr.test.ts`
- Modify: `packages/visual-engine/src/index.ts`

- [ ] **Step 1: Write failing command extractor tests**

Use a Node child-process fixture already available to Vitest, or invoke `process.execPath` with `-e`. Assert stdin payload operation `extract-text`, region metadata, base64 image, strict `TextItemListSchema` parsing, timeout handling, invalid JSON, nonzero exit, and identity metadata:

```ts
it('extracts text through the explicit command fallback', async () => {
  const extractor = new LocalOcrCommandProvider({
    command: process.execPath,
    args: ['-e', commandFixtureReturning({ items: [item] })],
  })
  await expect(extractor.extract({
    regionId: 'hero', image: png, width: 20, height: 10,
  })).resolves.toEqual([item])
  expect(extractor.identity.provider).toBe('command')
})
```

- [ ] **Step 2: Run OCR fallback tests and verify failure**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine test -- ocr.test.ts
```

Expected: FAIL because the provider still implements numeric `compare`.

- [ ] **Step 3: Implement the new command protocol**

Make `LocalOcrCommandProvider` implement `TextExtractor`. Send:

```ts
{
  operation: 'extract-text',
  regionId: input.regionId,
  image: input.image.toString('base64'),
  width: input.width,
  height: input.height,
  schemaVersion: TEXT_EXTRACTION_SCHEMA_VERSION,
}
```

Parse stdout through `TextItemListSchema` and return `.items`. Map spawn, timeout, exit, JSON, and schema failures to `OcrUnavailableError`. Keep the existing presets but remove `analyze-reference` and numeric `compare` behavior.

- [ ] **Step 4: Run OCR tests and package checks**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine test -- ocr.test.ts
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine typecheck
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine lint
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit fallback adaptation**

```powershell
git add packages/visual-engine/src/ocr.ts packages/visual-engine/src/ocr.test.ts packages/visual-engine/src/index.ts
git commit -m "feat: adapt OCR command as text extractor fallback"
```

---

### Task 8: Wire trusted origins, provider selection, cache, and fail-closed CLI behavior

**Files:**
- Modify: `packages/cli/src/runtime.ts`
- Modify: `packages/cli/src/commands/doctor.ts`
- Modify: `packages/cli/src/commands/run.ts`
- Modify: `packages/cli/src/cli.test.ts`

- [ ] **Step 1: Write failing CLI configuration tests**

Extract and test pure helpers instead of mutating global state inside `runPage` tests:

```ts
it('parses exact trusted HTTPS origins', () => {
  expect(parseTrustedOrigins(' https://api.example.com,https://model.example.com:8443 '))
    .toEqual(['https://api.example.com', 'https://model.example.com:8443'])
})

it.each(['http://api.example.com', 'https://api.example.com/path', 'not-a-url'])(
  'rejects unsafe trusted origin %s', value => {
    expect(() => parseTrustedOrigins(value)).toThrow()
  },
)

it('uses command extraction only when explicitly configured', () => {
  expect(selectTextExtractor({ ...modelEnv, UI_REBUILD_OCR_COMMAND: undefined }).identity.provider)
    .toBe('model')
  expect(selectTextExtractor({ ...modelEnv, UI_REBUILD_OCR_COMMAND: 'ocr' }).identity.provider)
    .toBe('command')
})
```

Add doctor assertions: configured model plus trusted remote origin passes the text-extraction check without `UI_REBUILD_OCR_COMMAND`; an untrusted remote endpoint fails with a useful detail.

- [ ] **Step 2: Run CLI tests and verify failure**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/cli test -- cli.test.ts
```

Expected: FAIL because helpers and default model extraction are absent.

- [ ] **Step 3: Implement secure configuration and runtime wiring**

In `runtime.ts`, export:

```ts
export function parseTrustedOrigins(raw = ''): string[] {
  return raw.split(',').map(value => value.trim()).filter(Boolean).map(value => {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.toString() !== `${url.origin}/`) {
      throw new Error(`Trusted model origin must be an HTTPS origin: ${value}`)
    }
    return url.origin
  })
}
```

Pass the result to `OpenAICompatibleTransport.trustedRemoteOrigins`. Construct `ModelTextExtractor` with the configured model identity. Add a pure `selectTextExtractor(env)` that selects `LocalOcrCommandProvider` only when `UI_REBUILD_OCR_COMMAND` is nonempty; otherwise use the model extractor.

In `run.ts`:

- Create `FileTextExtractionCache(path.join(root, '.ui-rebuild', 'cache', 'text'))`.
- Pass extractor and cache to `freezeReference` and `scoreAgainstFrozenReference`.
- Remove `requireOcr`, numeric OCR compare, and nullable OCR acceptance.
- Preserve `TextExtractionGateError` in `state.json` as a stable failure instead of turning it into a zero score.
- Keep single-state/viewport checks unchanged.

In `doctor.ts`, replace the mandatory OCR check with a `text-extraction` check based on valid model endpoint/model/trusted origin configuration. Report command fallback as optional when present.

- [ ] **Step 4: Run CLI tests and checks**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/cli test
corepack pnpm@10.13.1 --filter @ui-rebuild/cli typecheck
corepack pnpm@10.13.1 --filter @ui-rebuild/cli lint
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit CLI wiring**

```powershell
git add packages/cli/src/runtime.ts packages/cli/src/commands/doctor.ts packages/cli/src/commands/run.ts packages/cli/src/cli.test.ts
git commit -m "feat: wire multimodal text scoring into CLI"
```

---

### Task 9: Render detailed text diagnostics in review reports

**Files:**
- Modify: `packages/report/src/generate-report.ts`
- Modify: `packages/report/src/validate.ts`
- Modify: `packages/report/src/generate-report.test.ts`
- Modify: `packages/cli/src/commands/run.ts`

- [ ] **Step 1: Write failing report tests**

Extend the report fixture with text diagnostics and assert rendered, escaped output:

```ts
text: {
  score: 0.82,
  content: 0.7,
  position: 0.9,
  fontSize: 1,
  color: null,
  missing: ['¥99.00'],
  added: ['¥89.00'],
  lowConfidence: ['subtotal'],
  matches: [{ reference: 'Total', actual: 'TOTAL', cost: 0.02, critical: false }],
  extraction: { provider: 'model', model: 'gpt-test', cacheHit: true },
}
```

Assertions:

```ts
expect(html).toContain('内容 0.700')
expect(html).toContain('缺失文字')
expect(html).toContain('¥99.00')
expect(html).toContain('缓存命中')
expect(html).not.toContain('<script>alert(1)</script>')
```

- [ ] **Step 2: Run report tests and verify failure**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/report test -- generate-report.test.ts
```

Expected: FAIL because detailed text diagnostics are not accepted or rendered.

- [ ] **Step 3: Extend validation, rendering, and CLI mapping**

Update `ReportInput` and validation to use the Task 1 text diagnostic shape. Replace the single `OCR` line with content, position, font-size, color, extraction provider/model/cache state, matched pairs, missing, added, and low-confidence sections. Render absent dimensions as `N/A`. Pass every user/model-derived string through the existing `html()` escaping helper.

In `run.ts`, map `RegionScore.content` directly to the new report `text` field and stop emitting `score.ocr`.

- [ ] **Step 4: Run report and CLI checks**

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/report test
corepack pnpm@10.13.1 --filter @ui-rebuild/report typecheck
corepack pnpm@10.13.1 --filter @ui-rebuild/report lint
corepack pnpm@10.13.1 --filter @ui-rebuild/cli test
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit report diagnostics**

```powershell
git add packages/report/src packages/cli/src/commands/run.ts
git commit -m "feat: report region text scoring diagnostics"
```

---

### Task 10: Complete end-to-end verification

**Files:**
- Modify only files required to fix verification regressions introduced by Tasks 1–9.

- [ ] **Step 1: Run all package tests serially**

Avoid Chromium contention by running packages serially:

```powershell
corepack pnpm@10.13.1 --filter @ui-rebuild/contracts test
corepack pnpm@10.13.1 --filter @ui-rebuild/model-adapter test
corepack pnpm@10.13.1 --filter @ui-rebuild/visual-engine test
corepack pnpm@10.13.1 --filter @ui-rebuild/orchestrator test
corepack pnpm@10.13.1 --filter @ui-rebuild/report test
corepack pnpm@10.13.1 --filter @ui-rebuild/cli test
```

Expected: every command exits 0.

- [ ] **Step 2: Run repository static checks**

```powershell
corepack pnpm@10.13.1 typecheck
corepack pnpm@10.13.1 lint
git diff --check
```

Expected: every command exits 0 and `git diff --check` prints nothing.

- [ ] **Step 3: Verify the reference host app**

```powershell
corepack pnpm@10.13.1 --dir apps/reference-app typecheck
corepack pnpm@10.13.1 --dir apps/reference-app lint
corepack pnpm@10.13.1 --dir apps/reference-app build:h5
```

Expected: typecheck, lint, and H5 build all exit 0.

- [ ] **Step 4: Run CLI doctor with the configured remote model**

Open a fresh PowerShell so user environment variables are loaded, then run:

```powershell
$env:UI_REBUILD_MODEL_TRUSTED_ORIGINS='https://api.tokenhubagi.com'; corepack pnpm@10.13.1 --filter @ui-rebuild/cli exec ui-rebuild doctor
```

Expected: `model` and `text-extraction` checks pass without requiring `UI_REBUILD_OCR_COMMAND`. Do not print or log `UI_REBUILD_MODEL_API_KEY`.

- [ ] **Step 5: Inspect repository state and commit any verification fixes**

```powershell
git status --short
git diff --check
```

If verification required code fixes, commit only those fixes:

```powershell
git add <verified-fix-files>
git commit -m "fix: complete multimodal text scoring verification"
```

If no files changed, do not create an empty commit.

- [ ] **Step 6: Push the current branch**

```powershell
git push
```

Expected: current branch pushes successfully. If no remote/upstream exists, report that exact blocker and leave all commits local; do not alter Git configuration.
