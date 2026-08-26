import type { FileRow, Measure } from "../../shared/api.ts";
import { displayFilePath } from "../displayPath.ts";
import { FILE_KIND_DETAILS } from "../fileKinds.ts";
import { count, percent } from "../format.ts";
import { CopyPathButton } from "./CopyPathButton.tsx";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  files: readonly FileRow[];
  /** Highlighted column: the measure every other figure on the page is drawn from. */
  measure: Measure;
  /** Project-relative folder that displayed file names should be relative to. */
  displayRoot: string;
  /** Mark displayed paths as relative while preserving project-relative copy values. */
  prefixRelativePaths: boolean;
  onOpenSource: (path: string) => void;
  emptyMessage: string;
}

/** The shared metrics table, used for a folder's own files and for the ranking. */
export function FileTable({ files, measure, displayRoot, prefixRelativePaths, onOpenSource, emptyMessage }: Props): React.JSX.Element {
  if (files.length === 0) return <p className="empty">{emptyMessage}</p>;
  return (
    <div className="table-scroll">
      <table className="metrics">
        <thead>
          <tr>
            <th scope="col">Flavor</th>
            <th scope="col">File</th>
            <th scope="col" data-active={measure === "tokens"}>Tokens</th>
            <th scope="col" data-active={measure === "lines"}>Lines</th>
            <th scope="col" data-active={measure === "codeLines"}>LOC</th>
            <th scope="col">Comment</th>
            <th scope="col">Fn</th>
            <th scope="col">Branch</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => {
            const commentShare = file.lines > 0 ? file.commentLines / file.lines : 0;
            const displayedPath = displayFilePath(file.path, displayRoot, prefixRelativePaths);
            return (
              <tr key={file.path}>
                <td>
                  <span className="tag" data-flavor={file.generated ? "generated" : file.kind}>
                    {file.generated ? "gen" : FILE_KIND_DETAILS[file.kind].label}
                  </span>
                </td>
                <td className="metrics__path">
                  <span className="metrics__file">
                    <button type="button" className="link" onClick={() => onOpenSource(file.path)} {...tooltipHandlers}>
                      {displayedPath}
                      <Tooltip compact>{file.path}</Tooltip>
                    </button>
                    <CopyPathButton path={file.path} />
                  </span>
                </td>
                <td data-active={measure === "tokens"}>{count(file.tokens)}</td>
                <td data-active={measure === "lines"}>{count(file.lines)}</td>
                <td data-active={measure === "codeLines"}>{count(file.codeLines)}</td>
                <td {...tooltipHandlers}>
                  {count(file.commentLines)}
                  <Tooltip compact>{`${percent(commentShare)} of lines are comment`}</Tooltip>
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
