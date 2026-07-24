import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { scorePage } from './score.js'

async function card(left: number, color = '#ffcc00') {
  return sharp({ create: { width: 64, height: 64, channels: 4, background: '#ffffff' } })
    .composite([{ input: { create: { width: 24, height: 20, channels: 4, background: color } }, left, top: 20 }])
    .png().toBuffer()
}

describe('scorePage', () => {
  it('weights critical regions and reports geometry errors', async () => {
    const result = await scorePage(await card(8), await card(12), {
      width: 64,
      height: 64,
      regions: [{
        regionId: 'account-summary',
        referenceBounds: { x: 8, y: 20, width: 24, height: 20 },
        actualBounds: { x: 12, y: 20, width: 24, height: 20 },
        critical: true,
      }],
      masks: [],
      weights: { geometry: 0.30, visual: 0.30, color: 0.15, content: 0.25 },
    })
    expect(result.regions[0]?.regionId).toBe('account-summary')
    expect(result.regions[0]?.geometry.meanAbsoluteErrorPx).toBeGreaterThan(0)
    expect(result.total).toBeGreaterThanOrEqual(0)
    expect(result.total).toBeLessThanOrEqual(1)
  })

  it('renormalizes weights when OCR is unavailable', async () => {
    const result = await scorePage(await card(8), await card(8), {
      width: 64, height: 64,
      regions: [{
        regionId: 'card',
        referenceBounds: { x: 8, y: 20, width: 24, height: 20 },
        actualBounds: { x: 8, y: 20, width: 24, height: 20 },
        critical: false,
      }],
      masks: [],
      weights: { geometry: 0.30, visual: 0.30, color: 0.15, content: 0.25 },
    })
    expect(result.regions[0]?.content.ocrMatch).toBeNull()
    expect(result.total).toBe(1)
  })
})
