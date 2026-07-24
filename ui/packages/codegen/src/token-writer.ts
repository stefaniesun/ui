import type { VisualIR } from '@ui-rebuild/contracts'

function tokenName(value: string): string {
  if (!/^[a-z][a-z0-9-]*$/u.test(value)) throw new Error(`Unsafe token name: ${value}`)
  return value
}
function color(value: string): string {
  if (!/^(?:#[0-9a-f]{3,8}|rgba?\([\d.,%\s]+\)|transparent)$/iu.test(value)) {
    throw new Error(`Unsafe color token: ${value}`)
  }
  return value
}
function rpx(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid logical pixel token: ${value}`)
  return `${value * 2}rpx`
}

export function writeTokens(tokens: VisualIR['tokens']): string {
  const lines = [':root {', '  --ui-color-page: #f5f6f8;']
  for (const [name, value] of Object.entries(tokens.colors)) {
    lines.push(`  --ui-color-${tokenName(name)}: ${color(value)};`)
  }
  for (const [name, value] of Object.entries(tokens.spacing)) {
    lines.push(`  --ui-space-${tokenName(name)}: ${rpx(value)};`)
  }
  for (const [name, value] of Object.entries(tokens.radii)) {
    lines.push(`  --ui-radius-${tokenName(name)}: ${rpx(value)};`)
  }
  lines.push('}', '')
  return lines.join('\n')
}
