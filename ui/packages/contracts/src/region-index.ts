import { applyRegionSuggestion } from './visual-ir.js'
import type { RegionNode, RegionNodeInput } from './visual-ir.js'

export type RegionReferenceKind = 'name' | 'componentPath' | 'selector'

export class AmbiguousRegionReferenceError extends Error {
  readonly kind: RegionReferenceKind
  readonly query: string
  readonly regionIds: string[]

  constructor(kind: RegionReferenceKind, query: string, regions: RegionNode[]) {
    super(`Ambiguous region ${kind} "${query}": ${regions.map(item => item.regionId).join(', ')}`)
    this.name = 'AmbiguousRegionReferenceError'
    this.kind = kind
    this.query = query
    this.regionIds = regions.map(item => item.regionId)
  }
}

export class DuplicateRegionIdError extends Error {
  readonly regionId: string

  constructor(regionId: string) {
    super(`Duplicate regionId: ${regionId}`)
    this.name = 'DuplicateRegionIdError'
    this.regionId = regionId
  }
}

export function normalizeRegionName(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN').replaceAll(/\s+/gu, '')
}

function normalizeComponentPath(value: string): string {
  return value.trim().replaceAll(/[\\/]+/g, '/')
}

function addLookup(
  lookup: Map<string, RegionNode[]>,
  key: string,
  region: RegionNode,
): void {
  if (key.length === 0) return
  const matches = lookup.get(key)
  if (matches) {
    if (!matches.some(item => item.regionId === region.regionId)) matches.push(region)
  } else {
    lookup.set(key, [region])
  }
}

function resolveUnique(
  kind: RegionReferenceKind,
  lookup: ReadonlyMap<string, RegionNode[]>,
  key: string,
  query: string,
): RegionNode | undefined {
  const matches = lookup.get(key) ?? []
  if (matches.length > 1) throw new AmbiguousRegionReferenceError(kind, query, matches)
  return matches[0]
}

export interface RegionIndex {
  resolve(query: string): RegionNode | undefined
  resolveComponent(componentPath: string): RegionNode | undefined
  resolveSelector(selector: string): RegionNode | undefined
}

export function createRegionIndex(regions: readonly RegionNode[]): RegionIndex {
  const regionIds = new Set<string>()
  const names = new Map<string, RegionNode[]>()
  const components = new Map<string, RegionNode[]>()
  const selectors = new Map<string, RegionNode[]>()

  for (const region of regions) {
    if (regionIds.has(region.regionId)) throw new DuplicateRegionIdError(region.regionId)
    regionIds.add(region.regionId)

    addLookup(names, normalizeRegionName(region.regionId), region)
    addLookup(names, normalizeRegionName(region.displayName), region)
    for (const alias of region.aliases) addLookup(names, normalizeRegionName(alias), region)
    if (region.componentPath) {
      addLookup(components, normalizeComponentPath(region.componentPath), region)
    }
    if (region.selector) addLookup(selectors, region.selector, region)
  }

  return {
    resolve: query => resolveUnique('name', names, normalizeRegionName(query), query),
    resolveComponent: componentPath => resolveUnique(
      'componentPath',
      components,
      normalizeComponentPath(componentPath),
      componentPath,
    ),
    resolveSelector: selector => resolveUnique('selector', selectors, selector, selector),
  }
}

export function mergeRegionSuggestion(
  current: RegionNode,
  incoming: RegionNodeInput,
): RegionNode {
  if (incoming.regionId !== current.regionId) {
    throw new Error(`Region suggestion regionId mismatch: ${current.regionId} !== ${incoming.regionId}`)
  }

  if (current.lockedByHuman) {
    return applyRegionSuggestion(current, {
      ...incoming,
      source: 'human',
      lockedByHuman: true,
      displayName: current.displayName,
      aliases: current.aliases,
    })
  }
  return applyRegionSuggestion(current, incoming)
}
