import type { Bounds } from '@ui-rebuild/contracts'
import type { ImageNormalization, NormalizedImage } from './image.js'
import { normalizeImage } from './image.js'
import { cropRegion } from './regions.js'

export interface FrozenReferenceRegion {
  regionId: string
  bounds: Bounds
  crop: Buffer
}

export interface FrozenReference {
  image: NormalizedImage
  regions: ReadonlyMap<string, FrozenReferenceRegion>
}

export async function freezeReference(
  input: Buffer,
  normalization: ImageNormalization,
  regions: ReadonlyArray<{ regionId: string; bounds: Bounds }>,
): Promise<FrozenReference> {
  const image = await normalizeImage(input, normalization)
  const frozen = new Map<string, FrozenReferenceRegion>()
  for (const region of regions) {
    frozen.set(region.regionId, {
      ...region,
      crop: await cropRegion(image, region.bounds),
    })
  }
  return { image, regions: frozen }
}
