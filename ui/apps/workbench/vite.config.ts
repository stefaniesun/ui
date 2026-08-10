import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { "@": resolve(__dirname, "src"), "@ui-rebuild/workbench-contracts": resolve(__dirname, "../../packages/workbench-contracts/src/index.ts") } },
  server: { port: 4173, proxy: { "/api": "http://127.0.0.1:4174" } },
});
