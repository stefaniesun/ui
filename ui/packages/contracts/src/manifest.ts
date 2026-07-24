import path from 'node:path'
import { z } from 'zod'
import { isSafeProjectRelativePath, toPlatformRelativePath } from './path.js'

const finitePositive = z.number().finite().positive()
const finitePositiveInteger = z.number().finite().int().positive()
const safeRelativePath = z.string().min(1).refine(isSafeProjectRelativePath, {
  message: 'screenshot must be a project-relative path without traversal',
})

export const ScreenshotTypeSchema = z.enum(['viewport', 'fullpage'])

export const ManifestStateSchema = z.object({
  id: z.string().min(1),
  screenshot: safeRelativePath,
  screenshotType: ScreenshotTypeSchema,
  scale: finitePositive,
}).strict()

const ManifestBaseSchema = z.object({
  version: z.literal('1.0.0'),
  projectId: z.string().min(1),
  pageId: z.string().min(1),
  device: z.object({
    width: finitePositiveInteger,
    height: finitePositiveInteger,
    pixelRatio: finitePositive,
  }).strict(),
  states: z.array(ManifestStateSchema).min(1),
}).strict()

export const ManifestSchema = ManifestBaseSchema.superRefine((value, context) => {
  const stateIds = new Set<string>()
  for (const [index, state] of value.states.entries()) {
    if (stateIds.has(state.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate state id: ${state.id}`,
        path: ['states', index, 'id'],
      })
    }
    stateIds.add(state.id)
  }
})

export type ManifestInput = z.input<typeof ManifestSchema>
export type Manifest = z.output<typeof ManifestSchema>
export type FileExists = (absolutePath: string) => Promise<boolean>

export async function validateManifestFiles(
  manifest: Manifest,
  manifestDirectory: string,
  fileExists: FileExists,
): Promise<void> {
  const checks = new Map<string, { absolutePath: string; states: string[] }>()
  for (const state of manifest.states) {
    const normalized = toPlatformRelativePath(state.screenshot)
    const existing = checks.get(normalized)
    if (existing) {
      existing.states.push(state.id)
    } else {
      checks.set(normalized, {
        absolutePath: path.resolve(manifestDirectory, ...normalized.split('/')),
        states: [state.id],
      })
    }
  }

  const missing = (await Promise.all([...checks.entries()].map(async ([screenshot, check]) => ({
    screenshot,
    states: check.states,
    exists: await fileExists(check.absolutePath),
  })))).filter(result => !result.exists)

  if (missing.length > 0) {
    const details = missing.map(item => `${item.states.join(',')}: ${item.screenshot}`)
    throw new Error(`Missing manifest screenshots: ${details.join('; ')}`)
  }
}
