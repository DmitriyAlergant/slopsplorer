# Slopsplorer

Slopsplorer is a local, read-only map of where the weight of a codebase actually sits.

Point it at a repository and it measures every file by tokenizer weight, line composition, and structure, then lets you carve the tree down until the number matches what you can actually hold in review, or in an agent's context window.

```bash
npx slopsplorer /path/to/repository
```

Then open <http://127.0.0.1:8765>.

Token weight is a proxy for review surface and agent context cost.
It is not a measure of cyclomatic complexity, and it is not a quality score.
A large file is not a bad file; it is an expensive one.

## What it measures

Per file:

| Metric | Notes |
| --- | --- |
| `tokens` | `cl100k_base` by default, or `o200k_base` |
| `lines` | Non-blank lines only, so `lines = codeLines + commentLines` |
| `codeLines` / `commentLines` | Mutually exclusive. Code with a trailing comment counts as code |
| `functions` / `classes` / `branches` | From tree-sitter, across 13 languages |

Structure metrics come from prebuilt WASM grammars for Python, TypeScript, TSX, JavaScript, Go, Rust, Java, Ruby, C/C++, C#, PHP, Bash, and PowerShell.
Files outside those languages still get token and line counts, and report zero structure counts rather than guessing.

Comment spans come from the grammar rather than a leading-`#` heuristic, so block comments and doc comments are counted correctly.
Python docstrings count as comment, since Python has no block-comment syntax.

Files are sorted into flavors you can switch on and off independently: code, tests, docs, i18n catalogues, structured data, and configuration, with generated output tracked separately.
Turning tests off is usually the fastest way to find out whether a project is actually as large as it looks.

## What it shows

- **A mass ribbon** across the top: the whole scope as one bar, split by top-level folder, shaded darkest-first by rank. Click a segment to drill in.
- **A source tree** where each row carries a bar showing its share of its parent, so weight is visible before you read the number.
- **Folder cards** showing how a folder divides among its children, with each card's composition bar scaled to the folder rather than to the project.
- **A ranked file list** for the current scope, sortable by any metric. A dot marks files whose lines are mostly commentary, a common shape for generated bulk.
- **Read-only source previews**, capped at 512 KiB.

Folder and `(files)` checkboxes narrow the analytical scope independently from tree expansion, so you can exclude a vendored subtree from the totals without collapsing it out of view.

## Options

```bash
slopsplorer <path>              # defaults to the current folder
  --port 9000                   # default 8765, use 0 for any free port
  --host 0.0.0.0                # default 127.0.0.1
  --all-files                   # walk the filesystem and ignore .gitignore
  --exclude vendor              # exclude a directory name, repeatable
  --tokenizer o200k_base        # default cl100k_base
  --open                        # open a browser on start
  --dev                         # Vite HMR, for working on Slopsplorer itself
```

Inside a Git worktree the file list comes from the Git index, so ignored dependencies and build output never distort the map.
Outside one, the walker applies `.gitignore` itself, so a plain folder behaves the same way.
`--all-files` opts out of both.

## Agent skill

Slopsplorer ships an agent skill that teaches a coding agent when to reach for it and how to read its output.
The **Install agent skill** button in the interface hands you a command to run; it installs nothing on its own.

The skill goes to `~/.agents/skills/slopsplorer`, with a symlink from `~/.claude/skills/slopsplorer`, so any agent tool can find it.

## Safety

The server binds to loopback by default and is read-only.
It serves only files that were part of the scan, and refuses any path outside it.
Source previews are capped at 512 KiB.

## Development

See [AGENTS.md](AGENTS.md).

```bash
npm install
npm run dev      # scan the current folder, serve with HMR
npm test
```

## License

MIT
