import { describe, expect, it } from 'vitest'
import { applyRegionSuggestion, VisualIRSchema } from './visual-ir.js'

function createVisualIR() {
  return {
    version: '1.0.0',
    projectId: 'uinotes-demo',
    pageId: 'profile',
    coordinateSpace: 'logical-px',
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

  it('requires logical pixel coordinates', () => {
    expect(() => VisualIRSchema.parse({ ...createVisualIR(), coordinateSpace: 'physical-px' }))
      .toThrow()
    const withoutCoordinateSpace = { ...createVisualIR() }
    Reflect.deleteProperty(withoutCoordinateSpace, 'coordinateSpace')
    expect(() => VisualIRSchema.parse(withoutCoordinateSpace)).toThrow()
  })

  it('rejects a model-owned human lock', () => {
    const input = createVisualIR()
    input.regions[0]!.source = 'model'
    Object.assign(input.regions[0]!, { lockedByHuman: true })
    expect(() => VisualIRSchema.parse(input)).toThrow(/lockedByHuman/i)
  })

  it('preserves human-locked names and aliases during model updates', () => {
    const current = VisualIRSchema.parse({
      ...createVisualIR(),
      regions: [{
        ...createVisualIR().regions[0]!,
        source: 'human',
        lockedByHuman: true,
      }],
    }).regions[0]!
    const incoming = {
      ...current,
      source: 'model' as const,
      lockedByHuman: false,
      displayName: '模型新名称',
      aliases: ['模型别名'],
    }
    const merged = applyRegionSuggestion(current, incoming)
    expect(merged.displayName).toBe('车主服务区')
    expect(merged.aliases).toEqual(['爱车服务模块'])
    expect(merged.lockedByHuman).toBe(true)
  })
})
