import type {
  ApplyRefactorRequest,
  ApplyRefactorResponse,
  ContinueRefactorRequest,
  CreateRefactorSessionRequest,
  RefactorSessionResponse,
} from "@region-split/core/browser";

export class ElementRefactorApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly candidateVersion?: number,
    public readonly treeVersion?: string,
  ) { super(message); this.name = "ElementRefactorApiError"; }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new ElementRefactorApiError(data.error ?? "AI 重构请求失败", response.status, data.code ?? "UNKNOWN", data.candidateVersion, data.treeVersion);
  return data as T;
}

export interface ElementRefactorApi {
  createSession(projectId: string, input: CreateRefactorSessionRequest): Promise<RefactorSessionResponse>;
  sendMessage(projectId: string, sessionId: string, input: ContinueRefactorRequest): Promise<RefactorSessionResponse>;
  apply(projectId: string, sessionId: string, input: ApplyRefactorRequest): Promise<ApplyRefactorResponse>;
}

export const elementRefactorApi: ElementRefactorApi = {
  createSession: (projectId, input) => post(`/api/projects/${projectId}/elements/refactor-sessions`, input),
  sendMessage: (projectId, sessionId, input) => post(`/api/projects/${projectId}/elements/refactor-sessions/${sessionId}/messages`, input),
  apply: (projectId, sessionId, input) => post(`/api/projects/${projectId}/elements/refactor-sessions/${sessionId}/apply`, input),
};
