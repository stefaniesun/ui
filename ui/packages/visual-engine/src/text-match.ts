import { TEXT_CONFIDENCE_THRESHOLD } from '@ui-rebuild/contracts'
import type { TextItem } from '@ui-rebuild/contracts'

const PAIR_WEIGHTS = { text: 0.55, position: 0.25, fontSize: 0.12, color: 0.08 }
const MAX_PAIR_COST = 0.6

export interface TextMatch {
  reference: TextItem
  actual: TextItem
  cost: number
  critical: boolean
}

export interface TextMatchResult {
  matches: TextMatch[]
  missing: TextItem[]
  added: TextItem[]
  lowConfidence: TextItem[]
}

export function normalizeText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US')
}

export function isCriticalText(text: string): boolean {
  const value = normalizeText(text)
  return /^(?:[$€£¥￥]\s*)?\d+(?:[.,]\d+)*(?:\s*[$€£¥￥])?$/u.test(value)
    || /^\d+(?:[.,]\d+)?%$/u.test(value)
    || /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/u.test(value)
    || /^(?=.*\d)[a-z]+[-_]\d+$/iu.test(value)
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)) }

function levenshtein(left: string, right: string): number {
  if (left === right) return 0
  if (!left.length || !right.length) return Math.max(left.length, right.length)
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1]! + 1,
        previous[column]! + 1,
        previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[right.length]!
}

function textDistance(reference: TextItem, actual: TextItem): number {
  const left = normalizeText(reference.text)
  const right = normalizeText(actual.text)
  if ((isCriticalText(left) || isCriticalText(right)) && left !== right) return 1
  return levenshtein(left, right) / Math.max(left.length, right.length, 1)
}

function positionDistance(reference: TextItem, actual: TextItem): number {
  const center = Math.hypot(
    reference.bounds.x + reference.bounds.width / 2 - actual.bounds.x - actual.bounds.width / 2,
    reference.bounds.y + reference.bounds.height / 2 - actual.bounds.y - actual.bounds.height / 2,
  ) / Math.SQRT2
  const size = (Math.abs(reference.bounds.width - actual.bounds.width)
    + Math.abs(reference.bounds.height - actual.bounds.height)) / 2
  return clamp((center + size) / 2)
}

function fontDistance(reference: number, actual: number): number {
  return clamp(Math.abs(reference - actual) / Math.max(reference, actual))
}

type Rgb = [number, number, number]
function parseColor(value: string): Rgb | null {
  const color = value.trim().toLowerCase()
  const short = /^#([\da-f])([\da-f])([\da-f])$/u.exec(color)
  if (short) return short.slice(1).map(part => Number.parseInt(`${part}${part}`, 16)) as Rgb
  const long = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/u.exec(color)
  if (long) return long.slice(1).map(part => Number.parseInt(part, 16)) as Rgb
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/u.exec(color)
  if (!rgb) return null
  const values = rgb.slice(1).map(Number) as Rgb
  return values.every(channel => channel <= 255) ? values : null
}

