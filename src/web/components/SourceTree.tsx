import { useEffect, useRef } from "react";
import type { Measure, TreeRow, TreeSort } from "../../shared/api.ts";
import { count, measureHeading } from "../format.ts";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  rows: readonly TreeRow[];
  sort: TreeSort;
  /** Names the sort control and the numbers column. */
  measure: Measure;
  onSelect: (rowKind: "folder" | "files", path: string) => void;
  onDrill: (path: string) => void;
  onSortChange: (sort: TreeSort) => void;
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

/**
 * Marks the column the tree is ordered by, and which way that order runs.
 *
 * Each column sorts one way only: names ascend, weight descends. A caret that
 * never flips is a statement of fact rather than a control, so it is drawn on
 * the active column alone.
 */
function SortCaret({ ascending }: { ascending: boolean }): React.JSX.Element {
  return (
    <svg className="tree__caret" data-ascending={ascending} viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
      <path d="M1.5 3.5L5 7L8.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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

/** The folder hierarchy, with every row measured against the active scope root. */
export function SourceTree({
  rows, sort, measure, onSelect, onDrill, onSortChange, onToggleExpanded, onToggleFolder, onToggleDirectFiles, onExpandAll, onCollapseAll,
}: Props): React.JSX.Element {
  const expandableRows = rows.filter((row) => row.rowKind === "folder" && row.hasChildren);
  const allExpanded = expandableRows.length > 0 && expandableRows.every((row) => row.expanded);
  return (
    <section className="panel tree" aria-label="Source tree">
      <div className="panel__head">
        <h2>Source tree</h2>
        <div className="panel__tools">
          <button
            type="button"
            className="button button--tiny"
            onClick={allExpanded ? onCollapseAll : onExpandAll}
          >
            {allExpanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      <div className="tree__scroll">
        {/* Aligned to the row grid, so each heading sits over the column it orders. */}
        <div className="tree__columns">
          <span className="tree__disclose tree__disclose--leaf" aria-hidden="true" />
          <span aria-hidden="true" />
          <button
            type="button"
            className="tree__column"
            aria-pressed={sort === "name"}
            aria-label="Sort by name"
            onClick={() => onSortChange("name")}
          >
            Name
            {sort === "name" ? <SortCaret ascending /> : null}
          </button>
          <button
            type="button"
            className="tree__column tree__column--weight"
            aria-pressed={sort === "weight"}
            aria-label={`Sort by ${measureHeading(measure).toLowerCase()}`}
            onClick={() => onSortChange("weight")}
          >
            {sort === "weight" ? <SortCaret ascending={false} /> : null}
            {measureHeading(measure)}
          </button>
        </div>

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
              style={{ "--indent": row.depth, "--mass": Math.min(1, Math.max(0, row.shareOfScope)) } as React.CSSProperties}
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

              {/* Only the `.` row needs explaining. A folder row says what it is. */}
              <button
                type="button"
                className="tree__label"
                onClick={() => onSelect(row.rowKind, row.path)}
                // A `.` row names the same folder, so it drills to the same place.
                onDoubleClick={() => onDrill(row.path)}
                {...(row.rowKind === "files" ? tooltipHandlers : {})}
              >
                {row.name}
                {row.rowKind === "files" ? <Tooltip compact>Files directly in this folder</Tooltip> : null}
              </button>

              <span className="tree__weight">
                {row.included ? (
                  <>
                    <span className="tree__mass" aria-hidden="true" />
                    <span className="tree__count">{count(row.weight)}</span>
                  </>
                ) : null}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
