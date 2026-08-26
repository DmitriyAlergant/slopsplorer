# Slopsplorer

Slopsplorer is a local, read-only map of where the weight of a codebase sits.

Point it at a repository.
It measures every file by tokenizer weight, line composition, and structure.
You then narrow the tree until the total matches what you can hold in a review, or in an agent's context window.

```bash
npx slopsplorer /path/to/repository
```

Then open <http://127.0.0.1:8765>.

Token weight is a proxy for review surface and agent context cost.
It is not a measure of cyclomatic complexity, and it is not a quality score.
A large file is not a bad file.
It is an expensive one.

## What it measures

Per file:

| Metric | Notes |
| --- | --- |
| `tokens` | `cl100k_base` by default, or `o200k_base` |
| `lines` | Non-blank lines only, so `lines = codeLines + commentLines` |
| `codeLines` / `commentLines` | Mutually exclusive. Code with a trailing comment counts as code |
| `functions` / `classes` / `branches` | From tree-sitter, across 13 languages |

Structure metrics come from prebuilt WASM grammars for Python, TypeScript, TSX, JavaScript, Go, Rust, Java, Ruby, C/C++, C#, PHP, Bash, and PowerShell.
Files outside those languages still get token and line counts.
They report zero structure counts rather than a guess.

Comment spans come from the grammar, not from a leading-`#` heuristic, so block comments and doc comments are counted correctly.
Python docstrings count as comment, because Python has no block-comment syntax.

Files are sorted into flavors that you can show or hide independently: code, tests, docs, i18n catalogues, structured data, and configuration.
Generated output is tracked separately.
Hiding the tests is usually the fastest way to find out whether a project is as large as it looks.

## What it shows

- **A mass ribbon** across the top: the whole scope as one bar, split by top-level folder, shaded darkest-first by rank. Click a segment to drill in.
- **A source tree** where each row carries a bar showing its share of its parent, so weight is visible before you read the number.
- **Folder cards** showing how a folder divides among its children. Each card's composition bar is scaled to the folder rather than to the project.
- **A ranked file list** for the current scope, sortable by any metric. A dot marks files whose lines are mostly commentary, a common shape for generated bulk.
- **Read-only source previews**, capped at 512 KiB.

The folder and `(files)` checkboxes narrow the analytical scope.
They work independently of tree expansion, so you can drop a vendored subtree from the totals and still see it in the tree.

## Options

```bash
slopsplorer <path>              # defaults to the current folder
  --port 9000                   # default 8765, use 0 for any free port
  --host 0.0.0.0                # default 127.0.0.1
  --all-files                   # walk the filesystem and ignore .gitignore
  --exclude vendor              # exclude a directory name, repeatable
  --tokenizer o200k_base        # default cl100k_base
  --open                        # open a browser on start
  --dev                         # Vite hot reload, for work on Slopsplorer itself
```

Inside a Git worktree the file list comes from the Git index, so ignored dependencies and build output never distort the map.
Outside one, the walker applies `.gitignore` itself, so a plain folder behaves the same way.
`--all-files` disables both.

## Agent skill

Slopsplorer ships an agent skill that teaches a coding agent when to use it and how to read its output.
The **Install agent skill** button in the interface gives you a command to run.
The button itself installs nothing.

The skill goes to `~/.agents/skills/slopsplorer`, with a symlink from `~/.claude/skills/slopsplorer`, so any agent tool can find it.

## Safety

The server binds to loopback by default and is read-only.
It serves only files that were part of the scan, and refuses any path outside it.
Source previews are capped at 512 KiB.

## Development

See [AGENTS.md](AGENTS.md) for the architecture and the conventions.

```bash
npm install
npm run dev      # scan the current folder and serve it with hot reload
npm test
```

`npm run dev` needs Node 22.18 or later, because it runs the TypeScript sources directly.
A published install runs the compiled output and needs only Node 20.19.

## License

MIT
