import sharp from 'sharp'

export type SystemBarPolicy =
  | { mode: 'none' }
  | { mode: 'crop'; top: number }
  | { mode: 'mask'; top: number }

export interface ImageNormalization {
  logicalWidth: number
  logicalHeight: number
  sourceScale: number
  systemBarPolicy: SystemBarPolicy
  flattenBackground?: string
}

export interface NormalizedImage {
  data: Buffer
  width: number
  height: number
  png: Buffer
  defaultMasks: Array<{ x: number; y: number; width: number; height: number }>
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
}

export async function normalizeImage(
  input: Buffer,
  options: ImageNormalization,
): Promise<NormalizedImage> {
  positiveInteger(options.logicalWidth, 'logicalWidth')
  positiveInteger(options.logicalHeight, 'logicalHeight')
  if (!Number.isFinite(options.sourceScale) || options.sourceScale <= 0) {
    throw new Error('sourceScale must be finite and positive')
  }
  const metadata = await sharp(input, { failOn: 'error' }).metadata()
  const sourceWidth = options.logicalWidth * options.sourceScale
  const policyTop = options.systemBarPolicy.mode === 'none' ? 0 : options.systemBarPolicy.top
  if (!Number.isFinite(policyTop) || policyTop < 0) {
    throw new Error('system bar top must be finite and nonnegative')
  }
  const croppedTop = options.systemBarPolicy.mode === 'crop' ? policyTop : 0
  const sourceHeight = (options.logicalHeight + croppedTop) * options.sourceScale
  if (metadata.width !== sourceWidth || metadata.height !== sourceHeight) {
    throw new Error(
      `Image dimensions ${metadata.width}x${metadata.height} do not match expected `
      + `${sourceWidth}x${sourceHeight}; check viewport/fullpage, scale, and system bar policy.`,
    )
  }
  let pipeline = sharp(input, { failOn: 'error' })
    .extract({
      left: 0,
      top: Math.round(croppedTop * options.sourceScale),
      width: Math.round(sourceWidth),
      height: Math.round(options.logicalHeight * options.sourceScale),
    })
  if (options.flattenBackground) pipeline = pipeline.flatten({ background: options.flattenBackground })
  const png = await pipeline
    .toColourspace('srgb')
    .resize(options.logicalWidth, options.logicalHeight, {
      fit: 'fill',
      kernel: options.sourceScale === 1 ? sharp.kernel.nearest : sharp.kernel.lanczos3,
    })
    .ensureAlpha()
    .png()
    .toBuffer()
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const defaultMasks = options.systemBarPolicy.mode === 'mask' && policyTop > 0
    ? [{ x: 0, y: 0, width: options.logicalWidth, height: policyTop }]
    : []
  return { data, width: info.width, height: info.height, png, defaultMasks }
}
