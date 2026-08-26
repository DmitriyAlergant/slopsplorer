import type { KeyboardEvent, PointerEvent } from "react";

interface Props {
  ratio: number;
  onRatioChange: (ratio: number) => void;
}

const SPLITTER_WIDTH = 8;
const GRID_GAPS = 12;
const MIN_TREE_WIDTH = 260;
const MIN_DETAIL_WIDTH = 360;
const KEYBOARD_STEP = 24;
export const DEFAULT_TREE_PANEL_RATIO = 0.27;

/** Draggable and keyboard-accessible boundary between the two workspace panels. */
export function WorkspaceSplitter({ ratio, onRatioChange }: Props): React.JSX.Element {
  const resizeFromClientX = (element: HTMLElement, clientX: number): void => {
    const workspace = element.parentElement;
    if (!workspace) return;
    const bounds = workspace.getBoundingClientRect();
    const maximum = bounds.width - SPLITTER_WIDTH - GRID_GAPS - MIN_DETAIL_WIDTH;
    const width = Math.max(MIN_TREE_WIDTH, Math.min(maximum, clientX - bounds.left));
    onRatioChange(width / bounds.width);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeFromClientX(event.currentTarget, event.clientX);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    resizeFromClientX(event.currentTarget, event.clientX);
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
      className="workspace__splitter"
      role="separator"
      aria-label="Resize source tree"
      aria-orientation="vertical"
      aria-valuemin={10}
      aria-valuemax={80}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      title="Drag to resize the source tree. Double-click to reset."
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => onRatioChange(DEFAULT_TREE_PANEL_RATIO)}
    >
      <span aria-hidden="true" />
    </div>
  );
}
