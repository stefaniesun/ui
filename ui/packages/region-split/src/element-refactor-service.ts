import sharp from "sharp";
import {
  ElementRefactorModelOutputError,
  type ElementRefactorModel,
} from "./element-refactor-model.js";
import type {
  ApplyRefactorRequest,
  ApplyRefactorResponse,
  ContinueRefactorRequest,
  CreateRefactorSessionRequest,
  RefactorCandidate,
  RefactorSessionResponse,
} from "./element-refactor-types.js";
import { validateRefactorCandidate } from "./element-refactor-validate.js";
import { RefactorSessionStore } from "./element-refactor-session-store.js";
import { diffElementSubtrees, extractElementSubtree, hashElementTree } from "./element-subtree.js";
import { regionKey } from "./element-types.js";
import type { ProjectStore } from "./store.js";

export interface ElementRefactorDeps {
  store: ProjectStore;
  model: ElementRefactorModel;
  sessions: RefactorSessionStore;
}

export class RefactorServiceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "RefactorServiceError";
  }
}

function response(session: NonNullable<ReturnType<RefactorSessionStore["get"]>>): RefactorSessionResponse {
  return {
    sessionId: session.id,
    candidateVersion: session.candidateVersion,
    treeVersion: session.treeVersion,
    candidate: session.candidate.subtree,
    diff: diffElementSubtrees(session.original, session.candidate.subtree),
    explanation: session.candidate.explanation,
  };
}

async function crop(store: ProjectStore, projectId: string, box: { x: number; y: number; w: number; h: number }): Promise<string> {
  const values = [box.x, box.y, box.w, box.h];
  if (!values.every(Number.isSafeInteger) || box.x < 0 || box.y < 0 || box.w <= 0 || box.h <= 0) {
    throw new RefactorServiceError("INVALID_SCOPE", "refactor scope must use positive safe integer image coordinates");
  }
  const image = sharp(store.readElementSourceImage(projectId));
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height
    || box.x + box.w > metadata.width || box.y + box.h > metadata.height) {
    throw new RefactorServiceError("INVALID_SCOPE", "refactor scope is not fully covered by the source image");
  }
  return (await image.extract({ left: box.x, top: box.y, width: box.w, height: box.h })
    .png().toBuffer()).toString("base64");
}

async function generateValidated(
  deps: ElementRefactorDeps,
  args: Parameters<ElementRefactorModel["refactorElements"]>[0],
  tree: NonNullable<ReturnType<ProjectStore["readElementTree"]>>,
  region: CreateRefactorSessionRequest["region"],
  original: ReturnType<typeof extractElementSubtree>,
): Promise<RefactorCandidate> {
  let candidate: RefactorCandidate | null = null;
  let feedback = [] as ReturnType<typeof validateRefactorCandidate>["violations"];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      candidate = await deps.model.refactorElements({
        ...args,
        ...(feedback.length > 0 ? { validationFeedback: feedback } : {}),
      });
      const validation = validateRefactorCandidate({ tree, region, original, candidate: candidate.subtree });
      if (validation.valid) return candidate;
      feedback = validation.violations;
    } catch (error) {
      if (!(error instanceof ElementRefactorModelOutputError)) {
        throw new RefactorServiceError("MODEL_ERROR", (error as Error).message);
      }
      feedback = [{ code: "refactor.model-output", message: error.message }];
    }
  }
  throw new RefactorServiceError("INVALID_CANDIDATE", feedback.map(item => item.message).join("; "));
}

