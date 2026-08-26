interface Props {
  rootName: string;
  drillPath: string;
  onDrill: (path: string) => void;
}

/** Navigation back through the folder that currently acts as the workspace root. */
export function DrillBreadcrumbs({ rootName, drillPath, onDrill }: Props): React.JSX.Element | null {
  if (!drillPath) return null;
  const segments = drillPath.split("/").filter(Boolean);
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
