function srgbToLinear(value: number): number {
  const channel = value / 255
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function rgbToLab(red: number, green: number, blue: number): [number, number, number] {
  const r = srgbToLinear(red); const g = srgbToLinear(green); const b = srgbToLinear(blue)
  const x = ((r * 0.4124) + (g * 0.3576) + (b * 0.1805)) / 0.95047
  const y = ((r * 0.2126) + (g * 0.7152) + (b * 0.0722))
  const z = ((r * 0.0193) + (g * 0.1192) + (b * 0.9505)) / 1.08883
  const f = (value: number) => value > 0.008856 ? value ** (1 / 3) : (7.787 * value) + (16 / 116)
  const fx = f(x); const fy = f(y); const fz = f(z)
  return [(116 * fy) - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export function deltaE76(first: readonly number[], second: readonly number[]): number {
  const a = rgbToLab(first[0]!, first[1]!, first[2]!)
  const b = rgbToLab(second[0]!, second[1]!, second[2]!)
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}
