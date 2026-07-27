import { describe, expect, it } from 'vitest'
import {
  ManifestSchema,
  PatchPlanSchema,
  ReviewReportSchema,
  TextExtractionFailureSchema,
  TextItemSchema,
  VisualIRSchema,
} from './index.js'

describe('public contract exports', () => {
  it('exports every Task 2 runtime schema', () => {
    expect(ManifestSchema).toBeDefined()
    expect(VisualIRSchema).toBeDefined()
    expect(PatchPlanSchema).toBeDefined()
    expect(ReviewReportSchema).toBeDefined()
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

  it('accepts normalized extracted text', () => {
    expect(TextItemSchema.parse(valid)).toMatchObject({ text: '¥99.00', confidence: 0.95 })
  })

  it.each([
    { ...valid, text: '' },
    { ...valid, bounds: { x: -0.1, y: 0, width: 1, height: 1 } },
    { ...valid, bounds: { x: 0.8, y: 0, width: 0.3, height: 1 } },
    { ...valid, bounds: { x: 0, y: 0.9, width: 1, height: 0.2 } },
    { ...valid, bounds: { x: 0, y: 0, width: 0, height: 1 } },
    { ...valid, confidence: 1.1 },
    { ...valid, fontSize: 0 },
    { ...valid, color: '' },
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
})

describe('TextExtractionFailureSchema', () => {
  it('requires stable extraction failure context', () => {
    expect(TextExtractionFailureSchema.parse({
      code: 'text-extraction-failed',
      reason: 'schema-invalid',
      regionId: 'hero',
      stage: 'actual',
      message: 'invalid model output',
    })).toBeDefined()
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

  it.each([
    { total: 1.1 },
    { regions: [{ ...valid.regions[0], total: -0.1 }] },
    { regions: [{ ...valid.regions[0], geometryErrorPx: -1 }] },
    { regions: [{ ...valid.regions[0], text: { ...valid.regions[0].text, score: 2 } }] },
    { regions: [{ ...valid.regions[0], text: { ...valid.regions[0].text, extraction: { provider: 'unknown', model: 'x', cacheHit: false } } }] },
  ])('rejects invalid report metrics', override => {
    expect(() => ReviewReportSchema.parse({ ...valid, ...override })).toThrow()
  })
})
