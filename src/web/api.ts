import type {
  SkillInstallResponse, SourceResponse, ViewRequest, ViewResponse,
} from "../shared/api.ts";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `${url} failed with ${response.status}`);
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

export function fetchSource(path: string): Promise<SourceResponse> {
  return request<SourceResponse>(`/api/source?path=${encodeURIComponent(path)}`);
}

export function fetchSkillInstall(): Promise<SkillInstallResponse> {
  return request<SkillInstallResponse>("/api/skill-install");
}
