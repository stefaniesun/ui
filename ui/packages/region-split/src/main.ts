import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectCandidateLines } from "./candidate-lines.js";
import { createOpenAiModel } from "./model.js";
import { ModelConfigStore } from "./model-config.js";
import { buildServer } from "./server.js";
import { ProjectStore } from "./store.js";

// 从模块自身位置推导工作区根目录，而不是依赖 cwd——
// 无论从哪个目录启动服务，配置文件和数据目录的位置都一样。
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = join(packageRoot, "..", "..");

const configPath = process.env.UIR_CONFIG_FILE
  ? resolve(process.env.UIR_CONFIG_FILE)
  : join(workspaceRoot, "region-split.config.json");
const dataRoot = process.env.UIR_DATA_ROOT ?? join(workspaceRoot, "data");

const store = new ProjectStore(join(dataRoot, "projects"));
const configStore = new ModelConfigStore(configPath);

const app = buildServer({
  store,
  configStore,
  createModel: config => createOpenAiModel(config),
  detectLines: detectCandidateLines,
});

const port = Number(process.env.UIR_PORT ?? 4800);
app.listen({ port, host: "127.0.0.1" }).then(address => {
  const view = configStore.view();
  console.log(`region-split server on ${address}`);
  console.log(`  数据目录  ${dataRoot}`);
  console.log(`  模型配置  ${configPath}`);
  console.log(view.baseUrl && view.model
    ? `            ${view.model} @ ${view.baseUrl}${view.hasApiKey ? "（含 API Key）" : "（无 API Key）"}`
    : "            未配置——分析和 AI 命名不可用，请编辑上面这个文件");
});
