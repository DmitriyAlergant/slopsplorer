# Architecture

## Purpose

Slopsplorer reads a source tree, measures every file, and serves an interactive map of where the weight of the tree is.
The question it answers is how much of a repository an agent must read, and which folders and files hold most of that cost.

It answers a second question with the same map.
Diff mode measures what a comparison changed instead of what a tree holds, so the page reports how much of a change a reviewer must read and where it sits.
For that mode, read [diff-mode.md](./diff-mode.md).

The whole program is one Node process.
It has four parts: a scanner, an aggregator, a small HTTP server, and a React client.
A fifth part runs the coding agents the host already has, so the page can hand a question about the tree to one of them.
The client never computes a total.
It sends the scope it wants to see, and it draws the numbers that come back.

For the rules that decide what each file is, read [scanning-and-classification.md](./scanning-and-classification.md).
For the questions the page can hand to a local agent, read [ask.md](./ask.md).
For commands, conventions, and release steps, read [AGENTS.md](../AGENTS.md).

## Parts

```
src/scanner/   list files -> classify -> parse and measure -> ScanIndex
src/server/    ScanIndex + ViewRequest -> buildView -> ViewResponse
src/agents/    find the installed agents -> run one per question -> its answer
src/web/       ViewRequest state -> POST /api/view -> render
src/shared/    api.ts, the wire contract; index.ts, the queryable index shape
```

There are three paths to a `ScanIndex` and one consumer of it.
`scanSourceTree()` measures the working tree, `scanReviewSide()` measures one complete side of a comparison, and `scanDiff()` measures the change between two sides.
Both end at `assembleIndex()` in `src/shared/index.ts`, which builds the prefix sums and the lookup maps, so neither producer can grow a table the other one lacks.
Everything downstream reads the index and does not ask which one made it.

`src/cli.ts` parses the command line, runs the first scan, starts the server, and prints a summary.
`--dev` starts Vite in middleware mode inside the same process, so the API, the client, and the hot-reload channel use one port.

`src/shared/api.ts` is the wire contract that both builds import.
`src/shared/index.ts` holds `ScanIndex`, its JSON form, and the one pair of functions that assembles and hydrates its derived tables.
The snapshot worker imports it so the browser and the scanner cannot build different prefix arrays or lookup maps.

## The scan

`scanSourceTree()` in `src/scanner/scan.ts` runs the complete scan.

1. `listSourceFiles()` in `src/scanner/walk.ts` produces the candidate paths.
   Inside a Git worktree the list comes from `git ls-files --cached --others --exclude-standard`, so a new untracked file is on the map and an ignored file is not.
   Outside a Git worktree the walker reads the tree itself and applies the `.gitignore` files it finds on the way down.
2. Each file is read once, up to `--max-file-bytes` (2 MiB by default).
   Larger files are counted in `ScanMeta.skippedLargeFiles` and are left out.
3. `measureFile()` in `src/scanner/measure.ts` selects the grammar, counts the structure, and splits the lines.
   This is the single place that decides whether a file gets tree-sitter comment spans or the comment-marker table, so the scanner and the corpus test cannot disagree about it.
4. `classifyFile()` and `refineKindByContent()` in `src/scanner/classify.ts` set the flavor, and `isGenerated()` with `hasGeneratedContent()` set the generated flag.
   `classifyFile()` reads the locale levels that `findLocaleLevels()` computes once from the whole listing, so both producers have to hand it the same view of the tree.
5. The token count comes from `tokenCounter()` in `src/scanner/tokenize.ts`.

Files are read in parallel because reading is limited by the disk.
Measuring is not parallel: it is one thread, and a scan of 1,300 files takes about three seconds.

The result is a `ScanIndex`: the file rows, the folder nodes, and the metadata for the run.
There is no filesystem watcher. A new index is built at startup and again when the user presses Rescan.

