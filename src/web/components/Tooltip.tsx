import { closeTooltip, dismissTooltip, focusTooltip, openTooltip, trackTooltip } from "../tooltip.ts";

interface Props {
  children: React.ReactNode;
  /** Referenced by the anchor's `aria-describedby`, so assistive tech reads it. */
  id?: string;
  /** A short label such as a path, which should not be padded out to a paragraph. */
  compact?: boolean;
  /** Keep a compact control hint to one line and clip an unusually long value. */
  singleLine?: boolean;
}

/**
 * The only tooltip in the application.
 *
 * The native `title` attribute is deliberately unused: it cannot be styled, it
 * appears after a delay the page does not control, and it never appears for a
 * keyboard user. Render this as a direct child of the control it describes, and
 * spread {@link tooltipHandlers} onto that control.
 */
export function Tooltip({ children, id, compact, singleLine }: Props): React.JSX.Element {
  // Without an id nothing points at this panel, and because it renders inside the
  // control it would otherwise be appended to that control's accessible name: a
  // table cell would read as "12 2.1% of lines are comment". Such a tooltip only
  // repeats what is already on screen, so it is hidden from assistive tech.
  const described = id !== undefined;
  return (
    <span
      className="tooltip"
      data-compact={compact === true}
      data-single-line={singleLine === true}
      id={id}
      role={described ? "tooltip" : undefined}
      aria-hidden={described ? undefined : true}
    >
      {children}
    </span>
  );
}

/** Spread onto the anchor, so no caller has to remember the whole set. */
export const tooltipHandlers = {
  onMouseEnter: openTooltip,
  onMouseMove: trackTooltip,
  onMouseLeave: closeTooltip,
  onMouseDown: dismissTooltip,
  onFocus: focusTooltip,
  onBlur: closeTooltip,
} as const;
