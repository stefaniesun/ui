// 浏览器安全入口：只导出纯逻辑和类型，绝不触及 node:fs / sharp / fastify。
// 前端一律从 "@region-split/core/browser" 导入；根入口 "." 是服务端用的，
// 它 re-export 了 store/analyze/server/model 等依赖 Node 内置模块的实现。
export * from "./types.js";
export * from "./operations.js";
export * from "./reconcile.js";
export * from "./element-types.js";
export * from "./element-layout.js";
export * from "./element-refactor-types.js";
export { diffElementSubtrees } from "./element-subtree-pure.js";

// 类型导出在编译期被擦除，不会把 model-config.ts 的 node:fs 依赖带进包里。
export type { ModelConfig, ModelConfigView } from "./model-config.js";
