import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { clipBoundsToCanvas, cropRegions } from './regions.js'
import { createHeatmap } from './heatmap.js'
import { normalizeImage } from './image.js'

async function image(color: string) {
  return sharp({ create: { width: 16, height: 16, channels: 4, background: color } })
    .png().toBuffer()
}

describe('visual artifacts', () => {
  it('clips partially visible bounds to the logical canvas', () => {
    expect(clipBoundsToCanvas({ x: 0, y: 500, width: 390, height: 500 }, 390, 844, 'member-page'))
      .toEqual({ x: 0, y: 500, width: 390, height: 344 })
  })

  it('normalizes a high-density reference with its declared source scale', async () => {
    const source = await sharp({
      create: { width: 6, height: 6, channels: 4, background: '#fff' },
    }).png().toBuffer()
    const normalized = await normalizeImage(source, {
      logicalWidth: 2,
      logicalHeight: 2,
      sourceScale: 3,
      systemBarPolicy: { mode: 'none' },
    })
    expect(normalized).toMatchObject({ width: 2, height: 2 })
  })

  it('crops named regions in logical pixels', async () => {
    const crops = await cropRegions(await image('#ff0000'), [{
      regionId: 'header', bounds: { x: 2, y: 3, width: 8, height: 6 },
    }])
    const metadata = await sharp(crops.get('header')).metadata()
    expect(metadata).toMatchObject({ width: 8, height: 6 })
  })

  it('creates a transparent-to-red difference heatmap and honors masks', async () => {
    const reference = await image('#ffffff')
    const actual = await image('#000000')
    const heatmap = await createHeatmap(reference, actual, 16, 16, [
      { x: 0, y: 0, width: 8, height: 16 },
    ])
    const { data } = await sharp(heatmap).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(data[3]).toBe(0)
    expect(data[(8 * 4) + 3]).toBeGreaterThan(0)
  })
})
