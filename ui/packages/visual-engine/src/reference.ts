import type { Bounds, RegionTextBaseline, TextItem } from '@ui-rebuild/contracts'
import type { ImageNormalization, NormalizedImage } from './image.js'
import { normalizeImage } from './image.js'
import { cropRegion } from './regions.js'
import { hashImage } from './text-cache.js'
import type { TextExtractionCache } from './text-cache.js'
import { extractionReason, textExtractionFailure } from './text-errors.js'

export interface RegionTextExtractor {
  readonly identity: {
    provider: 'model' | 'command'
    model: string
    schemaVersion: string
    promptVersion: string
  }
  extract(input: {
    regionId: string
    image: Buffer
    width: number
    height: number
    signal?: AbortSignal
  }): Promise<TextItem[]>
}

export interface FrozenReferenceRegion {
  regionId: string
  bounds: Bounds
  crop: Buffer
  textBaseline: RegionTextBaseline
}

export interface FrozenReference {
  image: NormalizedImage
  normalization: ImageNormalization
  regions: ReadonlyMap<string, FrozenReferenceRegion>
}

export interface FreezeReferenceOptions {
  textExtractor: RegionTextExtractor
  textCache?: TextExtractionCache
  signal?: AbortSignal
}

export async function freezeReference(
  input: Buffer,
  normalization: ImageNormalization,
  regions: ReadonlyArray<{ regionId: string; bounds: Bounds }>,
  options: FreezeReferenceOptions,
): Promise<FrozenReference> {
  let image: NormalizedImage
  try {
    image = await normalizeImage(input, normalization)
  } catch (error) {
    throw textExtractionFailure('page', 'reference', 'crop-failed', 'Unable to normalize the reference image', error)
  }
  const frozen = new Map<string, FrozenReferenceRegion>()
  for (const region of regions) {
    try {
      const crop = await cropRegion(image, region.bounds)
      const imageHash = hashImage(crop)
      const key = { imageHash, regionId: region.regionId, ...options.textExtractor.identity }
      const cached = await options.textCache?.get(key)
      const items = cached ?? await options.textExtractor.extract({
        regionId: region.regionId,
        image: crop,
        width: Math.max(1, Math.round(region.bounds.width)),
        height: Math.max(1, Math.round(region.bounds.height)),
        signal: options.signal,
      })
      if (cached === null || cached === undefined) await options.textCache?.set(key, items)
      const textBaseline: RegionTextBaseline = {
        regionId: region.regionId,
        imageHash,
        model: options.textExtractor.identity.model,
        schemaVersion: options.textExtractor.identity.schemaVersion as '1.0.0',
        promptVersion: options.textExtractor.identity.promptVersion as '1.0.0',
        items,
        extractedAt: new Date().toISOString(),
      }
      frozen.set(region.regionId, { ...region, crop, textBaseline })
    } catch (error) {
      throw textExtractionFailure(
        region.regionId,
        'reference',
        extractionReason(error),
        'Unable to prepare structured text for the reference region',
        error,
      )
    }
  }
  return { image, normalization, regions: frozen }
}
