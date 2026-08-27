/**
 * Placement and visibility for the application's one tooltip.
 *
 * Tooltips are positioned rather than laid out, because every interesting
 * anchor sits inside something that clips: a scrolling tree, a table cell, a
 * panel with hidden overflow. A fixed-position panel escapes all of them, at
 * the cost of needing its coordinates measured on each hover.
 *
 * Visibility is driven from events rather than from `:hover`. A browser does
 * not re-evaluate `:hover` until the pointer next moves, so when a click or an
 * arriving view re-lays out the page, a CSS-driven panel hangs over whatever
 * took its control's place. Only an explicit enter can open one of these.
 */

/** Present on the panel that is currently showing. */
const OPEN = "data-open";

/** Present when the panel had to sit above its control instead of below it. */
const ABOVE = "data-above";

let openPanel: HTMLElement | null = null;

/** Where the pointer stood when the last press happened, if it is still holding tooltips shut. */
let suppressedAt: { x: number; y: number } | null = null;

/** Enough travel to be a deliberate move rather than device jitter. */
const MOVE_THRESHOLD = 3;

function panelOf(anchor: HTMLElement): HTMLElement | null {
  return anchor.querySelector<HTMLElement>(".tooltip");
}

/** Kept clear of every window edge, so a panel is never cut in half by one. */
const GUTTER = 12;

/** The gap between a control and the panel that describes it. */
const OFFSET = 10;

/**
 * Centre the panel under its control and pull it back inside the viewport.
 *
 * The arrow shifts by the same amount in the opposite direction, so it keeps
 * pointing at the control it belongs to.
 *
 * A control near the foot of the window has no room under it, so the panel goes
 * above it instead and the arrow moves to the other edge. The dock of asks sits
 * there, and so does the proportion bar at the end of the page.
 */
function place(anchor: HTMLElement, panel: HTMLElement): void {
  const anchorBounds = anchor.getBoundingClientRect();
  panel.style.setProperty("--tooltip-left", `${anchorBounds.left + anchorBounds.width / 2}px`);
  panel.style.setProperty("--tooltip-top", `${anchorBounds.bottom + OFFSET}px`);
  panel.style.setProperty("--tooltip-shift", "0px");
  panel.removeAttribute(ABOVE);

  const bounds = panel.getBoundingClientRect();
  const shift = bounds.left < GUTTER
    ? GUTTER - bounds.left
    : Math.min(0, window.innerWidth - GUTTER - bounds.right);
  panel.style.setProperty("--tooltip-shift", `${shift}px`);

  if (anchorBounds.bottom + OFFSET + bounds.height > window.innerHeight - GUTTER) {
    panel.style.setProperty("--tooltip-top", `${anchorBounds.top - OFFSET - bounds.height}px`);
    panel.setAttribute(ABOVE, "");
  }
}

function show(anchor: HTMLElement): void {
  const panel = panelOf(anchor);
  if (panel === null || panel === openPanel) return;
  closeTooltip();
  place(anchor, panel);
  panel.setAttribute(OPEN, "");
  openPanel = panel;
}

/** Close whatever is showing. Safe to call when nothing is. */
export function closeTooltip(): void {
  openPanel?.removeAttribute(OPEN);
  openPanel = null;
}

export function openTooltip(event: React.MouseEvent<HTMLElement>): void {
  if (suppressedAt !== null) return;
  show(event.currentTarget);
}

/**
 * Re-open after a press, once the pointer has actually travelled.
 *
 * The events a re-render produces carry the coordinates of the press, which is
 * how they are told apart from someone moving the mouse again.
 */
export function trackTooltip(event: React.MouseEvent<HTMLElement>): void {
  if (suppressedAt !== null) {
    const travelled = Math.abs(event.clientX - suppressedAt.x) > MOVE_THRESHOLD
      || Math.abs(event.clientY - suppressedAt.y) > MOVE_THRESHOLD;
    if (!travelled) return;
    suppressedAt = null;
  }
  show(event.currentTarget);
}

/** A press asks for the control, not for a description of it. */
export function dismissTooltip(event: React.MouseEvent<HTMLElement>): void {
  suppressedAt = { x: event.clientX, y: event.clientY };
  closeTooltip();
}

export function hideTooltip(): void {
  closeTooltip();
}

/** Keyboard focus asks for the description. A press focuses too, so it is excluded. */
export function focusTooltip(event: React.FocusEvent<HTMLElement>): void {
  if (!event.currentTarget.matches(":focus-visible")) return;
  suppressedAt = null;
  show(event.currentTarget);
}