`scanDiff()` in `src/scanner/diffScan.ts` builds the same structure from a revision pair.
It shares steps 3 to 5 with the scan, and it shares the acceptance rule in `acceptSourcePaths()`, so the two producers cannot disagree about what a source file is.
`ScanMeta.diff` is `null` for a scan and describes the comparison for a diff, and it is the only thing that tells the aggregator and the client which mode they are in.
`ScanMeta.review` is navigation context only.
It keeps the comparison and the active Before / Diff / After choice while a repository-side scan has no diff figures.

## Why the files are sorted by path

`ScanIndex.files` is sorted by path.
That makes every folder's descendants one contiguous range of the array, which `FolderNode.start` and `FolderNode.end` record.
The total for a subtree is then a slice, not a pass over the project.

`ScanIndex.weightPrefix` holds one running-total array for each weight field, so the unfiltered weight of any folder in any measure and aspect is one subtraction.
The summary states that number beside the visible weight, which is how the ribbon says what share of the tree the filters keep.
No percentage divides by it: every share divides by `visibleScopeWeight`, the drill scope as the filters leave it, so a percentage names the tree the reader is looking at.
Turning a flavor on therefore moves the whole as well as the parts, and a folder that holds none of that flavor takes a smaller share of a larger scope.

The sort is what makes the range correct: any path that starts with `a/b/` sorts between `a/b/` and `a/b0`, because `0` is the next code point after `/`.
`tests/scan.test.ts` holds sibling folders with shared name prefixes to keep this true.

## Why the server aggregates

An earlier version sent the whole file list to the browser and filtered it there.
That cost about 363 bytes per file, near 7 MiB for a repository of twenty thousand files, and it recomputed folder totals on every keystroke.

Now the live client sends a `ViewRequest` that describes what it wants to look at, and `buildView()` in `src/server/aggregate.ts` returns a `ViewResponse` that holds only the rows on screen.
The live browser never receives a file it does not display.

A static snapshot is the explicit exception.
It has no Node process, so its Web Worker receives a serialized index and runs the same `buildView()` function in the browser.
Source text is not in that index and still loads one file at a time.
For the complete path, read [export.md](./export.md).

`buildView()` runs these passes in order:

- Visibility. The path search decides which paths the tree shows, while the flavor switches decide which matching files carry weight.
- Inclusion. The tree checkboxes decide which of the visible files count toward the totals. Exclusion is inherited by every folder below the excluded one.
- Aggregation. Tree rows, folder cards, the folder panel, the headline figures, and the ranked file list are all built from the same totals.

## The wire contract

`ViewRequest` carries the flavor switches, the search text, the checkbox exclusions, the expanded folders, the drill path, and the selection.
It also carries the file scope, the sorted column, the table offset, the measure, and the aspect.
`ViewResponse` carries the tree rows, the folder panel, one ranked file page, the headline figures, and the scan metadata.

The measured quantity on the wire is always `weight`, never `tokens`.
`ViewResponse` repeats the measure, the aspect, and the sorted column it used, so a label in the client cannot describe one unit while the numbers beside it are in another unit and a newer request is still in flight.

A measure and an aspect together name a numeric field of `FileRow`.
`weightField()` in `src/shared/api.ts` is the one table that resolves the pair, and every name in it is written whole, because building `churnLines` out of fragments would put it beyond the reach of a text search.
The aggregator applies a measure by reading the resolved field, not by a branch, and `parseViewRequest()` checks both names against `MEASURES` and `ASPECTS` before either is used as an index.
A scan has one content per file, so `buildView()` forces the aspect to `after` unless the index is a diff.

## The server

`createSlopsplorerServer()` in `src/server/server.ts` serves the API and the built client.

