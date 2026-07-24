import { applyRegionSuggestion } from './visual-ir.js'
import type { RegionNode, RegionNodeInput } from './visual-ir.js'

export class AmbiguousRegionNameError extends Error {
  readonly regionIds: string[]

  constructor(query: string, regions: RegionNode[]) {
    super(`Ambiguous region reference "${query}": ${regions.map(item => item.regionId).join(', ')}`)
    this.name = 'AmbiguousRegionNameError'
    this.regionIds = regions.map(item => item.regionId)
  }
}

export function normalizeRegionName(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN').replaceAll(/\s+/gu, '')
}

function addLookup(
  lookup: Map<string, RegionNode[]>,
  key: string,
  region: RegionNode,
): void {
  const normalized = normalizeRegionName(key)
  if (normalized.length === 0) return
  const matches = lookup.get(normalized)
  if (matches) {
    if (!matches.some(item => item.regionId === region.regionId)) matches.push(region)
  } else {
    lookup.set(normalized, [region])
  }
}

function resolveUnique(
  lookup: ReadonlyMap<string, RegionNode[]>,
  query: string,
): RegionNode | undefined {
  const matches = lookup.get(normalizeRegionName(query)) ?? []
  if (matches.length > 1) throw new AmbiguousRegionNameError(query, matches)
  return matches[0]
}

export interface RegionIndex {
  resolve(query: string): RegionNode | undefined
  resolveComponent(componentPath: string): RegionNode | undefined
  resolveSelector(selector: string): RegionNode | undefined
}

export function createRegionIndex(regions: readonly RegionNode[]): RegionIndex {
  const names = new Map<string, RegionNode[]>()
  const components = new Map<string, RegionNode[]>()
  const selectors = new Map<string, RegionNode[]>()

  for (const region of regions) {
    addLookup(names, region.regionId, region)
    addLookup(names, region.displayName, region)
    for (const alias of region.aliases) addLookup(names, alias, region)
    if (region.componentPath) addLookup(components, region.componentPath, region)
    if (region.selector) addLookup(selectors, region.selector, region)
  }

  return {
    resolve: query => resolveUnique(names, query),
    resolveComponent: componentPath => resolveUnique(components, componentPath),
    resolveSelector: selector => resolveUnique(selectors, selector),
  }
}

export function mergeRegionSuggestion(
  current: RegionNode,
  incoming: RegionNodeInput,
): RegionNode {
  return applyRegionSuggestion(current, incoming)
}
