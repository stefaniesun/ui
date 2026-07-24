import type { Bounds } from '@ui-rebuild/contracts'
import type { NormalizedImage } from '../image.js'

export interface H5CaptureOptions {
  url: string
  viewport: { width: number; height: number; deviceScaleFactor: number }
  regionIds: string[]
  browsersPath?: string
  timeoutMs?: number
}

export interface CapturedRegion {
  regionId: string
  bounds: Bounds
}

export interface H5CaptureResult {
  image: NormalizedImage
  regions: CapturedRegion[]
}