| Route | Purpose |
| --- | --- |
| `POST /api/view` | Aggregate the current index for one `ViewRequest`. |
| `POST /api/files` | Return all files that match one `ViewRequest` for `Read all`. |
| `POST /api/rescan` | Scan the same root again. Concurrent calls share one scan. |
| `POST /api/open` | Replace the root with another absolute directory and scan it. |
| `GET /api/open-in` | List Cursor, VS Code, and the host operating system's file manager. |
| `POST /api/open-in` | Open the root or current drill folder in one listed application. |
| `POST /api/compare` | Replace the comparison, keeping the repository, and measure it again. |
| `POST /api/review-mode` | Rescan the diff or one complete side of the active comparison. |
| `GET /api/refs` | Return the branches, remote branches, and tags the comparison picker offers. |
| `GET /api/source` | Return one file for the source dialog: its text in a scan, its aligned lines in a comparison. |
| `GET /api/skill-install` | Return the command that installs the bundled agent skill, written for the shell of the host platform. |
| `GET /api/skill-source` | Return the bundled `SKILL.md` for the preview dialog. |
| `GET /api/agents` | Return the local coding agents this host can run. |
| `POST /api/ask` | Start one agent on one question about the open index. |
| `GET /api/asks` | Return every ask of this server run, newest first. |
| `POST /api/ask-dismiss` | Stop one ask if it runs, and drop it either way. |
| `GET /api/health` | Report that the process is up. |

The index is the list of readable files.
`/api/source` serves a path only if the current scan contains it, then resolves the real path and refuses anything that is outside the scan root, so a symlink added after the scan cannot read another part of the disk.
Inside a comparison the file has two contents, so the route returns the file as aligned lines instead, built by the aligner `openDiffAligner()` opens, from the same alignment the file's figures were summed over.
It sends every line, changed or not, and the page decides how much of the unchanged text to draw.

`/api/open-in` takes `ViewRequest.drillPath`, not the selected row.
An empty drill opens `ScanMeta.rootPath`, and a non-empty drill opens that folder below the root.
The route requires the drill to exist in `ScanIndex.folderByPath`, then resolves the root and target before it starts an application, so a changed symlink cannot aim the action outside the measured project.
`buildOpenInOptions()` and `buildOpenInPlan()` in `src/server/openIn.ts` choose the file manager name and launch command from the server operating system.
They do not probe installed applications.
The route reports a launch failure when the chosen editor or system command is absent.
The browser stores the last chosen application, and `OpenInPicker` uses it for the main half of the split control.
`FilterBar` draws it, and the agent picker beside it, at the right of the filter bar.
Both act on the drill scope that bar filters, and the bar holds the top of the page after the header scrolls away.

The skill ships with the package and not with the scan, so `/api/skill-source` reads it by a fixed name instead of through that allowlist, and the same dialog draws it.
`buildSkillInstall()` writes the install command for the platform the server runs on: `cp` chained with `&&` for a POSIX shell, `Copy-Item` chained with `;` under `$ErrorActionPreference` for PowerShell.
It copies the skill into `~/.claude/skills`, which Claude Code reads, and into `~/.agents/skills`, which Codex and the other tools that follow the open skill layout read.
Two copies and no symlink, because an unprivileged Windows user cannot always make one.

`listen()` binds the first free port from the one it was given, up to `portAttempts` in a row.
The command line passes 20 attempts for the default port, so a listener an earlier run left behind does not stop a scan, and 1 for a port the user named with `--port`, which is then used or the run fails.
On a failure the command line asks `lsof` who holds each busy port and prints a `kill` command for the Node processes among them.

`/api/open` always installs a scan producer.
A directory is not a comparison, so keeping the old one would leave the page reporting churn for a tree nobody compared.

`/api/compare` answers only when the open index is a comparison.
A repository-side review keeps that comparison, but a plain scan has no repository against which the page could name a revision, so a plain scan is refused with 400.
It takes a `ComparisonRequest` and verifies it with `verifyComparisonRequest()`, the same check the command line runs.
`/api/refs` is refused for a scan for the same reason.

A rescan replaces the state only after it succeeds.
A failed scan leaves the previous index in place, so the page keeps working.
A running measurement is identified by its root, comparison spec, and review mode, so two views of the same repository cannot join and get the wrong figures back.

## The client

`src/web/App.tsx` holds one `ViewRequest` as state and posts it on every change.
There is no client-side store beyond that request and the last response.
The browser tab is named from the response by `documentTitle` in `src/web/format.ts`: the scanned folder, and in a comparison what is compared, so two windows are told apart.

Two places keep the request:

