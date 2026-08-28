import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildFolders, UNCHANGED_FILE_FIELDS } from "../src/scanner/scan.ts";
import { buildView, parseViewRequest } from "../src/server/aggregate.ts";
import type { ScanMeta, SnapshotSourceRecord, SourceResponse, ViewRequest } from "../src/shared/api.ts";
import { assembleIndex, serializeScanIndex, type ScanIndex } from "../src/shared/index.ts";
import type { SnapshotRequest, SnapshotRequestBody, SnapshotResponse } from "../src/web/snapshotWorker.ts";

function rowOf(filePath: string, tokens: number) {
  return {
    ...UNCHANGED_FILE_FIELDS,
    path: filePath,
    name: path.posix.basename(filePath),
    kind: "code" as const,
    generated: false,
    tokens,
    lines: tokens,
    codeLines: tokens,
    commentLines: 0,
    blankLines: 0,
    functions: 0,
    classes: 0,
    branches: 0,
    language: null,
  };
}

const META: ScanMeta = {
  rootPath: "project",
  rootName: "project",
  tokenizer: "o200k_base",
  fileCount: 2,
  folderCount: 1,
  scannedAt: "2026-08-28T12:00:00.000Z",
  durationMs: 5,
  fileSource: "git-index",
  diff: null,
  skippedLargeFiles: 0,
  languages: [],
};

const GOOD_SOURCE: SourceResponse = {
  path: "a.ts",
  content: "export {};\n",
  mode: "source",
  truncated: false,
  totalBytes: 11,
  language: null,
};

const BROKEN_SOURCE: SnapshotSourceRecord = { error: "file resolves outside the scan root" };

describe("the snapshot worker", () => {
  let index: ScanIndex;
  let handleMessage: (event: { data: SnapshotRequest }) => void;
  const responses: SnapshotResponse[] = [];
  /** While true, every fetch of the index fails, as a flaky first load would. */
  let indexUnavailable = true;
  let nextId = 1;

  async function answered(request: SnapshotRequestBody): Promise<SnapshotResponse> {
    const id = nextId++;
    handleMessage({ data: { ...request, id } satisfies SnapshotRequest });
    await vi.waitFor(() => {
      if (!responses.some((response) => response.id === id)) throw new Error("no response yet");
    });
    const position = responses.findIndex((response) => response.id === id);
    return responses.splice(position, 1)[0]!;
  }

  function viewRequest(): ViewRequest {
    return parseViewRequest({ kinds: ["code", "test", "text", "i18n", "data", "other"], expanded: [""] });
  }

  beforeAll(async () => {
    const files = [rowOf("a.ts", 4), rowOf("b.ts", 6)];
    index = assembleIndex(META, files, buildFolders(files, "project"));
    const serialized = JSON.parse(JSON.stringify(serializeScanIndex(index, "project"))) as unknown;

    vi.stubGlobal("fetch", (url: string) => {
      if (url === "../data/index.json") {
        if (indexUnavailable) return Promise.resolve({ ok: false, status: 503 });
        return Promise.resolve({ ok: true, json: () => Promise.resolve(serialized) });
      }
      if (url === "../data/spine.json") return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      if (url === "../data/sources/0.json") return Promise.resolve({ ok: true, json: () => Promise.resolve(GOOD_SOURCE) });
      if (url === "../data/sources/1.json") return Promise.resolve({ ok: true, json: () => Promise.resolve(BROKEN_SOURCE) });
      return Promise.resolve({ ok: false, status: 404 });
    });
    vi.stubGlobal("self", {
      addEventListener: (type: string, handler: (event: { data: SnapshotRequest }) => void) => {
        expect(type).toBe("message");
        handleMessage = handler;
      },
      postMessage: (response: SnapshotResponse) => {
        responses.push(response);
      },
    });
    await import("../src/web/snapshotWorker.ts");
  });

  it("fails a request while the index cannot be fetched", async () => {
    const response = await answered({ kind: "view", view: viewRequest() });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toContain("../data/index.json");
  });

  it("retries the index fetch on the next request instead of holding the failure", async () => {
    indexUnavailable = false;
    const response = await answered({ kind: "view", view: viewRequest() });
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.value).toEqual(buildView(index, viewRequest()));
  });

  it("normalises an untrusted view request by the same rule as the live server", async () => {
    const untrusted = {
      ...viewRequest(),
      rank: { ...viewRequest().rank, minWeight: Number.POSITIVE_INFINITY },
    };
    const response = await answered({ kind: "view", view: untrusted });
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.value).toEqual(buildView(index, parseViewRequest(untrusted)));
  });

  it("serves a stored source preview by its file index", async () => {
    const response = await answered({ kind: "source", path: "a.ts" });
    expect(response).toEqual({ id: nextId - 1, ok: true, value: GOOD_SOURCE });
  });

  it("raises the stored refusal of a file the exporter could not read", async () => {
    const response = await answered({ kind: "source", path: "b.ts" });
    expect(response).toEqual({ id: nextId - 1, ok: false, error: "file resolves outside the scan root" });
  });

  it("refuses a path outside the static snapshot", async () => {
    const response = await answered({ kind: "source", path: "missing.ts" });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toContain("not part of this static snapshot");
  });

  it("answers the stored spine", async () => {
    const response = await answered({ kind: "spine" });
    expect(response).toEqual({ id: nextId - 1, ok: true, value: null });
  });
});
