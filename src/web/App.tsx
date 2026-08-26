import { useCallback, useEffect, useRef, useState } from "react";
import type { FileKind, Measure, RankMetric, TreeRow, ViewRequest, ViewResponse } from "../shared/api.ts";
import { MEASURES } from "../shared/api.ts";
import { fetchView, openRoot, rescan } from "./api.ts";
import {
  DEFAULT_RANKING_HEIGHT, DEFAULT_WORKSPACE_HEIGHT, MAX_WORKSPACE_HEIGHT, MIN_WORKSPACE_HEIGHT,
  readPreferences, readRankingHeight, readTreePanelRatio, readWorkspaceHeight,
  writePreferences, writeRankingHeight, writeTreePanelRatio, writeWorkspaceHeight,
} from "./preferences.ts";
import { closeTooltip } from "./tooltip.ts";
import { readRequest, selectionKey, writeRequest } from "./urlState.ts";
import { FilterBar } from "./components/FilterBar.tsx";
import { DrillBreadcrumbs } from "./components/DrillBreadcrumbs.tsx";
import { FolderDetail } from "./components/FolderDetail.tsx";
import { InstrumentBar } from "./components/InstrumentBar.tsx";
import { LargestFiles } from "./components/LargestFiles.tsx";
import { MassRibbon } from "./components/MassRibbon.tsx";
import { SkillInstallDialog } from "./components/SkillInstallDialog.tsx";
import { SourceDialog } from "./components/SourceDialog.tsx";
import { SourceTree } from "./components/SourceTree.tsx";
import { DEFAULT_TREE_PANEL_RATIO, HeightSplitter, WorkspaceSplitter } from "./components/Splitter.tsx";

/** Long enough to coalesce a burst of typing, short enough to feel immediate. */
const REQUEST_DEBOUNCE_MS = 80;

function requestFromLocation(): ViewRequest {
  try {
    return readRequest(window.location.search, readPreferences(window.localStorage));
  } catch {
    return readRequest(window.location.search);
  }
}

function treePanelRatioFromStorage(): number {
  try {
    return readTreePanelRatio(window.localStorage, DEFAULT_TREE_PANEL_RATIO);
  } catch {
    return DEFAULT_TREE_PANEL_RATIO;
  }
}

function workspaceHeightFromStorage(): number {
  try {
    return readWorkspaceHeight(window.localStorage, DEFAULT_WORKSPACE_HEIGHT);
  } catch {
    return DEFAULT_WORKSPACE_HEIGHT;
  }
}

function rankingHeightFromStorage(): number {
  try {
    return readRankingHeight(window.localStorage, DEFAULT_RANKING_HEIGHT);
  } catch {
    return DEFAULT_RANKING_HEIGHT;
  }
}

