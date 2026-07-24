import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { scorePage } from './score.js'

async function card(left: number, color = '#ffcc00', scale = 1) {
  return sharp({ create: { width: 64 * scale, height: 64 * scale, channels: 4, background: '#ffffff' } })
    .composite([{ input: { create: { width: 24 * scale, height: 20 * scale, channels: 4, background: color } }, left: left * scale, top: 20 * scale }])
    .png().toBuffer()
}

const normalization = { logicalWidth: 64, logicalHeight: 64, sourceScale: 1 }
const weights = { geometry: 0.30, visual: 0.30, color: 0.15, content: 0.25 }

describe('scorePage', () => {
  it('aligns semantic content separately from geometry', async () => {
    const result = await scorePage(await card(8), await card(12), {
      reference: normalization,
      actual: normalization,
      regions: [{
        regionId: 'account-summary',
        referenceBounds: { x: 8, y: 20, width: 24, height: 20 },
        actualBounds: { x: 12, y: 20, width: 24, height: 20 },
        critical: true,
      }],
      weights,
    })
    expect(result.regions[0]?.geometry.meanAbsoluteErrorPx).toBe(1)
    expect(result.regions[0]?.visual.score).toBe(1)
    expect(result.regions[0]?.color.score).toBe(1)
  })

  it('normalizes an explicit 2x reference without arbitrary stretching', async () => {
    const result = await scorePage(await card(8, '#ffcc00', 2), await card(8), {
      reference: { ...normalization, sourceScale: 2 },
      actual: normalization,
      regions: [{
        regionId: 'card',
        referenceBounds: { x: 8, y: 20, width: 24, height: 20 },
        actualBounds: { x: 8, y: 20, width: 24, height: 20 },
        critical: false,
      }],
      weights,
    })
    expect(result.total).toBeGreaterThan(0.99)
  })

  it('rejects mismatched dimensions, empty regions, and invalid weights', async () => {
    const region = {
      regionId: 'card',
      referenceBounds: { x: 8, y: 20, width: 24, height: 20 },
      actualBounds: { x: 8, y: 20, width: 24, height: 20 },
      critical: false,
    }
    await expect(scorePage(await card(8), await card(8), {
      reference: { ...normalization, logicalWidth: 63 }, actual: normalization,
      regions: [region], weights,
    })).rejects.toThrow(/canvas|dimensions/i)
    await expect(scorePage(await card(8), await card(8), {
      reference: normalization, actual: normalization,
      regions: [], weights,
    })).rejects.toThrow(/region/i)
    await expect(scorePage(await card(8), await card(8), {
      reference: normalization, actual: normalization,
      regions: [region], weights: { ...weights, geometry: Number.NaN },
    })).rejects.toThrow(/weights/i)
  })

  it('excludes a fully masked visual region and validates OCR output', async () => {
    const ocr = { compare: vi.fn().mockResolvedValue(0.98) }
    const result = await scorePage(await card(8), await card(8, '#000000'), {
      reference: normalization, actual: normalization,
      regions: [{
        regionId: 'card',
        referenceBounds: { x: 8, y: 20, width: 24, height: 20 },
        actualBounds: { x: 8, y: 20, width: 24, height: 20 },
        masks: [{ x: 0, y: 0, width: 24, height: 20 }],
        critical: false,
      }],
      weights,
      ocr,
    })
    expect(result.regions[0]?.visual.score).toBeNull()
    expect(result.regions[0]?.color.score).toBeNull()
    expect(ocr.compare).not.toHaveBeenCalled()
    expect(result.total).toBe(1)
  })

  it('weights critical regions in the page total', async () => {
    const result = await scorePage(await card(8), await card(8), {
      reference: normalization, actual: normalization,
      regions: [
        {
          regionId: 'critical', referenceBounds: { x: 8, y: 20, width: 24, height: 20 },
          actualBounds: { x: 16, y: 20, width: 24, height: 20 }, critical: true,
        },
        {
          regionId: 'normal', referenceBounds: { x: 8, y: 20, width: 24, height: 20 },
          actualBounds: { x: 8, y: 20, width: 24, height: 20 }, critical: false,
        },
      ],
      weights,
      criticalMultiplier: 2,
    })
    expect(result.total).toBeLessThan((result.regions[0]!.total + result.regions[1]!.total) / 2)
  })
})
