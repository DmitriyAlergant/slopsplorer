import type { FileRow } from "../../shared/api.ts";
import { pathRelativeTo } from "../displayPath.ts";
import { count, percent } from "../format.ts";

interface Props {
  files: readonly FileRow[];
  /** Project-relative folder that displayed file names should be relative to. */
  displayRoot: string;
  onOpenSource: (path: string) => void;
  emptyMessage: string;
}

/** The shared metrics table, used for a folder's own files and for the ranking. */
export function FileTable({ files, displayRoot, onOpenSource, emptyMessage }: Props): React.JSX.Element {
  if (files.length === 0) return <p className="empty">{emptyMessage}</p>;
  return (
    <div className="table-scroll">
      <table className="metrics">
        <thead>
          <tr>
            <th scope="col">Flavor</th>
            <th scope="col">File</th>
            <th scope="col">Tokens</th>
            <th scope="col">Lines</th>
            <th scope="col">Code</th>
            <th scope="col">Comment</th>
            <th scope="col">Fn</th>
            <th scope="col">Branch</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => {
            const commentShare = file.lines > 0 ? file.commentLines / file.lines : 0;
            return (
              <tr key={file.path}>
                <td>
                  <span className="tag" data-flavor={file.generated ? "generated" : file.kind}>
                    {file.generated ? "gen" : file.kind}
                  </span>
                </td>
                <td className="metrics__path">
                  <button type="button" className="link" onClick={() => onOpenSource(file.path)}>
                    {pathRelativeTo(file.path, displayRoot)}
                  </button>
                </td>
                <td>{count(file.tokens)}</td>
                <td>{count(file.lines)}</td>
                <td>{count(file.codeLines)}</td>
                <td title={`${percent(commentShare)} of lines are comment`}>
                  {count(file.commentLines)}
                  {commentShare >= 0.4 && file.lines >= 40 ? <i className="dot" aria-hidden="true" /> : null}
                </td>
                <td>{file.language ? count(file.functions) : "-"}</td>
                <td>{file.language ? count(file.branches) : "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
