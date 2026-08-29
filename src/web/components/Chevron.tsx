/** Drawn rather than typed: the Unicode triangles render far too small to hit. */
export function Chevron({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg className="chevron" data-open={open} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M6 3.5L10.5 8L6 12.5" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
