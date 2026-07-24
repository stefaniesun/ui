import sharp from 'sharp'
import { normalizeImage } from './image.js'
import { createMask } from './regions.js'
import type { Bounds } from '@ui-rebuild/contracts'

export async function createHeatmap(
  reference: Buffer,
  actual: Buffer,
  width: number,
  height: number,
  masks: readonly Bounds[],
): Promise<Buffer> {
  const [first, second] = await Promise.all([
    normalizeImage(reference, width, height), normalizeImage(actual, width, height),
  ])
  const mask = createMask(width, height, masks)
  const output = Buffer.alloc(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (mask[pixel]) continue
    const offset = pixel * 4
    const difference = Math.max(
      Math.abs(first.data[offset]! - second.data[offset]!),
      Math.abs(first.data[offset + 1]! - second.data[offset + 1]!),
      Math.abs(first.data[offset + 2]! - second.data[offset + 2]!),
    )
    if (difference === 0) continue
    output[offset] = 255
    output[offset + 1] = Math.max(0, 255 - difference)
    output[offset + 2] = 0
    output[offset + 3] = difference
  }
  return sharp(output, { raw: { width, height, channels: 4 } }).png().toBuffer()
}
