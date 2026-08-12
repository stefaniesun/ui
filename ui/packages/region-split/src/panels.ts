/**
 * 面板（卡片）检测。
 *
 * 候选切分线只做一维行分析，看不见"卡片"这个二维结构，因此分不清两种长得
 * 一模一样的横带：卡片**内部**的行间距，和卡片**之间**的留白。前者不是模块
 * 边界，后者是。这个模块补上那个缺失的维度。
 *
 * 判据：一行里有多大比例的像素与**这一行自己的页边距颜色**一致。
 * - 接近 1：整行都是页面底色，说明这一行在卡片之外 → 可以当模块边界
 * - 明显小于 1：行中间有卡片/内容，横穿它切开是错的
 *
 * 逐行取页边距颜色（而不是全局算一个底色）是必须的：页面顶部常有大面积彩色
 * 渐变页头，全局底色会被拽偏，导致哪一行都不匹配、整页被判成一整块面板。
 * 逐行比对则天然适应垂直渐变。
 */

export interface Panel {
  /** 原图坐标，闭开区间 [top, bottom) */
  top: number;
  bottom: number;
}

export interface RawImage { data: Buffer; width: number; height: number; channels: number }

/** 页边距取样宽度：卡片一定有侧边距，这几列几乎总是页面底色 */
const MARGIN_WIDTH = 8;
/**
 * 判定"同色"的欧氏距离阈值。必须小于白卡片(255)与浅灰底(245)之间的距离
 * （约 17.3），否则卡片会被当成底色，整个判据失效。
 */
const SAME_COLOR_DISTANCE = 12;
/** 一行的底色占比高于此值就算"敞开行"（不在任何卡片内） */
const OPEN_ROW_RATIO = 0.95;
/** 低于这个高度的面板视为噪声 */
const MIN_PANEL_HEIGHT = 8;

function pixel(raw: RawImage, x: number, y: number): [number, number, number] {
  const i = (y * raw.width + x) * raw.channels;
  return [raw.data[i]!, raw.data[i + 1]!, raw.data[i + 2]!];
}

function median(values: number[]): number {
  return values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
}

const distance = (a: [number, number, number], b: [number, number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** 这一行左右页边距的代表色 */
export function rowMarginColor(raw: RawImage, y: number): [number, number, number] {
  const samples: [number, number, number][] = [];
  const span = Math.min(MARGIN_WIDTH, Math.floor(raw.width / 4));
  for (let x = 0; x < span; x++) {
    samples.push(pixel(raw, x, y));
    samples.push(pixel(raw, raw.width - 1 - x, y));
  }
  return [0, 1, 2].map(c => median(samples.map(p => p[c]!))) as [number, number, number];
}

/** 这一行有多大比例与自己的页边距同色。1 表示整行都是页面底色。 */
export function rowOpenness(raw: RawImage, y: number): number {
  const margin = rowMarginColor(raw, y);
  let same = 0;
  for (let x = 0; x < raw.width; x++) {
    if (distance(pixel(raw, x, y), margin) < SAME_COLOR_DISTANCE) same++;
  }
  return same / raw.width;
}

/** 逐行的"敞开"标记：true = 这一行不在任何卡片内 */
export function openRows(raw: RawImage): boolean[] {
  return Array.from({ length: raw.height }, (_, y) => rowOpenness(raw, y) >= OPEN_ROW_RATIO);
}

/** 由敞开标记推出面板：连续的非敞开行就是一块面板 */
export function panelsFromOpenRows(open: boolean[]): Panel[] {
  const panels: Panel[] = [];
  let start = -1;
  for (let y = 0; y <= open.length; y++) {
    const isOpen = y === open.length ? true : open[y]!;
    if (!isOpen && start < 0) start = y;
    if (isOpen && start >= 0) {
      if (y - start >= MIN_PANEL_HEIGHT) panels.push({ top: start, bottom: y });
      start = -1;
    }
  }
  return panels;
}

export function detectPanels(raw: RawImage): Panel[] {
  return panelsFromOpenRows(openRows(raw));
}

/** y 是否落在某块面板内部（碰到面板的上下边缘不算，那正是合法的切分位置） */
export function crossesPanel(panels: Panel[], y: number): boolean {
  return panels.some(panel => y > panel.top && y < panel.bottom);
}
