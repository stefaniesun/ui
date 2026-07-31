import { describe, expect, it } from 'vitest'
import {
  applyRegionSuggestion,
  ContentNodeSchema,
  VisualAssetSchema,
  VisualInteractionSchema,
  VisualIRSchema,
} from './visual-ir.js'

function createVisualIR() {
  return {
    version: '1.0.0',
    projectId: 'uinotes-demo',
    pageId: 'profile',
    coordinateSpace: 'logical-px',
    tokens: {
      colors: { textPrimary: '#111111' },
      typography: { pageTitle: { fontSize: 20, fontWeight: 600, lineHeight: 24 } },
      spacing: {},
      radii: {},
    },
    states: [{ id: 'default', screenshot: 'reference/default.png' }],
    regions: [{
      regionId: 'owner-services',
      displayName: '车主服务区',
      aliases: ['爱车服务模块'],
      parentId: null as string | null,
      bounds: { x: 0, y: 0, width: 390, height: 844 },
      source: 'model',
      confidence: 0.94,
      componentPath: 'src/components/profile/OwnerServices.vue',
      content: [
        {
          kind: 'text' as const,
          nodeId: 'page-title',
          text: '会员中心',
          role: 'title' as const,
          bounds: { x: 20, y: 64, width: 90, height: 24 },
          typographyToken: 'pageTitle',
          colorToken: 'textPrimary',
        },
        {
          kind: 'asset' as const,
          nodeId: 'member-avatar',
          assetId: 'avatar-default',
          alt: '会员头像',
          bounds: { x: 20, y: 96, width: 48, height: 48 },
          fit: 'cover' as const,
        },
        {
          kind: 'control' as const,
          nodeId: 'pay-button',
          control: 'button' as const,
          label: '立即支付',
          bounds: { x: 20, y: 160, width: 356, height: 48 },
          actionId: 'submit-payment',
        },
      ],
    }],
    assets: [{
      assetId: 'avatar-default',
      regionId: 'owner-services',
      role: 'avatar' as const,
      source: 'src/assets/profile/avatar.png',
      mediaType: 'image/png' as const,
    }],
    interactions: [{
      interactionId: 'submit-payment',
      regionId: 'owner-services',
      triggerNodeId: 'pay-button',
      action: 'submit' as const,
      confidence: 0.98,
    }],
  }
}

describe('VisualIRSchema', () => {
  it('accepts ordered structured content with referenced assets and interactions', () => {
    const result = VisualIRSchema.parse(createVisualIR())
    expect(result.regions[0]?.regionId).toBe('owner-services')
    expect(result.regions[0]?.lockedByHuman).toBe(false)
    expect(result.regions[0]?.content.map(node => node.nodeId)).toEqual([
      'page-title',
      'member-avatar',
      'pay-button',
    ])
    expect(ContentNodeSchema).toBeDefined()
    expect(VisualAssetSchema).toBeDefined()
    expect(VisualInteractionSchema).toBeDefined()
  })

  it('rejects malformed typography tokens', () => {
    const input = createVisualIR()
    Object.assign(input.tokens.typography, { invalid: { fontSize: 'large', fontWeight: 600 } })
    expect(() => VisualIRSchema.parse(input)).toThrow()
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

  it('rejects duplicate content node ids', () => {
    const input = createVisualIR()
    input.regions[0]!.content.push({ ...input.regions[0]!.content[0]! })
    expect(() => VisualIRSchema.parse(input)).toThrow(/duplicate content nodeId/i)
  })

  it('rejects dangling asset references', () => {
    const input = createVisualIR()
    Object.assign(input.regions[0]!.content[1]!, { assetId: 'missing-asset' })
    expect(() => VisualIRSchema.parse(input)).toThrow(/assetId does not reference/i)
  })

  it.each([
    '../secret.png',
    '/absolute/image.png',
    'C:\\secret.png',
    'public/avatar.png',
    'src/assets/../secret.png',
    'src/assets/icons/../../secret.png',
    'src\\assets\\..\\secret.png',
  ])('rejects unsafe asset source %s', source => {
    const input = createVisualIR()
    input.assets[0]!.source = source
    expect(() => VisualIRSchema.parse(input)).toThrow(/asset source/i)
  })

  it('rejects interactions whose trigger node is missing', () => {
    const input = createVisualIR()
    input.interactions[0]!.triggerNodeId = 'missing-node'
    expect(() => VisualIRSchema.parse(input)).toThrow(/triggerNodeId/i)
  })

  it('rejects content outside the inferred page canvas', () => {
    const input = createVisualIR()
    input.regions[0]!.content[0]!.bounds.x = 391
    expect(() => VisualIRSchema.parse(input)).toThrow(/outside the inferred page canvas/i)
  })

  it('accepts empty alt text for decorative images', () => {
    const input = createVisualIR()
    Object.assign(input.regions[0]!.content[1]!, { alt: '' })
    expect(VisualIRSchema.parse(input).regions[0]?.content).toHaveLength(3)
  })

  it.each(['', '   '])('rejects an empty control label %j', label => {
    const input = createVisualIR()
    Object.assign(input.regions[0]!.content[2]!, { label })
    expect(() => VisualIRSchema.parse(input)).toThrow()
  })

  it('rejects a non-decorative leaf without visible content', () => {
    const input = createVisualIR()
    input.regions[0]!.content = []
    expect(() => VisualIRSchema.parse(input)).toThrow(/visible content/i)
  })

  it('accepts an empty decorative leaf', () => {
    const input = createVisualIR()
    input.regions[0]!.content = []
    input.interactions = []
    Object.assign(input.regions[0]!, { decorationOnly: true })
    expect(VisualIRSchema.parse(input).regions[0]?.decorationOnly).toBe(true)
  })

  it('accepts an empty parent container with a visible child', () => {
    const input = createVisualIR()
    input.regions[0]!.content = []
    input.interactions = []
    input.regions.push({
      ...createVisualIR().regions[0]!,
      regionId: 'member-details',
      parentId: 'owner-services',
      componentPath: 'src/components/profile/MemberDetails.vue',
    })
    expect(VisualIRSchema.parse(input).regions).toHaveLength(2)
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
