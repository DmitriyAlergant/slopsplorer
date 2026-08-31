# Static export

## Purpose

`--export <dir>` writes one scan or comparison as a static interactive explorer and exits.
The destination can be missing or empty.
The command refuses a non-empty destination, so it never deletes or mixes with files from an older export.

The snapshot is fixed at export time.
It cannot rescan, open another folder, open a local application, change a comparison, install the local skill, or run a local coding agent.
A commit band is read-only because another span needs another measured index.

## Command flow

`src/cli.ts` rejects server and report flags because one run has one output mode.
It checks that the built snapshot client exists before it scans.

The normal scan or diff then produces a `ScanIndex`.
For a revision comparison, `buildSpine()` also produces the read-only commit band.
`pullRequestBacklink()` retains a validated full GitHub pull request or GitLab merge request URL, while a number or revision has no backlink.
After a successful scan, `writeStaticBundle()` in `src/server/export.ts` prepares the output directory and writes the explorer.
It builds in a private sibling directory and renames that directory only after every file is ready.
A failed write therefore leaves the destination empty and ready for another attempt.
The command states that the complete accepted source will enter the bundle, says how to serve the result, then prints the absolute output path.
The export step starts no server and invokes no deployment command.

## Static data

The Vite build has a live entry and a snapshot entry.
The exporter copies the built client and makes `snapshot.html` the exported `index.html`.
It replaces the snapshot context placeholder with escaped JSON that holds the optional review backlink.
`snapshotMain.tsx` validates that context before it starts React.

`data/index.json` holds `ScanMeta`, every measured `FileRow`, and the folder list.
It replaces the absolute local root with `rootName` before serialization.
`hydrateScanIndex()` in `src/shared/index.ts` rebuilds the prefix arrays and lookup maps in the snapshot worker.
The worker runs `buildView()` from `src/server/aggregate.ts`, so a live view and a static view use one aggregation rule.

`data/sources/<index>.json` holds one `SnapshotSourceRecord` for each path-sorted file: a `SourceResponse`, or the `{ error }` refusal the live route would send for that file.
A refusal reaches the record instead of stopping the export, so one unreadable file, such as a symlink out of the scan root, never blocks the bundle.
The file index is stable and needs no path encoding.
The page fetches one response only when the reader opens that file, or when a stack of files scrolls to it.
`openSourceReader()` in `src/server/source.ts` owns the 512 KiB ceiling, the real-path boundary, and diff alignment for the server and the exporter.
A reader is opened for the rows it will serve: the exporter opens one over the whole index, so a comparison shares one size batch and one `git cat-file` process across every preview, and the live source route opens one for the single requested row, so an interactive preview measures one file rather than the whole comparison.

`data/spine.json` holds the commit band or `null`.
`.slopsplorer-export` marks the bundle root, and `acceptSourcePaths()` excludes that root when a later scan finds it inside the source tree.
The bundle contains no host policy or deployment metadata.

## Browser runtime

`App` receives an `ExplorerRuntime`.
The live runtime calls the HTTP routes.
The snapshot runtime sends view, file-list, and source requests to `snapshotWorker.ts`.
The worker module exports the message types, so the two sides of the wire cannot drift apart.
The worker keeps full-index work away from React and returns the same `ViewResponse` the HTTP server returns.
It remembers only a successful index load, so a fetch that failed once is retried by the next request.
A worker that fired its `error` event never answers again, so the runtime rejects every later request at once instead of leaving the page waiting.

The Vite build and the worker use relative URLs.
The bundle can therefore run at the root of a static host or below a path prefix.
It needs an HTTP server because browser modules, workers, and data fetches do not run from `file://`.
A `file://` document runs no module, so `snapshot.html` carries the notice that says so inside `#root`, and one classic inline script shows it only on that protocol.
React clears the notice on its first render, so a served page never draws it.

Snapshot capability checks remove remeasure, root editing, local application controls, comparison picking, agent controls, and skill installation.
The header names the page as a static snapshot and shows the root name instead of a local path.
When the context holds a backlink, the header also shows a compact link to the pull request or merge request.

## Pull request image

This repository renders its own pull request diff through `.github/workflows/pr-diff-image.yml`.
The workflow exports the merge-base comparison at the pull request head, serves the static bundle, and captures the top-level view as a PNG.
It runs pull request code with read-only repository access and uploads the PNG as an Actions artifact.

`.github/workflows/publish-pr-diff-image.yml` runs after a successful render on the default branch.
It does not check out or execute pull request code.
It accepts one bounded regular PNG from the artifact, uploads private `pr-<number>-<head>.png` to the dedicated Tigris bucket, and creates or replaces one marked pull request comment with a seven-day presigned URL.
The bucket credentials exist only in the trusted upload and refresh steps and cannot reach the pull request renderer.
The object metadata and comment name the producing workflow run, so a fork-controlled render retains its pull request, head, artifact, publisher, object, and comment audit trail.
It refuses a completed render when the pull request has moved to another head, so an older workflow cannot replace a newer image.
A daily schedule renews the maximum-length presigned URL for every open pull request whose stored head metadata still matches its current head.
The Tigris response allows cross-origin image reads, and the object cache lifetime matches the seven-day signature lifetime.
