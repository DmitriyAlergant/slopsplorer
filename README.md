# Slopsplorer

Slopsplorer is a local, read-only browser for navigating a source tree by tokenizer-measured weight.
It shows a correct collapsible folder hierarchy, aggregated folder totals, ranked files, structural signals, and on-demand source previews.
Independent visibility switches separate code, known tests, text and Markdown, i18n catalogs, structured data, configuration, and known generated files.
Folder and `(files)` checkboxes narrow the analytical scope independently from tree expansion.
Source previews use vendored Highlight.js `11.11.1`; its license is shipped beside the browser assets.

Token weight is a proxy for review surface and agent context cost, not cyclomatic complexity.
Python files also receive AST-derived function, class, async-function, and branch-node counts.

## Run

Use Python 3.11 or newer.
The tokenizer dependency and its transitive runtime dependencies are fully pinned in `pyproject.toml`.
Every pinned version predates this project by at least four days.

```bash
python -m venv .venv
sfw pip install --python .venv/bin/python .
.venv/bin/slopsplorer /path/to/repository
```

Open `http://127.0.0.1:8765`.

Useful options:

```bash
slopsplorer /path/to/repository --port 9000
slopsplorer /path/to/repository --all-files
slopsplorer /path/to/repository --exclude vendor
```

By default, a Git worktree is scanned through `git ls-files`, so ignored dependencies, build output, and runtime files do not distort the map.
For a non-Git folder, or with `--all-files`, the scanner walks the filesystem and applies built-in directory exclusions.

The HTTP server is intentionally bound to loopback by default.
It exposes only files that were accepted into the startup snapshot, and source previews are capped at 512 KiB.