function toLab([red, green, blue]: Rgb): [number, number, number] {
  const linear = [red, green, blue].map(channel => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const x = (linear[0]! * 0.4124 + linear[1]! * 0.3576 + linear[2]! * 0.1805) / 0.95047
  const y = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
  const z = (linear[0]! * 0.0193 + linear[1]! * 0.1192 + linear[2]! * 0.9505) / 1.08883
  const transform = (value: number) => value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116
  const fx = transform(x); const fy = transform(y); const fz = transform(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function colorDistance(left: Rgb, right: Rgb): number {
  const a = toLab(left); const b = toLab(right)
  return clamp(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 100)
}

export function textPairCost(reference: TextItem, actual: TextItem): number {
  const dimensions: Array<[number, number]> = [
    [PAIR_WEIGHTS.text, textDistance(reference, actual)],
    [PAIR_WEIGHTS.position, positionDistance(reference, actual)],
  ]
  if (reference.fontSize !== null && actual.fontSize !== null) {
    dimensions.push([PAIR_WEIGHTS.fontSize, fontDistance(reference.fontSize, actual.fontSize)])
  }
  const referenceColor = reference.color === null ? null : parseColor(reference.color)
  const actualColor = actual.color === null ? null : parseColor(actual.color)
  if (referenceColor !== null && actualColor !== null) {
    dimensions.push([PAIR_WEIGHTS.color, colorDistance(referenceColor, actualColor)])
  }
  const weight = dimensions.reduce((sum, [value]) => sum + value, 0)
  const cost = clamp(dimensions.reduce((sum, [value, distance]) => sum + value * distance, 0) / weight)
  return cost < Number.EPSILON ? 0 : cost
}

function stableKey(item: TextItem): string {
  return JSON.stringify([normalizeText(item.text), item.bounds.x, item.bounds.y, item.bounds.width, item.bounds.height, item.fontSize, item.color])
}

function hungarian(cost: number[][]): number[] {
  const size = cost.length
  const u = Array(size + 1).fill(0) as number[]
  const v = Array(size + 1).fill(0) as number[]
  const p = Array(size + 1).fill(0) as number[]
  const way = Array(size + 1).fill(0) as number[]
  for (let row = 1; row <= size; row += 1) {
    p[0] = row
    let column = 0
    const minimum = Array(size + 1).fill(Number.POSITIVE_INFINITY) as number[]
    const used = Array(size + 1).fill(false) as boolean[]
    do {
      used[column] = true
      const currentRow = p[column]!
      let delta = Number.POSITIVE_INFINITY
      let next = 0
      for (let candidate = 1; candidate <= size; candidate += 1) {
        if (used[candidate]) continue
        const reduced = cost[currentRow - 1]![candidate - 1]! - u[currentRow]! - v[candidate]!
        if (reduced < minimum[candidate]!) { minimum[candidate] = reduced; way[candidate] = column }
        if (minimum[candidate]! < delta) { delta = minimum[candidate]!; next = candidate }
      }
      for (let candidate = 0; candidate <= size; candidate += 1) {
        if (used[candidate]) { u[p[candidate]!]! += delta; v[candidate]! -= delta } else minimum[candidate]! -= delta
      }
      column = next
    } while (p[column] !== 0)
    do { const previous = way[column]!; p[column] = p[previous]!; column = previous } while (column !== 0)
  }
  const assignment = Array(size).fill(-1) as number[]
  for (let column = 1; column <= size; column += 1) assignment[p[column]! - 1] = column - 1
  return assignment
}

export function matchTextItems(referenceItems: readonly TextItem[], actualItems: readonly TextItem[]): TextMatchResult {
  const lowConfidence = [...referenceItems, ...actualItems]
    .filter(item => item.confidence < TEXT_CONFIDENCE_THRESHOLD).sort((a, b) => stableKey(a).localeCompare(stableKey(b)))
  const reference = referenceItems.filter(item => item.confidence >= TEXT_CONFIDENCE_THRESHOLD).sort((a, b) => stableKey(a).localeCompare(stableKey(b)))
  const actual = actualItems.filter(item => item.confidence >= TEXT_CONFIDENCE_THRESHOLD).sort((a, b) => stableKey(a).localeCompare(stableKey(b)))
  const size = reference.length + actual.length
  if (size === 0) return { matches: [], missing: [], added: [], lowConfidence }
  const costs = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => {
    if (row < reference.length && column < actual.length) return textPairCost(reference[row]!, actual[column]!)
    if (row < reference.length && column >= actual.length) return 1
    if (row >= reference.length && column < actual.length) return 1
    return 0
  }))
  const assignment = hungarian(costs)
  const matchedActual = new Set<number>()
  const matches: TextMatch[] = []
  const missing: TextItem[] = []
  reference.forEach((item, row) => {
    const column = assignment[row]!
    const cost = column < actual.length ? costs[row]![column]! : 1
    if (column < actual.length && cost <= MAX_PAIR_COST) {
      matchedActual.add(column)
      matches.push({ reference: item, actual: actual[column]!, cost, critical: isCriticalText(item.text) || isCriticalText(actual[column]!.text) })
    } else missing.push(item)
  })
  const added = actual.filter((_, index) => !matchedActual.has(index))
  return { matches, missing, added, lowConfidence }
}
