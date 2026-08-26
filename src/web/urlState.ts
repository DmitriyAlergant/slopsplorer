import type { FileKind, RankMetric, ViewRequest } from "../shared/api.ts";
import { FILE_KINDS, RANK_METRICS } from "../shared/api.ts";

/** Matches the server's own ceiling on how many ranked rows it will return. */
const RANK_LIMIT = 100;

/**
 * Every folder enclosing `path`, so a deep link opens onto its target.
 *
 * Expansion is derived rather than stored. Persisting it would put a folder
 * path in the URL for every open row, which on a large tree produces a link
 * too long to paste, and the ancestor chain is the only expansion a deep link
 * actually needs.
 */
function ancestorsOf(path: string): string[] {
  const expanded = [""];
  const segments = path.split("/").filter(Boolean);
  for (let depth = 0; depth < segments.length; depth += 1) {
    expanded.push(segments.slice(0, depth + 1).join("/"));
  }
  return expanded;
}

function isFileKind(value: string): value is FileKind {
  return (FILE_KINDS as readonly string[]).includes(value);
}

/** Rebuild the view state from a query string, falling back to the defaults. */
export function readRequest(search: string): ViewRequest {
  const params = new URLSearchParams(search);
  const path = params.get("path") ?? "";
  const rawKinds = params.get("kinds");
  const metric = RANK_METRICS.find((candidate) => candidate === params.get("rank"));
  return {
    kinds: rawKinds === null ? [...FILE_KINDS] : rawKinds.split(",").filter(isFileKind),
    showGenerated: params.get("gen") === "1",
    query: params.get("q") ?? "",
    excludedFolders: params.getAll("x"),
    excludedDirectFiles: params.getAll("xf"),
    expanded: ancestorsOf(path),
    selected: { rowKind: params.get("sel") === "files" ? "files" : "folder", path },
    rank: {
      metric: metric ?? "tokens",
      minTokens: Math.max(0, Number(params.get("min")) || 0),
      limit: RANK_LIMIT,
    },
  };
}

/**
 * Serialise the view state, omitting anything left at its default.
 *
 * List values are repeated parameters rather than a delimited string, because
 * a directory name may legally contain any separator we might have picked.
 */
export function writeRequest(request: ViewRequest): string {
  const params = new URLSearchParams();
  if (request.selected.path) params.set("path", request.selected.path);
  if (request.selected.rowKind === "files") params.set("sel", "files");
  if (request.kinds.length !== FILE_KINDS.length) {
    params.set("kinds", FILE_KINDS.filter((kind) => request.kinds.includes(kind)).join(","));
  }
  if (request.showGenerated) params.set("gen", "1");
  if (request.query) params.set("q", request.query);
  for (const folder of request.excludedFolders) params.append("x", folder);
  for (const folder of request.excludedDirectFiles) params.append("xf", folder);
  if (request.rank.metric !== "tokens") params.set("rank", request.rank.metric);
  if (request.rank.minTokens > 0) params.set("min", String(request.rank.minTokens));
  return params.toString();
}

/** Identifies what counts as a navigation, so only these push a history entry. */
export function selectionKey(request: ViewRequest): string {
  return `${request.selected.rowKind}:${request.selected.path}`;
}

/** Two requests describe the same view. */
export function sameRequest(left: ViewRequest, right: ViewRequest): boolean {
  return writeRequest(left) === writeRequest(right);
}
