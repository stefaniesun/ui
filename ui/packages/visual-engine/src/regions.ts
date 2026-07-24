import type { Bounds } from '@ui-rebuild/contracts'
import sharp from 'sharp'
import type { NormalizedImage } from './image.js'

export interface NamedRegion { regionId: string; bounds: Bounds }

export function validateBounds(bounds: Bounds, width: number, height: number, name: string): void {
  const values = [bounds.x, bounds.y, bounds.width, bounds.height]
  if (!values.every(Number.isFinite) || bounds.width < 0.5 || bounds.height < 0.5) {
    throw new Error(`${name} bounds must be finite and round to positive logical pixels`)
  }
  const left = Math.floor(bounds.x)
  const top = Math.floor(bounds.y)
  const right = Math.ceil(bounds.x + bounds.width)
  const bottom = Math.ceil(bounds.y + bounds.height)
  if (left < 0 || top < 0 || right <= left || bottom <= top
    || right > width || bottom > height) {
    throw new Error(`${name} bounds are outside the logical canvas`)
  }
}

export async function cropRegion(image: NormalizedImage, bounds: Bounds): Promise<Buffer> {
  validateBounds(bounds, image.width, image.height, 'region')
  return sharp(image.png).extract({
    left: Math.round(bounds.x), top: Math.round(bounds.y),
    width: Math.round(bounds.width), height: Math.round(bounds.height),
  }).png().toBuffer()
}

export async function cropRegions(
  image: Buffer,
  regions: readonly NamedRegion[],
): Promise<Map<string, Buffer>> {
  const metadata = await sharp(image).metadata()
  if (!metadata.width || !metadata.height) throw new Error('Image dimensions are unavailable')
  const normalized: NormalizedImage = {
    png: image,
    data: Buffer.alloc(0),
    width: metadata.width,
    height: metadata.height,
    defaultMasks: [],
  }
  const output = new Map<string, Buffer>()
  for (const region of regions) output.set(region.regionId, await cropRegion(normalized, region.bounds))
  return output
}

export function createMask(width: number, height: number, masks: readonly Bounds[]): Uint8Array {
  const result = new Uint8Array(width * height)
  for (const [index, mask] of masks.entries()) {
    validateBounds(mask, width, height, `mask[${index}]`)
    const left = Math.floor(mask.x); const top = Math.floor(mask.y)
    const right = Math.ceil(mask.x + mask.width); const bottom = Math.ceil(mask.y + mask.height)
    for (let y = top; y < bottom; y += 1) {
      result.fill(1, (y * width) + left, (y * width) + right)
    }
  }
  return result
}
