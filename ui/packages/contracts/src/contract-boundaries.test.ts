import { describe, expect, it } from 'vitest'
import {
  ManifestSchema,
  PatchPlanSchema,
  RegionTextBaselineSchema,
  ReviewReportSchema,
  TEXT_CONFIDENCE_THRESHOLD,
  TEXT_EXTRACTION_PROMPT_VERSION,
  TEXT_EXTRACTION_SCHEMA_VERSION,
  TextExtractionFailureSchema,
  TextItemListSchema,
  TextItemSchema,
  VisualIRSchema,
} from './index.js'

describe('public contract exports', () => {
  it('exports every Task 2 runtime schema', () => {
    expect(ManifestSchema).toBeDefined()
    expect(VisualIRSchema).toBeDefined()
    expect(PatchPlanSchema).toBeDefined()
    expect(ReviewReportSchema).toBeDefined()
    expect(TextItemSchema).toBeDefined()
    expect(TextItemListSchema).toBeDefined()
    expect(RegionTextBaselineSchema).toBeDefined()
    expect(TextExtractionFailureSchema).toBeDefined()
    expect(TEXT_EXTRACTION_SCHEMA_VERSION).toBe('1.0.0')
    expect(TEXT_EXTRACTION_PROMPT_VERSION).toBe('1.0.0')
    expect(TEXT_CONFIDENCE_THRESHOLD).toBe(0.6)
  })
})

describe('PatchPlanSchema', () => {
  const valid = {
    targetRegionIds: ['owner-services'],
    rootCause: 'grid gap differs from reference',
    allowedFiles: ['src/components/profile/OwnerServices.vue'],
    allowedComponents: ['OwnerServices'],
    allowedTokens: ['spacing.serviceGrid.rowGap'],
    expectedMetricChanges: { visual: 0.02 },
    affectedStateIds: ['default'],
    affectedTargets: ['h5', 'wechat'],
    rollbackConditions: ['page score decreases'],
    replacementFiles: {
      'src/components/profile/OwnerServices.vue': '<template />',
    },
  }

  it('accepts a complete project-relative patch plan', () => {
    expect(PatchPlanSchema.parse(valid).targetRegionIds).toEqual(['owner-services'])
  })

  it('rejects replacement files outside allowedFiles', () => {
    expect(() => PatchPlanSchema.parse({
      ...valid,
      replacementFiles: { 'src/components/profile/Other.vue': '<template />' },
    })).toThrow(/allowedFiles/i)
  })

  it.each(['allowedComponents', 'allowedTokens', 'affectedStateIds', 'affectedTargets'] as const)(
    'requires an explicit %s whitelist',
    field => {
      const incomplete: Record<string, unknown> = { ...valid }
      Reflect.deleteProperty(incomplete, field)
      expect(() => PatchPlanSchema.parse(incomplete)).toThrow()
    },
  )

  it.each([
    'C:\\outside\\file.ts',
    '\\\\server\\share\\file.ts',
    '/outside/file.ts',
    '../outside.ts',
    'src/../../outside.ts',
    'src\\..\\..\\outside.ts',
  ])('rejects unsafe allowed file %s', allowedFile => {
    expect(() => PatchPlanSchema.parse({ ...valid, allowedFiles: [allowedFile] })).toThrow()
  })
})

describe('TextItemSchema', () => {
  const valid = {
    text: '¥99.00',
    bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.04 },
    fontSize: 16,
    color: '#112233',
    confidence: 0.95,
  }

  it('accepts and trims normalized extracted text', () => {
    expect(TextItemSchema.parse({ ...valid, text: ' ¥99.00 ', color: ' #112233 ' })).toMatchObject({
      text: '¥99.00',
      color: '#112233',
      confidence: 0.95,
    })
    expect(TextItemSchema.parse({ ...valid, bounds: { x: 0, y: 0, width: 1, height: 1 } })).toBeDefined()
  })

  it.each([
    { ...valid, text: '' },
    { ...valid, text: '   ' },
    { ...valid, bounds: { x: -0.1, y: 0, width: 1, height: 1 } },
    { ...valid, bounds: { x: 0.8, y: 0, width: 0.3, height: 1 } },
    { ...valid, bounds: { x: 0, y: 0.9, width: 1, height: 0.2 } },
    { ...valid, bounds: { x: 0, y: 0, width: 0, height: 1 } },
    { ...valid, bounds: { x: 0, y: 0, width: -1, height: 1 } },
    { ...valid, bounds: { x: 0, y: 0, width: 1.1, height: 1 } },
    { ...valid, bounds: { x: 0, y: 1.1, width: 1, height: 1 } },
    { ...valid, confidence: -0.1 },
    { ...valid, confidence: 1.1 },
    { ...valid, confidence: Number.NaN },
    { ...valid, fontSize: Number.POSITIVE_INFINITY },
    { ...valid, fontSize: 0 },
    { ...valid, color: '' },
    { ...valid, color: '   ' },
    { ...valid, unexpected: true },
    { ...valid, bounds: { ...valid.bounds, unexpected: true } },
  ])('rejects invalid text item %#', item => {
    expect(() => TextItemSchema.parse(item)).toThrow()
  })

  it.each(['fontSize', 'color'] as const)('requires nullable field %s to be present', field => {
    const incomplete: Record<string, unknown> = { ...valid }
    Reflect.deleteProperty(incomplete, field)
    expect(() => TextItemSchema.parse(incomplete)).toThrow()
  })

  it('accepts null font size and color', () => {
    expect(TextItemSchema.parse({ ...valid, fontSize: null, color: null })).toBeDefined()
  })

  it('validates strict item lists', () => {
    expect(TextItemListSchema.parse({ items: [valid] }).items).toHaveLength(1)
    expect(() => TextItemListSchema.parse({ items: [valid], extra: true })).toThrow()
    expect(() => TextItemListSchema.parse({ items: [{ ...valid, confidence: 2 }] })).toThrow()
  })
})

