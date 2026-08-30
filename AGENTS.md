# Working on Slopsplorer

Slopsplorer scans a source tree, measures every file, and serves an interactive map of where the weight sits.
It is a single Node process: a scanner, an aggregator, a small HTTP server, and a React client.

## Commands

```bash
npm install          # four runtime packages and the build toolchain
npm run dev          # scan the current folder and serve it with hot reload on :8765
npm run build        # vite build (client) then tsc (server + CLI)
npm test             # vitest
npm run typecheck    # all three TypeScript projects, no emit
```

`npm run dev` runs `src/cli.ts` under `node --watch`, so it needs Node 22.18 or later for type stripping.
The published package runs on Node 20.19, which is what CI checks alongside 22 and 24.
There is no build step in the dev loop: Vite runs in middleware mode inside the server process, so a client edit hot-reloads and a server edit restarts the process and takes a new scan.

The dev server builds its Vite config inline instead of reading `vite.config.ts`.
Vite bundles a TypeScript config into a temporary file beside it on every start, and `node --watch` would treat that file as a change and restart forever.
`vite.config.ts` still owns the production build.

## Orientation

The data flows one way, and every aggregation happens on the server.

```
src/scanner/     walk -> classify -> tokenize + measure -> ScanIndex
                 git diff -> align lines -> tokenize + measure -> ScanIndex
src/server/      ScanIndex + ViewRequest -> buildView -> ViewResponse
                 ScanIndex + ReportOptions -> buildReport -> text on stdout
                 ScanIndex + AskRequest -> composeBrief -> the text a local agent reads
src/agents/      find the installed agents -> run one per question -> its answer
src/web/         ViewRequest state -> POST /api/view -> render
src/shared/      the wire contract both sides import
```

A tree and a comparison are two producers of one `ScanIndex`, and nothing downstream asks which one made it.

Two design docs hold the detail, and they are the technical memory of this repository:

- [docs/architecture.md](docs/architecture.md) - how the parts fit together, the scan, the wire contract, the routes, the client.
- [docs/scanning-and-classification.md](docs/scanning-and-classification.md) - which files enter a scan, flavors, grammar selection, structure counts, lines, tokens.
- [docs/diff-mode.md](docs/diff-mode.md) - the second producer of an index: the command line, the line diff, churn and net, signed weight.
- [docs/commit-band.md](docs/commit-band.md) - the commits inside a comparison: the span, the band above the filter bar, and where the spine is held.
- [docs/report.md](docs/report.md) - the second consumer of an index: `--report`, the sections, the one rule that decides how deep the walk goes.
- [docs/ask.md](docs/ask.md) - handing a question to a local coding agent: discovery, the brief, the one process per ask, and how an answer is drawn.
- [docs/export.md](docs/export.md) - the static consumer of an index: the output directory, embedded data, lazy previews, and browser worker.

`README.md` is the user-facing page, and `skill/SKILL.md` is the agent skill that ships inside the package.
Both describe behavior to someone outside the code, so a change in what a number means has to reach them too.

Start any non-trivial task by reading the design doc that covers the area you are about to change.

## Invariants

A change that breaks one of these changes the product, and is not a refactor.
Each is explained where it belongs; the list exists so nobody breaks one by accident.

