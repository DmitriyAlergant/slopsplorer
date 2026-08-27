import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComparisonRequest, DiffMeta, GitRef, RepositoryRefs } from "../../shared/api.ts";
import { fetchRefs } from "../api.ts";
import { comparisonLabel } from "../format.ts";
import { MenuChevron } from "./MenuChevron.tsx";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  diff: DiffMeta;
  /** A measurement is running, so a new one cannot start. */
  disabled: boolean;
  onCompare: (comparison: ComparisonRequest) => void;
}

/** Keeps the panel inside the window however close to an edge the trigger sits. */
const GUTTER = 12;

/**
 * The after side of a comparison.
 *
 * The working tree and the index are places rather than revisions, and only
 * this side can be one of them.
 */
type Target =
  | { kind: "worktree" }
  | { kind: "index" }
  | { kind: "revision"; name: string };

const WORKING_TREE: Target = { kind: "worktree" };
const INDEX: Target = { kind: "index" };

/** How the two lists group what the repository holds. */
const REF_SECTIONS: readonly { title: string; kind: GitRef["kind"] }[] = [
  { title: "Branches", kind: "branch" },
  { title: "Remote branches", kind: "remote" },
  { title: "Tags", kind: "tag" },
];

interface Selection {
  base: string;
  target: Target;
  /** `A...B` rather than `A..B`: compare B to where it left A. */
  fromMergeBase: boolean;
}

/** Open the picker on the comparison the page is drawing. */
function selectionOf(request: ComparisonRequest): Selection {
  switch (request.kind) {
    case "workingTree": return { base: "HEAD", target: WORKING_TREE, fromMergeBase: false };
    case "staged": return { base: "HEAD", target: INDEX, fromMergeBase: false };
    case "revisionToWorkingTree": return { base: request.rev, target: WORKING_TREE, fromMergeBase: false };
    case "revisionPair":
      return { base: request.base, target: { kind: "revision", name: request.target }, fromMergeBase: false };
    case "mergeBase":
      return { base: request.base, target: { kind: "revision", name: request.target }, fromMergeBase: true };
  }
}

/**
 * The comparison a selection asks for.
 *
 * The index has one meaning only, so choosing it settles the base side too.
 */
function requestOf({ base, target, fromMergeBase }: Selection): ComparisonRequest {
  switch (target.kind) {
    case "index": return { kind: "staged" };
    case "worktree":
      return base === "HEAD" ? { kind: "workingTree" } : { kind: "revisionToWorkingTree", rev: base };
    case "revision":
      return fromMergeBase
        ? { kind: "mergeBase", base, target: target.name }
        : { kind: "revisionPair", base, target: target.name };
  }
}

function targetKey(target: Target): string {
  return target.kind === "revision" ? `revision:${target.name}` : target.kind;
}

interface Option {
  key: string;
  name: string;
  note: string;
  selected: boolean;
  onSelect: () => void;
}

interface Section {
  title: string;
  options: Option[];
}

