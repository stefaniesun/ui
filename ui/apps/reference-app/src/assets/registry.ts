export const assets = {
  siteMark: new URL('./site-mark.png', import.meta.url).href,
  cellularIndicator: new URL('./cellular-indicator.png', import.meta.url).href,
  wifiIndicator: new URL('./wifi-indicator.png', import.meta.url).href,
  batteryIndicator: new URL('./battery-indicator.png', import.meta.url).href,
  backArrow: new URL('./back-arrow.png', import.meta.url).href,
  designerAvatar: new URL('./designer-avatar.png', import.meta.url).href,
  cloudMemberBadge: new URL('./cloud-member-badge.png', import.meta.url).href,
  platinumMemberDiamond: new URL('./platinum-member-diamond.png', import.meta.url).href,
  benefitCheckmark: new URL('./benefit-checkmark.png', import.meta.url).href,
} as const

export type AssetKey = keyof typeof assets
