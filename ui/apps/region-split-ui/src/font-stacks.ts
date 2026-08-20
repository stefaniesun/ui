export interface FontStackOption {
  id: "windows" | "android" | "ios";
  label: string;
  value: string;
}

export const FONT_STACKS: readonly FontStackOption[] = [
  { id: "windows", label: "Windows", value: 'Arial, "Microsoft YaHei", sans-serif' },
  { id: "android", label: "Android", value: 'Roboto, "Noto Sans CJK SC", "Source Han Sans SC", sans-serif' },
  { id: "ios", label: "iOS", value: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "PingFang SC", sans-serif' },
];

export const DEFAULT_FONT_STACK = FONT_STACKS[0]!;