export async function createRefactorSession(
  deps: ElementRefactorDeps,
  projectId: string,
  request: CreateRefactorSessionRequest,
): Promise<RefactorSessionResponse> {
  const tree = deps.store.readElementTree(projectId, regionKey(request.region));
  if (!tree) throw new RefactorServiceError("TREE_NOT_FOUND", "element tree not found");
  const version = hashElementTree(tree);
  if (version !== request.treeVersion) throw new RefactorServiceError("TREE_VERSION_CONFLICT", "element tree has changed");
  let original;
  try { original = extractElementSubtree(tree, request.rootId); }
  catch (error) { throw new RefactorServiceError("ROOT_NOT_FOUND", (error as Error).message); }
  const root = original.nodes.find(node => node.id === original.rootId)!;
  const cropBase64 = await crop(deps.store, projectId, root.box);
  const history = [{ role: "user" as const, content: request.instruction }];
  const candidate = await generateValidated(deps, {
    cropBase64, original, current: original, instruction: request.instruction,
    history: [], bounds: root.box,
  }, tree, request.region, original);
  const session = deps.sessions.create({
    projectId, region: request.region, rootId: request.rootId, treeVersion: version,
    candidateVersion: 1, original, candidate,
    history: [...history, { role: "assistant", content: candidate.explanation }],
  });
  return response(session);
}

export function applyRefactorSession(
  deps: Pick<ElementRefactorDeps, "store" | "sessions">,
  projectId: string,
  sessionId: string,
  request: ApplyRefactorRequest,
): ApplyRefactorResponse {
  const session = deps.sessions.peek(sessionId);
  if (!session || session.projectId !== projectId) {
    throw new RefactorServiceError("SESSION_NOT_FOUND", "refactor session not found");
  }
  if (session.candidateVersion !== request.candidateVersion) {
    throw new RefactorServiceError("CANDIDATE_VERSION_CONFLICT", "candidate version has changed");
  }
  if (session.treeVersion !== request.treeVersion) {
    throw new RefactorServiceError("TREE_VERSION_CONFLICT", "element tree has changed");
  }
  let result;
  try {
    result = deps.store.replaceElementSubtree(
      projectId, session.region, session.treeVersion, session.rootId, session.candidate.subtree,
    );
  } catch (error) {
    if ((error as Error).message.includes("version conflict")) {
      throw new RefactorServiceError("TREE_VERSION_CONFLICT", "element tree has changed");
    }
    throw error;
  }
  deps.sessions.delete(sessionId);
  return result;
}

export async function continueRefactorSession(
  deps: ElementRefactorDeps,
  projectId: string,
  sessionId: string,
  request: ContinueRefactorRequest,
): Promise<RefactorSessionResponse> {
  const session = deps.sessions.peek(sessionId);
  if (!session || session.projectId !== projectId) throw new RefactorServiceError("SESSION_NOT_FOUND", "refactor session not found");
  if (session.candidateVersion !== request.candidateVersion) throw new RefactorServiceError("CANDIDATE_VERSION_CONFLICT", "candidate version has changed");
  const tree = deps.store.readElementTree(projectId, regionKey(session.region));
  if (!tree || hashElementTree(tree) !== session.treeVersion) throw new RefactorServiceError("TREE_VERSION_CONFLICT", "element tree has changed");
  const root = session.original.nodes.find(node => node.id === session.original.rootId)!;
  const cropBase64 = await crop(deps.store, projectId, root.box);
  const candidate = await generateValidated(deps, {
    cropBase64, original: session.original, current: session.candidate.subtree,
    instruction: request.instruction, history: session.history, bounds: root.box,
  }, tree, session.region, session.original);
  let updated;
  try {
    updated = deps.sessions.update(sessionId, current => {
      if (current.candidateVersion !== request.candidateVersion) {
        throw new RefactorServiceError("CANDIDATE_VERSION_CONFLICT", "candidate version has changed");
      }
      return {
        ...current,
        candidateVersion: current.candidateVersion + 1,
        candidate,
        history: [...current.history, { role: "user", content: request.instruction }, { role: "assistant", content: candidate.explanation }],
      };
    });
  } catch (error) {
    if (error instanceof RefactorServiceError) throw error;
    throw new RefactorServiceError("SESSION_NOT_FOUND", "refactor session not found");
  }
  return response(updated);
}
