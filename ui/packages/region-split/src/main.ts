import { join } from "node:path";
import { detectCandidateLines } from "./candidate-lines.js";
import { createOpenAiModel } from "./model.js";
import { ModelConfigStore } from "./model-config.js";
import { buildServer } from "./server.js";
import { ProjectStore } from "./store.js";

const dataRoot = process.env.UIR_DATA_ROOT ?? "./data";
const store = new ProjectStore(join(dataRoot, "projects"));
const configStore = new ModelConfigStore(join(dataRoot, "model-config.json"));

const app = buildServer({
  store,
  configStore,
  createModel: config => createOpenAiModel(config),
  detectLines: detectCandidateLines,
});
const port = Number(process.env.UIR_PORT ?? 4800);
app.listen({ port, host: "127.0.0.1" })
  .then(address => console.log(`region-split server on ${address}`));
