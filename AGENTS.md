# Working on Slopsplorer

Slopsplorer scans a source tree, measures every file, and serves an interactive map of where the weight sits.
It is a single Node process: a scanner, an aggregator, a small HTTP server, and a React client.

## Commands

```bash
npm install          # installs 4 runtime deps and the build toolchain
npm run dev          # scan the current folder and serve it with Vite HMR on :8765
npm run build        # vite build (client) then tsc (server + CLI)
npm test             # vitest
npm run typecheck    # both TypeScript projects, no emit
```

`npm run dev` runs the real server with Vite in middleware mode, so the API and the client share one port and one process.
Editing anything under `src/web/` hot-reloads.
Editing anything under `src/scanner/` or `src/server/` needs a restart, because the scan happens at startup.

## Architecture

The data flows one way, and every aggregation happens on the server.

```
src/scanner/     walk -> classify -> tokenize + tree-sitter -> ScanIndex
src/server/      ScanIndex + ViewRequest -> buildView -> ViewResponse
src/web/         ViewRequest state -> POST /api/view -> render
src/shared/      the wire contract both sides import
```

`src/shared/api.ts` is the contract.
Change it and both sides must change together; it is the only file both projects import.

### Why the server aggregates

An earlier version shipped the whole file list to the browser and did the filtering there.
That cost roughly 363 bytes per file on the wire, about 7 MiB for a twenty-thousand-file repository, and it recomputed folder totals on every keystroke.
Now the client sends a `ViewRequest` describing the scope it wants and renders the `ViewResponse` it gets back.
The browser never sees a file it is not displaying.

### Why files are sorted by path

`ScanIndex.files` is sorted, which makes every folder's descendants a contiguous range.
`FolderNode.start` and `FolderNode.end` bound that range, so aggregating a subtree is a slice rather than a scan of the project.
The trick depends on the sort: any string beginning `a/b/` sorts between `a/b/` and `a/b0`, because `0` is the next code point after `/`.
`tests/scan.test.ts` pins this with sibling directories whose names share a prefix.

### Structure metrics

`src/scanner/structure.ts` holds an explicit table of tree-sitter node types per grammar.
It is deliberately explicit rather than pattern-matched: these counts are the product's output, so a reader has to be able to check exactly what was counted.
Grammars load lazily, so scanning a pure-Python repository never initialises the Rust parser.
Thirteen grammars ship prebuilt as WASM in `@vscode/tree-sitter-wasm`, which is why there is no native compilation step and `npx slopsplorer` works on any platform.

Files outside those grammars still get token and line counts, and report `language: null` with zero structure counts.

### Line counting

`lines` is non-blank lines only.
`lines === codeLines + commentLines`, and the three buckets are mutually exclusive, matching the convention `cloc` uses.
A line holding code plus a trailing comment counts as code.
Comment spans come from the grammar, not from a leading-marker guess, so block comments and doc comments are handled without per-language rules.
Python docstrings count as comment, because Python has no block-comment syntax and docstrings carry the weight that `/* */` carries elsewhere.

## Conventions

- No em dashes anywhere. Plain `-`.
- Comments explain why, not what. Doc comments on exported symbols and on non-obvious logic only.
- In Markdown and long comments, one sentence per line. Do not wrap inside a sentence.
- Relative imports carry the `.ts` / `.tsx` extension. `tsc` rewrites them on emit.
- Strict TypeScript, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Descriptive names. No abbreviations.

## Dependencies

Runtime dependencies are pinned exactly and total four packages with zero transitive dependencies:

| Package | Why |
| --- | --- |
| `gpt-tokenizer` | `cl100k_base` and `o200k_base` counting, in pure TypeScript |
| `web-tree-sitter` | WASM parser runtime |
| `@vscode/tree-sitter-wasm` | 13 prebuilt grammars, no native build |
| `ignore` | `.gitignore` semantics when walking a non-Git folder |

Pin every dependency to an exact version at least four days old, and check the registry rather than writing a version from memory.
Do not bump without a reason.

## Known limits

Scanning is single-threaded: tokenizing and parsing a 1,300-file repository takes about three seconds.
A worker pool would help on very large trees and has not been needed yet.

The scan is taken at startup and on demand via the Rescan button.
There is no filesystem watcher.
