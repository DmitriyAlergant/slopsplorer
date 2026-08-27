import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComparisonRequest, DiffMeta, GitRef, RepositoryRefs } from "../../shared/api.ts";
import { fetchRefs } from "../api.ts";
import { shortRevision } from "../format.ts";
import { MenuChevron } from "./MenuChevron.tsx";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  diff: DiffMeta;
  /** A measurement is running, so a new one cannot start. */
  disabled: boolean;
  onCompare: (comparison: ComparisonRequest) => void;
}

/** Keeps a panel inside the window however close to an edge its chip sits. */
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

/** Which end of the comparison a chip and its panel own. */
type Side = "base" | "target";

const SIDE_TITLES: Readonly<Record<Side, string>> = { base: "From", target: "To" };

/** How the lists group what the repository holds. */
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

/** The comparison the page is drawing, as the two chips hold it. */
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

/** What a target is called, whole. */
function targetName(target: Target): string {
  switch (target.kind) {
    case "worktree": return "working tree";
    case "index": return "index";
    case "revision": return target.name;
  }
}

/** The comparison the chips already draw asks for no measurement of its own. */
function sameSelection(one: Selection, other: Selection): boolean {
  return one.base === other.base
    && targetKey(one.target) === targetKey(other.target)
    && one.fromMergeBase === other.fromMergeBase;
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

/** A revision name never holds a space, so anything with one is a filter and nothing more. */
function isTypedRevision(needle: string): boolean {
  return needle !== "" && !/\s/.test(needle);
}

/**
 * One side's list: a filter box over everything that side can be.
 *
 * What is typed is also a revision. A commit reachable by name but held by no
 * ref, and any commit at all in a repository past `MAX_REFS`, is only reachable
 * this way, and the command line already accepts one.
 */
function RefPanel({ side, sections, error, onTypedRevision, mergeBase }: {
  side: Side;
  sections: Section[];
  error: string | null;
  onTypedRevision: (rev: string) => void;
  /** Offered on the From side only: `A...B` changes what "from" means. */
  mergeBase: { checked: boolean; available: boolean; onChange: (checked: boolean) => void } | null;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const needle = query.trim();
  const lowered = needle.toLowerCase();

  useEffect(() => { search.current?.focus(); }, []);

  const matching = sections
    .map((section) => ({
      title: section.title,
      options: lowered === "" ? section.options : section.options.filter(
        (option) => option.name.toLowerCase().includes(lowered),
      ),
    }))
    .filter((section) => section.options.length > 0);

  const named = matching.some((section) => section.options.some((option) => option.name === needle));
  const typed: Section[] = isTypedRevision(needle) && !named
    ? [{
      title: "Revision",
      options: [{
        key: "typed",
        name: needle,
        note: "as typed",
        selected: false,
        onSelect: () => onTypedRevision(needle),
      }],
    }]
    : [];
  const groups = [...typed, ...matching];

  return (
    <>
      <p className="picker__panel-title">{SIDE_TITLES[side]}</p>
      <input
        ref={search}
        className="picker__search"
        type="search"
        value={query}
        placeholder="Filter or type a revision"
        aria-label={`Filter ${SIDE_TITLES[side].toLowerCase()}`}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !isTypedRevision(needle)) return;
          event.preventDefault();
          onTypedRevision(needle);
        }}
        spellCheck={false}
        autoComplete="off"
      />
      <div className="picker__list" role="listbox" aria-label={SIDE_TITLES[side]}>
        {groups.length === 0 ? <p className="picker__empty">Nothing matches.</p> : null}
        {groups.map((section) => (
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
      {mergeBase === null ? null : (
        <label className="picker__merge" aria-disabled={!mergeBase.available}>
          <input
            type="checkbox"
            checked={mergeBase.checked}
            disabled={!mergeBase.available}
            onChange={(event) => mergeBase.onChange(event.target.checked)}
          />
          Start from the merge base, as a pull request does
        </label>
      )}
      {error === null ? null : <p className="picker__error">{error}</p>}
    </>
  );
}

/**
 * What the page compares, chosen from what the repository holds.
 *
 * Two chips and the link between them cover every comparison the command line
 * can name, so the page needs no argument grammar of its own: it sends the same
 * `ComparisonRequest` that argument text parses into. A choice measures at
 * once, so nothing here is half-chosen and the chips always read as what the
 * page below them is drawing.
 */
export function ComparisonPicker({ diff, disabled, onCompare }: Props): React.JSX.Element {
  const [openSide, setOpenSide] = useState<Side | null>(null);
  const [refs, setRefs] = useState<RepositoryRefs | null>(null);
  const [refsError, setRefsError] = useState<string | null>(null);
  const baseChip = useRef<HTMLButtonElement>(null);
  const targetChip = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const chipRef = useCallback(
    (side: Side): React.RefObject<HTMLButtonElement | null> => (side === "base" ? baseChip : targetChip),
    [],
  );

  const selection = selectionOf(diff.request);

  /** Choosing measures at once, and choosing what is already drawn only closes. */
  const apply = (next: Selection): void => {
    setOpenSide(null);
    if (!sameSelection(next, selection)) onCompare(requestOf(next));
  };

  // Read once, and only when a panel is first needed: a scan never asks.
  useEffect(() => {
    if (openSide === null || refs !== null) return;
    fetchRefs().then(setRefs, (cause: unknown) => {
      setRefsError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [openSide, refs]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const chip = openSide === null ? null : chipRef(openSide).current;
    if (!panel || !chip) return;
    const anchor = chip.getBoundingClientRect();
    panel.style.top = `${anchor.bottom + 8}px`;
    panel.style.left = `${anchor.left}px`;
    const bounds = panel.getBoundingClientRect();
    const overflow = bounds.right - (window.innerWidth - GUTTER);
    if (overflow > 0) panel.style.left = `${Math.max(GUTTER, anchor.left - overflow)}px`;
  }, [openSide, chipRef]);

  // A fixed panel does not travel with its anchor, so a scroll that moves the
  // page closes it. A scroll inside the panel is the list or the filter box
  // reaching its own end, and moves nothing.
  useEffect(() => {
    if (openSide === null) return;
    const dismiss = (event: Event): void => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      setOpenSide(null);
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (baseChip.current?.contains(target) || targetChip.current?.contains(target)) return;
      setOpenSide(null);
    };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [openSide]);

  const headNote = refs === null
    ? "the commit checked out"
    : refs.headBranch === null ? `detached at ${refs.headSha}` : `${refs.headBranch}, ${refs.headSha}`;

  const refSections = useMemo(() => REF_SECTIONS.map((section) => ({
    title: section.title,
    entries: (refs?.refs ?? []).filter((ref) => ref.kind === section.kind),
  })), [refs]);

  const chooseBase = (name: string): void => apply({ ...selection, base: name });
  const chooseTarget = (target: Target): void => apply({ ...selection, target });

  const baseSections = (): Section[] => [
    {
      title: "Commit",
      options: [{
        key: "HEAD",
        name: "HEAD",
        note: headNote,
        selected: selection.base === "HEAD",
        onSelect: () => chooseBase("HEAD"),
      }],
    },
    ...refSections.map((section) => ({
      title: section.title,
      options: section.entries.map((ref) => ({
        key: `base:${ref.kind}:${ref.name}`,
        name: ref.name,
        note: ref.shortSha,
        selected: selection.base === ref.name,
        onSelect: () => chooseBase(ref.name),
      })),
    })),
  ];

  const targetSections = (): Section[] => [
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

  // The index has one base, so the other chip has nothing left to choose.
  const baseSettled = selection.target.kind === "index";
  const comparesRevisions = selection.target.kind === "revision";
  const swapNote = comparesRevisions
    ? "click to swap the two sides"
    : `a ${targetName(selection.target)} cannot be the side a comparison starts from`;

  const chip = (
    side: Side, name: string, note: string, settled: boolean, tag?: string,
  ): React.JSX.Element => (
    <button
      ref={chipRef(side)}
      type="button"
      className="picker__chip"
      aria-haspopup="dialog"
      aria-expanded={openSide === side}
      aria-disabled={settled}
      aria-label={`Compare ${SIDE_TITLES[side].toLowerCase()} ${name}${tag === undefined ? "" : `, ${tag}`}`}
      disabled={disabled}
      onClick={() => {
        if (!settled) setOpenSide((previous) => (previous === side ? null : side));
      }}
      {...tooltipHandlers}
    >
      <span className="picker__chip-name">{name}</span>
      {tag === undefined ? null : <span className="picker__chip-tag">{tag}</span>}
      {settled ? null : <MenuChevron />}
      <Tooltip compact>{note}</Tooltip>
    </button>
  );

  return (
    <div className="picker">
      {chip(
        "base",
        shortRevision(selection.base),
        baseSettled
          ? "the index is always compared against HEAD"
          : selection.fromMergeBase
            ? `${diff.base} - click to compare from something else`
            : `${selection.base} - click to compare from something else`,
        baseSettled,
        // What "from" means, in Git's own notation, because a merge base moves
        // the start of the comparison and the chip would otherwise not say so.
        selection.fromMergeBase ? "merge base" : undefined,
      )}

      <button
        type="button"
        className="picker__swap"
        aria-disabled={!comparesRevisions}
        aria-label="Swap the sides of the comparison"
        disabled={disabled}
        onClick={() => {
          if (selection.target.kind !== "revision") return;
          apply({ ...selection, base: selection.target.name, target: { kind: "revision", name: selection.base } });
        }}
        {...tooltipHandlers}
      >
        -&gt;
        <Tooltip compact>{swapNote}</Tooltip>
      </button>

      {chip(
        "target",
        shortRevision(targetName(selection.target)),
        `${targetName(selection.target)} - click to compare against something else`,
        false,
      )}

      {openSide === null ? null : (
        <div
          ref={panelRef}
          className="picker__panel"
          role="dialog"
          aria-label={`Compare ${SIDE_TITLES[openSide].toLowerCase()}`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpenSide(null);
              chipRef(openSide).current?.focus();
            }
          }}
        >
          <RefPanel
            side={openSide}
            sections={openSide === "base" ? baseSections() : targetSections()}
            error={refsError}
            onTypedRevision={(rev) => {
              if (openSide === "base") chooseBase(rev);
              else chooseTarget({ kind: "revision", name: rev });
            }}
            mergeBase={openSide === "target" ? null : {
              checked: selection.fromMergeBase && comparesRevisions,
              available: comparesRevisions,
              onChange: (checked) => apply({ ...selection, fromMergeBase: checked }),
            }}
          />
        </div>
      )}
    </div>
  );
}
