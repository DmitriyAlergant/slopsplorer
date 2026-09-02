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
 *
 * A panel waits for the pointer to rest, and it stays for a moment after the
 * pointer leaves. A page this dense would otherwise flash panels at a pointer
 * crossing it, and a reader who overshoots a control by a few pixels would lose
 * what they were reading. While one panel is up the next opens at once, because
 * the wait has already been served.
 */

/** Present on the panel that is currently showing. */
const OPEN = "data-open";

/** Present when the panel had to sit above its control instead of below it. */
const ABOVE = "data-above";

/** How long the pointer rests on a control before its panel appears. */
const OPEN_DELAY = 500;

/** How long a panel stays after the pointer leaves. Short, and enough to cross a gap. */
const CLOSE_DELAY = 250;

let openPanel: HTMLElement | null = null;

/** The control a pending open belongs to, so a move inside it does not restart the wait. */
let waitingAnchor: HTMLElement | null = null;

/** The one pending act. An open and a close can never both be waiting. */
let timer: number | null = null;

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
 *
 * Only the panel's size is measured, never where it currently stands: the panel
 * moves under a transition, so a rect read during one carries the placement it
 * is leaving rather than the one it is given here. The edges are computed from
 * the anchor and that size, and rounded, so the border and the hairlines inside
 * the panel land on whole device pixels instead of straddling two.
 */
function place(anchor: HTMLElement, panel: HTMLElement): void {
  const anchorBounds = anchor.getBoundingClientRect();
  const panelBounds = panel.getBoundingClientRect();
  // The centre is rounded before the edge is taken from it, so the shift the
  // panel is given lands it on exactly the pixel this measured, gutter included.
  const centre = Math.round(anchorBounds.left + anchorBounds.width / 2);
  const centredLeft = centre - panelBounds.width / 2;
  const rightmostLeft = Math.max(GUTTER, Math.floor(window.innerWidth - GUTTER - panelBounds.width));
  const placedLeft = Math.round(Math.min(Math.max(centredLeft, GUTTER), rightmostLeft));
  const above = anchorBounds.bottom + OFFSET + panelBounds.height > window.innerHeight - GUTTER;

  panel.style.setProperty("--tooltip-left", `${centre}px`);
  panel.style.setProperty("--tooltip-shift", `${placedLeft - centredLeft}px`);
  panel.style.setProperty(
    "--tooltip-top",
    `${Math.round(above ? anchorBounds.top - OFFSET - panelBounds.height : anchorBounds.bottom + OFFSET)}px`,
  );
  panel.toggleAttribute(ABOVE, above);
}

function cancelPending(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  waitingAnchor = null;
}

function show(anchor: HTMLElement): void {
  const panel = panelOf(anchor);
  if (panel === null || panel === openPanel) return;
  closeTooltip();
  place(anchor, panel);
  panel.setAttribute(OPEN, "");
  openPanel = panel;
}

/** Ask for a panel: at once while one is already up, and after the wait otherwise. */
function requestTooltip(anchor: HTMLElement): void {
  if (waitingAnchor === anchor) return;
  cancelPending();
  if (openPanel !== null) {
    show(anchor);
    return;
  }
  waitingAnchor = anchor;
  timer = window.setTimeout(() => {
    cancelPending();
    show(anchor);
  }, OPEN_DELAY);
}

/** Close whatever is showing, and drop whatever is waiting. Safe to call when nothing is. */
export function closeTooltip(): void {
  cancelPending();
  openPanel?.removeAttribute(OPEN);
  openPanel = null;
}

/**
 * The pointer left the control, so the panel goes after a moment.
 *
 * A reader who overshoots a control, or who crosses the gap to the next one,
 * keeps what they were reading.
 */
export function leaveTooltip(): void {
  cancelPending();
  const leaving = openPanel;
  if (leaving === null) return;
  timer = window.setTimeout(() => {
    timer = null;
    if (openPanel === leaving) closeTooltip();
  }, CLOSE_DELAY);
}

export function openTooltip(event: React.MouseEvent<HTMLElement>): void {
  if (suppressedAt !== null) return;
  requestTooltip(event.currentTarget);
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
  requestTooltip(event.currentTarget);
}

/** A press asks for the control, not for a description of it. */
export function dismissTooltip(event: React.MouseEvent<HTMLElement>): void {
  suppressedAt = { x: event.clientX, y: event.clientY };
  closeTooltip();
}

/**
 * Keyboard focus asks for the description, and it asks deliberately, so there is
 * no wait. A press focuses too, so it is excluded.
 */
export function focusTooltip(event: React.FocusEvent<HTMLElement>): void {
  if (!event.currentTarget.matches(":focus-visible")) return;
  suppressedAt = null;
  cancelPending();
  show(event.currentTarget);
}
