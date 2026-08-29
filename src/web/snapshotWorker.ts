/// <reference lib="webworker" />

import type {
  CommitSpine, FileListResponse, SnapshotSourceRecord, SourceResponse, ViewRequest, ViewResponse,
} from "../shared/api.ts";
import { hydrateScanIndex, type ScanIndex, type SerializedScanIndex } from "../shared/index.ts";
import { buildFileList, buildView, parseViewRequest } from "../server/aggregate.ts";

/**
 * The one message protocol between `snapshotRuntime.ts` and this worker.
 *
 * Declared here and imported as types by the runtime, so the two sides of the
 * wire cannot drift apart.
 */
export type SnapshotRequestBody =
  | { kind: "view"; view: ViewRequest }
  | { kind: "files"; view: ViewRequest }
  | { kind: "source"; path: string }
  | { kind: "spine" };

export type SnapshotRequest = SnapshotRequestBody & { id: number };

export type SnapshotResponse =
  | { id: number; ok: true; value: ViewResponse | FileListResponse | SourceResponse | CommitSpine | null }
  | { id: number; ok: false; error: string };

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} failed with ${response.status}`);
  return await response.json() as T;
}

/** Load once and remember success only, so a failed fetch is retried by the next request. */
function loadOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let loaded: Promise<T> | null = null;
  return () => {
    loaded ??= load().catch((cause: unknown) => {
      loaded = null;
      throw cause;
    });
    return loaded;
  };
}

const loadIndex = loadOnce(() => fetchJson<SerializedScanIndex>("../data/index.json").then(hydrateScanIndex));
const loadSpine = loadOnce(() => fetchJson<CommitSpine | null>("../data/spine.json"));

async function answer(
  request: SnapshotRequest,
): Promise<ViewResponse | FileListResponse | SourceResponse | CommitSpine | null> {
  if (request.kind === "spine") return loadSpine();
  const hydrated: ScanIndex = await loadIndex();
  if (request.kind === "view") return buildView(hydrated, parseViewRequest(request.view));
  if (request.kind === "files") return buildFileList(hydrated, parseViewRequest(request.view));
  const fileIndex = hydrated.fileIndexByPath.get(request.path);
  if (fileIndex === undefined) throw new Error("file is not part of this static snapshot");
  const record = await fetchJson<SnapshotSourceRecord>(`../data/sources/${fileIndex}.json`);
  // A file the exporter could not read holds the refusal the live route would
  // have sent, and the preview raises it the same way.
  if ("error" in record) throw new Error(record.error);
  return record;
}

self.addEventListener("message", (event: MessageEvent<SnapshotRequest>) => {
  const request = event.data;
  answer(request).then(
    (value) => self.postMessage({ id: request.id, ok: true, value } satisfies SnapshotResponse),
    (cause: unknown) => self.postMessage({
      id: request.id,
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    } satisfies SnapshotResponse),
  );
});
