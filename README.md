# Slopsplorer

Slopsplorer is a local, read-only map of where the weight of a codebase sits.

Point it at a repository.
It measures every file by tokenizer weight, line composition, and structure.
You then narrow the tree until the total matches what you can hold in a review, or in an agent's context window.

![Slopsplorer reading its own repository: a mass ribbon split by top-level folder, a source tree where every row carries its share of its parent, folder cards, and a ranked file table.](https://raw.githubusercontent.com/DmitriyAlergant/slopsplorer/main/docs/screenshot.png)

*Slopsplorer reading its own source tree.*

```bash
npx slopsplorer /path/to/repository
```

Slopsplorer opens <http://127.0.0.1:8765> in your default browser when the scan finishes.
Install it with `npm install -g slopsplorer` if you use it often.

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
Shell scripts reach the Bash grammar by extension (`.sh`, `.bash`, `.ksh`, `.bats`, `.zsh`) or by their `#!` line.
Files outside those languages still get token and line counts.
They report zero structure counts rather than a guess.

Comment spans come from the grammar wherever there is one, so block comments and doc comments are counted correctly.
Python docstrings count as comment, because Python has no block-comment syntax.

Formats with no grammar use a comment-marker table instead, covering YAML, TOML, SQL, Prisma, JSONC, CSS, SCSS, LESS, HTML, XML, SVG, Vue, Svelte, Lua, Kotlin, Swift, Scala, Dart, Terraform, INI, `.env`, `Dockerfile`, `Makefile`, and more.
It reads block comments across lines and ignores markers inside string literals.
Markdown and JSON report no comment lines on purpose, because a Markdown paragraph is content rather than commentary and JSON has no comment syntax.
A format with no rule at all reports its content as code, so no file with content is ever reported as empty.

Files are sorted into flavors that you can show or hide independently: code, tests, docs, i18n catalogues, structured data, and configuration.
Generated output is tracked separately.
Hiding the tests is usually the fastest way to find out whether a project is as large as it looks.

## The primary measure

Tokens are the default unit, and the **Measure** switch changes it to lines.

| Measure | Counts |
| --- | --- |
| Tokens | Tokenizer weight for the whole file, comments and whitespace included |
| Lines | Every line with content, comment lines included |
| LOC | Lines of code: content lines that are not entirely comment |

Neither line measure counts blank lines.

The switch is orthogonal to every filter.
It changes the unit on every total, every bar, and the ranking, and never changes which files are counted.
Tokens answer what a review or a context window will cost.
LOC answers how much logic is actually there, which is the question a comment-padded file distorts.

## What it shows

- **A mass ribbon** across the top: the whole scope as one bar, split by top-level folder, shaded darkest-first by rank. Click a segment to drill in.
- **A source tree** where each row carries a bar showing its share of its parent, so weight is visible before you read the number.
- **Folder cards** showing how a folder divides among its children. Each card's composition bar is scaled to the folder rather than to the project.
- **A ranked file list** for the current scope, sortable by any metric, with a floor expressed in the active measure. A dot marks files whose lines are mostly commentary, a common shape for generated bulk.
- **Read-only source previews**, capped at 512 KiB.

The folder and `.` checkboxes narrow the analytical scope, where `.` is the row holding the files that sit directly in a folder.
They work independently of tree expansion, so you can drop a vendored subtree from the totals and still see it in the tree.

## Options

```bash
slopsplorer <path>              # defaults to the current folder
  --port 9000                   # default 8765, use 0 for any free port
  --host 0.0.0.0                # default 127.0.0.1
  --all-files                   # walk the filesystem and ignore .gitignore
  --exclude vendor              # exclude a directory name, repeatable
  --tokenizer o200k_base        # default cl100k_base
  --no-open                     # do not open a browser on start
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

[AGENTS.md](AGENTS.md#releasing) also describes how a release reaches npm.

## License

MIT
