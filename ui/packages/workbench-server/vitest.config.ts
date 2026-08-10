import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: {
    "@ui-rebuild/workbench-contracts": resolve(__dirname, "../workbench-contracts/src/index.ts"),
    "@ui-rebuild/workbench-measurement": resolve(__dirname, "../workbench-measurement/src/index.ts"),
  } },
  test: { include: ["src/**/*.test.ts"] },
});
