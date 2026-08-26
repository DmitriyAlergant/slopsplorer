# Architecture

## Purpose

Slopsplorer reads a source tree, measures every file, and serves an interactive map of where the weight of the tree is.
The question it answers is how much of a repository an agent must read, and which folders and files hold most of that cost.

The whole program is one Node process.
It has four parts: a scanner, an aggregator, a small HTTP server, and a React client.
The client never computes a total.
It sends the scope it wants to see, and it draws the numbers that come back.

For the rules that decide what each file is, read [classification.md](./classification.md).
For commands, conventions, and release steps, read [AGENTS.md](../AGENTS.md).

## Parts

```
src/scanner/   list files -> classify -> parse and measure -> ScanIndex
src/server/    ScanIndex + ViewRequest -> buildView -> ViewResponse
src/web/       ViewRequest state -> POST /api/view -> render
src/shared/    api.ts, the wire contract that both sides import
```

`src/cli.ts` parses the command line, runs the first scan, starts the server, and prints a summary.
`--dev` starts Vite in middleware mode inside the same process, so the API, the client, and the hot-reload channel use one port.

`src/shared/api.ts` is the only file that both the Node build and the browser build import.
A change to it is a change to both sides.

## The scan

`scanSourceTree()` in `src/scanner/scan.ts` runs the complete scan.

1. `listSourceFiles()` in `src/scanner/walk.ts` produces the candidate paths.
   Inside a Git worktree the list comes from `git ls-files --cached --others --exclude-standard`, so a new untracked file is on the map and an ignored file is not.
   Outside a Git worktree the walker reads the tree itself and applies the `.gitignore` files it finds on the way down.
2. Each file is read once, up to `--max-file-bytes` (2 MiB by default).
   Larger files are counted in `ScanMeta.skippedLargeFiles` and are left out.
3. `measureFile()` in `src/scanner/measure.ts` selects the grammar, counts the structure, and splits the lines.
   This is the single place that decides whether a file gets tree-sitter comment spans or the comment-marker table, so the scanner and the corpus test cannot disagree about it.
4. `classifyFile()` and `refineKindByContent()` in `src/scanner/classify.ts` set the flavor, and `isGenerated()` sets the generated flag.
5. The token count comes from `tokenCounter()` in `src/scanner/tokenize.ts`.

Files are read in parallel because reading is limited by the disk.
Measuring is not parallel: it is one thread, and a scan of 1,300 files takes about three seconds.

The result is a `ScanIndex`: the file rows, the folder nodes, and the metadata for the run.
There is no filesystem watcher. A new index is built at startup and again when the user presses Rescan.

## Why the files are sorted by path

`ScanIndex.files` is sorted by path.
That makes every folder's descendants one contiguous range of the array, which `FolderNode.start` and `FolderNode.end` record.
The total for a subtree is then a slice, not a pass over the project.

`ScanIndex.weightPrefix` holds one running-total array for each measure, so the unfiltered weight of any folder is one subtraction.
The aggregator uses that number as the denominator of every percentage, which is why a percentage does not move when a visibility switch changes.

The sort is what makes the range correct: any path that starts with `a/b/` sorts between `a/b/` and `a/b0`, because `0` is the next code point after `/`.
`tests/scan.test.ts` holds sibling folders with shared name prefixes to keep this true.

## Why the server aggregates

An earlier version sent the whole file list to the browser and filtered it there.
That cost about 363 bytes per file, near 7 MiB for a repository of twenty thousand files, and it recomputed folder totals on every keystroke.

Now the client sends a `ViewRequest` that describes what it wants to look at, and `buildView()` in `src/server/aggregate.ts` returns a `ViewResponse` that holds only the rows on screen.
The browser never receives a file it does not display.

`buildView()` runs these passes in order:

- Visibility. The flavor switches and the search text decide which files are counted at all.
- Inclusion. The tree checkboxes decide which of the visible files count toward the totals. Exclusion is inherited by every folder below the excluded one.
- Aggregation. Tree rows, folder cards, the detail panel, the headline figures, and the ranked file list are all built from the same totals.

## The wire contract

`ViewRequest` carries the flavor switches, the search text, the checkbox exclusions, the expanded folders, the drill path, the selection, the sorted column, and the measure.
`ViewResponse` carries the tree rows, the detail panel, the ranked files, the headline figures, and the scan metadata.

The measured quantity on the wire is always `weight`, never `tokens`.
`ViewResponse` repeats the measure it used, so a label in the client cannot describe one unit while the numbers beside it are in another unit and a newer request is still in flight.

Every `Measure` name (`tokens`, `lines`, `codeLines`) is also a numeric field of `FileRow`.
The aggregator applies a measure by reading that field, not by a branch, and `parseViewRequest()` checks the name against `MEASURES` before it is used as an index.

## The server

`createSlopsplorerServer()` in `src/server/server.ts` serves the API and the built client.

| Route | Purpose |
| --- | --- |
| `POST /api/view` | Aggregate the current index for one `ViewRequest`. |
| `POST /api/rescan` | Scan the same root again. Concurrent calls share one scan. |
| `POST /api/open` | Replace the root with another absolute directory and scan it. |
| `GET /api/source` | Return the text of one file for the source dialog. |
| `GET /api/skill-install` | Return the command that installs the bundled agent skill. |
| `GET /api/health` | Report that the process is up. |

The index is the list of readable files.
`/api/source` serves a path only if the current scan contains it, then resolves the real path and refuses anything that is outside the scan root, so a symlink added after the scan cannot read another part of the disk.

A rescan replaces the state only after it succeeds.
A failed scan leaves the previous index in place, so the page keeps working.

## The client

`src/web/App.tsx` holds one `ViewRequest` as state and posts it on every change.
There is no client-side store beyond that request and the last response.

Two places keep the request:

- `src/web/urlState.ts` writes the parts of the request that describe what is on screen into the URL, so a view can be sent to another person as a link.
- `src/web/preferences.ts` keeps the parts that are personal habit, such as the measure and the sorted column, in local storage.

The page reads in one direction, from top to bottom.
The filters and the drill trail come first, then the workspace where the user navigates the tree, then the readouts and the proportion bar, then the ranking.
Everything below the workspace describes what the workspace shows, so no part of the page needs a control that sits below it.

Three controls narrow the view, and they do different things:

- The flavor switches and the search box decide which files are counted at all.
- The tree checkboxes decide which of those count toward the totals.
- Drill decides which folder the page is about. Drilling moves the whole view: the headline figures, the proportion bar, and the percentage baselines all describe the drilled folder, and one readout keeps the project figure visible.

Ordinary folder selection is navigation inside the drill scope.
It moves the detail panel and the ranking, and it leaves the headline figures alone.

## Dependencies

Four runtime packages, each pinned to an exact version, none with a transitive dependency.

| Package | Why |
| --- | --- |
| `gpt-tokenizer` | Token counting for `cl100k_base` and `o200k_base`, in TypeScript. |
| `web-tree-sitter` | The WASM parser runtime. |
| `@vscode/tree-sitter-wasm` | Thirteen prebuilt grammars, so there is no native build step. |
| `ignore` | `.gitignore` rules when the walker reads a folder that is not a Git worktree. |

Because the grammars are prebuilt WASM, `npx slopsplorer` works on any platform without a compiler.
