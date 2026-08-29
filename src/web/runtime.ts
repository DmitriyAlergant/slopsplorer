import type { CommitSpine, FileListResponse, SourceResponse, ViewRequest, ViewResponse } from "../shared/api.ts";
import { fetchFileList, fetchSource, fetchSpine, fetchView } from "./api.ts";

/** The data operations shared by a live server and a static snapshot. */
export interface ExplorerRuntime {
  kind: "live" | "snapshot";
  fetchView(view: ViewRequest, signal?: AbortSignal): Promise<ViewResponse>;
  fetchFileList(view: ViewRequest, signal?: AbortSignal): Promise<FileListResponse>;
  fetchSource(path: string): Promise<SourceResponse>;
  fetchSpine(): Promise<CommitSpine | null>;
}

export const liveRuntime: ExplorerRuntime = {
  kind: "live",
  fetchView,
  fetchFileList,
  fetchSource,
  fetchSpine,
};
