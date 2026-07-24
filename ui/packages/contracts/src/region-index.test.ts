import { describe, expect, it } from 'vitest'
import type { RegionNode } from './visual-ir.js'
import {
  AmbiguousRegionNameError,
  createRegionIndex,
  mergeRegionSuggestion,
} from './region-index.js'

const regions: RegionNode[] = [
  {
    regionId: 'owner-services',
    displayName: '车主服务区',
    aliases: ['爱车服务模块'],
    parentId: null,
    bounds: { x: 22, y: 538, width: 358, height: 205 },
    source: 'model',
    confidence: 0.94,
    componentPath: 'src/components/profile/OwnerServices.vue',
    lockedByHuman: false,
  },
  {
    regionId: 'primary-tabbar',
    displayName: '一级底部导航',
    aliases: ['主导航'],
    parentId: null,
    bounds: { x: 22, y: 767, width: 362, height: 60 },
    source: 'model',
    confidence: 0.99,
    selector: '[data-region-id="primary-tabbar"]',
    lockedByHuman: false,
  },
]

describe('region index', () => {
  it('resolves a region by id, display name, or alias', () => {
    const index = createRegionIndex(regions)
    expect(index.resolve('owner-services')?.regionId).toBe('owner-services')
    expect(index.resolve(' 车主 服务区 ')?.regionId).toBe('owner-services')
    expect(index.resolve('爱车服务模块')?.regionId).toBe('owner-services')
  })

  it('maps a component path and selector back to a region', () => {
    const index = createRegionIndex(regions)
    expect(index.resolveComponent('src/components/profile/OwnerServices.vue')?.regionId)
      .toBe('owner-services')
    expect(index.resolveSelector('[data-region-id="primary-tabbar"]')?.regionId)
      .toBe('primary-tabbar')
  })

  it('reports ambiguous display names and aliases', () => {
    const duplicate = { ...regions[1]!, displayName: '车主服务区', aliases: ['爱车服务模块'] }
    const index = createRegionIndex([...regions, duplicate])
    expect(() => index.resolve('车主服务区')).toThrow(AmbiguousRegionNameError)
    expect(() => index.resolve('爱车服务模块')).toThrow(/ambiguous/i)
  })

  it('preserves human locked names during model merge', () => {
    const current = {
      ...regions[0]!,
      displayName: '车主权益区',
      aliases: ['我的车主服务'],
      source: 'human' as const,
      lockedByHuman: true,
    }
    const merged = mergeRegionSuggestion(current, {
      ...regions[0]!,
      displayName: '模型新名称',
      source: 'model',
    })
    expect(merged.displayName).toBe('车主权益区')
    expect(merged.aliases).toEqual(['我的车主服务'])
  })
})
