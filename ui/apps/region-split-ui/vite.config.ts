import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  // 端口和后端地址可用环境变量覆盖，便于在不打断已有实例的情况下再起一份跑验证
  server: {
    port: Number(process.env.UIR_UI_PORT ?? 5180),
    proxy: { "/api": process.env.UIR_API_URL ?? "http://127.0.0.1:4800" },
  },
  test: { environment: "jsdom", include: ["src/**/*.test.ts"] },
});
