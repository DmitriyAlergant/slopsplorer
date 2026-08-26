import type { FileKind, ViewRequest } from "../../shared/api.ts";

interface Props {
  request: ViewRequest;
  onToggleKind: (kind: FileKind) => void;
  onToggleGenerated: () => void;
  onQueryChange: (query: string) => void;
}

const KIND_LABELS: ReadonlyArray<{ kind: FileKind; label: string }> = [
  { kind: "code", label: "Code" },
  { kind: "test", label: "Tests" },
  { kind: "text", label: "Docs" },
  { kind: "i18n", label: "i18n" },
  { kind: "data", label: "Data" },
  { kind: "other", label: "Config" },
];

/** Search plus the visibility switches that decide what counts toward the totals. */
export function FilterBar({ request, onToggleKind, onToggleGenerated, onQueryChange }: Props): React.JSX.Element {
  return (
    <section className="filters" aria-label="Scope filters">
      <label className="search">
        <span className="visually-hidden">Search folders and files</span>
        <input
          type="search"
          value={request.query}
          placeholder="Filter by path"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>

      <div className="chips" role="group" aria-label="File kinds counted">
        {KIND_LABELS.map(({ kind, label }) => (
          <label key={kind} className="chip" data-flavor={kind} data-on={request.kinds.includes(kind)}>
            <input
              type="checkbox"
              checked={request.kinds.includes(kind)}
              onChange={() => onToggleKind(kind)}
            />
            {label}
          </label>
        ))}
        <label className="chip" data-flavor="generated" data-on={request.showGenerated}>
          <input type="checkbox" checked={request.showGenerated} onChange={onToggleGenerated} />
          Generated
        </label>
      </div>
    </section>
  );
}
