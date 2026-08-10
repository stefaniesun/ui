import { execFileSync } from "node:child_process";
export interface DoctorCheck { name: string; ok: boolean; message: string; warning?: boolean }
function command(file: string, args: string[]): boolean { try { execFileSync(file, args, { stdio: "ignore" }); return true; } catch { return false; } }
export function doctor(): DoctorCheck[] {
  const major = Number(process.versions.node.split(".")[0]); const python = command("python", ["--version"]);
  const checks: DoctorCheck[] = [
    { name: "Node >= 22", ok: major >= 22, message: major >= 22 ? process.version : "请安装 Node.js 22 或更高版本" },
    { name: "Python", ok: python, message: python ? "可用" : "请安装 Python 并加入 PATH" },
    { name: "RapidOCR", ok: python && command("python", ["-c", "import rapidocr_onnxruntime"]), message: "缺失时运行 pip install rapidocr-onnxruntime" },
    { name: "多模态模型", ok: Boolean(process.env.UIR_MODEL_BASE_URL), warning: true, message: process.env.UIR_MODEL_BASE_URL ? "已配置" : "未配置 UIR_MODEL_BASE_URL，标注提案不可用" },
  ];
  for (const item of checks) console.log(`${item.ok ? "✔" : item.warning ? "!" : "✘"} ${item.name}: ${item.message}`);
  return checks;
}
