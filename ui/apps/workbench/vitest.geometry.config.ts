import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["**/src/geometry.test.ts"], pool: "forks", poolOptions: { forks: { singleFork: true } } } });
