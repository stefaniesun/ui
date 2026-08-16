import type { FastifyInstance, FastifyReply } from "fastify";
import type { AiModel } from "./model.js";
import type { ModelConfig, ModelConfigStore } from "./model-config.js";
import type { ProjectStore } from "./store.js";
import {
  applyRefactorRequestSchema,
  continueRefactorRequestSchema,
  createRefactorSessionRequestSchema,
} from "./element-refactor-types.js";
import {
  applyRefactorSession,
  continueRefactorSession,
  createRefactorSession,
  RefactorServiceError,
} from "./element-refactor-service.js";
import type { RefactorSessionStore } from "./element-refactor-session-store.js";

export interface ElementRefactorRouteDeps {
  store: ProjectStore;
  configStore: ModelConfigStore;
  createModel: (config: ModelConfig) => AiModel;
  sessions: RefactorSessionStore;
}

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof RefactorServiceError) {
    const status = error.code.endsWith("CONFLICT") ? 409
      : error.code === "SESSION_NOT_FOUND" || error.code.endsWith("NOT_FOUND") ? 404
      : error.code === "INVALID_CANDIDATE" ? 422
      : error.code === "MODEL_ERROR" ? 502 : 400;
    return reply.code(status).send({ error: error.message, code: error.code, ...error.details });
  }
  return reply.code(500).send({ error: "element refactor failed", code: "INTERNAL_ERROR" });
}

export function registerElementRefactorRoutes(app: FastifyInstance, deps: ElementRefactorRouteDeps): void {
  type Project = { projectId: string };
  type Session = Project & { sessionId: string };
  app.post<{ Params: Project; Body: unknown }>("/api/projects/:projectId/elements/refactor-sessions", async (req, reply) => {
    if (!deps.store.exists(req.params.projectId)) return reply.code(404).send({ error: "project not found", code: "PROJECT_NOT_FOUND" });
    if (!deps.configStore.isConfigured()) return reply.code(400).send({ error: "model not configured", code: "MODEL_NOT_CONFIGURED" });
    const parsed = createRefactorSessionRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid request", code: "INVALID_REQUEST" });
    try {
      return await createRefactorSession({ ...deps, model: deps.createModel(deps.configStore.read()) }, req.params.projectId, parsed.data);
    } catch (error) { return fail(reply, error); }
  });
  app.post<{ Params: Session; Body: unknown }>("/api/projects/:projectId/elements/refactor-sessions/:sessionId/messages", async (req, reply) => {
    if (!deps.store.exists(req.params.projectId)) return reply.code(404).send({ error: "project not found", code: "PROJECT_NOT_FOUND" });
    if (!deps.configStore.isConfigured()) return reply.code(400).send({ error: "model not configured", code: "MODEL_NOT_CONFIGURED" });
    const parsed = continueRefactorRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid request", code: "INVALID_REQUEST" });
    try {
      return await continueRefactorSession({ ...deps, model: deps.createModel(deps.configStore.read()) }, req.params.projectId, req.params.sessionId, parsed.data);
    } catch (error) { return fail(reply, error); }
  });
  app.post<{ Params: Session; Body: unknown }>("/api/projects/:projectId/elements/refactor-sessions/:sessionId/apply", async (req, reply) => {
    if (!deps.store.exists(req.params.projectId)) return reply.code(404).send({ error: "project not found", code: "PROJECT_NOT_FOUND" });
    const parsed = applyRefactorRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid request", code: "INVALID_REQUEST" });
    try { return applyRefactorSession(deps, req.params.projectId, req.params.sessionId, parsed.data); }
    catch (error) { return fail(reply, error); }
  });
}
