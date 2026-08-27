import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Aspect, ComparisonRequest, FileKind, Measure, RankMetric, RowKind, TreeRow, ViewRequest, ViewResponse,
} from "../shared/api.ts";
import { ASPECTS, MEASURES } from "../shared/api.ts";
import { compare, fetchView, openRoot, rescan } from "./api.ts";
import {
  DEFAULT_WORKSPACE_HEIGHT, MAX_WORKSPACE_HEIGHT, MIN_WORKSPACE_HEIGHT,
  readPreferences, readTreePanelRatio, readWorkspaceHeight,
  writePreferences, writeTreePanelRatio, writeWorkspaceHeight,
} from "./preferences.ts";
import { comparisonLabel } from "./format.ts";
import { closeTooltip } from "./tooltip.ts";
import { readRequest, selectionKey, writeRequest } from "./urlState.ts";
import { FilterBar } from "./components/FilterBar.tsx";
import { DrillBreadcrumbs } from "./components/DrillBreadcrumbs.tsx";
import { FolderDetail } from "./components/FolderDetail.tsx";
import { InstrumentBar } from "./components/InstrumentBar.tsx";
import { MassRibbon } from "./components/MassRibbon.tsx";
import { SkillInstallDialog } from "./components/SkillInstallDialog.tsx";
import { SourceDialog, type Preview } from "./components/SourceDialog.tsx";
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

