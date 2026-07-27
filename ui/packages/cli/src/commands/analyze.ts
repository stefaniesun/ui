import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { VisualIRSchema } from '@ui-rebuild/contracts'
import type { VisualIR } from '@ui-rebuild/contracts'
import { loadManifest, modelAdapter, modelImage } from '../runtime.js'

function componentName(regionId: string) {
  return regionId.split('-').map(part => part[0]!.toUpperCase() + part.slice(1)).join('')
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
  const screenshots = await Promise.all(manifest.states.map(state => modelImage(path.join(root, state.screenshot))))
  const model = modelAdapter()
  await model.probe(screenshots[0]!)
  const analyzed = await model.analyzeScreens({
    screenshots,
    prompt: `Analyze these UI states into Visual IR version 1.0.0. projectId=${manifest.projectId}, pageId=${manifest.pageId}, logical canvas=${manifest.device.width}x${manifest.device.height}. Build maintainable semantic regions with stable kebab-case regionId, bounds in logical pixels, Design Tokens, replaceable asset slots, and confidence-rated interactions. Human region overrides: ${JSON.stringify(overrides)}. States: ${JSON.stringify(manifest.states.map(state => ({ id: state.id, screenshot: state.screenshot })))}`,
  })
  const regions = analyzed.regions.map(region => {
    const normalized: VisualIR['regions'][number] = {
      ...region,
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
  await writeFile(path.join(root, 'visual-ir.json'), JSON.stringify(merged, null, 2))
  return merged
}
