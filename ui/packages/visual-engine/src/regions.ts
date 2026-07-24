import type { Bounds } from '@ui-rebuild/contracts'
import sharp from 'sharp'

export interface NamedRegion { regionId: string; bounds: Bounds }

export async function cropRegions(
  image: Buffer,
  regions: readonly NamedRegion[],
): Promise<Map<string, Buffer>> {
  const output = new Map<string, Buffer>()
  await Promise.all(regions.map(async region => {
    const crop = await sharp(image).extract({
      left: Math.round(region.bounds.x),
      top: Math.round(region.bounds.y),
      width: Math.round(region.bounds.width),
      height: Math.round(region.bounds.height),
    }).png().toBuffer()
    output.set(region.regionId, crop)
  }))
  return output
}

export function createMask(width: number, height: number, masks: readonly Bounds[]): boolean[] {
  const result = Array<boolean>(width * height).fill(false)
  for (const mask of masks) {
    const left = Math.max(0, Math.floor(mask.x)); const top = Math.max(0, Math.floor(mask.y))
    const right = Math.min(width, Math.ceil(mask.x + mask.width))
    const bottom = Math.min(height, Math.ceil(mask.y + mask.height))
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) result[(y * width) + x] = true
    }
  }
  return result
}
