import type { ElementSubtree, RefactorCandidate } from "./element-refactor-types.js";
import type { InvariantViolation, Rect } from "./types.js";

export interface ElementRefactorMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ElementRefactorModelInput {
  cropBase64: string;
  original: ElementSubtree;
  current: ElementSubtree;
  instruction: string;
  history: ElementRefactorMessage[];
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