- `src/shared/api.ts` is the wire contract both builds import. `src/shared/index.ts` is the one other shared module, so a static worker rebuilds the same queryable index as the scanner. Change either and both sides change together.
- `src/scanner/measure.ts` is the single place that decides whether a file gets tree-sitter comment spans or the marker table, so the scanner and the corpus test cannot drift apart.
- `ScanIndex.files` is sorted by path, which is what makes a subtree total a slice. `tests/scan.test.ts` pins it, and `tests/diff-scan.test.ts` pins it for the other producer.
- `acceptSourcePaths` in `src/scanner/walk.ts` is the single acceptance rule, so a scan and a diff cannot disagree about what a source file is.
- The server aggregates a live page, and its browser never receives a file it does not display. A static snapshot is the explicit exception: its worker receives the measured file index, and source text still loads one file at a time.
- `lines === codeLines + commentLines`, non-blank lines only, buckets exclusive. Comment detection may only move a line between the two buckets, never change `lines`, never touch `tokens`.
- A `Measure` and an `Aspect` resolve to a numeric `FileRow` field through `weightField`, the one table that holds every such name whole. Both are validated by `parseViewRequest` before either reaches an index expression.
- Every `RankMetric` is a column both file tables draw in the mode it belongs to, and every column they draw is a `RankMetric`. Sorting is the only way to pick one, so a metric without a column could never be reached. `buildView` clamps a metric the open index cannot draw and echoes what it used.
- `name` is the one `RankMetric` that is not a `MeasuredMetric`: it holds no figure, it orders the rows A to Z, and it never decides which rows a curtailed list holds. The cut is always by the active measure and aspect.
- On the wire the measured quantity is `weight`, never `tokens`, and `ViewResponse` echoes the measure, the aspect, and the sorted column back.
- `ScanMeta.diff` is the only thing that says which mode the page is in. A scan forces the aspect to `after`, because a scanned file has one content.
- Churn is `added + removed` and net is `added - removed`, for every measure. Net is signed, so every share is drawn against churn, and every ordering and threshold uses magnitude.
- In `tests/comment-corpus.test.ts` a split that differs from `cloc` carries a written reason and a split that matches does not, so neither drift passes silently.
- An agent is offered when the host proved it can run it, its row says what the sign-in probe believed, and it is resolved outside the `node_modules/.bin` folders npm puts in front of `PATH`. It is asked in a mode that cannot write, and its question is one argument of an argument list, never a shell command. Stopping an ask signals the agent's process group, because an agent runs tools of its own.
- An answer is Markdown a model wrote, so it is drawn as React elements and never injected as HTML. The only string handed to the browser as HTML is the highlighter's, from text it escaped first.
- `GET /api/source` serves a path only if the current scan holds it, and refuses a resolved real path outside the scan root. Inside a comparison it returns the file as aligned lines, from the same alignment the file's figures came from, whole rather than as hunks, because the page decides how much of the unchanged text to draw.

## Agentic rules

TEST WHAT YOU CAN. The scanner, the aggregator, and the server are exercisable from Node, so anything assertable belongs in `tests/`.
`npm test` and `npm run typecheck` pass before a change is done, and that is not the reviewer's job.

TDD FOR BUGFIXES. Failing test first, then the fix, then the test passing. For a new feature, where practical.

FIX WHAT YOU FIND. Whoever meets a failing or flaky test fixes it, even when they did not cause it, and checks whether the same pattern sits elsewhere.
Same for a type error or visibly broken UI beside what you were sent to change.

NO FALLBACKS unless a user asks for one. No second route to the same result, no legacy path kept alive beside the new one. Process as intended, or fail.

NO SUPPRESSION OF EXCEPTIONS. Catch only where a specific failure must reach the user, and reconsider even then whether to rethrow. Catch-log-swallow is forbidden.

REFACTOR BY REMOVAL FIRST. Delete the old path before writing the new one, and add no abstraction the request does not need.
The wire contract just evolves: no persisted state and no external consumer, so nothing here ever needs a compatibility shim.

JUSTIFY NEW SURFACE. Before adding a CLI flag, a route, a `ViewRequest` field, or a control on the page, check whether an existing one already carries the meaning.
Two widgets that can each claim to decide what the page counts is the failure this prevents.

JUSTIFY DEFENSIVE COMPLEXITY. Prefer code that is correct by its shape over code that is correct because it guards itself.
A sorted array with a prefix sum beats a cache with an invalidation rule.

WRITE GREPPABLE CODE. Agents navigate by text search, so every name worth searching for appears whole in the source.
The measures are the example: `codeLines` is spelled out in `MEASURES`, in `FileRow`, in the aggregator, and in the column that draws it, so one search finds every place it matters. Indexing by a validated whole name, as `file[measure]` does, keeps that. Assembling one from fragments, as `` file[`${kind}Lines`] `` would, destroys it.

BE PICKY ABOUT THE UI. This product is a page someone reads.
  - Alignment, spacing, and two panels agreeing about the same number are part of the work, not polish for later.
  - Non-jumping controls. We prefer non-jumpy controls that stay in place when other controls navigate or change mode. This means reserving enough space for worst-case, disabling (muting) a non-applicable control instead of removing it, etc.

