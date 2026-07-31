import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { createHeatmap } from './heatmap.js'

describe('createHeatmap', () => {
  it('accepts a high-density reference source scale', async () => {
    const reference = await sharp({
      create: { width: 6, height: 6, channels: 4, background: '#fff' },
    }).png().toBuffer()
    const actual = await sharp({
      create: { width: 2, height: 2, channels: 4, background: '#fff' },
    }).png().toBuffer()
    const output = await createHeatmap(reference, actual, 2, 2, [], 3)
    await expect(sharp(output).metadata()).resolves.toMatchObject({ width: 2, height: 2 })
  })
})
