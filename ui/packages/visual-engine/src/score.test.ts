import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { freezeReference } from './reference.js'
import { scoreAgainstFrozenReference, scorePage, TextExtractionGateError } from './score.js'
import type { TextExtractionCache } from './text-cache.js'

async function card(left: number, color = '#ffcc00', scale = 1) {
  return sharp({ create: { width: 64 * scale, height: 64 * scale, channels: 4, background: '#ffffff' } })
    .composite([{ input: { create: { width: 24 * scale, height: 20 * scale, channels: 4, background: color } }, left: left * scale, top: 20 * scale }])
    .png().toBuffer()
}

const normalization = {
  logicalWidth: 64,
  logicalHeight: 64,
  sourceScale: 1,
  systemBarPolicy: { mode: 'none' as const },
}
const emptyExtractor = {
  identity: { provider: 'model' as const, model: 'test-model', schemaVersion: '1.0.0', promptVersion: '1.0.0' },
  extract: vi.fn().mockResolvedValue([]),
}

const weights = {
  geometry: 0.25,
  visual: 0.25,
  color: 0.10,
  content: 0.15,
  consistency: 0.15,
  state: 0.10,
}

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
      textExtractor: emptyExtractor,
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
      textExtractor: emptyExtractor,
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
      regions: [region], weights, textExtractor: emptyExtractor,
    })).rejects.toThrow(/canvas|dimensions/i)
    await expect(scorePage(await card(8), await card(8), {
      reference: normalization, actual: normalization,
      regions: [], weights, textExtractor: emptyExtractor,
    })).rejects.toThrow(/region/i)
    await expect(scorePage(await card(8), await card(8), {
      reference: normalization, actual: normalization,
      regions: [region], weights: { ...weights, geometry: Number.NaN }, textExtractor: emptyExtractor,
    })).rejects.toThrow(/weights/i)
  })

  it('excludes a fully masked visual region while retaining text scoring', async () => {
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
      textExtractor: emptyExtractor,
    })
    expect(result.regions[0]?.visual.score).toBeNull()
    expect(result.regions[0]?.color.score).toBeNull()
    expect(result.regions[0]?.content.total).toBe(1)
    expect(result.total).toBe(1)
  })

  it('freezes reference text, reuses the baseline, and caches actual extraction', async () => {
    const extracted = [{
      text: 'Total', bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 },
      fontSize: null, color: null, confidence: 0.9,
    }]
    const extractor = {
      ...emptyExtractor,
      extract: vi.fn().mockResolvedValue(extracted),
    }
    const entries = new Map<string, typeof extracted>()
    const cache: TextExtractionCache = {
      get: vi.fn(async key => entries.get(JSON.stringify(key)) ?? null),
      set: vi.fn(async (key, items) => { entries.set(JSON.stringify(key), [...items] as typeof extracted) }),
    }
    const region = { regionId: 'card', bounds: { x: 8, y: 20, width: 24, height: 20 } }
    const frozen = await freezeReference(await card(8), normalization, [region], { textExtractor: extractor, textCache: cache })
    const baseline = frozen.regions.get('card')!.textBaseline.items
    const options = {
      actual: normalization,
      regions: [{ regionId: 'card', actualBounds: region.bounds, critical: false }],
      weights,
      textExtractor: extractor,
      textCache: cache,
    }
    await scoreAgainstFrozenReference(frozen, await card(8), options)
    await scoreAgainstFrozenReference(frozen, await card(8), options)
    expect(frozen.regions.get('card')!.textBaseline.items).toBe(baseline)
    expect(baseline).toEqual(extracted)
    expect(extractor.extract).toHaveBeenCalledTimes(1)
  })

  it('fails closed when an actual region cannot be extracted', async () => {
    const frozen = await freezeReference(await card(8), normalization, [{
      regionId: 'card', bounds: { x: 8, y: 20, width: 24, height: 20 },
    }], { textExtractor: emptyExtractor })
    const failing = { ...emptyExtractor, extract: vi.fn().mockRejectedValue(Object.assign(new Error('secret'), { kind: 'timeout' })) }
    await expect(scoreAgainstFrozenReference(frozen, await card(8), {
      actual: normalization,
      regions: [{ regionId: 'card', actualBounds: { x: 8, y: 20, width: 24, height: 20 }, critical: false }],
      weights,
      textExtractor: failing,
    })).rejects.toMatchObject({
      name: 'TextExtractionGateError',
      failure: {
        code: 'text-extraction-failed',
        reason: 'timeout',
        regionId: 'card',
        stage: 'actual',
        message: 'Unable to extract structured text from the rendered region',
      },
    } satisfies Partial<TextExtractionGateError>)
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
      textExtractor: emptyExtractor,
      criticalMultiplier: 2,
    })
    expect(result.total).toBeLessThan((result.regions[0]!.total + result.regions[1]!.total) / 2)
  })
})
