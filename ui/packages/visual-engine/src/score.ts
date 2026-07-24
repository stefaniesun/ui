import pixelmatch from 'pixelmatch'
import sharp from 'sharp'
import type { Bounds } from '@ui-rebuild/contracts'
import { deltaE76 } from './color.js'
import { scoreGeometry } from './geometry.js'
import { normalizeImage } from './image.js'
import type { ImageNormalization } from './image.js'
import { OcrUnavailableError } from './ocr.js'
import type { FrozenReference } from './reference.js'
import { freezeReference } from './reference.js'
import { createMask, cropRegion, validateBounds } from './regions.js'

export interface OcrProvider {
  analyzeReference?(reference: Buffer, bounds: Bounds): Promise<unknown>
  compare(input: {
    reference: Buffer
    actual: Buffer
    referenceBounds: Bounds
    actualBounds: Bounds
    mask: Uint8Array
    referenceBaseline?: unknown
  }): Promise<number>
}
export interface ScoredRegion {
  regionId: string
  referenceBounds: Bounds
  actualBounds: Bounds
  critical: boolean
  masks?: Bounds[]
}
export interface FrozenScoredRegion {
  regionId: string
  actualBounds: Bounds
  critical: boolean
  masks?: Bounds[]
}
export interface ScoreWeights {
  geometry: number
  visual: number
  color: number
  content: number
  consistency: number
  state: number
}
export interface SharedScoreOptions {
  weights: ScoreWeights
  criticalMultiplier?: number
  pixelmatchThreshold?: number
  consistencyScore?: number | null
  stateScore?: number | null
  ocr?: OcrProvider
}
export interface ScoreOptions extends SharedScoreOptions {
  reference: ImageNormalization
  actual: ImageNormalization
  regions: ScoredRegion[]
}
export interface FrozenScoreOptions extends SharedScoreOptions {
  actual: ImageNormalization
  regions: FrozenScoredRegion[]
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
function validateShared(options: SharedScoreOptions) {
  const values = Object.values(options.weights)
  if (!values.every(value => Number.isFinite(value) && value >= 0) || values.every(value => value === 0)) {
    throw new Error('Score weights must be finite, nonnegative, and not all zero')
  }
  const threshold = options.pixelmatchThreshold ?? 0.1
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('pixelmatchThreshold must be in [0, 1]')
  }
  const multiplier = options.criticalMultiplier ?? 2
  if (!Number.isFinite(multiplier) || multiplier < 1) throw new Error('criticalMultiplier must be >= 1')
  return {
    threshold,
    multiplier,
    consistency: options.consistencyScore == null ? null : finiteScore(options.consistencyScore, 'consistency score'),
    state: options.stateScore == null ? null : finiteScore(options.stateScore, 'state score'),
  }
}
function masksForRegion(
  canvasMasks: readonly Bounds[],
  bounds: Bounds,
): Bounds[] {
  const output: Bounds[] = []
  for (const mask of canvasMasks) {
    const left = Math.max(bounds.x, mask.x)
    const top = Math.max(bounds.y, mask.y)
    const right = Math.min(bounds.x + bounds.width, mask.x + mask.width)
    const bottom = Math.min(bounds.y + bounds.height, mask.y + mask.height)
    if (right > left && bottom > top) {
      output.push({ x: left - bounds.x, y: top - bounds.y, width: right - left, height: bottom - top })
    }
  }
  return output
}

function weighted(values: Array<{ value: number | null; weight: number }>): number {
  const available = values.filter(item => item.value !== null) as Array<{ value: number; weight: number }>
  const totalWeight = available.reduce((sum, item) => sum + item.weight, 0)
  if (totalWeight <= 0) throw new Error('No measurable score dimensions remain')
  return available.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight
}
async function alignCrops(reference: Buffer, actual: Buffer, width: number, height: number) {
  const align = (input: Buffer) => sharp(input)
    .resize(width, height, { fit: 'contain', background: '#00000000' })
    .ensureAlpha().raw().toBuffer()
  return { reference: await align(reference), actual: await align(actual), width, height }
}

