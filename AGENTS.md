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

`npm run dev` runs `src/cli.ts` under `node --watch`, so it needs Node 22.18 or later for TypeScript type stripping.
There is no build step in the loop.
The server hosts Vite in middleware mode, so the API, the client, and the hot-reload channel share one port and one process.

Edits under `src/web/` hot-reload in the browser.
Edits under `src/cli.ts`, `src/scanner/`, `src/server/`, or `src/shared/` restart the process, which takes a new scan.

The dev server builds its Vite config inline instead of reading `vite.config.ts`.
Vite bundles a TypeScript config into a temporary file beside it on every start, and `node --watch` would treat that file as a change and restart forever.
`vite.config.ts` still owns the production build.

## Architecture

The data flows one way, and every aggregation happens on the server.

```
src/scanner/     walk -> classify -> tokenize + tree-sitter -> ScanIndex
src/server/      ScanIndex + ViewRequest -> buildView -> ViewResponse
src/web/         ViewRequest state -> POST /api/view -> render
src/shared/      the wire contract both sides import
```

`src/shared/api.ts` is the contract.
Change it and both sides must change together.
It is the only file both projects import.

### Why the server aggregates

An earlier version shipped the whole file list to the browser and filtered it there.
That cost roughly 363 bytes per file on the wire, about 7 MiB for a twenty-thousand-file repository.
It also recomputed folder totals on every keystroke.
Now the client sends a `ViewRequest` that describes the scope it wants, and renders the `ViewResponse` it gets back.
The browser never sees a file it is not displaying.

### Why files are sorted by path

`ScanIndex.files` is sorted, which makes every folder's descendants a contiguous range.
`FolderNode.start` and `FolderNode.end` bound that range, so aggregating a subtree is a slice rather than a scan of the project.
The trick depends on the sort: any string that begins `a/b/` sorts between `a/b/` and `a/b0`, because `0` is the next code point after `/`.
`tests/scan.test.ts` pins this with sibling directories whose names share a prefix.

### Structure metrics

`src/scanner/structure.ts` holds an explicit table of tree-sitter node types per grammar.
It is deliberately explicit rather than pattern-matched: these counts are the product's output, so a reader has to be able to check exactly what was counted.
Grammars load on first use, so a scan of a pure-Python repository never initialises the Rust parser.
Thirteen grammars ship prebuilt as WASM in `@vscode/tree-sitter-wasm`, which is why there is no native compilation step and `npx slopsplorer` works on any platform.

Files outside those grammars still get token and line counts.
They report `language: null` and zero structure counts.

### The primary measure

`ViewRequest.measure` selects the unit every aggregation is expressed in: `tokens`, `lines`, or `codeLines`.
It is orthogonal to the filters, which decide which files are counted rather than what counting means.

Every measure name is also a numeric `FileRow` field, so the aggregator applies one by indexing a row rather than by branching, and `parseViewRequest` validates the name against `MEASURES` before it reaches an index expression.
`ScanIndex.weightPrefix` holds one running-total array per measure, so an unfiltered folder baseline stays a single subtraction whichever measure is active.

On the wire the measured quantity is `weight`, never `tokens`.
`ViewResponse` echoes the measure back, so a label in the client cannot disagree with the numbers beside it while a newer request is still in flight.

### Line counting

Slopsplorer does its own line classification.
It does not shell out to `cloc`, and `cloc` is not a dependency.

`lines` is non-blank lines only.
`lines === codeLines + commentLines`, and the three buckets are mutually exclusive, matching the convention `cloc` uses.
A line that holds code plus a trailing comment counts as code.
Comment spans come from the grammar, not from a leading-marker guess, so block comments and doc comments need no per-language rules.
Python docstrings count as comment, because Python has no block-comment syntax and docstrings carry the weight that `/* */` carries elsewhere.

## Conventions

- No em dashes anywhere. Plain `-`.
- Comments explain why, not what. Doc comments on exported symbols and on non-obvious logic only.
- In Markdown and long comments, one sentence per line. Do not wrap inside a sentence.
- Relative imports carry the `.ts` / `.tsx` extension. `tsc` rewrites them on emit.
- Strict TypeScript, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Descriptive names. No abbreviations.

## Dependencies

Runtime dependencies are pinned exactly.
They total four packages, and none of them has a transitive dependency.

| Package | Why |
| --- | --- |
| `gpt-tokenizer` | `cl100k_base` and `o200k_base` counting, in pure TypeScript |
| `web-tree-sitter` | WASM parser runtime |
| `@vscode/tree-sitter-wasm` | 13 prebuilt grammars, no native build |
| `ignore` | `.gitignore` semantics when walking a non-Git folder |

Pin every dependency to an exact version that is at least four days old.
Check the registry rather than writing a version from memory.
Do not bump a version without a reason.

## Releasing

A release is one tag.
`.github/workflows/release.yml` runs the checks, publishes to npm, and opens the GitHub release.
Towncrier owns both `CHANGELOG.md` and the GitHub release notes.
Every user-facing change must add one file under `newsfragments/` named `<issue-or-commit>.<type>.md`.
Use `feature`, `bugfix`, `doc`, or `misc`, and write one concise sentence for users.
Towncrier and its runtime dependencies are pinned in `.github/workflows/release.yml`; use Towncrier 25.8.0 when building the changelog locally.

1. Bump `version` in `package.json` and `package-lock.json`.
2. Run `towncrier build --version X.Y.Z --keep` so `CHANGELOG.md` is updated while the fragments remain available to the tagged workflow.
3. Commit and push the version, changelog, and fragments.
4. Tag that exact commit with `vX.Y.Z` and push the tag.
5. After the release workflow succeeds, remove the consumed fragments and commit that cleanup to `main`.

The workflow refuses to publish when the tag and the manifest version disagree, so step 1 cannot be skipped.
The workflow compiles its release body from the fragments in the tagged commit rather than from Git commit subjects.

Authentication is npm trusted publishing over OIDC.
No npm token exists in this repository, and none should ever be added.
The registry mints a short-lived token for this one workflow, and it signs a provenance attestation that ties the tarball to the commit that produced it.
The trusted publisher is configured once, in the package's npm access settings, against this repository and `release.yml`.

Both workflows are written to survive a hostile pull request.
CI triggers on `pull_request`, never `pull_request_target`, so a fork's code runs with a read-only token and no secrets.
The release workflow triggers only on a version tag, which only an account with write access can push.
Every action is pinned to a commit rather than to a movable tag, and `npm ci --ignore-scripts` keeps a dependency from running code during install.

## Known limits

Scanning is single-threaded.
A scan of a 1,300-file repository takes about three seconds.
A worker pool would help on very large trees, and has not been needed yet.

The scan happens at startup, and again when you press Rescan.
There is no filesystem watcher.
