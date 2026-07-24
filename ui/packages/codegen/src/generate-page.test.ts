import { describe, expect, it } from 'vitest'
import { generatePage } from './generate-page.js'

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
  })
})
