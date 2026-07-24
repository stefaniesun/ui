import { VisualIRSchema } from '@ui-rebuild/contracts'
import type { VisualIRInput } from '@ui-rebuild/contracts'
import { writeAssetRegistry } from './asset-registry.js'
import { assertHealthyGeneratedFiles } from './component-policy.js'
import { writeTokens } from './token-writer.js'

function pascalCase(value: string): string {
  return value.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')
}

function component(regionId: string, displayName: string): string {
  return `<script setup lang="ts">
import { assetRegistry } from '../../assets/registry'

const items = [
  { id: 'refuel', label: '特惠加油', asset: assetRegistry['service.refuel'] },
  { id: 'more', label: '更多服务', asset: assetRegistry['icon.notice'] },
] as const
</script>

<template>
  <section class="region-card" data-region-id="${regionId}" aria-label="${displayName}">
    <view v-for="item in items" :key="item.id" class="region-card__item">
      <image :src="item.asset" class="region-card__icon" mode="aspectFit" />
      <text>{{ item.label }}</text>
    </view>
  </section>
</template>

<style scoped lang="scss">
.region-card { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--ui-space-page); background: var(--ui-color-surface); }
.region-card__item { display: flex; flex-direction: column; align-items: center; }
.region-card__icon { width: 40px; height: 40px; }
</style>
`
}

export function generatePage(input: VisualIRInput): Record<string, string> {
  const ir = VisualIRSchema.parse(input)
  const files: Record<string, string> = {}
  const imports: string[] = []
  const tags: string[] = []
  for (const region of ir.regions.filter(item => item.parentId === null)) {
    const name = pascalCase(region.regionId)
    const path = region.componentPath ?? `src/components/${ir.pageId}/${name}.vue`
    imports.push(`import ${name} from '../../components/${ir.pageId}/${name}.vue'`)
    tags.push(`    <${name} data-region-id="${region.regionId}" />`)
    files[path] = component(region.regionId, region.displayName)
  }
  files[`src/pages/${ir.pageId}/index.vue`] = `<script setup lang="ts">
${imports.join('\n')}
</script>

<template>
  <main class="page-${ir.pageId}">
${tags.join('\n')}
  </main>
</template>

<style scoped lang="scss">
.page-${ir.pageId} { min-height: 100vh; padding: var(--ui-space-page); background: #f5f6f8; }
</style>
`
  files['src/styles/tokens.scss'] = writeTokens(ir.tokens)
  files['src/assets/registry.ts'] = writeAssetRegistry()
  assertHealthyGeneratedFiles(files)
  return files
}