export async function scoreAgainstFrozenReference(
  frozen: FrozenReference,
  actualInput: Buffer,
  options: FrozenScoreOptions,
): Promise<PageScore> {
  const shared = validateShared(options)
  if (options.regions.length === 0) throw new Error('At least one scored region is required')
  if (frozen.normalization.logicalWidth !== options.actual.logicalWidth
    || frozen.normalization.logicalHeight !== options.actual.logicalHeight) {
    throw new Error('Reference and actual logical canvases must match')
  }
  const actual = await normalizeImage(actualInput, options.actual)
  const scores: RegionScore[] = []
  for (const region of options.regions) {
    const baseline = frozen.regions.get(region.regionId)
    if (!baseline) throw new Error(`Frozen reference region not found: ${region.regionId}`)
    validateBounds(region.actualBounds, actual.width, actual.height, `${region.regionId}.actual`)
    const actualCrop = await cropRegion(actual, region.actualBounds)
    const width = Math.max(1, Math.round(baseline.bounds.width))
    const height = Math.max(1, Math.round(baseline.bounds.height))
    const aligned = await alignCrops(baseline.crop, actualCrop, width, height)
    const systemMasks = masksForRegion(actual.defaultMasks, region.actualBounds)
    const mask = createMask(width, height, [...systemMasks, ...(region.masks ?? [])])
    const maskedActual = Buffer.from(aligned.actual)
    let validPixels = 0
    let deltaTotal = 0
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
      aligned.reference, maskedActual, null, width, height,
      { threshold: shared.threshold, includeAA: false },
    )
    const pixelDiffRatio = noVisualData ? null : differentPixels / validPixels
    const meanDeltaE = noVisualData ? null : deltaTotal / validPixels
    let ocrMatch: number | null = null
    if (options.ocr && !noVisualData) {
      try {
        ocrMatch = finiteScore(await options.ocr.compare({
          reference: aligned.reference,
          actual: aligned.actual,
          referenceBounds: baseline.bounds,
          actualBounds: region.actualBounds,
          mask,
          referenceBaseline: baseline.ocrBaseline,
        }), `${region.regionId} OCR score`)
      } catch (error) {
        if (!(error instanceof OcrUnavailableError)) throw error
      }
    }
    const geometry = scoreGeometry(baseline.bounds, region.actualBounds)
    const visualScore = pixelDiffRatio === null ? null : 1 - pixelDiffRatio
    const colorScore = meanDeltaE === null ? null : Math.max(0, 1 - meanDeltaE / 100)
    const total = weighted([
      { value: geometry.score, weight: options.weights.geometry },
      { value: visualScore, weight: options.weights.visual },
      { value: colorScore, weight: options.weights.color },
      { value: ocrMatch, weight: options.weights.content },
      { value: shared.consistency, weight: options.weights.consistency },
      { value: shared.state, weight: options.weights.state },
    ])
    scores.push({
      regionId: region.regionId,
      geometry,
      visual: { pixelDiffRatio, score: visualScore },
      color: { meanDeltaE, score: colorScore },
      content: { ocrMatch, score: ocrMatch },
      total,
      severeDefects: geometry.meanAbsoluteErrorPx > 16 ? ['geometry'] : [],
    })
  }
  const denominator = scores.reduce((sum, _, index) => sum + (options.regions[index]!.critical ? shared.multiplier : 1), 0)
  const total = scores.reduce((sum, score, index) => (
    sum + score.total * (options.regions[index]!.critical ? shared.multiplier : 1)
  ), 0) / denominator
  return { total: finiteScore(total, 'page total'), regions: scores }
}

export async function scorePage(
  referenceInput: Buffer,
  actualInput: Buffer,
  options: ScoreOptions,
): Promise<PageScore> {
  const frozen = await freezeReference(
    referenceInput,
    options.reference,
    options.regions.map(region => ({ regionId: region.regionId, bounds: region.referenceBounds })),
    options.ocr,
  )
  return scoreAgainstFrozenReference(frozen, actualInput, {
    ...options,
    regions: options.regions.map(({ regionId, actualBounds, critical, masks }) => ({
      regionId, actualBounds, critical, masks,
    })),
  })
}
