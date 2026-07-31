import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { Manifest } from '@ui-rebuild/contracts'
import { normalizeReferenceImage } from './reference-image.js'

const manifest: Manifest = {
  version: '1.0.0',
  projectId: 'crop-test',
  pageId: 'crop-test',
  device: { width: 2, height: 2, pixelRatio: 1 },
  states: [{
    id: 'default',
    screenshot: 'reference/default.png',
    screenshotType: 'viewport',
    scale: 2,
    contentViewport: { x: 0, y: 2, width: 4, height: 4 },
  }],
}

async function stripedImage() {
  return sharp({
    create: { width: 4, height: 8, channels: 3, background: '#ff0000' },
  }).composite([
    { input: { create: { width: 4, height: 4, channels: 3, background: '#00ff00' } }, top: 2, left: 0 },
    { input: { create: { width: 4, height: 2, channels: 3, background: '#0000ff' } }, top: 6, left: 0 },
  ]).png().toBuffer()
}

describe('normalizeReferenceImage', () => {
  it('removes captured shell pixels and resizes to the logical canvas', async () => {
    const result = await normalizeReferenceImage(await stripedImage(), manifest, manifest.states[0]!)
    const image = sharp(result)
    expect(await image.metadata()).toMatchObject({ width: 2, height: 2, format: 'png' })
    const { data } = await image.raw().toBuffer({ resolveWithObject: true })
    for (let offset = 0; offset < data.length; offset += 3) {
      expect([...data.subarray(offset, offset + 3)]).toEqual([0, 255, 0])
    }
  })

  it('rejects a crop whose physical dimensions do not match logical size and scale', async () => {
    const invalid = {
      ...manifest.states[0]!,
      contentViewport: { x: 0, y: 2, width: 3, height: 4 },
    }
    await expect(normalizeReferenceImage(await stripedImage(), manifest, invalid))
      .rejects.toThrow(/expected 4x4/i)
  })

  it('rejects a crop outside the actual source image', async () => {
    const invalid = {
      ...manifest.states[0]!,
      contentViewport: { x: 0, y: 6, width: 4, height: 4 },
    }
    await expect(normalizeReferenceImage(await stripedImage(), manifest, invalid))
      .rejects.toThrow(/outside source image/i)
  })

  it('rejects an uncropped viewport whose physical dimensions do not match scale', async () => {
    const state = { ...manifest.states[0]!, contentViewport: undefined }
    await expect(normalizeReferenceImage(await stripedImage(), manifest, state))
      .rejects.toThrow(/expected 4x4/i)
  })
})
