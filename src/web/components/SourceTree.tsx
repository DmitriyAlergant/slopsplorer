import { useEffect, useRef } from "react";
import type { TreeRow } from "../../shared/api.ts";
import { count } from "../format.ts";

interface Props {
  rows: readonly TreeRow[];
  totalTokens: number;
  onSelect: (rowKind: "folder" | "files", path: string) => void;
  onToggleExpanded: (path: string) => void;
  onToggleFolder: (row: TreeRow) => void;
  onToggleDirectFiles: (row: TreeRow) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

/** Drawn rather than typed: the Unicode triangles render far too small to hit. */
function Chevron({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg className="chevron" data-open={open} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M6 3.5L10.5 8L6 12.5" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Native checkboxes cannot express "partially selected" from markup alone. */
function ScopeCheckbox({ row, onChange }: { row: TreeRow; onChange: () => void }): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = row.indeterminate;
  }, [row.indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="tree__check"
      checked={row.included}
      disabled={row.disabled}
      onChange={onChange}
      aria-label={`Count ${row.rowKind === "files" ? `files directly in ${row.path || "the root"}` : row.name} toward the totals`}
    />
  );
}

/** The folder hierarchy, with each row's bar showing its share of its parent. */
export function SourceTree(props: Props): React.JSX.Element {
  const { rows, totalTokens, onSelect, onToggleExpanded, onToggleFolder, onToggleDirectFiles } = props;
  return (
    <section className="panel tree" aria-label="Source tree">
      <div className="panel__head">
        <h2>Source tree</h2>
        <div className="panel__tools">
          <span className="muted mono">{count(totalTokens)} tok</span>
          <button type="button" className="button button--tiny" onClick={props.onCollapseAll}>Collapse</button>
          <button type="button" className="button button--tiny" onClick={props.onExpandAll}>Expand</button>
        </div>
      </div>

      <div className="tree__scroll">
        {rows.length === 0 ? (
          <p className="empty">Nothing matches the current filters.</p>
        ) : (
          rows.map((row) => (
            <div
              key={`${row.rowKind}:${row.path}`}
              className="tree__row"
              data-kind={row.rowKind}
              data-selected={row.selected}
              data-muted={!row.included}
              style={{ "--indent": row.depth, "--mass": Math.min(1, Math.max(0, row.shareOfParent)) } as React.CSSProperties}
            >
              {row.rowKind === "folder" && row.hasChildren ? (
                <button
                  type="button"
                  className="tree__disclose"
                  aria-expanded={row.expanded}
                  aria-label={`${row.expanded ? "Collapse" : "Expand"} ${row.name}`}
                  onClick={() => onToggleExpanded(row.path)}
                >
                  <Chevron open={row.expanded} />
                </button>
              ) : (
                <span className="tree__disclose tree__disclose--leaf" aria-hidden="true" />
              )}

              <ScopeCheckbox
                row={row}
                onChange={() => (row.rowKind === "files" ? onToggleDirectFiles(row) : onToggleFolder(row))}
              />

              <button
                type="button"
                className="tree__label"
                onClick={() => onSelect(row.rowKind, row.path)}
                title={row.path || row.name}
              >
                {row.name}
              </button>

              <span className="tree__tokens">
                <span className="tree__mass" aria-hidden="true" />
                <span className="tree__count">{count(row.tokens)}</span>
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
