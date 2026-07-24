import type { Bounds } from '@ui-rebuild/contracts'
import { deltaE76 } from './color.js'
import { scoreGeometry } from './geometry.js'
import { normalizeImage } from './image.js'
import { createMask } from './regions.js'

export interface OcrProvider {
  compare(reference: Buffer, actual: Buffer, bounds: Bounds): Promise<number>
}
export interface ScoredRegion {
  regionId: string
  referenceBounds: Bounds
  actualBounds: Bounds
  critical: boolean
}
export interface ScoreWeights { geometry: number; visual: number; color: number; content: number }
export interface ScoreOptions {
  width: number; height: number
  regions: ScoredRegion[]
  masks: Bounds[]
  weights: ScoreWeights
  ocr?: OcrProvider
}
export interface RegionScore {
  regionId: string
  geometry: { meanAbsoluteErrorPx: number; score: number }
  visual: { pixelDiffRatio: number; score: number }
  color: { meanDeltaE: number; score: number }
  content: { ocrMatch: number | null; score: number | null }
  total: number
  severeDefects: string[]
}
export interface PageScore { total: number; regions: RegionScore[] }

function offset(width: number, x: number, y: number): number { return ((y * width) + x) * 4 }
function weighted(values: Array<{ value: number | null; weight: number }>): number {
  const available = values.filter(item => item.value !== null) as Array<{ value: number; weight: number }>
  const weight = available.reduce((sum, item) => sum + item.weight, 0)
  return weight === 0 ? 0 : available.reduce((sum, item) => sum + (item.value * item.weight), 0) / weight
}

export async function scorePage(
  reference: Buffer,
  actual: Buffer,
  options: ScoreOptions,
): Promise<PageScore> {
  const [first, second] = await Promise.all([
    normalizeImage(reference, options.width, options.height),
    normalizeImage(actual, options.width, options.height),
  ])
  const pageMask = createMask(options.width, options.height, options.masks)
  const regions = await Promise.all(options.regions.map(async region => {
    const geometry = scoreGeometry(region.referenceBounds, region.actualBounds)
    const left = Math.max(0, Math.floor(region.referenceBounds.x))
    const top = Math.max(0, Math.floor(region.referenceBounds.y))
    const right = Math.min(options.width, Math.ceil(region.referenceBounds.x + region.referenceBounds.width))
    const bottom = Math.min(options.height, Math.ceil(region.referenceBounds.y + region.referenceBounds.height))
    let compared = 0; let different = 0; let deltaTotal = 0
    for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) {
      const pixel = (y * options.width) + x
      if (pageMask[pixel]) continue
      const index = offset(options.width, x, y)
      const a = first.data.subarray(index, index + 4); const b = second.data.subarray(index, index + 4)
      const maxChannelDifference = Math.max(
        Math.abs(a[0]! - b[0]!), Math.abs(a[1]! - b[1]!), Math.abs(a[2]! - b[2]!),
      )
      if (maxChannelDifference > 25) different += 1
      deltaTotal += deltaE76([...a], [...b]); compared += 1
    }
    const pixelDiffRatio = compared === 0 ? 0 : different / compared
    const meanDeltaE = compared === 0 ? 0 : deltaTotal / compared
    const ocrMatch = options.ocr
      ? await options.ocr.compare(reference, actual, region.referenceBounds)
      : null
    const visual = { pixelDiffRatio, score: 1 - pixelDiffRatio }
    const color = { meanDeltaE, score: Math.max(0, 1 - (meanDeltaE / 100)) }
    const content = { ocrMatch, score: ocrMatch }
    const total = weighted([
      { value: geometry.score, weight: options.weights.geometry },
      { value: visual.score, weight: options.weights.visual },
      { value: color.score, weight: options.weights.color },
      { value: content.score, weight: options.weights.content },
    ])
    const severeDefects = geometry.meanAbsoluteErrorPx > 16 ? ['geometry'] : []
    return { regionId: region.regionId, geometry, visual, color, content, total, severeDefects }
  }))
  const totalWeight = regions.reduce((sum, region, index) => (
    sum + (options.regions[index]?.critical ? 2 : 1)
  ), 0)
  const total = regions.reduce((sum, region, index) => (
    sum + (region.total * (options.regions[index]?.critical ? 2 : 1))
  ), 0) / totalWeight
  return { total, regions }
}
