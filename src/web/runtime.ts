import type { CommitSpine, SourceResponse, ViewRequest, ViewResponse } from "../shared/api.ts";
import { fetchSource, fetchSpine, fetchView } from "./api.ts";

/** The data operations shared by a live server and a static snapshot. */
export interface ExplorerRuntime {
  kind: "live" | "snapshot";
  fetchView(view: ViewRequest, signal?: AbortSignal): Promise<ViewResponse>;
  fetchSource(path: string): Promise<SourceResponse>;
  fetchSpine(): Promise<CommitSpine | null>;
}

export const liveRuntime: ExplorerRuntime = {
  kind: "live",
  fetchView,
  fetchSource,
  fetchSpine,
};
