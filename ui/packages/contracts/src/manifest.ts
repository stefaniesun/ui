import path from 'node:path'
import { z } from 'zod'

export const ScreenshotTypeSchema = z.enum(['viewport', 'fullpage'])

export const ManifestStateSchema = z.object({
  id: z.string().min(1),
  screenshot: z.string().min(1),
  screenshotType: ScreenshotTypeSchema,
  scale: z.number().positive(),
})

const ManifestBaseSchema = z.object({
  version: z.literal('1.0.0'),
  projectId: z.string().min(1),
  pageId: z.string().min(1),
  device: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    pixelRatio: z.number().positive(),
  }),
  states: z.array(ManifestStateSchema).min(1),
})

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

export type Manifest = z.infer<typeof ManifestSchema>
export type FileExists = (absolutePath: string) => Promise<boolean>

export async function validateManifestFiles(
  manifest: Manifest,
  manifestDirectory: string,
  fileExists: FileExists,
): Promise<void> {
  const missing: string[] = []
  for (const state of manifest.states) {
    const absolutePath = path.resolve(manifestDirectory, state.screenshot)
    if (!await fileExists(absolutePath)) {
      missing.push(state.screenshot)
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing manifest screenshots: ${missing.join(', ')}`)
  }
}
