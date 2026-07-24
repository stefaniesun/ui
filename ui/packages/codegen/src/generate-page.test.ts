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
    confidence: 0.9, componentPath: 'src/components/profile/OwnerServices.vue', lockedByHuman: false }],
  assets: [], interactions: [],
}

describe('generatePage', () => {
  it('generates semantic regions, tokens and data-driven grids', () => {
    const files = generatePage(ir)
    expect(files['src/pages/profile/index.vue']).toContain('data-region-id="owner-services"')
    expect(files['src/components/profile/OwnerServices.vue']).toContain('v-for="item in items"')
    expect(Object.values(files).join('\n')).not.toContain('reference/default.png')
    expect(files['src/styles/tokens.scss']).toContain('32rpx')
  })

  it('escapes markup and rejects unsafe component paths', () => {
    const escaped = generatePage({
      ...ir,
      regions: [{ ...ir.regions[0]!, displayName: '<script>alert(1)</script>' }],
    })
    expect(Object.values(escaped).join('\n')).not.toContain('<script>alert(1)</script>')
    expect(() => generatePage({
      ...ir,
      regions: [{ ...ir.regions[0]!, componentPath: '../outside.vue' }],
    })).toThrow(/componentPath/i)
  })

  it('rejects forbidden generated patterns', () => {
    expect(inspectGeneratedFiles({
      'src/pages/profile/index.vue': '<style>.x{background:url(reference/default.png)}</style>',
    })).not.toHaveLength(0)
  })
})
