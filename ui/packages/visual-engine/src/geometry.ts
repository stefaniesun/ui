import type { Bounds } from '@ui-rebuild/contracts'

export interface GeometryScore { meanAbsoluteErrorPx: number; score: number }

export function scoreGeometry(reference: Bounds, actual: Bounds): GeometryScore {
  const errors = [
    Math.abs(reference.x - actual.x),
    Math.abs(reference.y - actual.y),
    Math.abs(reference.width - actual.width),
    Math.abs(reference.height - actual.height),
  ]
  const meanAbsoluteErrorPx = errors.reduce((sum, value) => sum + value, 0) / errors.length
  return { meanAbsoluteErrorPx, score: Math.max(0, 1 - (meanAbsoluteErrorPx / 16)) }
}
