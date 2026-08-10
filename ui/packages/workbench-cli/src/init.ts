import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
export interface InitOptions { pageId: string; imagePath: string; scale: number; pagesRoot: string; statusBarHeightPx?: number }
export function initPage(options: InitOptions): { pageDir: string } {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(options.pageId)) throw new Error("pageId contains invalid characters");
  if (!existsSync(options.imagePath)) throw new Error(`image not found: ${options.imagePath}`);
  if (!(options.scale > 0)) throw new Error("scale must be positive");
  const pageDir = resolve(options.pagesRoot, options.pageId); const referenceDir = join(pageDir, "reference");
  mkdirSync(referenceDir, { recursive: true }); copyFileSync(options.imagePath, join(referenceDir, "default.png"));
  writeFileSync(join(pageDir, "manifest.yaml"), `pageId: ${options.pageId}\nscale: ${options.scale}\nstatusBarHeightPx: ${options.statusBarHeightPx ?? 44}\n`, "utf8");
  return { pageDir };
}
