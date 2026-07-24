export interface PolicyViolation { rule: string; file: string; message: string }

export function inspectGeneratedFiles(files: Readonly<Record<string, string>>): PolicyViolation[] {
  const violations: PolicyViolation[] = []
  for (const [file, content] of Object.entries(files)) {
    if (/background(?:-image)?\s*:[^;]*reference\//iu.test(content)) {
      violations.push({ rule: 'no-reference-background', file, message: 'Reference screenshots cannot be page backgrounds' })
    }
    const absoluteCount = content.match(/position\s*:\s*absolute/giu)?.length ?? 0
    if (absoluteCount > 4) violations.push({ rule: 'absolute-position-limit', file, message: 'Too many absolute-positioned nodes' })
    if (content.split('\n').length > 300) violations.push({ rule: 'file-size-limit', file, message: 'Generated file exceeds 300 lines' })
    if (file.endsWith('index.vue') && !content.includes('data-region-id=')) {
      violations.push({ rule: 'semantic-region-required', file, message: 'Page has no semantic region bindings' })
    }
  }
  return violations
}

export function assertHealthyGeneratedFiles(files: Readonly<Record<string, string>>): void {
  const violations = inspectGeneratedFiles(files)
  if (violations.length > 0) throw new Error(violations.map(item => `${item.file}: ${item.message}`).join('; '))
}
