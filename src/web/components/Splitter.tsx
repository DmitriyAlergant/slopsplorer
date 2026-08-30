import { useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

const SPLITTER_WIDTH = 8;
const GRID_GAPS = 12;
const MIN_TREE_WIDTH = 260;
const MIN_DETAIL_WIDTH = 360;
const KEYBOARD_STEP = 24;
export const DEFAULT_TREE_PANEL_RATIO = 0.27;

/** Air left below a dragged box, so it never fills the window edge to edge. */
const VIEWPORT_MARGIN = 140;

interface ColumnProps {
  ratio: number;
  onRatioChange: (ratio: number) => void;
}

/** Draggable and keyboard-accessible boundary between the two workspace panels. */
export function WorkspaceSplitter({ ratio, onRatioChange }: ColumnProps): React.JSX.Element {
  const drag = useRef<{ pointerX: number; width: number } | null>(null);

  /** The tree's drawn width, which is the clamped ratio rather than the stored one. */
  const treeWidth = (element: HTMLElement): number => (
    element.previousElementSibling!.getBoundingClientRect().width
  );

  const resizeTo = (element: HTMLElement, width: number): void => {
    const workspace = element.parentElement;
    if (!workspace) return;
    const bounds = workspace.getBoundingClientRect();
    const maximum = bounds.width - SPLITTER_WIDTH - GRID_GAPS - MIN_DETAIL_WIDTH;
    onRatioChange(Math.max(MIN_TREE_WIDTH, Math.min(maximum, width)) / bounds.width);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    resizeTo(event.currentTarget, treeWidth(event.currentTarget) + direction * KEYBOARD_STEP);
  };

  // Capture is what keeps a drag alive once the pointer leaves the 8px bar,
  // which it does immediately.
  //
  // A drag is measured as pointer travel from where it started, as the row
  // splitter's is. Reading the pointer as the new edge instead would teleport
  // the bar by the width of the grid gap on the press, which moves the page
  // under a click that was not a drag and takes the bar out from under a second
  // click that was a double-click.
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerX: event.clientX, width: treeWidth(event.currentTarget) };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const started = drag.current;
    if (started === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    resizeTo(event.currentTarget, started.width + event.clientX - started.pointerX);
  };

  const endDrag = (): void => { drag.current = null; };

  return (
    <div
      className="workspace__splitter workspace__splitter--column"
      role="separator"
      aria-label="Resize source tree"
      aria-orientation="vertical"
      aria-valuemin={10}
      aria-valuemax={80}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => onRatioChange(DEFAULT_TREE_PANEL_RATIO)}
    >
      <span className="splitter__grip" aria-hidden="true" />
    </div>
  );
}

interface RowProps {
  height: number;
  onHeightChange: (height: number) => void;
  label: string;
  minimum: number;
  maximum: number;
  defaultHeight: number;
}

/**
 * Draggable and keyboard-accessible bottom edge of the box before it.
 *
 * The workspace uses it below both panels at once, since they stand the same
 * height, and the ranking uses it below its file list.
 *
 * A drag is measured as pointer travel from where it started, never from the
 * box's own top. Shrinking a box shortens the page, which can pull the box
 * downwards under a pointer that has not moved, and a measure taken from the
 * box would then chase itself all the way to the minimum.
 */
export function HeightSplitter({
  height, onHeightChange, label, minimum, maximum, defaultHeight,
}: RowProps): React.JSX.Element {
  const drag = useRef<{ pointerY: number; height: number } | null>(null);

  // Never taller than the window can show: the box scrolls inside itself, and a
  // sticky heading pushed off the top names a column nobody can see.
  const clamp = (value: number): number => {
    const ceiling = Math.max(minimum, Math.min(maximum, window.innerHeight - VIEWPORT_MARGIN));
    return Math.round(Math.max(minimum, Math.min(ceiling, value)));
  };

  // Capture is what keeps a drag alive once the pointer leaves the bar, which
  // it does immediately. See the column splitter for why the press stands.
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerY: event.clientY, height };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const started = drag.current;
    if (started === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    onHeightChange(clamp(started.height + event.clientY - started.pointerY));
  };

  const endDrag = (): void => { drag.current = null; };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const direction = event.key === "ArrowUp" ? -1 : 1;
    onHeightChange(clamp(height + direction * KEYBOARD_STEP));
  };

  return (
    <div
      className="workspace__splitter workspace__splitter--row"
      role="separator"
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={Math.round(height)}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => onHeightChange(defaultHeight)}
    >
      <span className="splitter__grip" aria-hidden="true" />
    </div>
  );
}
