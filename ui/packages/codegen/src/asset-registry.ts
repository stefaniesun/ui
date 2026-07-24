export function writeAssetRegistry(): string {
  return `export const assetRegistry = {
  'icon.notice': '/static/icons/notice.svg',
  'service.refuel': '/static/services/refuel.png',
  'tab.home': '/static/tabs/home.svg',
} as const

export type AssetKey = keyof typeof assetRegistry
`
}