export function App(): React.JSX.Element {
  const [request, setRequest] = useState<ViewRequest>(requestFromLocation);
  const [view, setView] = useState<ViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [openingRoot, setOpeningRoot] = useState<string | null>(null);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [skillOpen, setSkillOpen] = useState(false);
  const [treePanelRatio, setTreePanelRatio] = useState(treePanelRatioFromStorage);
  const [workspaceHeight, setWorkspaceHeight] = useState(workspaceHeightFromStorage);
  const [rankingHeight, setRankingHeight] = useState(rankingHeightFromStorage);
  const requestRef = useRef(request);
  requestRef.current = request;
  const lastSelectionRef = useRef(selectionKey(request));

  /**
   * Mirror the view state into the URL so it can be linked and revisited.
   *
   * Changing the selected folder pushes a history entry, so Back walks the
   * folders visited. Filters, search, and ranking replace it instead, which
   * keeps a burst of typing from filling the history stack.
   */
  useEffect(() => {
    const search = writeRequest(request);
    if (search === window.location.search.replace(/^\?/, "")) {
      lastSelectionRef.current = selectionKey(request);
      return;
    }
    const navigated = selectionKey(request) !== lastSelectionRef.current;
    lastSelectionRef.current = selectionKey(request);
    const url = `${window.location.pathname}${search ? `?${search}` : ""}`;
    if (navigated) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, [request]);

  useEffect(() => {
    const restore = (): void => {
      const restored = requestFromLocation();
      lastSelectionRef.current = selectionKey(restored);
      setRequest(restored);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  useEffect(() => {
    try {
      writePreferences(window.localStorage, request);
    } catch {
      // Accessing localStorage itself can be denied in locked-down contexts.
    }
  }, [request.kinds, request.showGenerated, request.treeSort, request.measure, request.rank.metric]);

  useEffect(() => {
    writeTreePanelRatio(window.localStorage, treePanelRatio);
  }, [treePanelRatio]);

  useEffect(() => {
    writeWorkspaceHeight(window.localStorage, workspaceHeight);
  }, [workspaceHeight]);

  useEffect(() => {
    writeRankingHeight(window.localStorage, rankingHeight);
  }, [rankingHeight]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      fetchView(request, controller.signal)
        .then((next) => {
          setView(next);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, REQUEST_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [request]);

  // A new view re-lays out the tree and the tables, so whatever a tooltip was
  // describing may no longer sit under the pointer.
  useEffect(closeTooltip, [view]);

  const patch = useCallback((change: Partial<ViewRequest>) => {
    setRequest((previous) => ({ ...previous, ...change }));
  }, []);

  const handleRescan = useCallback(() => {
    setRescanning(true);
    rescan(requestRef.current)
      .then((next) => {
        setView(next);
        setError(null);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setRescanning(false));
  }, []);

  const handleOpen = useCallback((root: string) => {
    const nextRequest: ViewRequest = {
      ...requestRef.current,
      excludedFolders: [],
      excludedDirectFiles: [],
      expanded: [""],
      drillPath: "",
      selected: { rowKind: "folder", path: "" },
    };
    setOpeningRoot(root);
    openRoot(root, nextRequest)
      .then((next) => {
        setRequest(nextRequest);
        setView(next);
        setSourcePath(null);
        setError(null);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setOpeningRoot(null));
  }, []);

  const toggleKind = useCallback((kind: FileKind) => {
    setRequest((previous) => ({
      ...previous,
      kinds: previous.kinds.includes(kind)
        ? previous.kinds.filter((candidate) => candidate !== kind)
        : [...previous.kinds, kind],
    }));
  }, []);

  const toggleExpanded = useCallback((path: string) => {
    setRequest((previous) => ({
      ...previous,
      expanded: previous.expanded.includes(path)
        ? previous.expanded.filter((candidate) => candidate !== path)
        : [...previous.expanded, path],
    }));
  }, []);

  const select = useCallback((rowKind: "folder" | "files", path: string) => {
    setRequest((previous) => {
      // Selecting a nested folder should reveal it, so open every ancestor.
      const ancestors = new Set(previous.expanded);
      ancestors.add("");
      const segments = path.split("/").filter(Boolean);
      for (let depth = 0; depth < segments.length; depth += 1) {
        ancestors.add(segments.slice(0, depth + 1).join("/"));
      }
      const drillPrefix = previous.drillPath ? `${previous.drillPath}/` : "";
      const insideDrill = previous.drillPath === "" || path === previous.drillPath || path.startsWith(drillPrefix);
      return {
        ...previous,
        drillPath: insideDrill ? previous.drillPath : "",
        selected: { rowKind, path },
        expanded: [...ancestors],
      };
    });
  }, []);

  const drill = useCallback((path: string) => {
    setRequest((previous) => ({
      ...previous,
      drillPath: path,
      selected: { rowKind: "folder", path },
      expanded: [path],
    }));
  }, []);

  /**
   * Toggle a folder's contribution to the totals.
   *
   * Re-including a partially excluded folder clears every exclusion beneath it,
   * so one click on a parent always restores its whole subtree.
   */
  const toggleFolder = useCallback((row: TreeRow) => {
    setRequest((previous) => {
      const prefix = row.path ? `${row.path}/` : "";
      const inSubtree = (candidate: string): boolean =>
        candidate === row.path || prefix === "" || candidate.startsWith(prefix);
      if (row.indeterminate || !row.included) {
        return {
          ...previous,
          excludedFolders: previous.excludedFolders.filter((candidate) => !inSubtree(candidate)),
          excludedDirectFiles: previous.excludedDirectFiles.filter((candidate) => !inSubtree(candidate)),
        };
      }
      if (row.disabled) return previous;
      return {
        ...previous,
        excludedFolders: [...previous.excludedFolders.filter((candidate) => !inSubtree(candidate)), row.path],
        excludedDirectFiles: previous.excludedDirectFiles.filter((candidate) => !inSubtree(candidate)),
      };
    });
  }, []);

  const toggleDirectFiles = useCallback((row: TreeRow) => {
    setRequest((previous) => ({
      ...previous,
      excludedDirectFiles: previous.excludedDirectFiles.includes(row.path)
        ? previous.excludedDirectFiles.filter((candidate) => candidate !== row.path)
        : [...previous.excludedDirectFiles, row.path],
    }));
  }, []);

  /** Ignore an unchanged value so the measurement cannot drive a render loop. */
  const setCardColumns = useCallback((cardColumns: number) => {
    setRequest((previous) => (previous.cardColumns === cardColumns ? previous : { ...previous, cardColumns }));
  }, []);

  const setRank = useCallback((change: Partial<ViewRequest["rank"]>) => {
    setRequest((previous) => ({ ...previous, rank: { ...previous.rank, ...change } }));
  }, []);

  /**
   * Switch the unit every figure is expressed in, from the tree's numbers heading.
   *
   * Choosing a measure there is also how the tree is put on that column, so an
   * unchanged measure still moves the sort. The file tables follow, because a
   * page counting code lines that ranks its files by tokens reads as a bug. A
   * sort on a metric outside the measures, such as comment lines, is a
   * deliberate choice and stays where it is. The threshold resets, since a
   * floor of 2,000 tokens is not a floor of 2,000 lines and carrying the number
   * across would silently empty the list.
   */
  const setMeasure = useCallback((measure: Measure) => {
    setRequest((previous) => {
      if (previous.measure === measure) {
        return previous.treeSort === "weight" ? previous : { ...previous, treeSort: "weight" };
      }
      const followsMeasure = MEASURES.some((candidate) => candidate === previous.rank.metric);
      return {
        ...previous,
        measure,
        treeSort: "weight",
        rank: {
          ...previous.rank,
          metric: followsMeasure ? measure : previous.rank.metric,
          minWeight: 0,
        },
      };
    });
  }, []);

  /**
   * Sort both file tables on one of their columns.
   *
   * The three measured columns carry the measure with them, which is the same
   * coupling {@link setMeasure} applies from the other side: the page has one
   * unit and one file order, and every column heading that can set them does.
   * The other columns order the tables without touching the unit.
   */
  const setRankMetric = useCallback((metric: RankMetric) => {
    setRequest((previous) => {
      if (previous.rank.metric === metric) return previous;
      const measure = MEASURES.find((candidate) => candidate === metric);
      const measureChanges = measure !== undefined && measure !== previous.measure;
      return {
        ...previous,
        measure: measureChanges ? measure : previous.measure,
        rank: {
          ...previous.rank,
          metric,
          minWeight: measureChanges ? 0 : previous.rank.minWeight,
        },
      };
    });
  }, []);

  if (error && !view) {
    return (
      <main className="app app--error">
        <h1 className="wordmark">Slopsplorer</h1>
        <p className="error-detail">{error}</p>
        <p className="error-hint">The scan server is not responding. Restart it and reload this page.</p>
      </main>
    );
  }

  return (
    <main className="app" data-busy={busy || rescanning || openingRoot !== null}>
      <InstrumentBar
        meta={view?.meta ?? null}
        rescanning={rescanning}
        opening={openingRoot !== null}
        onRescan={handleRescan}
        onOpen={handleOpen}
        onInstallSkill={() => setSkillOpen(true)}
      />

      <FilterBar
        request={request}
        onToggleKind={toggleKind}
        onToggleGenerated={() => patch({ showGenerated: !request.showGenerated })}
        onQueryChange={(query) => patch({ query })}
      />

      {/* The trail names the scope the tree beneath it is rooted in, and is the
          way back up out of a drill, so it sits with the tree rather than with
          the figures that summarise the scope further down. */}
      <DrillBreadcrumbs
        rootName={view?.meta.rootName ?? "Project"}
        drillPath={request.drillPath}
        onDrill={drill}
      />

      {error ? <p className="error-banner" role="status">{error}</p> : null}

      <div
        className="workspace"
        style={{
          "--tree-panel-width": `${treePanelRatio * 100}%`,
          "--workspace-height": `${workspaceHeight}px`,
        } as React.CSSProperties}
      >
        <SourceTree
          rows={view?.tree ?? []}
          sort={request.treeSort}
          measure={view?.measure ?? request.measure}
          onSelect={select}
          onDrill={drill}
          onSortChange={(treeSort) => patch({ treeSort })}
          onMeasureChange={setMeasure}
          onToggleExpanded={toggleExpanded}
          onToggleFolder={toggleFolder}
          onToggleDirectFiles={toggleDirectFiles}
          onExpandAll={() => patch({ expanded: view?.expandableFolderPaths ?? [""] })}
          onCollapseAll={() => patch({ expanded: [""] })}
        />
        <WorkspaceSplitter ratio={treePanelRatio} onRatioChange={setTreePanelRatio} />
        <FolderDetail
          detail={view?.detail ?? null}
          measure={view?.measure ?? request.measure}
          sort={request.rank.metric}
          onSortChange={setRankMetric}
          path={request.selected.path}
          onSelectFolder={(path) => select("folder", path)}
          directFilesOnly={request.selected.rowKind === "files"}
          canDrill={request.selected.rowKind === "folder" && request.selected.path !== request.drillPath}
          onDrill={() => drill(request.selected.path)}
          onOpenSource={setSourcePath}
          onCapacityChange={setCardColumns}
        />
      </div>

      <HeightSplitter
        height={workspaceHeight}
        onHeightChange={setWorkspaceHeight}
        label="Resize both workspace panels"
        hint="Drag to resize both panels. Double-click to reset."
        minimum={MIN_WORKSPACE_HEIGHT}
        maximum={MAX_WORKSPACE_HEIGHT}
        defaultHeight={DEFAULT_WORKSPACE_HEIGHT}
      />

      {/* Below the workspace, because the page reads downstream: the filters and
          the tree decide what is counted, and every figure here is the result. */}
      <MassRibbon
        summary={view?.summary ?? null}
        measure={view?.measure ?? request.measure}
        selectedPath={request.selected.rowKind === "folder" ? request.selected.path : null}
        onSelect={(path) => select("folder", path)}
      />

      <LargestFiles
        files={view?.ranked ?? []}
        measure={view?.measure ?? request.measure}
        total={view?.rankedTotal ?? 0}
        scopePath={request.selected.path}
        directFilesOnly={request.selected.rowKind === "files"}
        rootName={view?.meta.rootName ?? ""}
        displayRoot={request.drillPath}
        rank={request.rank}
        height={rankingHeight}
        onHeightChange={setRankingHeight}
        onRankChange={setRank}
        onSortChange={setRankMetric}
        onOpenSource={setSourcePath}
      />

      <SourceDialog path={sourcePath} onClose={() => setSourcePath(null)} />
      <SkillInstallDialog open={skillOpen} onClose={() => setSkillOpen(false)} />
      {openingRoot ? (
        <div className="progress-modal" role="dialog" aria-modal="true" aria-labelledby="opening-folder-title">
          <div className="progress-modal__card">
            <span className="progress-modal__spinner" aria-hidden="true" />
            <div className="progress-modal__copy">
              <h2 id="opening-folder-title">Opening folder</h2>
              <p className="progress-modal__path">{openingRoot}</p>
              <p className="progress-modal__hint">Scanning and measuring the source tree. Large folders can take a moment.</p>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
