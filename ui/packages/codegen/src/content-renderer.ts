import type { RegionNode, VisualIR } from '@ui-rebuild/contracts'
import { logicalPxToRpx } from './token-writer.js'

export interface RenderRegionContentInput {
  region: RegionNode
  logicalWidth: number
  assetBindings: ReadonlyMap<string, string>
  tokens: VisualIR['tokens']
}

export interface RenderedRegionContent {
  markup: string
  styles: string
  usesAssets: boolean
}

function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('{', '&#123;')
    .replaceAll('}', '&#125;')
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function classSuffix(value: string): string {
  if (!/^[a-z][a-z0-9-]*$/u.test(value)) throw new Error(`Unsafe content nodeId: ${value}`)
  return value
}

function tokenSuffix(value: string): string {
  const suffix = value.replaceAll('.', '-').replace(/([a-z0-9])([A-Z])/gu, '$1-$2').toLowerCase()
  if (!/^[a-z][a-z0-9-]*$/u.test(suffix)) throw new Error(`Unsafe token name: ${value}`)
  return suffix
}

export function renderRegionContent(input: RenderRegionContentInput): RenderedRegionContent {
  const markup: string[] = []
  const styles: string[] = []
  let usesAssets = false

  for (const node of input.region.content) {
    const suffix = classSuffix(node.nodeId)
    const className = `content-${suffix}`
    if (node.kind === 'text') {
      markup.push(`    <text class="content-node content-text ${className}" data-content-id="${suffix}">${escapeText(node.text)}</text>`)
    } else if (node.kind === 'asset') {
      const binding = input.assetBindings.get(node.assetId)
      if (binding === undefined) throw new Error(`Missing generated asset binding: ${node.assetId}`)
      usesAssets = true
      const mode = node.fit === 'cover' ? 'aspectFill' : node.fit === 'fill' ? 'scaleToFill' : 'aspectFit'
      markup.push(`    <image class="content-node content-asset ${className}" data-content-id="${suffix}" :src="assets.${binding}" alt="${escapeAttribute(node.alt)}" mode="${mode}" />`)
    } else if (node.kind === 'control') {
      markup.push(`    <button class="content-node content-control ${className}" data-content-id="${suffix}">${escapeText(node.label)}</button>`)
    } else {
      markup.push(`    <view class="content-node content-decoration ${className}" data-content-id="${suffix}" aria-hidden="true" />`)
    }

    const left = node.bounds.x - input.region.bounds.x
    const top = node.bounds.y - input.region.bounds.y
    const toRpx = (value: number) => `${value / input.logicalWidth * 750}rpx`
    const declarations = [
      `left:${toRpx(left)}`,
      `top:${toRpx(top)}`,
      `width:${logicalPxToRpx(node.bounds.width, input.logicalWidth)}`,
      `height:${logicalPxToRpx(node.bounds.height, input.logicalWidth)}`,
    ]
    if (node.kind === 'text') {
      if (node.colorToken !== undefined) declarations.push(`color:var(--ui-color-${tokenSuffix(node.colorToken)})`)
      if (node.typographyToken !== undefined) {
        const typography = input.tokens.typography[node.typographyToken]
        if (typography === undefined) throw new Error(`Missing typography token: ${node.typographyToken}`)
        declarations.push(`font-size:${logicalPxToRpx(typography.fontSize, input.logicalWidth)}`)
        declarations.push(`font-weight:${typography.fontWeight}`)
        declarations.push(`line-height:${logicalPxToRpx(typography.lineHeight, input.logicalWidth)}`)
      }
    } else if (node.kind === 'decoration') {
      if (node.colorToken !== undefined) declarations.push(`background:var(--ui-color-${tokenSuffix(node.colorToken)})`)
      if (node.radiusToken !== undefined) {
        const radius = input.tokens.radii[node.radiusToken]
        if (radius === undefined) throw new Error(`Missing radius token: ${node.radiusToken}`)
        declarations.push(`border-radius:${logicalPxToRpx(radius, input.logicalWidth)}`)
      }
    }
    styles.push(`.${className}{${declarations.join(';')}}`)
  }

  return {
    markup: markup.join('\n'),
    styles: `.content-node{position:absolute;box-sizing:border-box}\n${styles.join('\n')}`,
    usesAssets,
  }
}
