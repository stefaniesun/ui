import type { Bounds } from '@ui-rebuild/contracts'
import type { ImageNormalization, NormalizedImage } from './image.js'
import { normalizeImage } from './image.js'
import type { OcrProvider } from './score.js'
import { cropRegion } from './regions.js'

export interface FrozenReferenceRegion {
  regionId: string
  bounds: Bounds
  crop: Buffer
  meanColor: [number, number, number]
  ocrBaseline: unknown | null
}

export interface FrozenReference {
  image: NormalizedImage
  normalization: ImageNormalization
  regions: ReadonlyMap<string, FrozenReferenceRegion>
}

async function meanColor(crop: Buffer): Promise<[number, number, number]> {
  const { dominant } = await import('sharp').then(({ default: sharp }) => sharp(crop).stats())
  return [dominant.r, dominant.g, dominant.b]
}

export async function freezeReference(
  input: Buffer,
  normalization: ImageNormalization,
  regions: ReadonlyArray<{ regionId: string; bounds: Bounds }>,
  ocr?: OcrProvider,
): Promise<FrozenReference> {
  const image = await normalizeImage(input, normalization)
  const frozen = new Map<string, FrozenReferenceRegion>()
  for (const region of regions) {
    const crop = await cropRegion(image, region.bounds)
    let ocrBaseline: unknown | null = null
    if (ocr?.analyzeReference) {
      try {
        ocrBaseline = await ocr.analyzeReference(crop, region.bounds)
      } catch {
        ocrBaseline = null
      }
    }
    frozen.set(region.regionId, {
      ...region,
      crop,
      meanColor: await meanColor(crop),
      ocrBaseline,
    })
  }
  return { image, normalization, regions: frozen }
}
