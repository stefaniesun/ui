import { spawn } from "node:child_process";
import { resolve } from "node:path";
export function openWorkbench(options: { pageId: string; pagesRoot: string; workspaceRoot?: string }): void {
  const workspace = resolve(options.workspaceRoot ?? process.cwd()); const env = { ...process.env, WORKBENCH_PAGES_ROOT: resolve(options.pagesRoot) };
  const corepack = process.platform === "win32" ? "corepack.cmd" : "corepack";
  spawn(corepack, ["pnpm", "--filter", "@ui-rebuild/workbench-server", "dev"], { cwd: workspace, env, stdio: "inherit" });
  spawn(corepack, ["pnpm", "--filter", "@ui-rebuild/workbench", "dev"], { cwd: workspace, env, stdio: "inherit" });
  const url = `http://127.0.0.1:4173/?page=${encodeURIComponent(options.pageId)}`; console.log(url);
  if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
}
