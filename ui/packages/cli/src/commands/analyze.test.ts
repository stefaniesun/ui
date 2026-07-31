import { describe, expect, it } from 'vitest'
import { buildAnalysisPrompt, clampRegionBounds } from './analyze.js'

const manifest = {
  version: '1.0.0' as const,
  projectId: 'xunlei-member', pageId: 'xunlei-member',
  device: { width: 390, height: 844, pixelRatio: 3, platform: 'h5' as const },
  states: [{ id: 'default', screenshot: 'reference/default.png', screenshotType: 'viewport' as const, scale: 1 }],
  targets: ['h5' as const],
}

describe('clampRegionBounds', () => {
  it('clamps small partial overflow to the logical content canvas', () => {
    expect(clampRegionBounds({ x: 360, y: 760, width: 40, height: 30 }, 390, 781))
      .toEqual({ x: 360, y: 760, width: 30, height: 21 })
  })

  it('rejects bounds fully outside the logical content canvas', () => {
    expect(() => clampRegionBounds({ x: 5000, y: 5000, width: 100, height: 100 }, 390, 781))
      .toThrow(/outside canvas/i)
  })

  it('rejects excessive partial overflow instead of hiding a coordinate-space error', () => {
    expect(() => clampRegionBounds({ x: 360, y: 760, width: 80, height: 60 }, 390, 781))
      .toThrow(/exceeds canvas/i)
  })
})

describe('buildAnalysisPrompt', () => {
  it('requires exact ordered visible content and page-level bounds', () => {
    const prompt = buildAnalysisPrompt(manifest, { 'member-header': { displayName: '会员头部' } })
    expect(prompt).toContain('exact visible text')
    expect(prompt).toContain('Chinese, currency symbols, numbers, dates, and punctuation')
    expect(prompt).toContain('ordered text, asset, control, or decoration content nodes')
    expect(prompt).toContain('Do not use region displayName as visible text')
    expect(prompt).toContain('Every non-decorative leaf region must have visible content')
    expect(prompt).toContain('page-level logical-pixel bounds')
    expect(prompt).toContain('content-only')
    expect(prompt).toContain('status bars')
    expect(prompt).toContain('browser address bars')
    expect(prompt).toContain('Home Indicators')
    expect(prompt).toContain('fontFamily, fontSize, fontWeight, and lineHeight')
    expect(prompt).toContain('xunlei-member')
  })
})
