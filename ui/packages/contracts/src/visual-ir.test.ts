import { describe, expect, it } from 'vitest'
import { VisualIRSchema } from './visual-ir.js'

function createVisualIR() {
  return {
    version: '1.0.0',
    projectId: 'uinotes-demo',
    pageId: 'profile',
    tokens: { colors: {}, typography: {}, spacing: {}, radii: {} },
    states: [{ id: 'default', screenshot: 'reference/default.png' }],
    regions: [{
      regionId: 'owner-services',
      displayName: '车主服务区',
      aliases: ['爱车服务模块'],
      parentId: null as string | null,
      bounds: { x: 22, y: 538, width: 358, height: 205 },
      source: 'model',
      confidence: 0.94,
      componentPath: 'src/components/profile/OwnerServices.vue',
    }],
    assets: [],
    interactions: [],
  }
}

describe('VisualIRSchema', () => {
  it('accepts stable region ids with editable names and aliases', () => {
    const result = VisualIRSchema.parse(createVisualIR())
    expect(result.regions[0]?.regionId).toBe('owner-services')
    expect(result.regions[0]?.lockedByHuman).toBe(false)
  })

  it('rejects duplicate region ids', () => {
    const input = createVisualIR()
    input.regions.push({ ...input.regions[0]! })
    expect(() => VisualIRSchema.parse(input)).toThrow(/duplicate regionId/i)
  })

  it('rejects dangling parent ids', () => {
    const input = createVisualIR()
    input.regions[0]!.parentId = 'missing-region'
    expect(() => VisualIRSchema.parse(input)).toThrow(/parentId/i)
  })

  it('rejects cyclic region hierarchies', () => {
    const input = createVisualIR()
    input.regions = [
      { ...input.regions[0]!, regionId: 'first', parentId: 'second' },
      { ...input.regions[0]!, regionId: 'second', parentId: 'first' },
    ]
    expect(() => VisualIRSchema.parse(input)).toThrow(/cycle/i)
  })
})
