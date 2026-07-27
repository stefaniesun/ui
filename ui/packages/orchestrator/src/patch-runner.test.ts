import { describe, expect, it } from 'vitest'
import { validatePatchPayload } from './patch-runner.js'

const replacementFiles = { 'src/Hero.vue': '<template />' }
const plan = {
  targetRegionIds: ['hero'],
  rootCause: 'spacing',
  allowedFiles: ['src/Hero.vue'],
  allowedComponents: ['Hero'],
  allowedTokens: [],
  expectedMetricChanges: { total: .01 },
  affectedStateIds: ['default'],
  affectedTargets: ['h5' as const],
  rollbackConditions: ['regression'],
  replacementFiles,
}
const boundary = {
  bindings: [
    { regionId: 'hero', componentPath: 'src/Hero.vue', componentName: 'Hero' },
    { regionId: 'footer', componentPath: 'src/Footer.vue', componentName: 'Footer' },
  ],
  stateIds: ['default'],
  targets: ['h5'],
}

describe('patch whitelist', () => {
  it('rejects files outside PatchPlan', () => expect(() => validatePatchPayload(plan, { 'src/Other.vue': 'x' }, boundary)).toThrow(/not allowed|replacementFiles/i))
  it('accepts complete replacement and matching region component', () => expect(validatePatchPayload(plan, replacementFiles, boundary)).toEqual(['src/Hero.vue']))
  it('rejects mismatched region component mapping', () => expect(() => validatePatchPayload({ ...plan, allowedComponents: ['Other'] }, replacementFiles, boundary)).toThrow(/outside PatchPlan/i))
  it('rejects an unrelated component even when the model allows it', () => {
    const payload = { ...replacementFiles, 'src/Footer.vue': '<template />' }
    expect(() => validatePatchPayload({
      ...plan,
      allowedFiles: ['src/Hero.vue', 'src/Footer.vue'],
      allowedComponents: ['Hero', 'Footer'],
      replacementFiles: payload,
    }, payload, boundary)).toThrow(/target regions/i)
  })
  it('rejects payload content that differs from replacementFiles', () => {
    expect(() => validatePatchPayload(plan, { 'src/Hero.vue': 'different' }, boundary)).toThrow(/replacementFiles/i)
  })
})
