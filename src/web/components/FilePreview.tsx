import { MEASUREMENT_LABELS } from "../../shared/api.ts";
import type { SourceResponse } from "../../shared/api.ts";
import { count, statusName } from "../format.ts";
import { highlightSource } from "../highlight.ts";
import { DiffView, type PreviewSide } from "./DiffView.tsx";

interface Props {
  /** The loaded file, or null while it is still on the way. */
  source: SourceResponse | null;
  /** Why the file could not be read, or null. */
  failure: string | null;
  /** Hide every line further than the context from a change. */
  changedOnly: boolean;
  /** The change, or the file as one side of the comparison held it. */
  side: PreviewSide;
}

/**
 * One file's body: its change inside a comparison, its text inside a scan.
 *
 * Drawn the same way whether the dialog holds one file or the whole list, so a
 * file cannot read one way on its own and another way among its neighbours.
 */
export function FilePreview({ source, failure, changedOnly, side }: Props): React.JSX.Element {
  if (failure !== null) return <p className="empty">{failure}</p>;
  if (source === null) return <p className="empty">Loading source</p>;
  if (source.mode === "unmeasured") return (
    <div className="viewer__metadata">
      <p>{MEASUREMENT_LABELS[source.reason]}. Line and token counts are not available.</p>
      <dl>
        <dt>Path</dt><dd>{source.path}</dd>
        <dt>Change</dt><dd>{statusName(source.status)}</dd>
        {source.previousPath !== null ? <><dt>Previous path</dt><dd>{source.previousPath}</dd></> : null}
      </dl>
    </div>
  );
  // Only the change has nothing to draw when nothing changed. Either side still
  // holds the file, and reading it whole is what the side views are for.
  const unchanged = side === "diff" && source.mode === "diff"
    && source.lines.every((line) => line.marker === " ");
  return (
    <>
      {source.mode === "diff" && source.previousPath !== null ? <p className="viewer__note">Renamed from {source.previousPath}</p> : null}
      {source.mode === "diff" && source.beforeMode !== null && source.afterMode !== null && source.beforeMode !== source.afterMode
        ? <p className="viewer__note">File mode: {source.beforeMode} → {source.afterMode}</p> : null}
      {unchanged ? <p className="empty">This comparison reports no textual change for the file.</p> : null}
      {source.mode === "diff" && !unchanged ? (
        <DiffView path={source.path} lines={source.lines} changedOnly={changedOnly} side={side} />
      ) : null}
      {source.mode === "source" ? (
        <pre className="viewer__code">
          <code dangerouslySetInnerHTML={{ __html: highlightSource(source.path, source.content) }} />
        </pre>
      ) : null}
      {source.truncated ? (
        <p className="viewer__note">
          Preview truncated at 512 KiB of {count(source.totalBytes)} bytes.
        </p>
      ) : null}
    </>
  );
}
