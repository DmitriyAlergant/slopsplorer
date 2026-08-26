import { useId, useRef } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

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
  const hintId = useId();
  const dragging = useRef(false);

  const resizeFromClientX = (element: HTMLElement, clientX: number): void => {
    const workspace = element.parentElement;
    if (!workspace) return;
    const bounds = workspace.getBoundingClientRect();
    const maximum = bounds.width - SPLITTER_WIDTH - GRID_GAPS - MIN_DETAIL_WIDTH;
    const width = Math.max(MIN_TREE_WIDTH, Math.min(maximum, clientX - bounds.left));
    onRatioChange(width / bounds.width);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const workspace = event.currentTarget.parentElement;
    if (!workspace) return;
    event.preventDefault();
    const bounds = workspace.getBoundingClientRect();
    const currentWidth = ratio * bounds.width;
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    resizeFromClientX(event.currentTarget, bounds.left + currentWidth + direction * KEYBOARD_STEP);
  };

  // Capture is what keeps a drag alive once the pointer leaves the 8px bar,
  // which it does immediately.
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    resizeFromClientX(event.currentTarget, event.clientX);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    resizeFromClientX(event.currentTarget, event.clientX);
  };

  const endDrag = (): void => { dragging.current = false; };

  // A drag holds the pointer, so move events keep arriving here after the press
  // shut the tooltip. Without this the panel reopens and follows the drag.
  const handleMouseMove = (event: MouseEvent<HTMLDivElement>): void => {
    if (dragging.current) return;
    tooltipHandlers.onMouseMove(event);
  };

  return (
    <div
      className="workspace__splitter workspace__splitter--column"
      role="separator"
      aria-label="Resize source tree"
      aria-orientation="vertical"
      aria-valuemin={10}
      aria-valuemax={80}
      aria-valuenow={Math.round(ratio * 100)}
      aria-describedby={hintId}
      tabIndex={0}
      {...tooltipHandlers}
      onMouseMove={handleMouseMove}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => onRatioChange(DEFAULT_TREE_PANEL_RATIO)}
    >
      <span className="splitter__grip" aria-hidden="true" />
      <Tooltip id={hintId}>Drag to resize the source tree. Double-click to reset.</Tooltip>
    </div>
  );
}

interface RowProps {
  height: number;
  onHeightChange: (height: number) => void;
  label: string;
  hint: string;
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
  height, onHeightChange, label, hint, minimum, maximum, defaultHeight,
}: RowProps): React.JSX.Element {
  const hintId = useId();
  const drag = useRef<{ pointerY: number; height: number } | null>(null);

  // Never taller than the window can show: the box scrolls inside itself, and a
  // sticky heading pushed off the top names a column nobody can see.
  const clamp = (value: number): number => {
    const ceiling = Math.max(minimum, Math.min(maximum, window.innerHeight - VIEWPORT_MARGIN));
    return Math.round(Math.max(minimum, Math.min(ceiling, value)));
  };

  // Capture is what keeps a drag alive once the pointer leaves the bar, which
  // it does immediately.
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerY: event.clientY, height };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const started = drag.current;
    if (started === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    onHeightChange(clamp(started.height + event.clientY - started.pointerY));
  };

  const endDrag = (): void => { drag.current = null; };

  // See the column splitter: a captured drag would otherwise reopen the panel.
  const handleMouseMove = (event: MouseEvent<HTMLDivElement>): void => {
    if (drag.current !== null) return;
    tooltipHandlers.onMouseMove(event);
  };

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
      aria-describedby={hintId}
      tabIndex={0}
      {...tooltipHandlers}
      onMouseMove={handleMouseMove}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => onHeightChange(defaultHeight)}
    >
      <span className="splitter__grip" aria-hidden="true" />
      <Tooltip id={hintId}>{hint}</Tooltip>
    </div>
  );
}
