import type { FileKind, RankMetric, ViewRequest } from "../shared/api.ts";
import { FILE_KINDS, RANK_METRICS, TREE_SORTS } from "../shared/api.ts";
import type { ViewPreferences } from "./preferences.ts";

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
export function readRequest(search: string, stored: ViewPreferences | null = null): ViewRequest {
  const params = new URLSearchParams(search);
  const embeddedPreferences = params.get("prefs") === "1";
  const path = params.get("path") ?? "";
  const drillPath = params.get("drill") ?? "";
  const rawKinds = params.get("kinds");
  const metric = RANK_METRICS.find((candidate) => candidate === params.get("rank"));
  const treeSort = TREE_SORTS.find((candidate) => candidate === params.get("tree"));
  return {
    kinds: rawKinds !== null
      ? rawKinds.split(",").filter(isFileKind)
      : !embeddedPreferences && stored !== null ? stored.kinds : [...FILE_KINDS],
    showGenerated: params.has("gen")
      ? params.get("gen") === "1"
      : !embeddedPreferences && stored !== null ? stored.showGenerated : false,
    query: params.get("q") ?? "",
    excludedFolders: params.getAll("x"),
    excludedDirectFiles: params.getAll("xf"),
    expanded: ancestorsOf(path),
    treeSort: treeSort ?? (!embeddedPreferences && stored !== null ? stored.treeSort : "name"),
    drillPath,
    selected: { rowKind: params.get("sel") === "files" ? "files" : "folder", path },
    rank: {
      metric: metric ?? "tokens",
      minTokens: Math.max(0, Number(params.get("min")) || 0),
      limit: RANK_LIMIT,
    },
    // Layout capacity, measured by the panel rather than carried in the link.
    cardColumns: 3,
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
  const preferencesDifferFromDefaults =
    request.kinds.length !== FILE_KINDS.length || request.showGenerated || request.treeSort !== "name";
  if (preferencesDifferFromDefaults) params.set("prefs", "1");
  if (request.selected.path) params.set("path", request.selected.path);
  if (request.drillPath) params.set("drill", request.drillPath);
  if (request.selected.rowKind === "files") params.set("sel", "files");
  if (request.kinds.length !== FILE_KINDS.length) {
    params.set("kinds", FILE_KINDS.filter((kind) => request.kinds.includes(kind)).join(","));
  }
  if (request.showGenerated) params.set("gen", "1");
  if (request.query) params.set("q", request.query);
  for (const folder of request.excludedFolders) params.append("x", folder);
  for (const folder of request.excludedDirectFiles) params.append("xf", folder);
  if (request.treeSort !== "name") params.set("tree", request.treeSort);
  if (request.rank.metric !== "tokens") params.set("rank", request.rank.metric);
  if (request.rank.minTokens > 0) params.set("min", String(request.rank.minTokens));
  return params.toString();
}

/** Identifies what counts as a navigation, so only these push a history entry. */
export function selectionKey(request: ViewRequest): string {
  return `${request.drillPath}|${request.selected.rowKind}:${request.selected.path}`;
}
