import sharp from 'sharp'

export interface NormalizedImage { data: Buffer; width: number; height: number }

export async function normalizeImage(
  input: Buffer,
  width: number,
  height: number,
): Promise<NormalizedImage> {
  const { data, info } = await sharp(input, { failOn: 'error' })
    .removeAlpha()
    .toColourspace('srgb')
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

export function maskedPixel(mask: readonly boolean[], index: number): boolean {
  return mask[Math.floor(index / 4)] ?? false
}
