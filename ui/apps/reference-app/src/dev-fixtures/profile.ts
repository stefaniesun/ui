export const profileFixtures = {
  default: {
    account: { title: '立即登录', subtitle: '点击登录，精彩永不丢失' },
    services: [
      { id: 'refuel', label: '特惠加油', asset: 'service.refuel' },
      { id: 'more', label: '更多服务', asset: 'icon.notice' },
    ],
  },
} as const

export type ProfileFixtureName = keyof typeof profileFixtures
