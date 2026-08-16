import sharp from "sharp";
import type { ElementRefactorModel } from "./element-refactor-model.js";
import type {
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
  return (await sharp(store.readElementSourceImage(projectId)).extract({
    left: box.x, top: box.y, width: box.w, height: box.h,
  }).png().toBuffer()).toString("base64");
}

async function generateValidated(
  deps: ElementRefactorDeps,
  args: Parameters<ElementRefactorModel["refactorElements"]>[0],
  tree: NonNullable<ReturnType<ProjectStore["readElementTree"]>>,
  region: CreateRefactorSessionRequest["region"],
  original: ReturnType<typeof extractElementSubtree>,
): Promise<RefactorCandidate> {
  let candidate = await deps.model.refactorElements(args);
  let validation = validateRefactorCandidate({ tree, region, original, candidate: candidate.subtree });
  if (!validation.valid) {
    candidate = await deps.model.refactorElements({ ...args, validationFeedback: validation.violations });
    validation = validateRefactorCandidate({ tree, region, original, candidate: candidate.subtree });
  }
  if (!validation.valid) throw new RefactorServiceError("INVALID_CANDIDATE", validation.violations.map(item => item.message).join("; "));
  return candidate;
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

export async function continueRefactorSession(
  deps: ElementRefactorDeps,
  projectId: string,
  sessionId: string,
  request: ContinueRefactorRequest,
): Promise<RefactorSessionResponse> {
  const session = deps.sessions.get(sessionId);
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
  const updated = deps.sessions.update(sessionId, current => ({
    ...current,
    candidateVersion: current.candidateVersion + 1,
    candidate,
    history: [...current.history, { role: "user", content: request.instruction }, { role: "assistant", content: candidate.explanation }],
  }));
  return response(updated);
}
