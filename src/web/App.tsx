import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentTool, Aspect, AskTask, CommitSpine, ComparisonRequest, FileKind, Measure, RankMetric, RowKind,
  ReviewMode, SnapshotBacklink, TreeRow, ViewRequest, ViewResponse,
} from "../shared/api.ts";
import { ASPECTS, MEASURES, spansRequest } from "../shared/api.ts";
import {
  compare, dismissAsk, fetchAgents, fetchAsks, openRoot, rescan, startAsk, switchReviewMode,
} from "./api.ts";
import { liveRuntime, type ExplorerRuntime } from "./runtime.ts";
import {
  DEFAULT_SPINE_HEIGHT, DEFAULT_WORKSPACE_HEIGHT, MAX_WORKSPACE_HEIGHT, MIN_WORKSPACE_HEIGHT,
  browserStorage, readAskAgent, readPreferences, readSpineExpanded, readSpineHeight,
  readTreePanelRatio, readWorkspaceHeight, writeAskAgent, writePreferences, writeSpineExpanded,
  writeSpineHeight, writeTreePanelRatio, writeWorkspaceHeight,
} from "./preferences.ts";
import { isInsideFolder } from "./displayPath.ts";
import { comparisonLabel, documentTitle, messageOf } from "./format.ts";
import { closeTooltip } from "./tooltip.ts";
import { readRequest, selectionKey, writeRequest } from "./urlState.ts";
import { AnswerDialog } from "./components/AnswerDialog.tsx";
import { AskDialog } from "./components/AskDialog.tsx";
import { AskDock } from "./components/AskDock.tsx";
import { FilterBar } from "./components/FilterBar.tsx";
import { FolderDetail } from "./components/FolderDetail.tsx";
import { InstrumentBar } from "./components/InstrumentBar.tsx";
import { MassRibbon } from "./components/MassRibbon.tsx";
import { SkillInstallDialog } from "./components/SkillInstallDialog.tsx";
import { SourceDialog, type Preview } from "./components/SourceDialog.tsx";
import { SourceTree } from "./components/SourceTree.tsx";
import { PendingSpineBand, SpineBand } from "./components/SpineBand.tsx";
import { DEFAULT_TREE_PANEL_RATIO, HeightSplitter, WorkspaceSplitter } from "./components/Splitter.tsx";

/** Long enough to coalesce a burst of typing, short enough to feel immediate. */
const REQUEST_DEBOUNCE_MS = 80;

/**
 * How often a running ask is asked whether it has finished.
 *
 * An agent takes minutes, so this is about how soon the floater turns rather
 * than about the answer arriving any sooner.
 */
const ASK_POLL_MS = 1200;

function requestFromLocation(): ViewRequest {
  return readRequest(window.location.search, readPreferences(browserStorage()));
}

/** Open `root` and every folder under it, and leave the rest of the tree as it is. */
function withSubtreeExpanded(expanded: readonly string[], expandable: readonly string[], root: string): string[] {
  const opened = new Set(expanded);
  opened.add(root);
  for (const path of expandable) {
    if (isInsideFolder(path, root)) opened.add(path);
  }
  return [...opened];
}

/**
 * Close every folder under `root`, and leave `root` itself open.
 *
 * Selecting a folder opens it, so closing the folder the button acts on would
 * undo the selection that aimed the button.
 */
function withSubtreeCollapsed(expanded: readonly string[], root: string): string[] {
  return expanded.filter((path) => path === root || !isInsideFolder(path, root));
}

interface Props {
  runtime?: ExplorerRuntime;
  backlink?: SnapshotBacklink | null;
}