KEEP THE EXPORT SNAPSHOT AT PARITY. A new capability of the page has to work in a static export as well as against the server.
Read the index through `ExplorerRuntime`, so the live routes and the snapshot worker both serve it, and open an exported bundle before you call the work done.
The exemptions are the ones a frozen index cannot serve, and [docs/export.md](docs/export.md) names them: a snapshot cannot rescan, open another folder, change the comparison, step to another span in the commit band, install the skill, or ask a local agent.
Anything outside that list is a parity break and not a trade-off to accept quietly.

CONSULT AND MAINTAIN THE DOCS. `docs/` is written by agents for agents: how the thing works under the hood, so a cold reader does not re-derive it by grepping.
  - Update the doc when behavior changes substantially, and edit the existing one rather than adding a near-duplicate.
  - Current state only. History lives in git.
  - Name the modules, functions, routes, and fields a reader would open, with no line numbers, and explain intent rather than restating the code.
  - English, ASD-STE100 Simplified Technical English: short words, active voice, simple tenses, plain verbs over metaphor
  - Staright sentence structure: subject verb adjective.
  - Short enough to read in one go by a human. If curtailing gets hard, split the doc.

COMMENTS AND DOCSTRINGS. English, short, and only where they carry a rationale the code cannot.
The reader is as competent as you are, so what the code or a design doc already says needs no restating.
Trim a pre-existing comment that deviates from this rather than growing it further.

PLANS. Keep a plan high-level and write no code inside it: its reader is as capable as you are.
A plan in an untracked `./.plans/` folder stays uncommitted, whatever other instructions suggest.

README stays concise and should not verbally explain the UI/UX details where it is already ergonomic and self-obvious to engineer users. README stays lightly ironic (code == slop).

## Agentic tooling

This section is a default. A user-owned AGENTS.md with competing personal guidance wins.

**Edits**: prefer the native Edit/Write tools for targeted changes, because they are reliable and a human can watch them.
Scripted edits are fine and encouraged for a large mechanical sweep or for moving a block of existing code.

**UI checking**: the page cannot be verified from a test run.
Use the `dev-browser` CLI against the dev server on `http://127.0.0.1:8765`, and drive it from a sub-agent, because browser work consumes context fast.

**Watching CI**: long-poll. Do not iterate in fifty-second steps over a run that takes several minutes.

## Conventions

- No em dashes anywhere. Plain `-` and even that is rarely needed.
- Comments explain why, not what. Doc comments on exported symbols and on non-obvious logic only.
- In Markdown and long comments, one sentence per line. Do not wrap inside a sentence.
- Relative imports carry the `.ts` / `.tsx` extension. `tsc` rewrites them on emit.
- Strict TypeScript, including `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, and `noUnusedParameters`.
- Descriptive names. No abbreviations.
- A modal is a native `<dialog>` driven by `useModalDialog` from `src/web/dialog.ts`. It pushes the open state into the element and guards both calls, because `showModal` on an open dialog throws.
- Tooltips are CSS, never the native `title` attribute, which cannot be styled, appears on a delay the page does not control, and never appears for a keyboard user.
  Render `Tooltip` from `src/web/components/Tooltip.tsx` as a direct child of the control and spread `tooltipHandlers` onto it.
  The panel is fixed-position and placed on hover, so it escapes a scrolling tree, a table cell, and a panel with hidden overflow.

## Dependencies

Four runtime packages, pinned exactly, none with a transitive dependency of its own.
That is a constraint and not an accident: `npx slopsplorer` has to work on any platform with no native build, which is why the grammars ship as prebuilt WASM.

Pin every dependency, runtime or dev, to an exact version that is at least four days old.
Check the registry rather than writing a version from memory. Do not bump a version without a reason.
Treat an unpinned install as running unreviewed code: check the manifest before invoking the installer.

## Changelog and releasing

Add each user-facing change to `CHANGELOG.md` under `Unreleased` in one user-facing sentence.
Do not add an entry for internal work or for a fix to an unreleased feature. Follow `RELEASING.md` to prepare screenshots, validate, and release a version.