/** One side of the comparison: a filter box over everything it can be. */
function SideList({ label, sections, disabled, note }: {
  label: string;
  sections: Section[];
  disabled: boolean;
  /** Replaces the list when the other side has already settled this one. */
  note: string | null;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matching = sections
    .map((section) => ({
      title: section.title,
      options: needle === "" ? section.options : section.options.filter(
        (option) => option.name.toLowerCase().includes(needle),
      ),
    }))
    .filter((section) => section.options.length > 0);

  return (
    <div className="picker__side" aria-disabled={disabled}>
      <p className="picker__side-title">{label}</p>
      {note === null ? (
        <>
          <input
            className="picker__search"
            type="search"
            value={query}
            placeholder="Filter"
            aria-label={`Filter ${label.toLowerCase()}`}
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <div className="picker__list" role="listbox" aria-label={label}>
            {matching.length === 0 ? <p className="picker__empty">Nothing matches.</p> : null}
            {matching.map((section) => (
              <div key={section.title} className="picker__group">
                <p className="picker__group-title">{section.title}</p>
                {section.options.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className="picker__option"
                    role="option"
                    aria-selected={option.selected}
                    onClick={option.onSelect}
                  >
                    <span className="picker__option-name">{option.name}</span>
                    <span className="picker__option-note">{option.note}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="picker__note">{note}</p>
      )}
    </div>
  );
}

/**
 * What the page compares, chosen from what the repository holds.
 *
 * The two sides and one switch cover every comparison the command line can
 * name, so the page needs no argument grammar of its own: it sends the same
 * `ComparisonRequest` that argument text parses into.
 */
export function ComparisonPicker({ diff, disabled, onCompare }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [refs, setRefs] = useState<RepositoryRefs | null>(null);
  const [refsError, setRefsError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(() => selectionOf(diff.request));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // The panel always opens on what the page is drawing, whatever was left
  // half-chosen the last time it was dismissed.
  useEffect(() => {
    if (open) setSelection(selectionOf(diff.request));
  }, [open, diff.request]);

  // Read once, and only when the panel is first needed: a scan never asks.
  useEffect(() => {
    if (!open || refs !== null) return;
    fetchRefs().then(setRefs, (cause: unknown) => {
      setRefsError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [open, refs]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!open || !panel || !trigger) return;
    const anchor = trigger.getBoundingClientRect();
    panel.style.top = `${anchor.bottom + 8}px`;
    panel.style.left = `${anchor.left}px`;
    const bounds = panel.getBoundingClientRect();
    const overflow = bounds.right - (window.innerWidth - GUTTER);
    if (overflow > 0) panel.style.left = `${Math.max(GUTTER, anchor.left - overflow)}px`;
  }, [open]);

  // A fixed panel does not travel with its anchor, so any scroll closes it.
  useEffect(() => {
    if (!open) return;
    const dismiss = (): void => setOpen(false);
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
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

  const headNote = refs === null
    ? "the commit checked out"
    : refs.headBranch === null ? `detached at ${refs.headSha}` : `${refs.headBranch}, ${refs.headSha}`;

  const refSections = useMemo(() => REF_SECTIONS.map((section) => ({
    title: section.title,
    entries: (refs?.refs ?? []).filter((ref) => ref.kind === section.kind),
  })), [refs]);

  const baseSections: Section[] = [
    {
      title: "Commit",
      options: [{
        key: "HEAD",
        name: "HEAD",
        note: headNote,
        selected: selection.base === "HEAD",
        onSelect: () => setSelection((previous) => ({ ...previous, base: "HEAD" })),
      }],
    },
    ...refSections.map((section) => ({
      title: section.title,
      options: section.entries.map((ref) => ({
        key: `base:${ref.kind}:${ref.name}`,
        name: ref.name,
        note: ref.shortSha,
        selected: selection.base === ref.name,
        onSelect: () => setSelection((previous) => ({ ...previous, base: ref.name })),
      })),
    })),
  ];

  const chooseTarget = (target: Target): void => setSelection((previous) => ({ ...previous, target }));
  const targetSections: Section[] = [
    {
      title: "Uncommitted",
      options: [
        {
          key: "worktree",
          name: "Working tree",
          note: "untracked included",
          selected: selection.target.kind === "worktree",
          onSelect: () => chooseTarget(WORKING_TREE),
        },
        {
          key: "index",
          name: "Index",
          note: "what is staged",
          selected: selection.target.kind === "index",
          onSelect: () => chooseTarget(INDEX),
        },
      ],
    },
    {
      title: "Commit",
      options: [{
        key: "HEAD",
        name: "HEAD",
        note: headNote,
        selected: targetKey(selection.target) === "revision:HEAD",
        onSelect: () => chooseTarget({ kind: "revision", name: "HEAD" }),
      }],
    },
    ...refSections.map((section) => ({
      title: section.title,
      options: section.entries.map((ref) => ({
        key: `target:${ref.kind}:${ref.name}`,
        name: ref.name,
        note: ref.shortSha,
        selected: targetKey(selection.target) === `revision:${ref.name}`,
        onSelect: () => chooseTarget({ kind: "revision", name: ref.name }),
      })),
    })),
  ];

  const comparesRevisions = selection.target.kind === "revision";

  return (
    <div className="picker">
      <button
        ref={triggerRef}
        type="button"
        className="picker__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((previous) => !previous)}
        {...tooltipHandlers}
      >
        <span className="picker__rev">{diff.base}</span>
        <span className="picker__arrow" aria-hidden="true">-&gt;</span>
        <span className="picker__rev">{diff.target}</span>
        <MenuChevron />
        <Tooltip compact>
          {`${diff.filesAdded} added, ${diff.filesModified} modified, `
            + `${diff.filesDeleted} deleted, ${diff.filesRenamed} renamed`
            + ` - click to compare something else`}
        </Tooltip>
      </button>

      {open ? (
        <div
          ref={panelRef}
          className="picker__panel"
          role="dialog"
          aria-label="What to compare"
          onKeyDown={(event) => {
            if (event.key === "Escape") close(true);
          }}
        >
          <div className="picker__sides">
            <SideList
              label="From"
              sections={baseSections}
              disabled={selection.target.kind === "index"}
              note={selection.target.kind === "index" ? "The index is always compared against HEAD." : null}
            />
            <SideList label="To" sections={targetSections} disabled={false} note={null} />
          </div>

          {/* Only two revisions have a merge base, so the switch is offered
              only when both sides are ones. */}
          <label className="picker__merge" aria-disabled={!comparesRevisions}>
            <input
              type="checkbox"
              checked={selection.fromMergeBase && comparesRevisions}
              disabled={!comparesRevisions}
              onChange={(event) => setSelection((previous) => ({ ...previous, fromMergeBase: event.target.checked }))}
            />
            Start from the merge base, as a pull request does
          </label>

          {refsError === null ? null : <p className="picker__error">{refsError}</p>}

          <div className="picker__foot">
            <p className="picker__preview">{comparisonLabel(requestOf(selection))}</p>
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                close(false);
                onCompare(requestOf(selection));
              }}
            >
              Compare
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
