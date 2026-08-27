import type {
  CompareRequest, ComparisonRequest, OpenRootRequest, RepositoryRefs, SkillInstallResponse,
  SourceResponse, ViewRequest, ViewResponse,
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

/** Re-read the source tree from disk, then aggregate the current scope. */
export function rescan(view: ViewRequest): Promise<ViewResponse> {
  return postJson<ViewResponse>("/api/rescan", view);
}

/** Scan an absolute server-side directory and make it the active root. */
export function openRoot(root: string, view: ViewRequest): Promise<ViewResponse> {
  const body: OpenRootRequest = { root, view };
  return postJson<ViewResponse>("/api/open", body);
}

/** Compare something else in the same repository, then aggregate the current scope. */
export function compare(comparison: ComparisonRequest, view: ViewRequest): Promise<ViewResponse> {
  const body: CompareRequest = { comparison, view };
  return postJson<ViewResponse>("/api/compare", body);
}

/** Branches, remote branches, and tags the comparison picker offers. */
export function fetchRefs(): Promise<RepositoryRefs> {
  return request<RepositoryRefs>("/api/refs");
}

export function fetchSource(path: string): Promise<SourceResponse> {
  return request<SourceResponse>(`/api/source?path=${encodeURIComponent(path)}`);
}

export function fetchSkillInstall(): Promise<SkillInstallResponse> {
  return request<SkillInstallResponse>("/api/skill-install");
}
