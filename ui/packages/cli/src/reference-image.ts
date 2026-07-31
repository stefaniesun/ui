import sharp from 'sharp'
import type { Manifest } from '@ui-rebuild/contracts'

export async function normalizeReferenceImage(
  input: Buffer,
  manifest: Manifest,
  state: Manifest['states'][number],
): Promise<Buffer> {
  const metadata = await sharp(input).metadata()
  if (metadata.width === undefined || metadata.height === undefined) {
    throw new Error(`Reference image has no dimensions: ${state.screenshot}`)
  }

  const expectedWidth = Math.round(manifest.device.width * state.scale)
  const expectedHeight = Math.round(manifest.device.height * state.scale)
  let pipeline = sharp(input).toColorspace('srgb').removeAlpha()
  if (state.contentViewport !== undefined) {
    const viewport = state.contentViewport
    if (viewport.width !== expectedWidth || viewport.height !== expectedHeight) {
      throw new Error(`Content viewport for ${state.screenshot} is ${viewport.width}x${viewport.height}; expected ${expectedWidth}x${expectedHeight}`)
    }
    if (viewport.x + viewport.width > metadata.width || viewport.y + viewport.height > metadata.height) {
      throw new Error(`Content viewport is outside source image ${metadata.width}x${metadata.height}: ${state.screenshot}`)
    }
    pipeline = pipeline.extract({
      left: viewport.x,
      top: viewport.y,
      width: viewport.width,
      height: viewport.height,
    })
  } else {
    if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
      throw new Error(`Reference image ${state.screenshot} is ${metadata.width}x${metadata.height}; expected ${expectedWidth}x${expectedHeight} without contentViewport`)
    }
  }

  return pipeline
    .resize(manifest.device.width, manifest.device.height, { fit: 'fill' })
    .png()
    .toBuffer()
}
