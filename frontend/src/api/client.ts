/**
 * One thin fetch wrapper. Every backend failure arrives as
 * `{ error: { code, message, ...context } }`, so it is turned into a typed
 * ApiError here and nothing downstream has to inspect response bodies.
 */

const BASE = "/api";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly context: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return undefined as T;

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const { code = "UNKNOWN", message = res.statusText, ...context } = payload?.error ?? {};
    throw new ApiError(code, res.status, message, context);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: (path: string) => request<void>("DELETE", path),
};

// ---------------------------------------------------------------- types
// Mirrors of the backend view shapes.

export interface User {
  id: string;
  name: string;
  currentModuleId: string | null;
}

export interface OptionView {
  id: string;
  label: string;
  order: number;
  nextQuestionId: string | null;
  switchesToModuleKey: string | null;
  isBroken: boolean;
}

export interface QuestionView {
  id: string;
  text: string;
  isCheckpoint: boolean;
  module: { id: string; key: string; title: string };
  options: OptionView[];
}

export interface StateView {
  userId: string;
  currentModule: { id: string; key: string; title: string } | null;
  currentQuestionId: string | null;
  modules: {
    moduleKey: string;
    moduleTitle: string;
    currentQuestionId: string | null;
    contextResetSeq: number;
    completedAt: string | null;
    startedAt: string;
  }[];
}

export interface FlowResponse {
  question: QuestionView | null;
  state: StateView;
  reason: string;
}

export interface ResumeResponse extends FlowResponse {
  requestedQuestionId: string | null;
  redirected: boolean;
}

export interface HistoryEvent {
  seq: number;
  kind: string;
  moduleId: string;
  moduleTitle: string;
  questionId: string;
  questionText: string;
  optionId: string | null;
  optionLabel: string | null;
  createdAt: string;
  isLiveContext: boolean;
}

export interface ModuleSummary {
  id: string;
  key: string;
  title: string;
  entryQuestionId: string | null;
  _count: { questions: number };
}

export interface GraphOption {
  id: string;
  label: string;
  order: number;
  nextQuestionId: string | null;
  nextQuestionText: string | null;
  nextModuleKey: string | null;
  switchesModule: boolean;
  isTerminal: boolean;
}

export interface GraphQuestion {
  id: string;
  text: string;
  isCheckpoint: boolean;
  isEntry: boolean;
  incomingCount: number;
  options: GraphOption[];
}

export interface ModuleGraph {
  id: string;
  key: string;
  title: string;
  entryQuestionId: string | null;
  questions: GraphQuestion[];
}

export interface FlowIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  questionId?: string;
  optionId?: string;
}

// ---------------------------------------------------------------- endpoints

export const flowApi = {
  users: () => api.get<{ users: User[] }>("/users").then((r) => r.users),
  createUser: (name: string) => api.post<User>("/users", { name }),
  /** Cascades: the user's conversation history and module state go with them. */
  deleteUser: (id: string) => api.del(`/users/${id}`),
  modules: () => api.get<{ modules: ModuleSummary[] }>("/modules").then((r) => r.modules),
  state: (userId: string) => api.get<StateView>(`/flow/${userId}/state`),
  history: (userId: string) =>
    api.get<{ events: HistoryEvent[] }>(`/flow/${userId}/history`).then((r) => r.events),
  resume: (userId: string, questionId?: string | null) =>
    api.get<ResumeResponse>(
      `/flow/${userId}/resume${questionId ? `?questionId=${encodeURIComponent(questionId)}` : ""}`,
    ),
  start: (userId: string, moduleKey: string, restart = false) =>
    api.post<FlowResponse>(`/flow/${userId}/start`, { moduleKey, restart }),
  answer: (userId: string, questionId: string, optionId: string) =>
    api.post<FlowResponse>(`/flow/${userId}/answer`, { questionId, optionId }),
  back: (userId: string) => api.post<FlowResponse>(`/flow/${userId}/back`),
};

export const adminApi = {
  graph: (key: string) => api.get<ModuleGraph>(`/modules/${key}/graph`),
  validate: (key: string) => api.get<{ ok: boolean; issues: FlowIssue[] }>(`/modules/${key}/validate`),
  createModule: (key: string, title: string) => api.post<ModuleSummary>("/modules", { key, title }),
  updateModule: (key: string, data: { title?: string; entryQuestionId?: string | null }) =>
    api.patch<ModuleSummary>(`/modules/${key}`, data),
  deleteModule: (key: string) => api.del(`/modules/${key}`),
  createQuestion: (data: { moduleKey: string; text: string; isCheckpoint?: boolean }) =>
    api.post<GraphQuestion>("/questions", data),
  updateQuestion: (id: string, data: { text?: string; isCheckpoint?: boolean }) =>
    api.patch<GraphQuestion>(`/questions/${id}`, data),
  deleteQuestion: (id: string) => api.del(`/questions/${id}`),
  createOption: (data: { questionId: string; label: string; nextQuestionId?: string | null }) =>
    api.post<GraphOption>("/options", data),
  updateOption: (id: string, data: { label?: string; nextQuestionId?: string | null }) =>
    api.patch<GraphOption>(`/options/${id}`, data),
  deleteOption: (id: string) => api.del(`/options/${id}`),
};
