export interface PolicyViolation { rule: string; file: string; message: string }

export function inspectGeneratedFiles(files: Readonly<Record<string, string>>): PolicyViolation[] {
  const violations: PolicyViolation[] = []
  for (const [file, content] of Object.entries(files)) {
    if (/background(?:-image)?\s*:[^;}]*url\([^)]*(?:reference\/|\.png|\.jpe?g|\.webp)/iu.test(content)) {
      violations.push({ rule: 'no-page-image-background', file, message: 'Page screenshots/images cannot be layout backgrounds' })
    }
    const absoluteCount = content.match(/position\s*:\s*absolute/giu)?.length ?? 0
    if (absoluteCount > 4) violations.push({ rule: 'absolute-position-limit', file, message: 'Too many absolute-positioned nodes' })
    if (content.split('\n').length > 300) violations.push({ rule: 'file-size-limit', file, message: 'Generated file exceeds 300 lines' })
    const repeatedGridItems = content.match(/<view\s+class="[^"]*(?:item|cell)[^"]*"/giu)?.length ?? 0
    if (repeatedGridItems >= 4 && !content.includes('v-for=')) {
      violations.push({ rule: 'data-driven-grid', file, message: 'Repeated grid items must use v-for data rendering' })
    }
    if (file.includes('/components/') && !content.includes('data-region-id=')) {
      violations.push({ rule: 'semantic-region-required', file, message: 'Semantic component has no region binding' })
    }

  }
  return violations
}

export function assertHealthyGeneratedFiles(files: Readonly<Record<string, string>>): void {
  const violations = inspectGeneratedFiles(files)
  if (violations.length > 0) throw new Error(violations.map(item => `${item.file}: ${item.message}`).join('; '))
}
