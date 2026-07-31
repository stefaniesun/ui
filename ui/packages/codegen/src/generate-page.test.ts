import { describe, expect, it } from 'vitest'
import { generatePage } from './generate-page.js'
import { inspectGeneratedFiles } from './component-policy.js'

const ir = {
  version: '1.0.0' as const, projectId: 'demo', pageId: 'profile',
  coordinateSpace: 'logical-px' as const,
  tokens: { colors: { surface: '#fff' }, typography: {}, spacing: { page: 16 }, radii: {} },
  states: [{ id: 'default', screenshot: 'reference/default.png' }],
  regions: [{ regionId: 'owner-services', displayName: '车主服务区', aliases: [], parentId: null,
    bounds: { x: 16, y: 300, width: 364, height: 200 }, source: 'model' as const,
    confidence: 0.9, componentPath: 'src/components/profile/OwnerServices.vue', lockedByHuman: false,
    decorationOnly: false,
    content: [
      { kind: 'text' as const, nodeId: 'page-title', text: '会员中心', role: 'title' as const,
        bounds: { x: 32, y: 320, width: 120, height: 30 } },
      { kind: 'asset' as const, nodeId: 'member-avatar', assetId: 'avatar-default', alt: '会员头像', fit: 'cover' as const,
        bounds: { x: 32, y: 360, width: 48, height: 48 } },
      { kind: 'control' as const, nodeId: 'pay-button', control: 'button' as const, label: '立即支付',
        bounds: { x: 32, y: 430, width: 330, height: 48 } },
    ] }],
  assets: [{ assetId: 'avatar-default', regionId: 'owner-services', role: 'avatar' as const,
    source: 'src/assets/profile/avatar.png', mediaType: 'image/png' as const }], interactions: [],
}

describe('generatePage', () => {
  it('generates semantic regions, tokens and data-driven grids', () => {
    const files = generatePage(ir, { logicalWidth: 396 })
    expect(files['src/pages/profile/index.vue']).toContain('<OwnerServices />')
    expect(JSON.parse(files['src/pages.json']!)).toEqual({
      pages: [{ path: 'pages/profile/index', style: { navigationStyle: 'custom' } }],
      globalStyle: { backgroundColor: '#f5f6f8' },
    })
    expect(files['src/components/profile/OwnerServices.vue']).toContain('data-region-id="owner-services"')
    expect(files['src/components/profile/OwnerServices.vue']).toContain('会员中心')
    expect(files['src/components/profile/OwnerServices.vue']).toContain('立即支付')
    expect(files['src/components/profile/OwnerServices.vue']).toContain(':src="assets.avatarDefault"')
    expect(files['src/components/profile/OwnerServices.vue']).toContain("from '../../assets/registry'")
    expect(files['src/assets/registry.ts']).toContain('avatarDefault')
    expect(files['src/assets/registry.ts']).toContain("./profile/avatar.png")
    expect(files['src/components/profile/OwnerServices.vue']).toContain('position:absolute')
    expect(files['src/pages/profile/index.vue']).toContain('position:relative')
    const nestedFiles = generatePage({
      ...ir,
      regions: [
        ir.regions[0]!,
        { ...ir.regions[0]!, regionId: 'service-item', parentId: 'owner-services', componentPath: 'src/components/profile/ServiceItem.vue', content: [], decorationOnly: true },
      ],
    }, { logicalWidth: 396 })
    expect(nestedFiles['src/components/profile/OwnerServices.vue'])
      .toContain("from './ServiceItem'")
    expect(nestedFiles['src/components/profile/ServiceItem.vue'])
      .toContain('left:0rpx;top:0rpx')
    expect(Object.values(files).join('\n')).not.toContain('reference/default.png')
    expect(files['src/styles/tokens.scss']).toContain(`${16 * (750 / 396)}rpx`)
    expect(generatePage({
      ...ir,
      tokens: { ...ir.tokens, colors: { pageBackground: '#fff' } },
    }, { logicalWidth: 396 })['src/styles/tokens.scss']).toContain('--ui-color-page-background: #fff;')
  })

  it('escapes markup and rejects unsafe component paths', () => {
    const escaped = generatePage({
      ...ir,
      regions: [{ ...ir.regions[0]!, displayName: '<script>alert(1)</script>' }],
    }, { logicalWidth: 396 })
    expect(Object.values(escaped).join('\n')).not.toContain('<script>alert(1)</script>')
    expect(() => generatePage({
      ...ir,
      regions: [{ ...ir.regions[0]!, componentPath: '../outside.vue' }],
    }, { logicalWidth: 396 })).toThrow(/componentPath/i)
  })

  it('rejects duplicate component paths without hanging', () => {
    expect(() => generatePage({ ...ir, regions: [ir.regions[0]!, { ...ir.regions[0]!, regionId: 'second-region', content: [], decorationOnly: true }] }, { logicalWidth: 396 })).toThrow(/componentPath/i)
  })

  it('rejects an empty visible leaf but accepts a decorative leaf', () => {
    expect(() => generatePage({ ...ir, regions: [{ ...ir.regions[0]!, content: [] }] }, { logicalWidth: 396 })).toThrow(/visible content/i)
    expect(generatePage({ ...ir, regions: [{ ...ir.regions[0]!, content: [], decorationOnly: true }], assets: [] }, { logicalWidth: 396 }))
      .toHaveProperty('src/components/profile/OwnerServices.vue')
  })

  it('rejects forbidden generated patterns', () => {
    expect(inspectGeneratedFiles({
      'src/pages/profile/index.vue': '<style>.x{background:url(reference/default.png)}</style>',
    })).not.toHaveLength(0)
    expect(inspectGeneratedFiles({
      'src/components/Grid.vue': '<view class="grid-item"/><view class="grid-item"/><view class="grid-item"/><view class="grid-item"/>',
    }).map(item => item.rule)).toContain('data-driven-grid')
  })
})
