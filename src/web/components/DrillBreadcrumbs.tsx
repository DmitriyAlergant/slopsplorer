interface Props {
  rootName: string;
  drillPath: string;
  onDrill: (path: string) => void;
}

/**
 * Navigation back through the folder that currently acts as the workspace root.
 *
 * At the root the row is drawn empty rather than left out. The scan root is
 * already named twice above, so a one-step trail would only repeat it, and a
 * trail that arrived on the first drill would push the workspace down the page
 * at the moment the reader moved into a folder.
 */
export function DrillBreadcrumbs({ rootName, drillPath, onDrill }: Props): React.JSX.Element {
  const segments = drillPath.split("/").filter(Boolean);
  if (segments.length === 0) return <div className="drill-trail" aria-hidden="true" />;
  return (
    <nav className="drill-trail" aria-label="Drill scope">
      <button type="button" onClick={() => onDrill("")}>{rootName}</button>
      {segments.map((segment, index) => {
        const path = segments.slice(0, index + 1).join("/");
        return (
          <span key={path} className="drill-trail__step">
            <span className="drill-trail__separator" aria-hidden="true">/</span>
            {index === segments.length - 1 ? (
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
