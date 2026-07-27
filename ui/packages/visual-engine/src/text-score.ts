import type { TextItem } from '@ui-rebuild/contracts'
import {
  matchTextItems,
  normalizeText,
  textColorDistance,
  textDistance,
  textFontDistance,
  textPositionDistance,
} from './text-match.js'

const REGION_TEXT_WEIGHTS = { content: 0.5, position: 0.25, fontSize: 0.15, color: 0.1 }

export interface RegionTextScore {
  total: number
  content: number
  position: number
  fontSize: number | null
  color: number | null
  missing: string[]
  added: string[]
  lowConfidence: string[]
  matches: Array<{ reference: string; actual: string; cost: number; critical: boolean }>
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)) }
function average(values: readonly number[]): number {
  return values.length === 0 ? 1 : values.reduce((sum, value) => sum + value, 0) / values.length
}

export function scoreRegionText(reference: readonly TextItem[], actual: readonly TextItem[]): RegionTextScore {
  const result = matchTextItems(reference, actual)
  const matchedContent = result.matches.map(match => match.critical && normalizeText(match.reference.text) !== normalizeText(match.actual.text)
    ? 0
    : 1 - textDistance(match.reference, match.actual))
  const denominator = result.matches.length + result.missing.length + result.added.length
  const content = denominator === 0
    ? 1
    : clamp(matchedContent.reduce((sum, value) => sum + value, 0) / denominator)
  const position = average(result.matches.map(match => 1 - textPositionDistance(match.reference, match.actual)))
  const fontValues = result.matches.flatMap(match => match.reference.fontSize === null || match.actual.fontSize === null
    ? []
    : [1 - textFontDistance(match.reference.fontSize, match.actual.fontSize)])
  const colorValues = result.matches.flatMap(match => {
    if (match.reference.color === null || match.actual.color === null) return []
    const distance = textColorDistance(match.reference.color, match.actual.color)
    return distance === null ? [] : [1 - distance]
  })
  const fontSize = fontValues.length === 0 ? null : average(fontValues)
  const color = colorValues.length === 0 ? null : average(colorValues)
  const weighted: Array<[number, number]> = [
    [REGION_TEXT_WEIGHTS.content, content],
    [REGION_TEXT_WEIGHTS.position, position],
  ]
  if (fontSize !== null) weighted.push([REGION_TEXT_WEIGHTS.fontSize, fontSize])
  if (color !== null) weighted.push([REGION_TEXT_WEIGHTS.color, color])
  const weight = weighted.reduce((sum, [value]) => sum + value, 0)
  const total = clamp(weighted.reduce((sum, [value, score]) => sum + value * score, 0) / weight)
  return {
    total,
    content,
    position,
    fontSize,
    color,
    missing: result.missing.map(item => item.text),
    added: result.added.map(item => item.text),
    lowConfidence: result.lowConfidence.map(item => item.text),
    matches: result.matches.map(match => ({
      reference: match.reference.text,
      actual: match.actual.text,
      cost: match.cost,
      critical: match.critical,
    })),
  }
}
