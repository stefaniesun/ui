import { z } from "zod";

export const stageIds = ["measurement", "layout", "tokens", "content-assets", "page", "interactions"] as const;
export type StageId = (typeof stageIds)[number];

export const stageStatuses = ["empty", "analyzing", "draft", "confirmed"] as const;
export type StageStatus = (typeof stageStatuses)[number];

export interface StageDoc<TPayload> {
  stage: StageId;
  schemaVersion: string;
  status: StageStatus;
  payload: TPayload;
  upstreamFingerprint: string;
  confirmedAt?: string;
  confirmedBy?: string;
}

export function stageDocSchema<T extends z.ZodTypeAny>(stage: StageId, payload: T) {
  return z.object({
    stage: z.literal(stage),
    schemaVersion: z.string().min(1),
    status: z.enum(stageStatuses),
    payload,
    upstreamFingerprint: z.string(),
    confirmedAt: z.string().datetime().optional(),
    confirmedBy: z.string().min(1).optional(),
  });
}
