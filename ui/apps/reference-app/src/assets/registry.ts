export const assets = {
  iconBack: new URL('./icon-back.png', import.meta.url).href,
  avatarDesignerMx: new URL('./avatar-designer-mx.png', import.meta.url).href,
  backgroundPlanGold: new URL('./background-plan-gold.png', import.meta.url).href,
  iconCloudMember: new URL('./icon-cloud-member.png', import.meta.url).href,
  iconPlatinumMember: new URL('./icon-platinum-member.png', import.meta.url).href,
  iconCheck: new URL('./icon-check.png', import.meta.url).href,
} as const

export type AssetKey = keyof typeof assets
