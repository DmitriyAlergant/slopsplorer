interface Props {
  rootName: string;
  /** The folder the tree is rooted in. Never empty: at the scan root the panel draws its own heading. */
  drillPath: string;
  onDrill: (path: string) => void;
}

/** Steps drawn whole at the end of the trail. Anything before them is elided. */
const STEPS_KEPT = 2;

/**
 * The way back up out of a drill, drawn as the heading of the source tree.
 *
 * The panel is narrow and a path is not, so a deep trail keeps the scan root and
 * the last steps only. The reader needs the folder the tree is in and a way back
 * out of it, and the elided steps are one click up the trail.
 */
export function DrillBreadcrumbs({ rootName, drillPath, onDrill }: Props): React.JSX.Element {
  const segments = drillPath.split("/").filter(Boolean);
  const first = Math.max(segments.length - STEPS_KEPT, 0);
  const kept = segments.slice(first);
  return (
    <nav className="drill-trail" aria-label="Drill scope">
      <button type="button" onClick={() => onDrill("")}>{rootName}</button>
      {first > 0 ? (
        <span className="drill-trail__step">
          <span className="drill-trail__separator" aria-hidden="true">/</span>
          <button type="button" onClick={() => onDrill(segments.slice(0, first).join("/"))}>...</button>
        </span>
      ) : null}
      {kept.map((segment, index) => {
        const path = segments.slice(0, first + index + 1).join("/");
        return (
          <span key={path} className="drill-trail__step">
            <span className="drill-trail__separator" aria-hidden="true">/</span>
            {first + index === segments.length - 1 ? (
              <span aria-current="page">{segment}</span>
            ) : (
              <button type="button" onClick={() => onDrill(path)}>{segment}</button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
