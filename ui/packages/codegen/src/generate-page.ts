import { VisualIRSchema, isSafeProjectRelativePath } from '@ui-rebuild/contracts'
import type { RegionNode, VisualIRInput } from '@ui-rebuild/contracts'
import { writeAssetRegistry } from './asset-registry.js'
import { assertHealthyGeneratedFiles } from './component-policy.js'
import { renderRegionContent } from './content-renderer.js'
import { logicalPxToRpx, writeTokens } from './token-writer.js'

export interface GenerateOptions { logicalWidth: number }

const pascal = (value: string) => {
  const result = value.split('-').map(part => part[0]!.toUpperCase() + part.slice(1)).join('')
  if (!/^[A-Z][A-Za-z0-9]*$/u.test(result)) throw new Error(`Unsafe component name: ${value}`)
  return result
}
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
function safePath(value: string) { return isSafeProjectRelativePath(value) && /^src\/components\/[a-zA-Z0-9_./-]+\.vue$/u.test(value) }
function relative(from: string, to: string) {
  const source = from.split('/').slice(0, -1)
  const target = to.split('/')
  while (source.length > 0 && target.length > 0 && source[0] === target[0]) { source.shift(); target.shift() }
  const result = `${'../'.repeat(source.length)}${target.join('/').replace(/\.vue$/u, '')}`
  return result.startsWith('.') ? result : `./${result}`
}

function component(
  region: RegionNode,
  current: string,
  width: number,
  assetBindings: ReadonlyMap<string, string>,
  tokens: Parameters<typeof renderRegionContent>[0]['tokens'],
) {
  const rendered = renderRegionContent({ region, logicalWidth: width, assetBindings, tokens })
  const imports = rendered.usesAssets
    ? `import { assets } from '${relative(current, 'src/assets/registry.ts').replace(/\.ts$/u, '')}'`
    : ''
  return `<script setup lang="ts">\n${imports}\n</script>\n<template><view class="semantic-region" data-region-id="${region.regionId}" aria-label="${escape(region.displayName)}">\n${rendered.markup}\n</view></template>\n<style scoped lang="scss">.semantic-region{position:absolute;box-sizing:border-box;left:${logicalPxToRpx(region.bounds.x, width)};top:${logicalPxToRpx(region.bounds.y, width)};width:${logicalPxToRpx(region.bounds.width, width)};height:${logicalPxToRpx(region.bounds.height, width)};background:transparent}\n${rendered.styles}</style>\n`
}

export function generatePage(input: VisualIRInput, options: GenerateOptions): Record<string, string> {
  const ir = VisualIRSchema.parse(input)
  if (!/^[a-z][a-z0-9-]*$/u.test(ir.pageId)) throw new Error(`Unsafe pageId: ${ir.pageId}`)
  const files: Record<string, string> = {}
  const paths = new Map<string, string>()
  const names = new Set<string>()
  const componentPaths = new Set<string>()
  const assetRegistry = writeAssetRegistry(ir.assets)

  for (const region of ir.regions) {
    const name = pascal(region.regionId)
    if (names.has(name)) throw new Error(`Component name collision: ${name}`)
    names.add(name)
    const componentPath = (region.componentPath ?? `src/components/${ir.pageId}/${name}.vue`).replaceAll('\\', '/')
    if (!safePath(componentPath)) throw new Error(`Unsafe componentPath: ${componentPath}`)
    if (componentPaths.has(componentPath)) throw new Error(`Duplicate componentPath: ${componentPath}`)
    componentPaths.add(componentPath)
    paths.set(region.regionId, componentPath)
  }

  for (const region of ir.regions) {
    const componentPath = paths.get(region.regionId)!
    files[componentPath] = component(
      region,
      componentPath,
      options.logicalWidth,
      assetRegistry.bindings,
      ir.tokens,
    )
  }

  const page = `src/pages/${ir.pageId}/index.vue`
  const imports = ir.regions.map(region => `import ${pascal(region.regionId)} from '${relative(page, paths.get(region.regionId)!)}'`).join('\n')
  const tags = ir.regions.map(region => `    <${pascal(region.regionId)} />`).join('\n')
  files[page] = `<script setup lang="ts">\n${imports}\n</script>\n<template><view class="page-${ir.pageId}">\n${tags}\n</view></template>\n<style scoped lang="scss">.page-${ir.pageId}{position:relative;width:100vw;min-height:100vh;overflow:hidden;background:var(--ui-color-page)}</style>\n`
  files['src/pages.json'] = `${JSON.stringify({ pages: [{ path: `pages/${ir.pageId}/index`, style: { navigationStyle: 'custom' } }], globalStyle: { backgroundColor: '#f5f6f8' } }, null, 2)}\n`
  files['src/styles/tokens.scss'] = writeTokens(ir.tokens, options.logicalWidth)
  files['src/assets/registry.ts'] = assetRegistry.source
  assertHealthyGeneratedFiles(files)
  return files
}
