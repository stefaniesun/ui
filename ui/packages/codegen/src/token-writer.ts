import type { VisualIR } from '@ui-rebuild/contracts'

export function writeTokens(tokens: VisualIR['tokens']): string {
  const lines = ['$ui-colors: (']
  for (const [name, value] of Object.entries(tokens.colors)) lines.push(`  '${name}': ${value},`)
  lines.push(');', ':root {')
  for (const [name, value] of Object.entries(tokens.colors)) lines.push(`  --ui-color-${name}: ${value};`)
  for (const [name, value] of Object.entries(tokens.spacing)) lines.push(`  --ui-space-${name}: ${value}px;`)
  for (const [name, value] of Object.entries(tokens.radii)) lines.push(`  --ui-radius-${name}: ${value}px;`)
  lines.push('}', '')
  return lines.join('\n')
}
