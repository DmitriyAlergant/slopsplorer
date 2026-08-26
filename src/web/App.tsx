import { useCallback, useEffect, useRef, useState } from "react";
import type { FileKind, TreeRow, ViewRequest, ViewResponse } from "../shared/api.ts";
import { fetchView, openRoot, rescan } from "./api.ts";
import { readPreferences, writePreferences } from "./preferences.ts";
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

/** Long enough to coalesce a burst of typing, short enough to feel immediate. */
const REQUEST_DEBOUNCE_MS = 80;

function requestFromLocation(): ViewRequest {
  try {
    return readRequest(window.location.search, readPreferences(window.localStorage));
  } catch {
    return readRequest(window.location.search);
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
  }, [request.kinds, request.showGenerated, request.treeSort]);

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

      <MassRibbon
        summary={view?.summary ?? null}
        selectedPath={request.selected.rowKind === "folder" ? request.selected.path : null}
        onSelect={(path) => select("folder", path)}
      />

      <DrillBreadcrumbs
        rootName={view?.meta.rootName ?? "Project"}
        drillPath={request.drillPath}
        onDrill={drill}
      />

      {error ? <p className="error-banner" role="status">{error}</p> : null}

      <div className="workspace">
        <SourceTree
          rows={view?.tree ?? []}
          sort={request.treeSort}
          onSelect={select}
          onDrill={drill}
          onSortChange={(treeSort) => patch({ treeSort })}
          onToggleExpanded={toggleExpanded}
          onToggleFolder={toggleFolder}
          onToggleDirectFiles={toggleDirectFiles}
          onExpandAll={() => patch({ expanded: view?.expandableFolderPaths ?? [""] })}
          onCollapseAll={() => patch({ expanded: [""] })}
        />
        <FolderDetail
          detail={view?.detail ?? null}
          filePathRoot={request.selected.path}
          onSelectFolder={(path) => select("folder", path)}
          canDrill={request.selected.rowKind === "folder" && request.selected.path !== request.drillPath}
          onDrill={() => drill(request.selected.path)}
          onOpenSource={setSourcePath}
          onCapacityChange={setCardColumns}
        />
      </div>

      <LargestFiles
        files={view?.ranked ?? []}
        total={view?.rankedTotal ?? 0}
        scope={view?.rankScope ?? ""}
        displayRoot={request.drillPath}
        rank={request.rank}
        onRankChange={setRank}
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
              <p className="progress-modal__path" title={openingRoot}>{openingRoot}</p>
              <p className="progress-modal__hint">Scanning and measuring the source tree. Large folders can take a moment.</p>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
