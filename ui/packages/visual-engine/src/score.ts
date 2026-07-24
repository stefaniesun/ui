import pixelmatch from 'pixelmatch'
import sharp from 'sharp'
import type { Bounds } from '@ui-rebuild/contracts'
import { deltaE76 } from './color.js'
import { scoreGeometry } from './geometry.js'
import { normalizeImage } from './image.js'
import type { ImageNormalization, NormalizedImage } from './image.js'
import { createMask, cropRegion, validateBounds } from './regions.js'

export interface OcrProvider {
  compare(input: {
    reference: Buffer
    actual: Buffer
    referenceBounds: Bounds
    actualBounds: Bounds
    mask: Uint8Array
  }): Promise<number>
}
export interface ScoredRegion {
  regionId: string
  referenceBounds: Bounds
  actualBounds: Bounds
  critical: boolean
  masks?: Bounds[]
}
export interface ScoreWeights { geometry: number; visual: number; color: number; content: number }
export interface ScoreOptions {
  reference: ImageNormalization
  actual: ImageNormalization
  regions: ScoredRegion[]
  weights: ScoreWeights
  criticalMultiplier?: number
  pixelmatchThreshold?: number
  ocr?: OcrProvider
}
export interface RegionScore {
  regionId: string
  geometry: { meanAbsoluteErrorPx: number; score: number }
  visual: { pixelDiffRatio: number | null; score: number | null }
  color: { meanDeltaE: number | null; score: number | null }
  content: { ocrMatch: number | null; score: number | null }
  total: number
  severeDefects: string[]
}
export interface PageScore { total: number; regions: RegionScore[] }

function finiteScore(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be in [0, 1]`)
  return value
}

function validateWeights(weights: ScoreWeights): void {
  const values = Object.values(weights)
  if (!values.every(value => Number.isFinite(value) && value >= 0)
    || values.every(value => value === 0)) throw new Error('Score weights must be finite, nonnegative, and not all zero')
}

function weighted(values: Array<{ value: number | null; weight: number }>): number {
  const available = values.filter(item => item.value !== null) as Array<{ value: number; weight: number }>
  const weight = available.reduce((sum, item) => sum + item.weight, 0)
  if (weight <= 0) throw new Error('No measurable score dimensions remain')
  return available.reduce((sum, item) => sum + (item.value * item.weight), 0) / weight
}

async function alignedRegion(
  reference: NormalizedImage,
  actual: NormalizedImage,
  region: ScoredRegion,
): Promise<{ reference: Buffer; actual: Buffer; width: number; height: number }> {
  const referenceCrop = await cropRegion(reference, region.referenceBounds)
  const actualCrop = await cropRegion(actual, region.actualBounds)
  const width = Math.max(1, Math.round(region.referenceBounds.width))
  const height = Math.max(1, Math.round(region.referenceBounds.height))
  return {
    reference: await sharp(referenceCrop).resize(width, height, { fit: 'fill' }).ensureAlpha().raw().toBuffer(),
    actual: await sharp(actualCrop).resize(width, height, { fit: 'fill' }).ensureAlpha().raw().toBuffer(),
    width,
    height,
  }
}

export async function scorePage(
  referenceInput: Buffer,
  actualInput: Buffer,
  options: ScoreOptions,
): Promise<PageScore> {
  validateWeights(options.weights)
  if (options.regions.length === 0) throw new Error('At least one scored region is required')
  if (options.reference.logicalWidth !== options.actual.logicalWidth
    || options.reference.logicalHeight !== options.actual.logicalHeight) {
    throw new Error('Reference and actual logical canvases must match')
  }
  const [reference, actual] = await Promise.all([
    normalizeImage(referenceInput, options.reference), normalizeImage(actualInput, options.actual),
  ])
  const regions: RegionScore[] = []
  for (const region of options.regions) {
    validateBounds(region.referenceBounds, reference.width, reference.height, `${region.regionId}.reference`)
    validateBounds(region.actualBounds, actual.width, actual.height, `${region.regionId}.actual`)
    const geometry = scoreGeometry(region.referenceBounds, region.actualBounds)
    const aligned = await alignedRegion(reference, actual, region)
    const mask = createMask(aligned.width, aligned.height, region.masks ?? [])
    const maskedActual = Buffer.from(aligned.actual)
    let validPixels = 0; let deltaTotal = 0
    for (let pixel = 0; pixel < mask.length; pixel += 1) {
      const offset = pixel * 4
      if (mask[pixel]) {
        aligned.reference.copy(maskedActual, offset, offset, offset + 4)
        continue
      }
      validPixels += 1
      deltaTotal += deltaE76(
        [aligned.reference[offset]!, aligned.reference[offset + 1]!, aligned.reference[offset + 2]!],
        [aligned.actual[offset]!, aligned.actual[offset + 1]!, aligned.actual[offset + 2]!],
      )
    }
    const noVisualData = validPixels === 0
    const differentPixels = noVisualData ? 0 : pixelmatch(
      aligned.reference,
      maskedActual,
      null,
      aligned.width,
      aligned.height,
      { threshold: options.pixelmatchThreshold ?? 0.1, includeAA: false },
    )
    const pixelDiffRatio = noVisualData ? null : Math.min(1, differentPixels / validPixels)
    const meanDeltaE = noVisualData ? null : deltaTotal / validPixels
    const ocrMatch = options.ocr && !noVisualData
      ? finiteScore(await options.ocr.compare({
        reference: aligned.reference,
        actual: aligned.actual,
        referenceBounds: region.referenceBounds,
        actualBounds: region.actualBounds,
        mask,
      }), `${region.regionId} OCR score`)
      : null
    const visualScore = pixelDiffRatio === null ? null : 1 - pixelDiffRatio
    const colorScore = meanDeltaE === null ? null : Math.max(0, 1 - (meanDeltaE / 100))
    const total = weighted([
      { value: geometry.score, weight: options.weights.geometry },
      { value: visualScore, weight: options.weights.visual },
      { value: colorScore, weight: options.weights.color },
      { value: ocrMatch, weight: options.weights.content },
    ])
    const severeDefects = geometry.meanAbsoluteErrorPx > 16 ? ['geometry'] : []
    regions.push({
      regionId: region.regionId,
      geometry,
      visual: { pixelDiffRatio, score: visualScore },
      color: { meanDeltaE, score: colorScore },
      content: { ocrMatch, score: ocrMatch },
      total,
      severeDefects,
    })
  }
  const multiplier = options.criticalMultiplier ?? 2
  if (!Number.isFinite(multiplier) || multiplier < 1) throw new Error('criticalMultiplier must be >= 1')
  const totalWeight = regions.reduce((sum, _, index) => sum + (options.regions[index]!.critical ? multiplier : 1), 0)
  const total = regions.reduce((sum, region, index) => (
    sum + (region.total * (options.regions[index]!.critical ? multiplier : 1))
  ), 0) / totalWeight
  return { total: finiteScore(total, 'page total'), regions }
}
