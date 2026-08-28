import type { CommitSpine, SourceResponse, ViewResponse } from "../shared/api.ts";
import type { ExplorerRuntime } from "./runtime.ts";
import type { SnapshotRequest, SnapshotRequestBody, SnapshotResponse } from "./snapshotWorker.ts";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (cause: unknown) => void;
  release: () => void;
}

/** Run the frozen server aggregation away from the React rendering thread. */
export function createSnapshotRuntime(): ExplorerRuntime {
  const worker = new Worker(new URL("./snapshotWorker.ts", import.meta.url), { type: "module" });
  const pending = new Map<number, PendingRequest>();
  let nextId = 1;
  /**
   * Why the worker is dead, or `null` while it runs. A worker that fired
   * `error` never answers again, so every later request is refused at once
   * instead of waiting on a reply that cannot come.
   */
  let failure: Error | null = null;

  worker.addEventListener("message", (event: MessageEvent<SnapshotResponse>) => {
    const response = event.data;
    const held = pending.get(response.id);
    if (held === undefined) return;
    pending.delete(response.id);
    held.release();
    if (response.ok) held.resolve(response.value);
    else held.reject(new Error(response.error));
  });
  worker.addEventListener("error", (event) => {
    failure = new Error(event.message || "the snapshot worker failed");
    for (const held of pending.values()) {
      held.release();
      held.reject(failure);
    }
    pending.clear();
  });

  const request = <T>(message: SnapshotRequestBody, signal?: AbortSignal): Promise<T> => {
    if (failure !== null) return Promise.reject(failure);
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      const abort = (): void => {
        const held = pending.get(id);
        if (held === undefined) return;
        pending.delete(id);
        held.release();
        reject(new DOMException("The request was aborted", "AbortError"));
      };
      const release = (): void => signal?.removeEventListener("abort", abort);
      if (signal?.aborted === true) {
        reject(new DOMException("The request was aborted", "AbortError"));
        return;
      }
      pending.set(id, { resolve: (value) => resolve(value as T), reject, release });
      signal?.addEventListener("abort", abort, { once: true });
      worker.postMessage({ ...message, id } satisfies SnapshotRequest);
    });
  };

  return {
    kind: "snapshot",
    fetchView: (view, signal) => request<ViewResponse>({ kind: "view", view }, signal),
    fetchSource: (path) => request<SourceResponse>({ kind: "source", path }),
    fetchSpine: () => request<CommitSpine | null>({ kind: "spine" }),
  };
}
