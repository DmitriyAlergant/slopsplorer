/**
 * Keep a tooltip inside the viewport when its anchor sits near either edge.
 *
 * The tooltip is centred on its anchor by transform, so a chip at the end of a
 * row would otherwise overflow the window. Shared by every control that hangs
 * one, so they all shift by the same rule.
 */
export function positionTooltip(event: React.SyntheticEvent<HTMLElement>): void {
  const tooltip = event.currentTarget.querySelector<HTMLElement>(".tooltip");
  if (tooltip === null) return;

  tooltip.style.setProperty("--tooltip-shift", "0px");
  const bounds = tooltip.getBoundingClientRect();
  const gutter = 12;
  const shift = bounds.left < gutter
    ? gutter - bounds.left
    : Math.min(0, window.innerWidth - gutter - bounds.right);
  tooltip.style.setProperty("--tooltip-shift", `${shift}px`);
}
