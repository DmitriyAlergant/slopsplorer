import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Aspect, Measure } from "../../shared/api.ts";
import { ASPECTS } from "../../shared/api.ts";
import { aspectDescription, aspectHeading, weightHeading } from "../format.ts";
import { MenuChevron } from "./MenuChevron.tsx";

interface Props {
  measure: Measure;
  aspect: Aspect;
  /** Whether the index is a diff, which is the only thing an aspect can describe. */
  isDiff: boolean;
  /** Whether the tree is currently ordered by this column. */
  sorted: boolean;
  /** Order the tree by this column, which is what a scan's heading does. */
  onSort: () => void;
  onAspectChange: (aspect: Aspect) => void;
}

/** Keeps the panel inside the window however close to an edge the heading sits. */
const GUTTER = 12;

/**
 * Solid, so it never reads as the outlined sort caret beside it.
 *
 * One glyph means "this column orders the list", the other means "this heading
 * opens a menu", and the page uses each for one job only.
 */
function CheckMark(): React.JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <path d="M2 6.3L4.7 9L10 3.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The source tree's numeric column heading: it names what the column holds.
 *
 * A scan has one thing to say there, so the heading only orders the tree by it.
 * A diff has five, and the heading is where the side of the change is chosen,
 * because that is the column those figures are drawn in. The unit is not here:
 * it belongs to every figure on the page, so it is chosen once, above.
 *
 * The panel is fixed-position and placed on open, for the same reason the
 * tooltip is: this heading sits inside a scrolling tree within a panel that
 * hides its overflow, and a laid-out menu would be clipped by both.
 */
export function WeightHeading({ measure, aspect, isDiff, sorted, onSort, onAspectChange }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  // Placed from the heading's own box, then pulled back inside the window.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const button = buttonRef.current;
    if (!open || !menu || !button) return;
    const anchor = button.getBoundingClientRect();
    menu.style.top = `${anchor.bottom + 6}px`;
    menu.style.left = `${anchor.right - menu.offsetWidth}px`;
    const bounds = menu.getBoundingClientRect();
    const shift = bounds.left < GUTTER
      ? GUTTER - bounds.left
      : Math.min(0, window.innerWidth - GUTTER - bounds.right);
    menu.style.left = `${anchor.right - menu.offsetWidth + shift}px`;
    menu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [open]);

  // A fixed panel does not travel with its anchor, so any scroll closes it.
  // The capture phase catches the tree's own scroll box as well as the page.
  useEffect(() => {
    if (!open) return;
    const dismiss = (): void => setOpen(false);
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);

  const moveFocus = (step: number): void => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>(".menu__item") ?? [])];
    const current = items.findIndex((item) => item === document.activeElement);
    const next = items[(current + step + items.length) % items.length];
    next?.focus();
  };

  return (
    <div className="tree__measure">
      <button
        ref={buttonRef}
        type="button"
        className="tree__column tree__column--weight"
        {...(isDiff ? { "aria-haspopup": "menu" as const, "aria-expanded": open } : {})}
        data-sorted={sorted}
        aria-label={
          `${sorted ? "Tree ordered by " : ""}${weightHeading(measure, aspect, isDiff).toLowerCase()}. `
          + (isDiff ? "Choose the side of the change and order the tree by it" : "Order the tree by it")
        }
        onClick={() => (isDiff ? setOpen((previous) => !previous) : onSort())}
      >
        {/* Ahead of the label, where the sort caret used to sit: the label keeps
            the right edge it shares with the numbers running below it. */}
        {isDiff ? <MenuChevron /> : null}
        {weightHeading(measure, aspect, isDiff)}
      </button>

      {open ? (
        <div
          ref={menuRef}
          className="menu"
          role="menu"
          aria-label="Side of the change"
          onKeyDown={(event) => {
            if (event.key === "Escape") close(true);
            else if (event.key === "ArrowDown") { event.preventDefault(); moveFocus(1); }
            else if (event.key === "ArrowUp") { event.preventDefault(); moveFocus(-1); }
          }}
        >
          {ASPECTS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className="menu__item"
              role="menuitemradio"
              aria-checked={candidate === aspect}
              onClick={() => {
                onAspectChange(candidate);
                close(true);
              }}
            >
              <span className="menu__name">
                <span className="menu__check">{candidate === aspect ? <CheckMark /> : null}</span>
                {aspectHeading(candidate)}
              </span>
              <span className="menu__note">{aspectDescription(candidate)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
