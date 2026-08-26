import type { KeyboardEvent, PointerEvent } from "react";
import { DEFAULT_WORKSPACE_HEIGHT, MAX_WORKSPACE_HEIGHT, MIN_WORKSPACE_HEIGHT } from "../preferences.ts";

const SPLITTER_WIDTH = 8;
const GRID_GAPS = 12;
const MIN_TREE_WIDTH = 260;
const MIN_DETAIL_WIDTH = 360;
const KEYBOARD_STEP = 24;
export const DEFAULT_TREE_PANEL_RATIO = 0.27;

/** Air left below the panels, so a dragged workspace never fills the window edge to edge. */
const VIEWPORT_MARGIN = 140;

/**
 * Pointer capture, shared by both boundaries.
 *
 * Capture is what keeps a drag alive once the pointer leaves the 8px bar,
 * which it does immediately. Each boundary supplies its own geometry.
 */
function dragHandlers(resize: (element: HTMLElement, event: PointerEvent<HTMLDivElement>) => void) {
  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>): void => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      resize(event.currentTarget, event);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>): void => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      resize(event.currentTarget, event);
    },
  };
}

interface ColumnProps {
  ratio: number;
  onRatioChange: (ratio: number) => void;
}

/** Draggable and keyboard-accessible boundary between the two workspace panels. */
export function WorkspaceSplitter({ ratio, onRatioChange }: ColumnProps): React.JSX.Element {
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
      title="Drag to resize the source tree. Double-click to reset."
      {...dragHandlers((element, event) => resizeFromClientX(element, event.clientX))}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => onRatioChange(DEFAULT_TREE_PANEL_RATIO)}
    >
      <span aria-hidden="true" />
    </div>
  );
}

interface RowProps {
  height: number;
  onHeightChange: (height: number) => void;
}

/**
 * Draggable and keyboard-accessible bottom edge of the workspace.
 *
 * Both panels stand the same height, so one boundary resizes the pair. It sits
 * outside the workspace grid rather than inside it, because it bounds the two
 * panels together rather than dividing them.
 */
export function WorkspaceHeightSplitter({ height, onHeightChange }: RowProps): React.JSX.Element {
  const resizeFromClientY = (element: HTMLElement, clientY: number): void => {
    const workspace = element.previousElementSibling;
    if (!workspace) return;
    const top = workspace.getBoundingClientRect().top;
    // Never taller than the window can show: the panels scroll inside
    // themselves, so height beyond the viewport buys nothing but scrolling.
    const maximum = Math.max(MIN_WORKSPACE_HEIGHT, window.innerHeight - VIEWPORT_MARGIN);
    onHeightChange(Math.max(MIN_WORKSPACE_HEIGHT, Math.min(maximum, clientY - top)));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const workspace = event.currentTarget.previousElementSibling;
    if (!workspace) return;
    event.preventDefault();
    const direction = event.key === "ArrowUp" ? -1 : 1;
    const top = workspace.getBoundingClientRect().top;
    resizeFromClientY(event.currentTarget, top + height + direction * KEYBOARD_STEP);
  };

  return (
    <div
      className="workspace__splitter workspace__splitter--row"
      role="separator"
      aria-label="Resize workspace height"
      aria-orientation="horizontal"
      aria-valuemin={MIN_WORKSPACE_HEIGHT}
      aria-valuemax={MAX_WORKSPACE_HEIGHT}
      aria-valuenow={Math.round(height)}
      tabIndex={0}
      title="Drag to resize both panels. Double-click to reset."
      {...dragHandlers((element, event) => resizeFromClientY(element, event.clientY))}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => onHeightChange(DEFAULT_WORKSPACE_HEIGHT)}
    >
      <span aria-hidden="true" />
    </div>
  );
}
