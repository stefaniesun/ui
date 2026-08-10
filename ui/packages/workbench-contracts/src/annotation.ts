import { z } from "zod";
import { rectIntersects, type Rect } from "./geometry.js";
import { rectSchema, type MeasurementPayload } from "./measurement.js";

export const annotationSchema = z.object({
  id: z.string().min(1),
  stage: z.literal("measurement"),
  bounds: rectSchema,
  instruction: z.string().min(1),
  targetIds: z.array(z.string()).optional(),
  createdAt: z.string().datetime(),
});
export type Annotation = z.infer<typeof annotationSchema>;

export const changeOpSchema = z.object({
  op: z.enum(["replace", "add", "remove"]),
  path: z.string(),
  value: z.unknown().optional(),
  explanation: z.string(),
});
export type ChangeOp = z.infer<typeof changeOpSchema>;

export const changeSetSchema = z.object({
  id: z.string().min(1),
  annotationId: z.string().min(1),
  operations: z.array(changeOpSchema),
  status: z.enum(["proposed", "accepted", "rejected"]),
});
export type ChangeSet = z.infer<typeof changeSetSchema>;

const collections = ["textItems", "colorSamples", "ignoreMasks"] as const;
type Collection = (typeof collections)[number];
const pathPattern = new RegExp(`^/(${collections.join("|")})/(\\d+|-)(/.*)?$`);

export interface GuardResult {
  allowed: ChangeOp[];
  rejected: Array<{ op: ChangeOp; reason: "invalid-path" | "human-protected" | "out-of-bounds" }>;
}

export function guardChangeSet(changeSet: ChangeSet, payload: MeasurementPayload, bounds: Rect): GuardResult {
  const result: GuardResult = { allowed: [], rejected: [] };

  for (const operation of changeSet.operations) {
    const match = pathPattern.exec(operation.path);
    if (!match) {
      result.rejected.push({ op: operation, reason: "invalid-path" });
      continue;
    }

    const collection = match[1] as Collection;
    const index = match[2];
    if (index === "-") {
      const value = operation.value as { bounds?: Rect } | undefined;
      if (operation.op !== "add" || !value?.bounds || !rectIntersects(value.bounds, bounds)) {
        result.rejected.push({ op: operation, reason: "out-of-bounds" });
      } else {
        result.allowed.push(operation);
      }
      continue;
    }

    const item = payload[collection][Number(index)] as { bounds: Rect; source: string } | undefined;
    if (!item) {
      result.rejected.push({ op: operation, reason: "invalid-path" });
    } else if (item.source === "human") {
      result.rejected.push({ op: operation, reason: "human-protected" });
    } else if (!rectIntersects(item.bounds, bounds)) {
      result.rejected.push({ op: operation, reason: "out-of-bounds" });
    } else {
      result.allowed.push(operation);
    }
  }

  return result;
}

function decodePointerPart(part: string): string {
  return part.replaceAll("~1", "/").replaceAll("~0", "~");
}

function applyOperation(root: unknown, operation: ChangeOp): void {
  const parts = operation.path.split("/").slice(1).map(decodePointerPart);
  let parent = root as Record<string, unknown> | unknown[];
  for (const part of parts.slice(0, -1)) {
    parent = (parent as Record<string, unknown>)[part] as Record<string, unknown> | unknown[];
  }
  const key = parts.at(-1);
  if (!key) throw new Error(`Invalid change path: ${operation.path}`);
  if (Array.isArray(parent)) {
    if (operation.op === "add" && key === "-") parent.push(operation.value);
    else if (operation.op === "remove") parent.splice(Number(key), 1);
    else parent[Number(key)] = operation.value;
  } else if (operation.op === "remove") {
    delete parent[key];
  } else {
    parent[key] = operation.value;
  }
}

export function applyGuardedChangeSet(
  payload: MeasurementPayload,
  changeSet: ChangeSet,
  bounds: Rect,
): { payload: MeasurementPayload; guard: GuardResult } {
  const guard = guardChangeSet(changeSet, payload, bounds);
  const next = structuredClone(payload);
  for (const operation of guard.allowed) applyOperation(next, operation);
  return { payload: next, guard };
}
