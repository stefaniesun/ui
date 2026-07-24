import { VisualIRSchema, isSafeProjectRelativePath } from '@ui-rebuild/contracts'
import type { RegionNode, VisualIRInput } from '@ui-rebuild/contracts'
import { writeAssetRegistry } from './asset-registry.js'
import { assertHealthyGeneratedFiles } from './component-policy.js'
import { writeTokens } from './token-writer.js'

function pascalCase(value: string): string {
  const result = value.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')
  if (!/^[A-Z][A-Za-z0-9]*$/u.test(result)) throw new Error(`Unsafe component name: ${value}`)
  return result
}
function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}
function componentPath(region: RegionNode, pageId: string, name: string): string {
  const value = region.componentPath ?? `src/components/${pageId}/${name}.vue`
  if (!isSafeProjectRelativePath(value) || !value.startsWith('src/components/') || !value.endsWith('.vue')) {
    throw new Error(`Unsafe componentPath: ${value}`)
  }
  return value.replaceAll('\\', '/')
}
function component(region: RegionNode, children: RegionNode[]): string {
  const childMarkup = children.map(child => (
    `    <view class="region-card__child" data-region-id="${child.regionId}" aria-label="${escapeHtml(child.displayName)}" />`
  )).join('\n')
  return `<script setup lang="ts">
import { assetRegistry } from '../../assets/registry'

const items = [
  { id: 'refuel', label: '特惠加油', asset: assetRegistry['service.refuel'] },
  { id: 'more', label: '更多服务', asset: assetRegistry['icon.notice'] },
] as const
</script>

<template>
  <view class="region-card" data-region-id="${region.regionId}" aria-label="${escapeHtml(region.displayName)}">
    <view v-for="item in items" :key="item.id" class="region-card__item">
      <image :src="item.asset" class="region-card__icon" mode="aspectFit" />
      <text>{{ item.label }}</text>
    </view>
${childMarkup}
  </view>
</template>

<style scoped lang="scss">
.region-card { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--ui-space-page); background: var(--ui-color-surface); }
.region-card__item { display: flex; flex-direction: column; align-items: center; }
.region-card__icon { width: 80rpx; height: 80rpx; }
.region-card__child { min-height: 2rpx; }
</style>
`
}

export function generatePage(input: VisualIRInput): Record<string, string> {
  const ir = VisualIRSchema.parse(input)
  const files: Record<string, string> = {}
  const imports: string[] = []
  const tags: string[] = []
  const roots = ir.regions.filter(region => region.parentId === null)
  const names = new Set<string>()
  for (const region of roots) {
    const name = pascalCase(region.regionId)
    if (names.has(name)) throw new Error(`Component name collision: ${name}`)
    names.add(name)
    const path = componentPath(region, ir.pageId, name)
    const importPath = `../../${path.slice('src/'.length).replace(/\.vue$/u, '')}`
    imports.push(`import ${name} from '${importPath}'`)
    tags.push(`    <${name} data-region-id="${region.regionId}" />`)
    files[path] = component(region, ir.regions.filter(child => child.parentId === region.regionId))
  }
  files[`src/pages/${ir.pageId}/index.vue`] = `<script setup lang="ts">
${imports.join('\n')}
</script>

<template>
  <view class="page-${ir.pageId}">
${tags.join('\n')}
  </view>
</template>

<style scoped lang="scss">
.page-${ir.pageId} { min-height: 100vh; padding: var(--ui-space-page); background: var(--ui-color-page); }
</style>
`
  files['src/styles/tokens.scss'] = writeTokens(ir.tokens)
  files['src/assets/registry.ts'] = writeAssetRegistry()
  assertHealthyGeneratedFiles(files)
  return files
}
