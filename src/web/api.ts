import type {
  AgentsResponse, AskListResponse, AskRequest, AskTask, CommitSpine, CompareRequest, ComparisonRequest,
  DismissAskRequest, FileListResponse, OpenInApplication, OpenInOptionsResponse, OpenInRequest,
  OpenInResponse, OpenRootRequest, RepositoryRefs, SkillInstallResponse, SourceResponse, ReviewMode,
  ReviewModeRequest, ViewRequest, ViewResponse,
} from "../shared/api.ts";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let message = detail;
    try {
      const payload: unknown = JSON.parse(detail);
      if (typeof payload === "object" && payload !== null && "error" in payload) {
        const error = (payload as { error?: unknown }).error;
        if (typeof error === "string") message = error;
      }
    } catch {
      // A plain-text response is already the most useful error available.
    }
    throw new Error(message || `${url} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}

/** Ask the server to aggregate the current scope. */
export function fetchView(view: ViewRequest, signal?: AbortSignal): Promise<ViewResponse> {
  return postJson<ViewResponse>("/api/view", view, signal);
}

/** Load every file matched by the panel for the Read-all preview. */
export function fetchFileList(view: ViewRequest, signal?: AbortSignal): Promise<FileListResponse> {
  return postJson<FileListResponse>("/api/files", view, signal);
}

/** Re-read the source tree from disk, then aggregate the current scope. */
export function rescan(view: ViewRequest): Promise<ViewResponse> {
  return postJson<ViewResponse>("/api/rescan", view);
}

/** Scan an absolute server-side directory and make it the active root. */
export function openRoot(root: string, view: ViewRequest): Promise<ViewResponse> {
  const body: OpenRootRequest = { root, view };
  return postJson<ViewResponse>("/api/open", body);
}

/** Fixed applications offered by the operating system that hosts the scan. */
export function fetchOpenInOptions(): Promise<OpenInOptionsResponse> {
  return request<OpenInOptionsResponse>("/api/open-in");
}

/** Open the project root, or its drilled folder, in one local application. */
export function openIn(application: OpenInApplication, drillPath: string): Promise<OpenInResponse> {
  const body: OpenInRequest = { application, drillPath };
  return postJson<OpenInResponse>("/api/open-in", body);
}

/** Compare something else in the same repository, then aggregate the current scope. */
export function compare(comparison: ComparisonRequest, view: ViewRequest): Promise<ViewResponse> {
  const body: CompareRequest = { comparison, view };
  return postJson<ViewResponse>("/api/compare", body);
}

/** Rescan the change or one complete repository image in the active review. */
export function switchReviewMode(mode: ReviewMode, view: ViewRequest): Promise<ViewResponse> {
  const body: ReviewModeRequest = { mode, view };
  return postJson<ViewResponse>("/api/review-mode", body);
}

/** Branches, remote branches, and tags the comparison picker offers. */
export function fetchRefs(): Promise<RepositoryRefs> {
  return request<RepositoryRefs>("/api/refs");
}

/** The commits the open comparison spans, or null when it spans none. */
export function fetchSpine(): Promise<CommitSpine | null> {
  return request<CommitSpine | null>("/api/spine");
}

export function fetchSource(path: string): Promise<SourceResponse> {
  return request<SourceResponse>(`/api/source?path=${encodeURIComponent(path)}`);
}

export function fetchSkillInstall(): Promise<SkillInstallResponse> {
  return request<SkillInstallResponse>("/api/skill-install");
}

/** The bundled SKILL.md, shaped like any other file the preview dialog draws. */
export function fetchSkillSource(): Promise<SourceResponse> {
  return request<SourceResponse>("/api/skill-source");
}

/** The local coding agents the host found runnable and signed in. */
export function fetchAgents(): Promise<AgentsResponse> {
  return request<AgentsResponse>("/api/agents");
}

/** Start one agent on one question. It returns as soon as the process is running. */
export function startAsk(ask: AskRequest): Promise<AskTask> {
  return postJson<AskTask>("/api/ask", ask);
}

/** Every ask of this server run, newest first. */
export function fetchAsks(): Promise<AskListResponse> {
  return request<AskListResponse>("/api/asks");
}

/** Stop an ask if it still runs, and drop it either way. */
export function dismissAsk(id: string): Promise<AskListResponse> {
  const body: DismissAskRequest = { id };
  return postJson<AskListResponse>("/api/ask-dismiss", body);
}