export function App(): React.JSX.Element {
  const [request, setRequest] = useState<ViewRequest>(requestFromLocation);
  const [view, setView] = useState<ViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [openingRoot, setOpeningRoot] = useState<string | null>(null);
  const [comparingLabel, setComparingLabel] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [skillOpen, setSkillOpen] = useState(false);
  const [treePanelRatio, setTreePanelRatio] = useState(treePanelRatioFromStorage);
  const [workspaceHeight, setWorkspaceHeight] = useState(workspaceHeightFromStorage);
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
  }, [request.kinds, request.showGenerated, request.treeSort, request.measure, request.aspect, request.rank.metric]);

  useEffect(() => {
    writeTreePanelRatio(window.localStorage, treePanelRatio);
  }, [treePanelRatio]);

  useEffect(() => {
    writeWorkspaceHeight(window.localStorage, workspaceHeight);
  }, [workspaceHeight]);

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

  // A scan and a diff draw different columns, so a stored or linked sort can
  // name one the open index has not got. The server clamps it and echoes what
  // it used; adopting that is what keeps the caret under a real heading.
  useEffect(() => {
    if (!view || view.rankMetric === requestRef.current.rank.metric) return;
    setRequest((previous) => ({ ...previous, rank: { ...previous.rank, metric: view.rankMetric } }));
  }, [view]);

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

  /**
   * Aim the page at a new index, and reset what only the old one could mean.
   *
   * Another folder and another comparison both replace the file list, so an
   * exclusion or a drill carried across would name a path that may not exist.
   */
  const reaim = useCallback((
    start: (view: ViewRequest) => Promise<ViewResponse>, finish: () => void,
  ) => {
    const nextRequest: ViewRequest = {
      ...requestRef.current,
      excludedFolders: [],
      excludedDirectFiles: [],
      expanded: [""],
      drillPath: "",
      selected: { rowKind: "folder", path: "" },
    };
    start(nextRequest)
      .then((next) => {
        setRequest(nextRequest);
        setView(next);
        setPreview(null);
        setError(null);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(finish);
  }, []);

  const handleOpen = useCallback((root: string) => {
    setOpeningRoot(root);
    reaim((view) => openRoot(root, view), () => setOpeningRoot(null));
  }, [reaim]);

  const handleCompare = useCallback((comparison: ComparisonRequest) => {
    setComparingLabel(comparisonLabel(comparison));
    reaim((view) => compare(comparison, view), () => setComparingLabel(null));
  }, [reaim]);

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

  const select = useCallback((rowKind: RowKind, path: string) => {
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
   * Switch the unit every figure is expressed in.
   *
   * Choosing a measure is also how the tree is put on its numbers column, so an
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
      const measure = MEASURES.find((candidate) => candidate === metric);
      const aspect = ASPECTS.find((candidate) => candidate === metric);
      const measureChanges = measure !== undefined && measure !== previous.measure;
      const aspectChanges = aspect !== undefined && aspect !== previous.aspect;
      if (previous.rank.metric === metric && !measureChanges && !aspectChanges) return previous;
      return {
        ...previous,
        measure: measureChanges ? measure : previous.measure,
        aspect: aspectChanges ? aspect : previous.aspect,
        rank: {
          ...previous.rank,
          metric,
          minWeight: measureChanges || aspectChanges ? 0 : previous.rank.minWeight,
        },
      };
    });
  }, []);

  /**
   * Switch which side of a change every figure describes.
   *
   * The switch beside the unit owns it, and it moves the same three things the
   * unit does: the tree onto its numbers column, the file tables onto the
   * matching column, and the threshold back to zero, because a floor of 2,000
   * churn tokens is not a floor of 2,000 net tokens.
   */
  const setAspect = useCallback((aspect: Aspect) => {
    setRequest((previous) => {
      if (previous.aspect === aspect) {
        return previous.treeSort === "weight" ? previous : { ...previous, treeSort: "weight" };
      }
      const followsAspect = ASPECTS.some((candidate) => candidate === previous.rank.metric);
      return {
        ...previous,
        aspect,
        treeSort: "weight",
        rank: {
          ...previous.rank,
          metric: followsAspect ? aspect : previous.rank.metric,
          minWeight: 0,
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

  // Taken from the response rather than the pending request, so a heading
  // never claims a mode the numbers beside it are not in.
  const isDiff = view?.meta.diff != null;
  const scanning = rescanning || openingRoot !== null || comparingLabel !== null;
  // Re-aiming replaces the whole data model, so the stale page stays covered
  // until the new figures arrive.
  const reaiming = openingRoot !== null
    ? {
      title: "Opening folder",
      subject: openingRoot,
      hint: "Scanning and measuring the source tree. Large folders can take a moment.",
    }
    : comparingLabel !== null
      ? {
        title: "Comparing",
        subject: comparingLabel,
        hint: "Reading both sides and measuring the change. A wide comparison can take a moment.",
      }
      : null;
  const aspect = view?.aspect ?? request.aspect;

  return (
    <main className="app" data-busy={busy || scanning}>
      <InstrumentBar
        meta={view?.meta ?? null}
        rescanning={rescanning}
        scanning={scanning}
        onRescan={handleRescan}
        onOpen={handleOpen}
        onCompare={handleCompare}
        onInstallSkill={() => setSkillOpen(true)}
      />

      <FilterBar
        request={request}
        isDiff={isDiff}
        onToggleKind={toggleKind}
        onToggleGenerated={() => patch({ showGenerated: !request.showGenerated })}
        onQueryChange={(query) => patch({ query })}
        onMeasureChange={setMeasure}
        onAspectChange={setAspect}
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
          aspect={aspect}
          isDiff={isDiff}
          onSelect={select}
          onDrill={drill}
          onSortChange={(treeSort) => patch({ treeSort })}
          onToggleExpanded={toggleExpanded}
          onToggleFolder={toggleFolder}
          onToggleDirectFiles={toggleDirectFiles}
          onExpandAll={() => patch({ expanded: view?.expandableFolderPaths ?? [""] })}
          onCollapseAll={() => patch({ expanded: [""] })}
        />
        <WorkspaceSplitter ratio={treePanelRatio} onRatioChange={setTreePanelRatio} />
        <FolderDetail
          detail={view?.detail ?? null}
          files={view?.ranked ?? []}
          filesTotal={view?.rankedTotal ?? 0}
          measure={view?.measure ?? request.measure}
          aspect={aspect}
          isDiff={isDiff}
          sort={request.rank.metric}
          onSortChange={setRankMetric}
          path={request.selected.path}
          onSelect={select}
          directFilesOnly={request.selected.rowKind === "files"}
          canDrill={request.selected.rowKind === "folder" && request.selected.path !== request.drillPath}
          onDrill={() => drill(request.selected.path)}
          rank={request.rank}
          onRankChange={setRank}
          onOpenSource={(path) => setPreview({ kind: "file", path })}
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

      {/* Last, because the page reads downstream: the filters and the tree decide
          what is counted, the workspace shows it, and this states the total. */}
      <MassRibbon
        summary={view?.summary ?? null}
        measure={view?.measure ?? request.measure}
        aspect={aspect}
        isDiff={isDiff}
        selected={request.selected}
        onSelect={select}
      />

      <SourceDialog preview={preview} onClose={() => setPreview(null)} />
      <SkillInstallDialog
        open={skillOpen}
        onClose={() => setSkillOpen(false)}
        onPreviewSkill={() => setPreview({ kind: "skill" })}
      />
      {reaiming ? (
        <div className="progress-modal" role="dialog" aria-modal="true" aria-labelledby="reaim-title">
          <div className="progress-modal__card">
            <span className="progress-modal__spinner" aria-hidden="true" />
            <div className="progress-modal__copy">
              <h2 id="reaim-title">{reaiming.title}</h2>
              <p className="progress-modal__path">{reaiming.subject}</p>
              <p className="progress-modal__hint">{reaiming.hint}</p>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