- `src/web/urlState.ts` writes the parts of the request that describe what is on screen into the URL, so a view can be sent to another person as a link.
- `src/web/preferences.ts` keeps the parts that are personal habit, such as the measure and the sorted column, in local storage.
  It does not keep flavor filters: each visit starts with all flavors on and generated files off unless the URL states another selection.
  A browser can deny storage, and it denies it from the property access as well as from the call, so every read and write goes through `browserStorage()` and the two guarded primitives beside it.
  A denied read is an absent value and a denied write holds for the visit only, so no caller decides that again.

The page reads in one direction, from top to bottom.
The filters come first, then the workspace where the user navigates the tree, then the readouts and the proportion bar.
The drill trail is the heading of the source tree panel, because it names what that tree is rooted in.
Everything below the workspace describes what the workspace shows, so no part of the page needs a control that sits below it.
The one deliberate exception is the proportion bar, whose segments select a folder in the folder panel above it.
The bar is a view of the scope, so selecting from it is the same act as clicking the tree.

There is one file table, and it is inside the folder panel.
The panel divides its subject twice: the tiles divide it by part, and the table lists every file under it, heaviest first.
A part is a child folder or the folder's own files, which take the last tile named `.`, so a folder with no subfolders still fills the row.
The `.` tile remains when filtering leaves it with zero files and zero weight, so the folder's direct-files path never disappears.
The tile before `.` absorbs child folders that do not fit one row, and it is named for what it holds.

Each tile carries a bar, and every bar in the panel divides one whole: `DetailView.flavorBaseline`, the drill scope as the tree's checkboxes and the path filter leave it.
The flavor chips are not applied to that whole, and generated files are never in it.
So the bar's length is what the folder holds of the scope, its divisions are the flavors it is made of, and turning a flavor off takes a slice out of every bar instead of stretching the rest to fill the width.
The tiles account for the whole of their folder, so at the top of a scope the bars add up to the scope.
A separate ranking panel used to repeat the tiles as rows, which put the same subtree on the page twice.
The strip above the ranked table holds the flavor controls and states the available weight of every flavor in the table scope, including disabled and empty flavors.
The page does not draw a file-scope control, but the request field remains available for shared links and static snapshots.

`ViewRequest.fileScope` is that first control.
`subtree` lists every file under the selected folder, and `folder` lists only the files that sit directly in it.
It moves the table alone: the tiles, the folder head, and the tree all keep describing the whole selection, so a reader can ask what one folder holds without leaving the subtree the panel is about.
A `.` selection is a folder's own files already, so the switch is not drawn there and `rankFiles()` treats that selection as the narrow scope whatever the field says.

The pagination line places borderless previous and next controls around the current row range and the number of files the flavor switches show.
The line below states how many files are available in the same path, folder, and checkbox scope.
Compact previous and next controls request the other pages from the same ranked list and stay visibly inert when only one page exists.

The matching list is read in two ways.
Clicking one file opens it alone in `SourceDialog`.
`Read all`, beside the File column heading, opens every matching file in one scrolling dialog, drawn by `FileStack`.
The modal requests the complete list through `ExplorerRuntime.fetchFileList`, independent of the open table page.
The modal always sorts the files by path.
A rank order can separate files from the same folder, but a path order keeps them together.
It holds the `ViewRequest` it was opened with, so a later page request cannot change the modal's selection.
The modal fetches one file when the reader comes near it.
The modal does not fetch the source of a file that the reader folds.
When the reader folds an open file, `FileStack` moves the next file header to the same viewport position.
This keeps the next fold control under the pointer and moves the earlier folded headers up by one row instead of snapping the stack to the top.
`Collapse all` in the modal head folds every file at once, and reads `Expand all` while any file is folded, so one press always reaches a state the reader can see whole.
`SourceDialog` holds which paths are folded, because the control that folds them all sits in its head, and a new selection arrives with every file open.
`FilePreview` draws the body in both dialogs, so a file cannot read one way alone and another way among its neighbours.

The scope strip under the workspace draws the same columns as the folder head, in the same order, and one is read the same way in both places.
Only the subject differs: the folder head describes the selection, and the strip describes the whole drill scope.
The two figures no other panel can state - how much of the project the scope and the filters keep, and how much of that is comment - stand to the right of the columns rather than among them.