export function App({ runtime = liveRuntime, backlink = null }: Props = {}): React.JSX.Element {
  const staticSnapshot = runtime.kind === "snapshot";
  const [request, setRequest] = useState<ViewRequest>(requestFromLocation);
  const [view, setView] = useState<ViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [openingRoot, setOpeningRoot] = useState<string | null>(null);
  const [comparingLabel, setComparingLabel] = useState<string | null>(null);
  const [reviewModeTarget, setReviewModeTarget] = useState<ReviewMode | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [skillOpen, setSkillOpen] = useState(false);
  const [agents, setAgents] = useState<readonly AgentTool[]>([]);
  const [agentId, setAgentId] = useState<string | null>(() => readAskAgent(browserStorage()));
  const [askOpen, setAskOpen] = useState(false);
  const [askStarting, setAskStarting] = useState(false);
  const [askFailure, setAskFailure] = useState<string | null>(null);
  const [tasks, setTasks] = useState<readonly AskTask[]>([]);
  const [openAnswerId, setOpenAnswerId] = useState<string | null>(null);
  const [lastViewedPath, setLastViewedPath] = useState<string | null>(null);
  const [spine, setSpine] = useState<CommitSpine | null>(null);
  const [spineLoading, setSpineLoading] = useState(false);
  const [spineExpanded, setSpineExpanded] = useState(() => readSpineExpanded(browserStorage()));
  const [spineHeight, setSpineHeight] = useState(() => readSpineHeight(browserStorage(), DEFAULT_SPINE_HEIGHT));
  const [treePanelRatio, setTreePanelRatio] = useState(
    () => readTreePanelRatio(browserStorage(), DEFAULT_TREE_PANEL_RATIO),
  );
  const [workspaceHeight, setWorkspaceHeight] = useState(
    () => readWorkspaceHeight(browserStorage(), DEFAULT_WORKSPACE_HEIGHT),
  );
  const requestRef = useRef(request);
  requestRef.current = request;
  const displayedRequestRef = useRef(request);
  const spineRef = useRef(spine);
  spineRef.current = spine;
  const lastSelectionRef = useRef(selectionKey(request));
  const lastViewedPathRef = useRef(lastViewedPath);
  lastViewedPathRef.current = lastViewedPath;

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
    writePreferences(browserStorage(), request);
  }, [request.treeSort, request.measure, request.aspect, request.rank.metric]);

  // The tab names what was measured, so two open windows are told apart at a
  // glance. It follows the response rather than the request, for the same
  // reason every heading does.
  useEffect(() => {
    document.title = documentTitle(view?.meta ?? null);
  }, [view?.meta]);

  useEffect(() => {
    writeTreePanelRatio(browserStorage(), treePanelRatio);
  }, [treePanelRatio]);

  useEffect(() => {
    writeWorkspaceHeight(browserStorage(), workspaceHeight);
  }, [workspaceHeight]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      runtime.fetchView(request, controller.signal)
        .then((next) => {
          displayedRequestRef.current = request;
          setView(next);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setError(messageOf(cause));
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, REQUEST_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [request, runtime]);

  /**
   * What this host can ask, and what it was already asked.
   *
   * The agents were found once, before the server started listening, so this
   * is a read of that list and never a search of its own. The asks come back
   * too, which is what lets a reload find an answer that arrived while the
   * page was closed.
   */
  useEffect(() => {
    if (staticSnapshot) return;
    let cancelled = false;
    const fail = (cause: unknown): void => {
      if (!cancelled) setError(messageOf(cause));
    };
    fetchAgents().then((found) => { if (!cancelled) setAgents(found.agents); }, fail);
    fetchAsks().then((held) => { if (!cancelled) setTasks(held.tasks); }, fail);
    return () => { cancelled = true; };
  }, [staticSnapshot]);

  // Only while something runs: a dock of finished asks has nothing to learn.
  const asksRunning = tasks.some((task) => task.state === "running");
  useEffect(() => {
    if (!asksRunning) return;
    let cancelled = false;
    const poll = (): void => {
      fetchAsks().then(
        (held) => { if (!cancelled) setTasks(held.tasks); },
        (cause: unknown) => { if (!cancelled) setError(messageOf(cause)); },
      );
    };
    const timer = setInterval(poll, ASK_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [asksRunning]);

  // A new view re-lays out the tree and the tables, so whatever a tooltip was
  // describing may no longer sit under the pointer.
  useEffect(closeTooltip, [view]);

  const patch = useCallback((change: Partial<ViewRequest>) => {
    const resetsPage = Object.keys(change).some((field) => ![
      "expanded", "treeSort", "cardColumns",
    ].includes(field));
    setRequest((previous) => ({
      ...previous,
      ...change,
      ...(resetsPage ? { rank: { ...previous.rank, offset: 0 } } : {}),
    }));
  }, []);

  // A scan and a diff draw different columns, so a stored or linked sort can
  // name one the open index has not got. The server clamps it and echoes what
  // it used; adopting that is what keeps the caret under a real heading.
  useEffect(() => {
    if (!view) return;
    const current = requestRef.current.rank;
    if (view.rankMetric === current.metric && view.rankedOffset === current.offset) return;
    setRequest((previous) => ({
      ...previous,
      rank: { ...previous.rank, metric: view.rankMetric, offset: view.rankedOffset },
    }));
  }, [view]);

  /**
   * Hold the spine of the range being reviewed.
   *
   * A step opens a comparison inside the same range, so the band must not be
   * rebuilt as the reader walks it. It is asked for again only when a
   * comparison arrives that the held spine does not span, which is what makes
   * measuring a commit at a time affordable.
   */
  const diffSpec = view?.meta.diff?.spec ?? null;
  useEffect(() => {
    let cancelled = false;
    const diff = view?.meta.diff ?? null;
    if (diff === null) {
      setSpine(null);
    } else if (spineRef.current === null || !spansRequest(spineRef.current, diff.request)) {
      // Dropped before the ask, so the band never draws a selection read from a
      // range the page has already left.
      setSpine(null);
      setSpineLoading(true);
      runtime.fetchSpine()
        .then((next) => {
          if (!cancelled) setSpine(next);
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setSpine(null);
          setError(messageOf(cause));
        })
        .finally(() => {
          if (!cancelled) setSpineLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
    // The spec names the open comparison, which is the only thing that can
    // move the page out of the range the held spine covers.
  }, [diffSpec, runtime]);

  const handleRescan = useCallback(() => {
    setRescanning(true);
    rescan(requestRef.current)
      .then((next) => {
        displayedRequestRef.current = requestRef.current;
        setView(next);
        setError(null);
      })
      .catch((cause: unknown) => setError(messageOf(cause)))
      .finally(() => setRescanning(false));
  }, []);

  /** The agent the reader last chose, or the first one this host offers. */
  const chosenAgent = agents.find((agent) => agent.id === agentId) ?? agents[0];
  const chosenAgentId = chosenAgent?.id ?? null;

  const chooseAgent = useCallback((chosen: string) => {
    setAgentId(chosen);
    writeAskAgent(browserStorage(), chosen);
  }, []);

  /**
   * Start one agent on one question.
   *
   * The request goes with it, so the brief the server writes describes the
   * page as it is at the moment of asking and not as it is when the answer
   * arrives. The dialog closes at once, because the answer is minutes away
   * and the dock is where it will appear.
   */
  const handleAsk = useCallback((question: string) => {
    if (chosenAgentId === null) return;
    setAskStarting(true);
    setAskFailure(null);
    startAsk({
      agentId: chosenAgentId,
      question,
      view: requestRef.current,
      lastViewedPath: lastViewedPathRef.current,
    })
      .then((task) => {
        setTasks((previous) => [task, ...previous]);
        setAskOpen(false);
      })
      .catch((cause: unknown) => setAskFailure(messageOf(cause)))
      .finally(() => setAskStarting(false));
  }, [chosenAgentId]);

  const handleDismissAsk = useCallback((id: string) => {
    setOpenAnswerId((open) => (open === id ? null : open));
    dismissAsk(id)
      .then((held) => setTasks(held.tasks))
      .catch((cause: unknown) => setError(messageOf(cause)));
  }, []);

  const openFile = useCallback((path: string) => {
    setLastViewedPath(path);
    setPreview({ kind: "file", path });
  }, []);

  /**
   * Read the panel's whole file list end to end, in path order.
   *
   * The modal holds the request that produced the visible page.
   * It uses that request to load all matches, independent of the table offset.
   */
  const openListedFiles = useCallback(() => {
    if (view === null || view.ranked.length === 0) return;
    setPreview({
      kind: "files",
      title: displayedRequestRef.current.selected.path || view.meta.rootName,
      request: displayedRequestRef.current,
      total: view.rankedTotal,
      measure: view.measure,
      isDiff: view.meta.diff !== null,
    });
  }, [view]);

  /**
   * Aim the page at a new index, and reset what only the old one could mean.
   *
   * Another folder and another comparison both replace the file list, so an
   * exclusion or a drill carried across would name a path that may not exist.
   *
   * A step along the commit band is the exception: it opens a comparison inside
   * the range already being reviewed, and throwing the reader back to the
   * project root on every step would make walking commits unusable.
   */
  const reaim = useCallback((
    start: (view: ViewRequest) => Promise<ViewResponse>, finish: () => void, keepPlace = false,
  ) => {
    const nextRequest: ViewRequest = keepPlace ? { ...requestRef.current } : {
      ...requestRef.current,
      excludedFolders: [],
      excludedDirectFiles: [],
      expanded: [""],
      drillPath: "",
      selected: { rowKind: "folder", path: "" },
    };
    start(nextRequest)
      .then((next) => {
        displayedRequestRef.current = nextRequest;
        setRequest(nextRequest);
        setView(next);
        setPreview(null);
        setError(null);
      })
      .catch((cause: unknown) => setError(messageOf(cause)))
      .finally(finish);
  }, []);

  const handleOpen = useCallback((root: string) => {
    setOpeningRoot(root);
    reaim((view) => openRoot(root, view), () => setOpeningRoot(null));
  }, [reaim]);

  const handleCompare = useCallback((comparison: ComparisonRequest, keepPlace = false) => {
    setComparingLabel(comparisonLabel(comparison));
    reaim((view) => compare(comparison, view), () => setComparingLabel(null), keepPlace);
  }, [reaim]);

  const handleReviewMode = useCallback((mode: ReviewMode) => {
    if (view?.meta.review?.mode === mode) return;
    setReviewModeTarget(mode);
    reaim((request) => switchReviewMode(mode, request), () => setReviewModeTarget(null));
  }, [reaim, view?.meta.review?.mode]);

  /** Walking the band never leaves the range, so it never loses the reader's place. */
  const handleSpan = useCallback((comparison: ComparisonRequest) => {
    handleCompare(comparison, true);
  }, [handleCompare]);

  const resizeSpine = useCallback((height: number) => {
    setSpineHeight(height);
    writeSpineHeight(browserStorage(), height);
  }, []);

  const toggleSpineExpanded = useCallback((expanded: boolean) => {
    setSpineExpanded(expanded);
    writeSpineExpanded(browserStorage(), expanded);
  }, []);

  const toggleKind = useCallback((kind: FileKind) => {
    setRequest((previous) => ({
      ...previous,
      kinds: previous.kinds.includes(kind)
        ? previous.kinds.filter((candidate) => candidate !== kind)
        : [...previous.kinds, kind],
      rank: { ...previous.rank, offset: 0 },
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
        rank: { ...previous.rank, offset: 0 },
      };
    });
  }, []);

  const drill = useCallback((path: string) => {
    setRequest((previous) => ({
      ...previous,
      drillPath: path,
      selected: { rowKind: "folder", path },
      expanded: [path],
      rank: { ...previous.rank, offset: 0 },
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
          rank: { ...previous.rank, offset: 0 },
        };
      }
      if (row.disabled) return previous;
      return {
        ...previous,
        excludedFolders: [...previous.excludedFolders.filter((candidate) => !inSubtree(candidate)), row.path],
        excludedDirectFiles: previous.excludedDirectFiles.filter((candidate) => !inSubtree(candidate)),
        rank: { ...previous.rank, offset: 0 },
      };
    });
  }, []);

  const toggleDirectFiles = useCallback((row: TreeRow) => {
    setRequest((previous) => ({
      ...previous,
      excludedDirectFiles: previous.excludedDirectFiles.includes(row.path)
        ? previous.excludedDirectFiles.filter((candidate) => candidate !== row.path)
        : [...previous.excludedDirectFiles, row.path],
      rank: { ...previous.rank, offset: 0 },
    }));
  }, []);

  /** Ignore an unchanged value so the measurement cannot drive a render loop. */
  const setCardColumns = useCallback((cardColumns: number) => {
    setRequest((previous) => (previous.cardColumns === cardColumns ? previous : { ...previous, cardColumns }));
  }, []);

  const setRank = useCallback((change: Partial<ViewRequest["rank"]>) => {
    const changesList = Object.keys(change).some((field) => field !== "offset");
    setRequest((previous) => ({
      ...previous,
      rank: { ...previous.rank, ...change, ...(changesList ? { offset: 0 } : {}) },
    }));
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
          offset: 0,
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
          offset: 0,
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
          offset: 0,
        },
      };
    });
  }, []);

  if (error && !view) {
    return (
      <main className="app app--error">
        <h1 className="wordmark">Slopsplorer</h1>
        <p className="error-detail">{error}</p>
        <p className="error-hint">
          {staticSnapshot ? "The static snapshot could not be loaded." : "The scan server is not responding. Restart it and reload this page."}
        </p>
      </main>
    );
  }

  // Taken from the response rather than the pending request, so a heading
  // never claims a mode the numbers beside it are not in.
  const isDiff = view?.meta.diff != null;
  const scanning = rescanning || openingRoot !== null || comparingLabel !== null || reviewModeTarget !== null;
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
      : reviewModeTarget !== null
        ? {
          title: reviewModeTarget === "diff" ? "Opening diff" : `Opening ${reviewModeTarget} view`,
          subject: view?.meta.review?.spec ?? view?.meta.rootPath ?? "Repository",
          hint: reviewModeTarget === "diff"
            ? "Rescanning and measuring the change."
            : "Rescanning and measuring the complete repository image.",
        }
      : null;
  const aspect = view?.aspect ?? request.aspect;

  return (
    <main className="app" data-busy={busy || scanning}>
      <InstrumentBar
        meta={view?.meta ?? null}
        staticSnapshot={staticSnapshot}
        backlink={backlink}
        rescanning={rescanning}
        scanning={scanning}
        onRescan={handleRescan}
        onOpen={handleOpen}
        onCompare={handleCompare}
        onReviewMode={handleReviewMode}
        agents={agents}
        agentId={chosenAgentId ?? ""}
        onChooseAgent={chooseAgent}
        onAsk={() => {
          setAskFailure(null);
          setAskOpen(true);
        }}
      />

      {view && view.meta.diff && spine === null && spineLoading ? <PendingSpineBand /> : null}

      {view && view.meta.diff && spine && spine.commits.length > 0 ? (
        <SpineBand
          spine={spine}
          measure={view.measure}
          request={view.meta.diff.request}
          disabled={staticSnapshot || busy || scanning}
          expanded={spineExpanded}
          onExpandedChange={toggleSpineExpanded}
          onSelect={handleSpan}
          height={spineHeight}
          onHeightChange={resizeSpine}
        />
      ) : null}

      <FilterBar
        request={request}
        isDiff={isDiff}
        onToggleKind={toggleKind}
        onToggleGenerated={() => patch({ showGenerated: !request.showGenerated })}
        onQueryChange={(query) => patch({ query })}
        onMeasureChange={setMeasure}
        onAspectChange={setAspect}
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
          rootName={view?.meta.rootName ?? "Project"}
          drillPath={request.drillPath}
          sort={request.treeSort}
          measure={view?.measure ?? request.measure}
          aspect={aspect}
          isDiff={isDiff}
          selectedPath={request.selected.path}
          onSelect={select}
          onDrill={drill}
          onSortChange={(treeSort) => patch({ treeSort })}
          onToggleExpanded={toggleExpanded}
          onToggleFolder={toggleFolder}
          onToggleDirectFiles={toggleDirectFiles}
          onExpandSubtree={(path) => patch({
            expanded: withSubtreeExpanded(request.expanded, view?.expandableFolderPaths ?? [], path),
          })}
          onCollapseSubtree={(path) => patch({ expanded: withSubtreeCollapsed(request.expanded, path) })}
        />
        <WorkspaceSplitter ratio={treePanelRatio} onRatioChange={setTreePanelRatio} />
        <FolderDetail
          detail={view?.detail ?? null}
          files={view?.ranked ?? []}
          filesTotal={view?.rankedTotal ?? 0}
          filesOffset={view?.rankedOffset ?? 0}
          measure={view?.measure ?? request.measure}
          aspect={aspect}
          isDiff={isDiff}
          sort={request.rank.metric}
          onSortChange={setRankMetric}
          path={request.selected.path}
          onSelect={select}
          directFilesOnly={request.selected.rowKind === "files"}
          fileScope={request.fileScope}
          onFileScopeChange={(fileScope) => patch({ fileScope })}
          canDrill={request.selected.rowKind === "folder" && request.selected.path !== request.drillPath}
          onDrill={() => drill(request.selected.path)}
          rank={request.rank}
          onRankChange={setRank}
          onOpenSource={openFile}
          onOpenListed={openListedFiles}
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

      {staticSnapshot ? null : (
        <p className="colophon">
          <button type="button" className="link" onClick={() => setSkillOpen(true)}>
            Install the agent skill
          </button>
        </p>
      )}

      <AskDock
        tasks={tasks}
        onOpen={(task) => setOpenAnswerId(task.id)}
        onDismiss={handleDismissAsk}
      />

      {chosenAgent !== undefined ? (
        <AskDialog
          open={askOpen}
          agent={chosenAgent}
          starting={askStarting}
          failure={askFailure}
          onClose={() => setAskOpen(false)}
          onAsk={handleAsk}
        />
      ) : null}

      <AnswerDialog
        task={tasks.find((task) => task.id === openAnswerId) ?? null}
        onClose={() => setOpenAnswerId(null)}
      />

      <SourceDialog
        preview={preview}
        onClose={() => setPreview(null)}
        loadSource={runtime.fetchSource}
        loadFileList={runtime.fetchFileList}
      />
      {staticSnapshot ? null : (
        <SkillInstallDialog
          open={skillOpen}
          onClose={() => setSkillOpen(false)}
          onPreviewSkill={() => setPreview({ kind: "skill" })}
        />
      )}
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
