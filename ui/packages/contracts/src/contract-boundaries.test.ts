import { describe, expect, it } from 'vitest'
import {
  ManifestSchema,
  PatchPlanSchema,
  ReviewReportSchema,
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
    expectedMetricChanges: { visual: 0.02 },
    rollbackConditions: ['page score decreases'],
  }

  it('accepts a complete project-relative patch plan', () => {
    expect(PatchPlanSchema.parse(valid).targetRegionIds).toEqual(['owner-services'])
  })

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
      ocrMatch: null,
      severeDefects: [],
    }],
    bestRound: 3,
  }

  it('accepts nullable OCR scores', () => {
    expect(ReviewReportSchema.parse(valid).regions[0]?.ocrMatch).toBeNull()
  })

  it.each([
    { total: 1.1 },
    { regions: [{ ...valid.regions[0], total: -0.1 }] },
    { regions: [{ ...valid.regions[0], geometryErrorPx: -1 }] },
    { regions: [{ ...valid.regions[0], ocrMatch: 2 }] },
  ])('rejects invalid report metrics', override => {
    expect(() => ReviewReportSchema.parse({ ...valid, ...override })).toThrow()
  })
})
