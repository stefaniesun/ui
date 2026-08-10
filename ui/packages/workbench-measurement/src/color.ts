import sharp from "sharp";
import type { ColorSample, Rect } from "@ui-rebuild/workbench-contracts";

export type ColorRole = ColorSample["role"];

function linearize(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function pivotLab(value: number): number {
  return value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
}

export function rgbToLab(red: number, green: number, blue: number): [number, number, number] {
  const r = linearize(red);
  const g = linearize(green);
  const b = linearize(blue);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = (r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const fx = pivotLab(x);
  const fy = pivotLab(y);
  const fz = pivotLab(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function toHex(value: number): string {
  return Math.round(value).toString(16).padStart(2, "0");
}

export async function sampleMedianColor(
  imagePath: string,
  region: Rect,
  role: ColorRole,
  id = `color-${role}`,
): Promise<ColorSample> {
  const { data, info } = await sharp(imagePath)
    .extract({ left: region.x, top: region.y, width: region.w, height: region.h })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels: number[][] = [[], [], []];
  for (let offset = 0; offset < data.length; offset += info.channels) {
    channels[0]?.push(data[offset] ?? 0);
    channels[1]?.push(data[offset + 1] ?? 0);
    channels[2]?.push(data[offset + 2] ?? 0);
  }
  const median = channels.map((channel) => {
    channel.sort((a, b) => a - b);
    return channel[Math.floor(channel.length / 2)] ?? 0;
  });
  const [red = 0, green = 0, blue = 0] = median;
  return {
    id,
    role,
    hex: `#${toHex(red)}${toHex(green)}${toHex(blue)}`,
    lab: rgbToLab(red, green, blue),
    sampleRegion: region,
    source: "tool",
    confidence: 1,
    reviewed: false,
  };
}
