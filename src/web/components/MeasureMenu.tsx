import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Measure } from "../../shared/api.ts";
import { MEASURES } from "../../shared/api.ts";
import { measureHeading } from "../format.ts";

interface Props {
  measure: Measure;
  /** Whether the tree is currently ordered by this column. */
  sorted: boolean;
  onChange: (measure: Measure) => void;
}

const MEASURE_DESCRIPTIONS: Record<Measure, string> = {
  tokens: "Tokenizer count for the whole file, comments and whitespace included.",
  lines: "Every line with content, comment lines included. Blank lines are excluded.",
  codeLines: "Content lines that are not entirely comment. A line of code with a trailing comment still counts.",
};

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

function MenuChevron(): React.JSX.Element {
  return (
    <svg className="menu-chevron" viewBox="0 0 8 8" width="7" height="7" aria-hidden="true">
      <path d="M0.6 2.4h6.8L4 6.4z" fill="currentColor" />
    </svg>
  );
}

/**
 * The source tree's numeric column heading: it names the unit and picks it.
 *
 * The measure has no control of its own anywhere on the page. It is a property
 * of a column, so it is chosen from the columns that show it - here, and by
 * sorting a file table on one of its measured columns.
 *
 * The panel is fixed-position and placed on open, for the same reason the
 * tooltip is: this heading sits inside a scrolling tree within a panel that
 * hides its overflow, and a laid-out menu would be clipped by both.
 */
export function MeasureMenu({ measure, sorted, onChange }: Props): React.JSX.Element {
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
        aria-haspopup="menu"
        aria-expanded={open}
        data-sorted={sorted}
        aria-label={
          `${sorted ? "Tree ordered by " : ""}${measureHeading(measure).toLowerCase()}. `
          + "Choose the measure and order the tree by it"
        }
        onClick={() => setOpen((previous) => !previous)}
      >
        {/* Ahead of the label, where the sort caret used to sit: the label keeps
            the right edge it shares with the numbers running below it. */}
        <MenuChevron />
        {measureHeading(measure)}
      </button>

      {open ? (
        <div
          ref={menuRef}
          className="menu"
          role="menu"
          aria-label="Primary measure"
          onKeyDown={(event) => {
            if (event.key === "Escape") close(true);
            else if (event.key === "ArrowDown") { event.preventDefault(); moveFocus(1); }
            else if (event.key === "ArrowUp") { event.preventDefault(); moveFocus(-1); }
          }}
        >
          {MEASURES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className="menu__item"
              role="menuitemradio"
              aria-checked={candidate === measure}
              onClick={() => {
                onChange(candidate);
                close(true);
              }}
            >
              <span className="menu__name">
                <span className="menu__check">{candidate === measure ? <CheckMark /> : null}</span>
                {measureHeading(candidate)}
              </span>
              <span className="menu__note">{MEASURE_DESCRIPTIONS[candidate]}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
