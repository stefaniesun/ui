import type { TextItem } from '@ui-rebuild/contracts'
import { describe, expect, it } from 'vitest'
import { scoreRegionText } from './text-score.js'

const item = (text = 'Total', overrides: Partial<TextItem> = {}): TextItem => ({
  text,
  bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
  fontSize: 16,
  color: '#ffffff',
  confidence: 0.9,
  ...overrides,
})

describe('scoreRegionText', () => {
  it('scores exact text and presentation as one', () => {
    const score = scoreRegionText([item()], [item()])
    expect(score).toMatchObject({ total: 1, content: 1, position: 1, fontSize: 1, color: 1 })
  })

  it('renormalizes unavailable font and color dimensions', () => {
    const score = scoreRegionText(
      [item('same', { fontSize: null, color: null })],
      [item('same', { fontSize: null, color: null })],
    )
    expect(score.total).toBe(1)
    expect(score.fontSize).toBeNull()
    expect(score.color).toBeNull()
  })

  it('handles empty, missing, and added text explicitly', () => {
    expect(scoreRegionText([], [])).toMatchObject({ total: 1, content: 1, missing: [], added: [] })
    const missing = scoreRegionText([item()], [])
    expect(missing.content).toBeLessThan(1)
    expect(missing.missing).toEqual(['Total'])
    const added = scoreRegionText([], [item('Extra')])
    expect(added.content).toBeLessThan(1)
    expect(added.added).toEqual(['Extra'])
  })

  it('penalizes added text deterministically', () => {
    const score = scoreRegionText([item()], [item(), item('Extra', { bounds: { x: 0.6, y: 0.2, width: 0.2, height: 0.1 } })])
    expect(score.content).toBeLessThan(1)
    expect(score.added).toEqual(['Extra'])
  })

  it('gives critical content mismatch zero content similarity', () => {
    const score = scoreRegionText([item('¥99.00')], [item('¥89.00')])
    expect(score.content).toBe(0)
    expect(score.matches[0]).toMatchObject({ reference: '¥99.00', actual: '¥89.00', critical: true })
  })

  it('calculates weighted presentation scores', () => {
    const actual = item('Total', {
      bounds: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 },
      fontSize: 32,
      color: '#000000',
    })
    const score = scoreRegionText([item()], [actual])
    expect(score.position).toBeLessThan(1)
    expect(score.fontSize).toBe(0.5)
    expect(score.color).toBe(0)
    expect(score.total).toBeCloseTo(
      0.5 * score.content + 0.25 * score.position + 0.15 * score.fontSize! + 0.1 * score.color!,
    )
  })
})
