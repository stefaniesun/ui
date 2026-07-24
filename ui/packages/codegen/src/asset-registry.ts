export interface AssetDefinition { key:string; path:string }
function safe(value:string){return /^\/(?:static\/[a-z0-9_./-]+)$/iu.test(value)&&!value.includes('..')}
export function writeAssetRegistry(assets:readonly AssetDefinition[]):string{
 const entries=assets.map(asset=>{if(!/^[a-z][a-z0-9.-]*$/u.test(asset.key)||!safe(asset.path))throw new Error(`Unsafe asset: ${asset.key}`);return `  '${asset.key}': '${asset.path}',`})
 return `export const assetRegistry = {\n${entries.join('\n')}\n} as const\n\nexport type AssetKey = keyof typeof assetRegistry\n`
}
