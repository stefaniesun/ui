import path from 'node:path'
import { z } from 'zod'
import { isSafeProjectRelativePath, toPlatformRelativePath } from './path.js'

const finitePositive = z.number().finite().positive()
const finitePositiveInteger = z.number().finite().int().positive()
const safeRelativePath = z.string().min(1).refine(isSafeProjectRelativePath, {
  message: 'screenshot must be a project-relative path without traversal',
})

export const ScreenshotTypeSchema = z.enum(['viewport', 'fullpage'])

export const ContentViewportSchema = z.object({
  x: z.number().finite().int().nonnegative(),
  y: z.number().finite().int().nonnegative(),
  width: finitePositiveInteger,
  height: finitePositiveInteger,
}).strict()

export const ManifestStateSchema = z.object({
  id: z.string().min(1),
  screenshot: safeRelativePath,
  screenshotType: ScreenshotTypeSchema,
  scale: finitePositive,
  contentViewport: ContentViewportSchema.optional(),
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
export interface FileInspection {
  exists: boolean
  isFile: boolean
  realPath: string | null
}
export type InspectFile = (absolutePath: string) => Promise<FileInspection>
export type ResolveRealPath = (absolutePath: string) => Promise<string>

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export async function validateManifestFiles(
  manifest: Manifest,
  manifestDirectory: string,
  inspectFile: InspectFile,
  resolveRealPath: ResolveRealPath = async value => path.resolve(value),
): Promise<void> {
  const realRoot = await resolveRealPath(manifestDirectory)
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

  const failures = (await Promise.all([...checks.entries()].map(async ([screenshot, check]) => {
    const inspection = await inspectFile(check.absolutePath)
    let reason: string | null = null
    if (!inspection.exists) {
      reason = 'missing'
    } else if (!inspection.isFile) {
      reason = 'not a regular file'
    } else if (inspection.realPath === null || !isPathInside(realRoot, inspection.realPath)) {
      reason = 'real path is outside manifest directory'
    }
    return { screenshot, states: check.states, reason }
  }))).filter(result => result.reason !== null)

  if (failures.length > 0) {
    const details = failures.map(item => (
      `${item.states.join(',')}: ${item.screenshot} (${item.reason})`
    ))
    throw new Error(`Invalid manifest screenshots: ${details.join('; ')}`)
  }
}
