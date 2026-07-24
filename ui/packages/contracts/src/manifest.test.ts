import { describe, expect, it } from 'vitest'
import { ManifestSchema, validateManifestFiles } from './manifest.js'

function createManifest() {
  return {
    version: '1.0.0',
    projectId: 'uinotes-demo',
    pageId: 'profile',
    device: { width: 396, height: 842, pixelRatio: 3 },
    states: [{
      id: 'default',
      screenshot: 'reference/default.png',
      screenshotType: 'viewport',
      scale: 3,
    }],
  }
}

describe('ManifestSchema', () => {
  it('requires screenshot type and scale for coordinate normalization', () => {
    const result = ManifestSchema.parse(createManifest())
    expect(result.states[0]?.screenshotType).toBe('viewport')
    expect(result.states[0]?.scale).toBe(3)
  })

  it('rejects non-positive device dimensions', () => {
    const input = createManifest()
    input.device.width = 0
    expect(() => ManifestSchema.parse(input)).toThrow()
  })

  it('rejects duplicate state ids', () => {
    const input = createManifest()
    input.states.push({ ...input.states[0]! })
    expect(() => ManifestSchema.parse(input)).toThrow(/duplicate state id/i)
  })

  it('reports missing screenshots with their manifest path', async () => {
    const result = ManifestSchema.parse(createManifest())
    await expect(validateManifestFiles(result, 'C:/fixture', async () => false))
      .rejects.toThrow(/reference\/default\.png/i)
  })
})
