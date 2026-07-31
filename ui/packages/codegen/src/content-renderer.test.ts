import { describe, expect, it } from 'vitest'
import type { RegionNode, VisualIR } from '@ui-rebuild/contracts'
import { renderRegionContent } from './content-renderer.js'
import { writeTokens } from './token-writer.js'

const region: RegionNode = {
  regionId: 'member-card', displayName: '会员卡', aliases: [], parentId: null,
  bounds: { x: 10, y: 20, width: 370, height: 220 }, source: 'model', confidence: 0.98,
  lockedByHuman: false, decorationOnly: false,
  content: [
    { kind: 'text', nodeId: 'page-title', text: '会员中心', role: 'title', bounds: { x: 30, y: 40, width: 100, height: 24 }, typographyToken: 'pageTitle', colorToken: 'textPrimary' },
    { kind: 'asset', nodeId: 'member-avatar', assetId: 'avatar-default', alt: '会员头像', bounds: { x: 30, y: 80, width: 48, height: 48 }, fit: 'cover' },
    { kind: 'control', nodeId: 'pay-button', control: 'button', label: '立即支付', bounds: { x: 30, y: 150, width: 330, height: 48 } },
  ],
}
const tokens: VisualIR['tokens'] = {
  colors: { textPrimary: '#111111', cardSurface: '#ffffff' },
  typography: { pageTitle: { fontSize: 20, fontWeight: 600, lineHeight: 24 } },
  spacing: {}, radii: { cardRadius: 12 },
}

describe('writeTokens', () => {
  it('emits valid scalar typography variables instead of JSON objects', () => {
    const css = writeTokens(tokens, 390)
    expect(css).toContain('--ui-type-page-title-font-size: 38.46153846153846rpx;')
    expect(css).toContain('--ui-type-page-title-font-weight: 600;')
    expect(css).toContain('--ui-type-page-title-line-height: 46.15384615384615rpx;')
    expect(css).not.toContain('{"fontSize"')
  })
})

describe('renderRegionContent', () => {
  it('renders ordered visible nodes with relative positions', () => {
    const result = renderRegionContent({ region, logicalWidth: 390, assetBindings: new Map([['avatar-default', 'avatarDefault']]), tokens })
    expect(result.markup).toContain('data-content-id="page-title">会员中心</text>')
    expect(result.markup).toContain(':src="assets.avatarDefault"')
    expect(result.markup).toContain('data-content-id="pay-button" aria-label="立即支付"></button>')
    expect(result.styles).toContain('.content-control{appearance:none;margin:0;padding:0;border:0;background:transparent;color:transparent;font-size:0}')
    expect(result.markup.indexOf('page-title')).toBeLessThan(result.markup.indexOf('member-avatar'))
    expect(result.styles).toContain('left:38.46153846153846rpx')
    expect(result.styles).toContain('color:var(--ui-color-text-primary)')
    expect(result.styles).toContain('font-size:38.46153846153846rpx')
    expect(result.styles).toContain('font-weight:600')
    expect(result.styles).toContain('line-height:46.15384615384615rpx')
    expect(result.usesAssets).toBe(true)
  })

  it.each([
    ['contain', 'aspectFit'],
    ['cover', 'aspectFill'],
    ['fill', 'scaleToFill'],
  ] as const)('maps %s image fit to %s', (fit, mode) => {
    const imageRegion = { ...region, content: [
      { kind: 'asset' as const, nodeId: 'test-image', assetId: 'avatar-default', alt: '', bounds: { x: 10, y: 20, width: 20, height: 20 }, fit },
    ] }
    expect(renderRegionContent({ region: imageRegion, logicalWidth: 390, assetBindings: new Map([['avatar-default', 'avatarDefault']]), tokens }).markup)
      .toContain(`mode="${mode}"`)
  })

  it('renders decoration colors and radii', () => {
    const decorationRegion = { ...region, content: [
      { kind: 'decoration' as const, nodeId: 'card-surface', decoration: 'surface' as const, bounds: { x: 10, y: 20, width: 100, height: 80 }, colorToken: 'cardSurface', radiusToken: 'cardRadius' },
    ] }
    const result = renderRegionContent({ region: decorationRegion, logicalWidth: 390, assetBindings: new Map(), tokens })
    expect(result.styles).toContain('background:var(--ui-color-card-surface)')
    expect(result.styles).toContain('border-radius:23.076923076923077rpx')
  })

  it('escapes text and attributes', () => {
    const unsafe = { ...region, content: [
      { kind: 'text' as const, nodeId: 'unsafe-text', text: '<script>{{evil}}</script>', role: 'body' as const, bounds: { x: 10, y: 20, width: 100, height: 20 } },
      { kind: 'asset' as const, nodeId: 'unsafe-image', assetId: 'avatar-default', alt: '" onerror="evil', bounds: { x: 10, y: 50, width: 20, height: 20 }, fit: 'cover' as const },
    ] }
    const result = renderRegionContent({ region: unsafe, logicalWidth: 390, assetBindings: new Map([['avatar-default', 'avatarDefault']]), tokens })
    expect(result.markup).not.toContain('<script>')
    expect(result.markup).not.toContain('alt="" onerror=')
    expect(result.markup).toContain('alt="&quot; onerror=&quot;evil"')
    expect(result.markup).toContain('&lt;script&gt;')
  })
})
