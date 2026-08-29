import type { SourceResponse } from "../../shared/api.ts";
import { count } from "../format.ts";
import { highlightSource } from "../highlight.ts";
import { DiffView } from "./DiffView.tsx";

interface Props {
  /** The loaded file, or null while it is still on the way. */
  source: SourceResponse | null;
  /** Why the file could not be read, or null. */
  failure: string | null;
  /** Hide every line further than the context from a change. */
  changedOnly: boolean;
}

/**
 * One file's body: its change inside a comparison, its text inside a scan.
 *
 * Drawn the same way whether the dialog holds one file or the whole list, so a
 * file cannot read one way on its own and another way among its neighbours.
 */
export function FilePreview({ source, failure, changedOnly }: Props): React.JSX.Element {
  if (failure !== null) return <p className="empty">{failure}</p>;
  if (source === null) return <p className="empty">Loading source</p>;
  const unchanged = source.mode === "diff" && source.lines.every((line) => line.marker === " ");
  return (
    <>
      {unchanged ? <p className="empty">This comparison reports no textual change for the file.</p> : null}
      {source.mode === "diff" && !unchanged ? (
        <DiffView path={source.path} lines={source.lines} changedOnly={changedOnly} />
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
