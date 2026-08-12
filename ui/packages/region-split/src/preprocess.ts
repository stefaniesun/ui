import sharp from "sharp";

/**
 * 上传后的预处理：抹掉手机系统外壳（顶部状态栏的时间/信号/电量、底部 Home Indicator），
 * 得到一张只剩设计内容的干净图。
 *
 * 两条硬约束：
 * 1. **不改分辨率**——只重写像素，绝不缩放或裁剪，输出与原图同宽同高。
 * 2. **不编造内容**——背景用相邻干净行逐列外推得到，是确定性计算，不是生成模型。
 *    外推不安全时（相邻区域是内容而非背景）宁可不动，也不硬填。
 *
 * 之所以逐列而不是逐行取色：状态栏背景常有横向渐变，按行填会丢掉横向变化、
 * 出现明显横条纹；按列从下方取样则天然保留横向结构。
 */

/** 系统外壳所在的横带，坐标为原图像素 */
export interface ChromeBand {
  edge: "top" | "bottom";
  height: number;
  /** 该带内被判定为图标/文字的像素占比，用于诊断 */
  glyphRatio: number;
}

export interface PreprocessResult {
  /** 清理后的 PNG，与原图同尺寸；没有可清理的内容时是原图的等价副本 */
  png: Buffer;
  width: number;
  height: number;
  removed: ChromeBand[];
  /** 检测到但因外推不安全而放弃清理的带 */
  skipped: ChromeBand[];
}

/** 状态栏高度占整屏的比例区间。iPhone 刘海屏约 5–6.5%，安卓与老机型略小。 */
const TOP_BAND_MIN_RATIO = 0.03;
const TOP_BAND_MAX_RATIO = 0.10;
/** Home Indicator 连同下方留白的比例区间 */
const BOTTOM_BAND_MIN_RATIO = 0.015;
const BOTTOM_BAND_MAX_RATIO = 0.06;

/** 判定为"图标/文字像素"的色差阈值（与本行背景色比） */
const GLYPH_DELTA = 24;
/**
 * 一行里图标像素占比低于此值就算作干净行。
 * 不能设得太低：抗锯齿边缘会让个别行出现零点几个百分点的"图标"，
 * 那种噪声行会把图标簇割开，导致把噪声和真正的状态栏当成两段。
 * 真正的图标行占比在 4% 以上，1% 能干净地把两者分开。
 */
const MIN_GLYPH_RATIO = 0.01;
/** 图标簇必须紧贴这条边开始，否则说明这边没有系统外壳，扫到的是页面内容 */
const MAX_GLYPH_START_RATIO = 0.035;
/** 高于此值说明这不是系统外壳，而是真实内容 */
const MAX_GLYPH_RATIO = 0.35;

/** 外推取样的行数 */
const SAMPLE_ROWS = 20;
/** 取样列在垂直方向的最大允许波动；超过说明取样区是内容不是背景 */
const SAMPLE_STABLE_SPREAD = 40;
/** 不平稳列占比超过此值就放弃清理 */
const MAX_UNSTABLE_COLUMN_RATIO = 0.15;

interface Raw { data: Buffer; width: number; height: number; channels: number }

function pixel(raw: Raw, x: number, y: number): [number, number, number] {
  const i = (y * raw.width + x) * raw.channels;
  return [raw.data[i]!, raw.data[i + 1]!, raw.data[i + 2]!];
}

function median(values: number[]): number {
  return values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
}

/** 一行里偏离该行背景色（取中位）较远的像素占比 */
function rowGlyphRatio(raw: Raw, y: number): number {
  const row = Array.from({ length: raw.width }, (_, x) => pixel(raw, x, y));
  const base = [0, 1, 2].map(c => median(row.map(p => p[c]!)));
  const far = row.filter(p =>
    Math.hypot(p[0] - base[0]!, p[1] - base[1]!, p[2] - base[2]!) > GLYPH_DELTA);
  return far.length / raw.width;
}

/**
 * 找系统外壳带的下边界：从边缘向内扫，找到**第一段图标簇之后的第一个干净间隙**。
 *
 * 不能用"扫描范围内最后一行有图标"——系统外壳和它下面的页面内容之间隔着一段留白，
 * 用"最后一行"会一路吃到导航栏标题或协议文字上，把真实设计内容一起抹掉。
 * 找不到图标就说明这条边本来就没有系统外壳。
 */
