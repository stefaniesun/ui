import type { VisualAsset } from '@ui-rebuild/contracts'

export function assetBindingName(assetId: string): string {
  const binding = assetId.replace(/-([a-z0-9])/gu, (_, character: string) => character.toUpperCase())
  if (!/^[a-z][A-Za-z0-9]*$/u.test(binding)) throw new Error(`Unsafe asset: ${assetId}`)
  return binding
}

export interface AssetRegistryOutput {
  source: string
  bindings: ReadonlyMap<string, string>
}

export function writeAssetRegistry(assets: readonly VisualAsset[]): AssetRegistryOutput {
  const bindings = new Map<string, string>()
  const usedBindings = new Set<string>()
  const entries = assets.map(asset => {
    const binding = assetBindingName(asset.assetId)
    if (usedBindings.has(binding)) throw new Error(`Asset binding collision: ${binding}`)
    usedBindings.add(binding)
    bindings.set(asset.assetId, binding)
    const relativePath = `./${asset.source.slice('src/assets/'.length)}`
    return `  ${binding}: new URL('${relativePath}', import.meta.url).href,`
  })
  return {
    bindings,
    source: `export const assets = {\n${entries.join('\n')}\n} as const\n\nexport type AssetKey = keyof typeof assets\n`,
  }
}