Three controls narrow the view, and they do different things:

- The flavor switches decide which files carry weight, while the search box decides which paths the tree and table can show.
- The tree checkboxes decide which of those count toward the totals.
- Drill decides which folder the page is about. Drilling moves the whole view: the headline figures, the proportion bar, and the percentage baselines all describe the drilled folder, and one readout keeps the project figure visible.

Ordinary folder selection is navigation inside the drill scope.
It moves the detail panel and the ranking, and it leaves the headline figures alone.
The source tree keeps folders that the path search finds even when every file below them has a disabled flavor.
Such a folder stays navigable, reads as muted, and carries zero active weight.
The virtual `.` row follows the same rule for files that sit directly in a folder.
Selection is clamped to the drill scope on both sides.
`buildView()` puts the scope root in place of a selection that falls outside it, and `readRequest()` does the same to a link, so a panel can never name a folder that its contents do not cover.

A `.` row is its own subject and not a second way to name its folder.
Selecting it reports the folder's own files: the heading reads `root/folder/.`, the child-folder tiles disappear because they belong to the subtree and not to the loose files, and every figure in the panel is the loose files' own.
The panel keeps one tile there, the subject itself, so the row still stands and the file table under it does not move.
In the tree it is the first row of every level it appears in, above the subfolders and whichever order the level is sorted by, because it is the one row that holds files rather than more folders.
In the tiles and in the ribbon it is ranked by weight like every other part of the folder.

## Where the measure is chosen

The measure and the aspect are properties of every figure on the page, so each is chosen once, in the filter bar.
`FilterBar` draws two switches side by side, the unit and then the side of the change.
The row ends with the two acts on the drill scope, Open in and Ask, which the header held before.
The aspect switch is only drawn inside a comparison, because a scanned file has one content, and it comes second so that the unit switch keeps its place while a review moves between before, diff, and after.
A control per panel would let several widgets each claim to decide what the page counts.

`ViewRequest.rank.metric` is the sorted column of the file table, and it is coupled to the measure and the aspect in one direction each way.
Sorting on `tokens`, `lines`, or `codeLines` makes that column the measure; sorting on `churn`, `net`, `added`, or `removed` makes that column the aspect.
Choosing one moves the sort to it, unless the tables are sorted on a metric it does not cover, such as comment lines or function count, which is a deliberate choice and stays where it is.
The file order follows a new measure or aspect, so a tokens page cannot keep ranking its files by lines and a net page cannot keep ranking them by churn.

The file column is the one sorted column that holds no figure.
It orders the rows A to Z by whole path, which keeps the files of one folder together, and it moves neither the measure nor the aspect.
It is also the one column that does not decide which rows the table holds: a name is not a ranking, so `rankFiles()` always cuts the list to the heaviest by the active measure and aspect, and the name orders what survives that cut.
`MeasuredMetric` is every other sorted column, the ones a table draws a number in, and `rankMetricsFor()` returns those while `sortMetricsFor()` adds the file column to them.

A scan and a diff draw different columns, so a stored preference or a pasted link can name one the open index has not got.
`buildView()` clamps the metric to the columns the mode can sort on and echoes what it used in `ViewResponse.rankMetric`, and the client adopts that, which keeps the sort caret under a heading that exists.

`aspectTotals()` in `src/shared/api.ts` applies the two identities that make net and churn out of the two sides.
The folder head and the scope strip both call it, so a strip that states all five sides at once cannot disagree with the server about what any of them is.

## Dependencies

Four runtime packages, each pinned to an exact version, none with a transitive dependency.

| Package | Why |
| --- | --- |
| `gpt-tokenizer` | Token counting for `cl100k_base` and `o200k_base`, in TypeScript. |
| `web-tree-sitter` | The WASM parser runtime. |
| `@vscode/tree-sitter-wasm` | Thirteen prebuilt grammars, so there is no native build step. |
| `ignore` | `.gitignore` rules when the walker reads a folder that is not a Git worktree. |

Because the grammars are prebuilt WASM, `npx slopsplorer` works on any platform without a compiler.
