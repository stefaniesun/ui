import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  server: { port: 5180, proxy: { "/api": "http://127.0.0.1:4800" } },
  test: { environment: "jsdom", include: ["src/**/*.test.ts"] },
});
