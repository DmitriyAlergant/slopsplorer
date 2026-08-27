/** Marks a control that opens a panel, as distinct from the outlined sort caret. */
export function MenuChevron(): React.JSX.Element {
  return (
    <svg className="menu-chevron" viewBox="0 0 8 8" width="7" height="7" aria-hidden="true">
      <path d="M0.6 2.4h6.8L4 6.4z" fill="currentColor" />
    </svg>
  );
}
