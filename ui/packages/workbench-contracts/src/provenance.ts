export const sources = ["tool", "model", "human"] as const;
export type Source = (typeof sources)[number];

export interface Meta {
  source: Source;
  confidence: number;
  reviewed: boolean;
}