describe('RegionTextBaselineSchema', () => {
  const valid = {
    regionId: 'hero',
    imageHash: 'a'.repeat(64),
    model: 'gpt-test',
    schemaVersion: TEXT_EXTRACTION_SCHEMA_VERSION,
    promptVersion: TEXT_EXTRACTION_PROMPT_VERSION,
    items: [],
    extractedAt: '2026-07-27T10:00:00.000Z',
  }

  it('accepts a complete versioned baseline', () => {
    expect(RegionTextBaselineSchema.parse(valid).imageHash).toHaveLength(64)
  })

  it.each([
    { ...valid, imageHash: 'A'.repeat(64) },
    { ...valid, imageHash: 'a'.repeat(63) },
    { ...valid, schemaVersion: '2.0.0' },
    { ...valid, promptVersion: '2.0.0' },
    { ...valid, extractedAt: 'not-a-date' },
    { ...valid, extra: true },
  ])('rejects an invalid baseline %#', baseline => {
    expect(() => RegionTextBaselineSchema.parse(baseline)).toThrow()
  })
})

describe('TextExtractionFailureSchema', () => {
  const valid = {
    code: 'text-extraction-failed',
    reason: 'schema-invalid',
    regionId: 'hero',
    stage: 'actual',
    message: 'invalid model output',
  }

  it('requires stable extraction failure context', () => {
    expect(TextExtractionFailureSchema.parse(valid)).toBeDefined()
  })

  it.each([
    { ...valid, code: 'other' },
    { ...valid, reason: 'unknown' },
    { ...valid, stage: 'other' },
    { ...valid, message: '' },
    { ...valid, extra: true },
  ])('rejects invalid extraction failure %#', failure => {
    expect(() => TextExtractionFailureSchema.parse(failure)).toThrow()
  })

  it.each(['code', 'reason', 'regionId', 'stage', 'message'] as const)('requires failure field %s', field => {
    const incomplete: Record<string, unknown> = { ...valid }
    Reflect.deleteProperty(incomplete, field)
    expect(() => TextExtractionFailureSchema.parse(incomplete)).toThrow()
  })
})

describe('ReviewReportSchema', () => {
  const valid = {
    version: '1.0.0',
    runId: 'run-1',
    pageId: 'profile',
    stateId: 'default',
    total: 0.88,
    regions: [{
      regionId: 'owner-services',
      total: 0.9,
      geometryErrorPx: 2,
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
      },
      severeDefects: [],
    }],
    bestRound: 3,
  }

  it('accepts structured text diagnostics', () => {
    expect(ReviewReportSchema.parse(valid).regions[0]?.text.fontSize).toBeNull()
  })

  const region = valid.regions[0]!

  it.each([
    { total: 1.1 },
    { regions: [{ ...region, total: -0.1 }] },
    { regions: [{ ...region, geometryErrorPx: -1 }] },
    { regions: [{ ...region, ocrMatch: 1 }] },
    { regions: [{ ...region, text: { ...region.text, score: 2 } }] },
    { regions: [{ ...region, text: { ...region.text, content: -0.1 } }] },
    { regions: [{ ...region, text: { ...region.text, position: 1.1 } }] },
    { regions: [{ ...region, text: { ...region.text, fontSize: 2 } }] },
    { regions: [{ ...region, text: { ...region.text, color: -1 } }] },
    { regions: [{ ...region, text: { ...region.text, matches: [{ reference: 'a', actual: 'b', cost: 2, critical: false }] } }] },
    { regions: [{ ...region, text: { ...region.text, extraction: { provider: 'unknown', model: 'x', cacheHit: false } } }] },
    { regions: [{ ...region, text: { ...region.text, extra: true } }] },
  ])('rejects invalid report metrics', override => {
    expect(() => ReviewReportSchema.parse({ ...valid, ...override })).toThrow()
  })
})
