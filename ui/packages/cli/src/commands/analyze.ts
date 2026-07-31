import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { VisualIRSchema } from '@ui-rebuild/contracts'
import type { Bounds, Manifest, VisualIR } from '@ui-rebuild/contracts'
import { loadManifest, modelAdapter, modelImageBuffer } from '../runtime.js'
import { normalizeReferenceImage } from '../reference-image.js'

function componentName(regionId: string) {
  return regionId.split('-').map(part => part[0]!.toUpperCase() + part.slice(1)).join('')
}

export function buildAnalysisPrompt(
  manifest: Manifest,
  overrides: Record<string, { displayName?: string; aliases?: string[] }>,
): string {
  return `Analyze these UI states into Visual IR version 1.0.0. projectId=${manifest.projectId}, pageId=${manifest.pageId}, logical canvas=${manifest.device.width}x${manifest.device.height}. Build maintainable semantic regions with stable kebab-case regionId and Design Tokens. Extract exact visible text including Chinese, currency symbols, numbers, dates, and punctuation. Represent every visible fact as ordered text, asset, control, or decoration content nodes. Do not use region displayName as visible text. Every non-decorative leaf region must have visible content. Use page-level logical-pixel bounds for regions and content nodes. Screenshots are already content-only: never create regions, assets, or content nodes for captured system status bars, browser address bars or toolbars, Home Indicators, or other device chrome. Typography tokens may contain only fontFamily, fontSize, fontWeight, and lineHeight; do not add textDecoration or other fields. Create referenced asset definitions under src/assets for avatars, icons, backgrounds, and product images. Include confidence-rated interactions whose triggerNodeId references a control node. Human region overrides: ${JSON.stringify(overrides)}. States: ${JSON.stringify(manifest.states.map(state => ({ id: state.id, screenshot: state.screenshot })))}`
}

export function clampRegionBounds(bounds: Bounds, width: number, height: number): Bounds {
  const right = bounds.x + bounds.width
  const bottom = bounds.y + bounds.height
  if (right <= 0 || bottom <= 0 || bounds.x >= width || bounds.y >= height) {
    throw new Error(`Bounds are outside canvas: ${JSON.stringify(bounds)}`)
  }
  const x = Math.max(bounds.x, 0)
  const y = Math.max(bounds.y, 0)
  const clippedWidth = Math.min(right, width) - x
  const clippedHeight = Math.min(bottom, height) - y
  const visibleRatio = clippedWidth * clippedHeight / (bounds.width * bounds.height)
  if (visibleRatio < 0.5) throw new Error(`Bounds exceeds canvas: ${JSON.stringify(bounds)}`)
  return { x, y, width: clippedWidth, height: clippedHeight }
}

async function existingBindings(root: string) {
  try {
    const existing = VisualIRSchema.parse(JSON.parse(await readFile(path.join(root, 'visual-ir.json'), 'utf8')))
    return new Map(existing.regions.map(region => [region.regionId, region.componentPath]))
  } catch {
    return new Map<string, string | undefined>()
  }
}

export async function analyzePage(root: string) {
  const manifest = await loadManifest(root)
  const overrides = JSON.parse(await readFile(path.join(root, 'region-overrides.json'), 'utf8')) as Record<string, { displayName?: string; aliases?: string[] }>
  const previousPaths = await existingBindings(root)
  const screenshots = await Promise.all(manifest.states.map(async state => {
    const source = await readFile(path.join(root, state.screenshot))
    const normalized = await normalizeReferenceImage(source, manifest, state)
    return modelImageBuffer(normalized, state.screenshot)
  }))
  const model = modelAdapter()
  await model.probe(screenshots[0]!)
  const analyzed = await model.analyzeScreens({
    screenshots,
    prompt: buildAnalysisPrompt(manifest, overrides),
  })
  const regions = analyzed.regions.map(region => {
    const normalized: VisualIR['regions'][number] = {
      ...region,
      bounds: clampRegionBounds(region.bounds, manifest.device.width, manifest.device.height),
      content: region.content.map(node => ({
        ...node,
        bounds: clampRegionBounds(node.bounds, manifest.device.width, manifest.device.height),
      })),
      componentPath: previousPaths.get(region.regionId) ?? `src/components/${manifest.pageId}/${componentName(region.regionId)}.vue`,
    }
    const override = overrides[region.regionId]
    return override ? {
      ...normalized,
      displayName: override.displayName ?? region.displayName,
      aliases: override.aliases ?? region.aliases,
      source: 'human' as const,
      confidence: 1,
      lockedByHuman: true,
    } : normalized
  })
  const componentPaths = regions.map(region => region.componentPath)
  if (new Set(componentPaths).size !== componentPaths.length) throw new Error('Region componentPath values must be unique')
  const merged = VisualIRSchema.parse({
    ...analyzed,
    version: '1.0.0',
    projectId: manifest.projectId,
    pageId: manifest.pageId,
    coordinateSpace: 'logical-px',
    states: manifest.states.map(state => ({ id: state.id, screenshot: state.screenshot })),
    regions,
  })
  const outputPath = path.join(root, 'visual-ir.json')
  const temporaryPath = `${outputPath}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(merged, null, 2)}\n`)
    await rename(temporaryPath, outputPath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
  return merged
}
