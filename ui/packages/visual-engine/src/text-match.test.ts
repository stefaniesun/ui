import type { TextItem } from '@ui-rebuild/contracts'
import { describe, expect, it } from 'vitest'
import { isCriticalText, matchTextItems, normalizeText } from './text-match.js'

const item = (text: string, x: number, overrides: Partial<TextItem> = {}): TextItem => ({
  text,
  bounds: { x, y: 0.1, width: 0.2, height: 0.1 },
  fontSize: 16,
  color: '#ffffff',
  confidence: 0.9,
  ...overrides,
})

function pairs(result: ReturnType<typeof matchTextItems>) {
  return result.matches.map(match => `${match.reference.text}:${match.actual.text}`).sort()
}

describe('deterministic text matching', () => {
  it('normalizes compatibility text without dropping punctuation', () => {
    expect(normalizeText('  ＡＢＣ   ¥ 99.00 ')).toBe('abc ¥ 99.00')
  })

  it.each(['¥99.00', '2026-07-27', '18%', 'A-1024', '12345'])('marks %s as critical', value => {
    expect(isCriticalText(value)).toBe(true)
  })

  it('is independent of input order', () => {
    const reference = [item('Title', 0), item('Total', 0.6)]
    const actual = [item('TOTAL', 0.6), item('title', 0)]
    expect(pairs(matchTextItems(reference, actual))).toEqual(pairs(matchTextItems([...reference].reverse(), [...actual].reverse())))
  })

  it('uses global assignment and reports unmatched items', () => {
    const result = matchTextItems(
      [item('alpha', 0), item('beta', 0.6)],
      [item('beta', 0.6), item('unrelated-long-value', 0.8, { fontSize: 1000, color: '#000000' })],
    )
    expect(pairs(result)).toContain('beta:beta')
    expect(result.missing.map(value => value.text)).toContain('alpha')
    expect(result.added.map(value => value.text)).toContain('unrelated-long-value')
  })

  it('filters low-confidence items before matching', () => {
    const result = matchTextItems([item('low', 0, { confidence: 0.59 })], [item('low', 0)])
    expect(result.matches).toEqual([])
    expect(result.lowConfidence.map(value => value.text)).toEqual(['low'])
    expect(result.added.map(value => value.text)).toEqual(['low'])
  })

  it('makes unequal critical text maximally distant', () => {
    const result = matchTextItems([item('¥99.00', 0)], [item('¥89.00', 0)])
    expect(result.matches[0]?.critical).toBe(true)
    expect(result.matches[0]?.cost).toBeGreaterThanOrEqual(0.55)
  })

  it('renormalizes missing dimensions and parses common colors', () => {
    const noOptional = matchTextItems(
      [item('same', 0, { fontSize: null, color: null })],
      [item('same', 0, { fontSize: null, color: null })],
    )
    expect(noOptional.matches[0]?.cost).toBe(0)
    const colors = matchTextItems([item('same', 0, { color: '#fff' })], [item('same', 0, { color: 'rgb(255, 255, 255)' })])
    expect(colors.matches[0]?.cost).toBe(0)
  })
})
