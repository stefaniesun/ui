import { describe, expect, it } from 'vitest'
import { buildAnalysisPrompt } from './analyze.js'

const manifest = {
  version: '1.0.0' as const,
  projectId: 'xunlei-member', pageId: 'xunlei-member',
  device: { width: 390, height: 844, pixelRatio: 3, platform: 'h5' as const },
  states: [{ id: 'default', screenshot: 'reference/default.png', screenshotType: 'viewport' as const, scale: 1 }],
  targets: ['h5' as const],
}

describe('buildAnalysisPrompt', () => {
  it('requires exact ordered visible content and page-level bounds', () => {
    const prompt = buildAnalysisPrompt(manifest, { 'member-header': { displayName: '会员头部' } })
    expect(prompt).toContain('exact visible text')
    expect(prompt).toContain('Chinese, currency symbols, numbers, dates, and punctuation')
    expect(prompt).toContain('ordered text, asset, control, or decoration content nodes')
    expect(prompt).toContain('Do not use region displayName as visible text')
    expect(prompt).toContain('Every non-decorative leaf region must have visible content')
    expect(prompt).toContain('page-level logical-pixel bounds')
    expect(prompt).toContain('xunlei-member')
  })
})
