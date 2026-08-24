import type { ElementKind } from "@region-split/core/browser";

/** 界面上一律用中文。类型的英文名只在数据里存在，不该出现在人眼前。 */
export const KIND_LABEL: Record<ElementKind, string> = {
  component: "组件", grid: "网格", text: "文字",
  icon: "图标", image: "图片", decoration: "装饰",
};

/** 元素框用互不相同的颜色帮助用户快速识别类型。 */
export const KIND_COLOR: Record<ElementKind, string> = {
  component: "#55a4ff", grid: "#3ecf8e", text: "#ffd166",
  icon: "#c792ea", image: "#ff8a5b", decoration: "#8a94a6",
};