function detectBand(raw: Raw, edge: "top" | "bottom"): ChromeBand | null {
  const minH = Math.round(raw.height * (edge === "top" ? TOP_BAND_MIN_RATIO : BOTTOM_BAND_MIN_RATIO));
  const maxH = Math.round(raw.height * (edge === "top" ? TOP_BAND_MAX_RATIO : BOTTOM_BAND_MAX_RATIO));
  if (maxH < 2) return null;
  // 判定"间隙"所需的连续干净行数，随图片尺寸缩放
  const gapRows = Math.max(6, Math.round(raw.height * 0.003));

  // 先把整个扫描窗口的图标掩码算出来，再按"簇"处理。
  // 逐行状态机的写法在这里会翻车：一行抗锯齿噪声就会提前触发间隙判定，
  // 切出一个过小的假带，然后因为低于 minH 被整个否决，真正的状态栏反而漏掉。
  const ratios = Array.from({ length: maxH }, (_, depth) =>
    rowGlyphRatio(raw, edge === "top" ? depth : raw.height - 1 - depth));
  const isGlyph = ratios.map(ratio => ratio > MIN_GLYPH_RATIO);

  // 把间隔小于 gapRows 的相邻图标行并成一簇，取第一个够大的簇
  const maxStart = Math.round(raw.height * MAX_GLYPH_START_RATIO);
  let start = -1;
  let end = -1;
  for (let depth = 0; depth < maxH; depth++) {
    if (!isGlyph[depth]) continue;
    if (start < 0) start = depth;
    else if (depth - end > gapRows) {
      // 与上一簇隔得够远：如果上一簇已经够大就用它，否则丢掉重新开始
      if (end + 3 >= minH) break;
      start = depth;
    }
    end = depth;
  }
  if (start < 0) return null;                      // 这条边没有图标
  if (start > maxStart) return null;               // 图标不贴边，是页面内容不是系统外壳

  // 簇尾再留 2px 余量吃掉抗锯齿残留
  const height = Math.min(maxH, end + 3);
  if (height < minH) return null;

  // 图标密度只在带内统计——用整个扫描窗口会把带下方的页面内容算进来
  const glyphRatio = ratios.slice(0, height).reduce((sum, r) => sum + r, 0) / height;
  if (glyphRatio > MAX_GLYPH_RATIO) return null;   // 内容太密，不是系统外壳
  return { edge, height, glyphRatio };
}

/**
 * 用紧邻干净行逐列外推填充整条带。返回是否执行了填充——
 * 取样区在垂直方向不平稳（说明是内容不是背景）时不动任何像素。
 */
function fillBand(raw: Raw, band: ChromeBand): boolean {
  const sampleStart = band.edge === "top" ? band.height : raw.height - band.height - SAMPLE_ROWS;
  if (sampleStart < 0 || sampleStart + SAMPLE_ROWS > raw.height) return false;

  const columnMeans: [number, number, number][] = [];
  let unstable = 0;
  for (let x = 0; x < raw.width; x++) {
    const rows = Array.from({ length: SAMPLE_ROWS }, (_, k) => pixel(raw, x, sampleStart + k));
    const mean = [0, 1, 2].map(c => rows.reduce((s, p) => s + p[c]!, 0) / rows.length);
    const spread = Math.max(...[0, 1, 2].map(c => {
      const vals = rows.map(p => p[c]!);
      return Math.max(...vals) - Math.min(...vals);
    }));
    if (spread > SAMPLE_STABLE_SPREAD) unstable++;
    columnMeans.push(mean as [number, number, number]);
  }
  if (unstable / raw.width > MAX_UNSTABLE_COLUMN_RATIO) return false;

  for (let x = 0; x < raw.width; x++) {
    const mean = columnMeans[x]!;
    for (let depth = 0; depth < band.height; depth++) {
      const y = band.edge === "top" ? depth : raw.height - 1 - depth;
      const i = (y * raw.width + x) * raw.channels;
      for (let c = 0; c < 3; c++) raw.data[i + c] = Math.round(mean[c]!);
    }
  }
  return true;
}

export async function preprocessScreenshot(buffer: Buffer): Promise<PreprocessResult> {
  const { data, info } = await sharp(buffer).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const raw: Raw = { data, width: info.width, height: info.height, channels: info.channels };

  const removed: ChromeBand[] = [];
  const skipped: ChromeBand[] = [];
  for (const edge of ["top", "bottom"] as const) {
    const band = detectBand(raw, edge);
    if (!band) continue;
    (fillBand(raw, band) ? removed : skipped).push(band);
  }

  // 原尺寸写回，不做任何缩放
  const png = await sharp(raw.data, {
    raw: { width: raw.width, height: raw.height, channels: raw.channels as 3 | 4 },
  }).png().toBuffer();

  return { png, width: raw.width, height: raw.height, removed, skipped };
}
