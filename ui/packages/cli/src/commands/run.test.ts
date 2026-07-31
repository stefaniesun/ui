import { describe, expect, it } from 'vitest'
import type { VisualIR } from '@ui-rebuild/contracts'
import { constrainPatchPlan, regionAssetSlots, regionInteractions } from './run.js'

const bindings = [
  { regionId: 'hero', componentPath: 'src/Hero.vue', componentName: 'Hero' },
  { regionId: 'footer', componentPath: 'src/Footer.vue', componentName: 'Footer' },
]

const metadataIR = {
  assets: [
    { assetId: 'hero-image', regionId: 'hero' },
    { assetId: 'footer-logo', regionId: 'footer' },
  ],
  interactions: [
    { interactionId: 'open-member', regionId: 'hero', triggerNodeId: 'join-button', action: 'navigate', confidence: 0.9 },
  ],
} as VisualIR

describe('region report metadata', () => {
  it('maps assets and interactions deterministically by region', () => {
    expect(regionAssetSlots(metadataIR, 'hero')).toEqual(['hero-image'])
    expect(regionInteractions(metadataIR, 'hero')).toEqual([{ description: 'open-member:navigate:join-button', confidence: 0.9 }])
    expect(regionAssetSlots(metadataIR, 'missing')).toEqual([])
    expect(regionInteractions(metadataIR, 'missing')).toEqual([])
  })
})

describe('constrainPatchPlan', () => {
  it('derives allowed files and components from target region bindings', () => {
    const plan = constrainPatchPlan({
      targetRegionIds: ['hero'],
      rootCause: 'geometry',
      allowedFiles: ['src/Hero.vue'],
      allowedComponents: [],
      allowedTokens: [],
      expectedMetricChanges: {},
      affectedStateIds: ['default'],
      affectedTargets: ['h5'],
      rollbackConditions: ['regression'],
      replacementFiles: { 'src/Hero.vue': '<template />' },
    }, bindings)
    expect(plan.allowedComponents).toEqual(['Hero'])
    expect(plan.allowedFiles).toEqual(['src/Hero.vue'])
  })

  it('limits target regions to files that have complete replacements', () => {
    const plan = constrainPatchPlan({
      targetRegionIds: ['hero', 'footer'],
      rootCause: 'geometry',
      allowedFiles: ['src/Hero.vue'],
      allowedComponents: ['Hero'],
      allowedTokens: [],
      expectedMetricChanges: {},
      affectedStateIds: ['default'],
      affectedTargets: ['h5'],
      rollbackConditions: ['regression'],
      replacementFiles: { 'src/Hero.vue': '<template />' },
    }, bindings)
    expect(plan.targetRegionIds).toEqual(['hero'])
  })

  it('constrains affected states and targets to the active boundary', () => {
    const plan = constrainPatchPlan({
      targetRegionIds: ['hero'], rootCause: 'geometry',
      allowedFiles: ['src/Hero.vue'], allowedComponents: ['Hero'], allowedTokens: [],
      expectedMetricChanges: {}, affectedStateIds: ['member-page:default'],
      affectedTargets: ['h5', 'wechat'], rollbackConditions: ['regression'],
      replacementFiles: { 'src/Hero.vue': '<template />' },
    }, bindings, ['default'], ['h5'])
    expect(plan).toMatchObject({ affectedStateIds: ['default'], affectedTargets: ['h5'] })
  })
})
