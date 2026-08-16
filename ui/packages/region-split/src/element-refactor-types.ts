import { z } from "zod";
import { elementNodeSchema, elementTreeSchema, type ElementNode } from "./element-types.js";
import { rectSchema } from "./types.js";

export const elementSubtreeSchema = z.object({
  rootId: z.string().min(1),
  nodes: z.array(elementNodeSchema).min(1),
});
export type ElementSubtree = z.infer<typeof elementSubtreeSchema>;

export const refactorCandidateSchema = z.object({
  subtree: elementSubtreeSchema,
  explanation: z.string().default(""),
});
export type RefactorCandidate = z.infer<typeof refactorCandidateSchema>;

export const refactorDiffKinds = [
  "root-replaced", "added", "removed", "moved", "kind-changed",
  "name-changed", "box-changed", "layout-changed", "style-changed",
] as const;
export type RefactorDiffKind = (typeof refactorDiffKinds)[number];

export const refactorDiffItemSchema = z.object({
  nodeId: z.string().min(1),
  kind: z.enum(refactorDiffKinds),
  before: elementNodeSchema.optional(),
  after: elementNodeSchema.optional(),
});
export type RefactorDiffItem = z.infer<typeof refactorDiffItemSchema>;

export const createRefactorSessionRequestSchema = z.object({
  region: rectSchema,
  rootId: z.string().min(1),
  treeVersion: z.string().min(1),
  instruction: z.string().trim().min(1),
});
export type CreateRefactorSessionRequest = z.infer<typeof createRefactorSessionRequestSchema>;

export const continueRefactorRequestSchema = z.object({
  candidateVersion: z.number().int().positive(),
  instruction: z.string().trim().min(1),
});
export type ContinueRefactorRequest = z.infer<typeof continueRefactorRequestSchema>;

export const applyRefactorRequestSchema = z.object({
  candidateVersion: z.number().int().positive(),
  treeVersion: z.string().min(1),
});
export type ApplyRefactorRequest = z.infer<typeof applyRefactorRequestSchema>;

export const refactorSessionResponseSchema = z.object({
  sessionId: z.string().min(1),
  candidateVersion: z.number().int().positive(),
  treeVersion: z.string().min(1),
  candidate: elementSubtreeSchema,
  diff: z.array(refactorDiffItemSchema),
  explanation: z.string(),
});
export type RefactorSessionResponse = z.infer<typeof refactorSessionResponseSchema>;

export const applyRefactorResponseSchema = z.object({
  tree: elementTreeSchema,
  treeVersion: z.string().min(1),
});
export type ApplyRefactorResponse = z.infer<typeof applyRefactorResponseSchema>;
