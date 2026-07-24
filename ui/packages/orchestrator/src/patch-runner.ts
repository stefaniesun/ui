import { PatchPlanSchema } from '@ui-rebuild/contracts'
import type { PatchPlanInput } from '@ui-rebuild/contracts'

export type PatchPayload = Readonly<Record<string, string>>
export function validatePatchPayload(planInput: PatchPlanInput, payload: PatchPayload): string[] {
  const plan = PatchPlanSchema.parse(planInput)
  const files = Object.keys(payload)
  if (files.length === 0) throw new Error('Patch payload is empty')
  for (const file of files) {
    if (!plan.allowedFiles.includes(file)) throw new Error(`File is not allowed by PatchPlan: ${file}`)
    if (typeof payload[file] !== 'string') throw new Error(`Patch must contain complete text content: ${file}`)
  }
  return files
}

export interface PatchWorkspace {
  read(file: string): Promise<string>
  write(file: string, content: string): Promise<void>
}
export async function applyPatchAtomically(workspace: PatchWorkspace, plan: PatchPlanInput, payload: PatchPayload): Promise<() => Promise<void>> {
  const files = validatePatchPayload(plan, payload)
  const originals = new Map<string, string>()
  for (const file of files) originals.set(file, await workspace.read(file))
  try {
    for (const file of files) await workspace.write(file, payload[file]!)
  } catch (error) {
    for (const [file, content] of originals) await workspace.write(file, content)
    throw error
  }
  return async () => { for (const [file, content] of originals) await workspace.write(file, content) }
}
