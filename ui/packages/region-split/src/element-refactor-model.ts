import type { ElementSubtree, RefactorCandidate } from "./element-refactor-types.js";
import type { InvariantViolation, Rect } from "./types.js";

export interface ElementRefactorMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ElementReference {
  number: string;
  id: string;
  parentId: string | null;
  displayName: string;
  kind: string;
  box: { x: number; y: number; w: number; h: number };
}

export interface ElementRefactorModelInput {
  cropBase64: string;
  original: ElementSubtree;
  current: ElementSubtree;
  instruction: string;
  history: ElementRefactorMessage[];
  references: ElementReference[];
  bounds: Rect;
  validationFeedback?: InvariantViolation[];
}

export interface ElementRefactorModel {
  refactorElements(input: ElementRefactorModelInput): Promise<RefactorCandidate>;
}

export class ElementRefactorModelOutputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ElementRefactorModelOutputError";
  }
}
