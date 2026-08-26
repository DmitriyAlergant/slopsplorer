interface Props {
  ascending?: boolean;
  /** Draw the space without the mark, so an unsorted heading holds its width. */
  placeholder?: boolean;
}

/**
 * Marks the column a list is ordered by, and which way that order runs.
 *
 * Each column sorts one way only: names ascend, every measured column
 * descends. A caret that never flips is a statement of fact rather than a
 * control, so it is drawn on the active column alone.
 */
export function SortCaret({ ascending = false, placeholder = false }: Props): React.JSX.Element {
  return (
    <svg
      className="sort-caret"
      data-ascending={ascending}
      data-placeholder={placeholder}
      viewBox="0 0 10 10"
      width="9"
      height="9"
      aria-hidden="true"
    >
      <path d="M1.5 3.5L5 7L8.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
