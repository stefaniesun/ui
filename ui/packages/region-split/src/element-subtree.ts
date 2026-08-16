import { createHash } from "node:crypto";
import { elementTreeSchema, type ElementTree } from "./element-types.js";

export * from "./element-subtree-pure.js";

export function hashElementTree(tree: ElementTree): string {
  const parsed = elementTreeSchema.parse(tree);
  return createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
}
