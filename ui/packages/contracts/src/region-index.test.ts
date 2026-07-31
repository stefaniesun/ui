import { describe, expect, it } from 'vitest'
import type { RegionNode } from './visual-ir.js'
import {
  AmbiguousRegionReferenceError,
  createRegionIndex,
  DuplicateRegionIdError,
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
    content: [],
    decorationOnly: true,
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
    content: [],
    decorationOnly: true,
    lockedByHuman: false,
  },
]

describe('region index', () => {
  it('resolves a region by id, display name, or alias', () => {
    const index = createRegionIndex(regions)
    expect(index.resolve('owner-services')?.regionId).toBe('owner-services')
    expect(index.resolve(' 车主 服务区 ')?.regionId).toBe('owner-services')
    expect(index.resolve('爱车服务模块')?.regionId).toBe('owner-services')
    expect(index.resolve('不存在')).toBeUndefined()
  })

  it('maps normalized project paths and exact selectors back to regions', () => {
    const index = createRegionIndex(regions)
    expect(index.resolveComponent('src\\components\\profile\\OwnerServices.vue')?.regionId)
      .toBe('owner-services')
    expect(index.resolveSelector('[data-region-id="primary-tabbar"]')?.regionId)
      .toBe('primary-tabbar')
  })

  it('does not collapse selectors whose whitespace changes their meaning', () => {
    const first = { ...regions[0]!, selector: 'div .item' }
    const second = { ...regions[1]!, selector: 'div.item' }
    const index = createRegionIndex([first, second])
    expect(index.resolveSelector('div .item')?.regionId).toBe('owner-services')
    expect(index.resolveSelector('div.item')?.regionId).toBe('primary-tabbar')
  })

  it('reports structured ambiguity for every reference kind', () => {
    const duplicateName = { ...regions[1]!, displayName: '车主服务区' }
    const duplicateComponent = {
      ...regions[1]!,
      componentPath: 'src/components/profile/OwnerServices.vue',
    }
    const duplicateSelector = {
      ...regions[0]!,
      selector: '[data-region-id="primary-tabbar"]',
    }

    for (const [kind, resolve] of [
      ['name', () => createRegionIndex([regions[0]!, duplicateName]).resolve('车主服务区')],
      ['componentPath', () => createRegionIndex([regions[0]!, duplicateComponent])
        .resolveComponent('src/components/profile/OwnerServices.vue')],
      ['selector', () => createRegionIndex([duplicateSelector, regions[1]!])
        .resolveSelector('[data-region-id="primary-tabbar"]')],
    ] as const) {
      try {
        resolve()
        expect.fail('expected an ambiguity error')
      } catch (error) {
        expect(error).toBeInstanceOf(AmbiguousRegionReferenceError)
        expect(error).toMatchObject({ kind, regionIds: ['owner-services', 'primary-tabbar'] })
      }
    }
  })

  it('rejects duplicate region ids instead of building an inconsistent index', () => {
    const duplicate = { ...regions[0]!, displayName: '另一个名称' }
    expect(() => createRegionIndex([...regions, duplicate])).toThrow(DuplicateRegionIdError)
  })

  it('preserves human locked names during the plan-shaped model merge', () => {
    const current = {
      ...regions[0]!,
      displayName: '车主权益区',
      aliases: ['我的车主服务'],
      source: 'human' as const,
      lockedByHuman: true,
    }
    const merged = mergeRegionSuggestion(current, {
      ...current,
      displayName: '模型新名称',
      aliases: ['模型别名'],
      source: 'model',
    })
    expect(merged.displayName).toBe('车主权益区')
    expect(merged.aliases).toEqual(['我的车主服务'])
    expect(merged.lockedByHuman).toBe(true)
  })

  it('rejects suggestions for a different region', () => {
    expect(() => mergeRegionSuggestion(regions[0]!, regions[1]!)).toThrow(/regionId/i)
  })
})
