import { emitHtml } from "./emit-html.js";
import type { ElementTree } from "./element-types.js";
import type { Rect } from "./types.js";

export interface PageRegionInput {
  region: Rect;
  tree: ElementTree;
}

export interface EmitPageInput {
  designWidth: number;
  regions: readonly PageRegionInput[];
  assets?: (nodeKey: string) => string | undefined;
  inlineSvg?: (nodeKey: string) => string | undefined;
  fontStack?: string;
}

export interface EmitPageOutput {
  html: string;
  css: string;
}

/**
 * 把区域诊断 emitter 组合为全页交付物。区域按真实 y 定位，不假设连续或无重叠。
 */
export function emitPage(input: EmitPageInput): EmitPageOutput {
  if (!Number.isFinite(input.designWidth) || input.designWidth <= 0) {
    throw new Error("designWidth must be a positive finite number");
  }
  const regions = [...input.regions].sort((a, b) => a.region.y - b.region.y || a.region.x - b.region.x);
  const pageHeight = regions.reduce((height, item) => Math.max(height, item.region.y + item.region.h), 0);
  const html: string[] = [];
  const pageDeclarations = [
    "position: relative", "width: 100vw",
    `height: ${(pageHeight / input.designWidth) * 100}vw`, "overflow: hidden",
    ...(input.fontStack ? [`font-family: ${input.fontStack}`] : []),
  ];
  const css: string[] = [
    "* { box-sizing: border-box; }",
    "html, body { margin: 0; min-height: 100%; }",
    `.page { ${pageDeclarations.join("; ")}; }`,
  ];

  regions.forEach((item, index) => {
    const assetSources = Object.fromEntries(item.tree.nodes.flatMap(node => {
      const source = input.assets?.(`${index}:${node.id}`);
      return source === undefined ? [] : [[node.id, source]];
    }));
    const inlineSvgSources = Object.fromEntries(item.tree.nodes.flatMap(node => {
      const source = input.inlineSvg?.(`${index}:${node.id}`);
      return source === undefined ? [] : [[node.id, source]];
    }));
    const emitted = emitHtml({
      designWidth: input.designWidth,
      region: item.region,
      tree: item.tree,
      assetSources,
      inlineSvgSources,
      classPrefix: `r${index}-`,
    });
    const regionClass = `page-region-r${index}`;
    html.push(emitted.html.replace('class="region"', `class="page-region ${regionClass}"`));
    css.push(emitted.css.replaceAll(".region", `.${regionClass}`));
    css.push(`.${regionClass} { position: absolute; left: ${(item.region.x / input.designWidth) * 100}vw; top: ${(item.region.y / input.designWidth) * 100}vw; }`);
  });

  return {
    html: [
      "<!doctype html>",
      '<html lang="zh-CN">',
      "<head>",
      '  <meta charset="UTF-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '  <link rel="stylesheet" href="style.css">',
      "</head>",
      "<body>",
      '  <main class="page">',
      ...html.map(fragment => fragment.split("\n").map(line => `    ${line}`).join("\n")),
      "  </main>",
      "</body>",
      "</html>",
    ].join("\n"),
    css: `${css.join("\n\n")}\n`,
  };
}
