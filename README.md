# Slopsplorer

Slopsplorer is an interactive codebase explorer focused on mapping where the weight of a codebase sits.

Point it at a repository. It measures every file by tokenizer weight, line composition, and structure, then shows you which folders and which files carry the mass. At any measure (Tokens or LOC), the higher the number the bigger the slop. Sniff where it has accumulated.

```bash
npx slopsplorer /path/to/repository
```

The scan runs, then Slopsplorer opens <http://127.0.0.1:8765> in your default browser.

```bash
# Install it if you use it often
npm install -g slopsplorer

cd vibe-coded-repo
slopsplorer .
```

![Slopsplorer reading its own repository: flavor filters above a source tree and a folder panel, then the headline readouts, the mass ribbon, and the heaviest-files table.](https://raw.githubusercontent.com/DmitriyAlergant/slopsplorer/main/docs/screenshot.png)

*Slopsplorer reading its own source tree.*

## Three ways to filter and narrow-down

They are deliberately different, and they compose.

- **The flavor switches and the search box** decide which files are counted at all.
  - Code
  - Tests
  - Docs
  - i18n
  - Data, Config and Other files
  - Generated files (e.g. lockfiles), default off
- **The tree checkboxes** allow you to selectively exclude certain folders from totals and heavy files summary
- **Drill Down** (**double-click**) focuses the entire explorer to the selected subfolder

## What you see

The page reads downwards. What you choose at the top decides every number below it.

- **Filters** across the top: a path search, and one switch per flavor, with generated output as a switch of its own.
- **A source tree**, where every row carries a bar showing its share of its parent, so weight is visible before you read the number. A `.` row holds the files that sit directly in a folder rather than in a subfolder.
- **A folder panel** beside it, showing how the selected folder divides among its children as cards, then listing its own files. Each card's bar is scaled to the folder rather than to the project.
- **Headline readouts**, then **a mass ribbon**: the current scope as one bar, split by the folders directly inside it and shaded darkest-first by rank. Clicking a segment selects that folder in the panel above.
- **A heaviest-files table** for the current selection, sorted by any column, with a minimum threshold in the active measure. A dot marks a file whose lines are mostly commentary, a common shape for generated bulk.
- **Read-only source previews**, capped at 512 KiB.

## What it counts

Per file:

| Metric | Counts |
| --- | --- |
| `tokens` | Tokenizer weight for the whole file, comments and whitespace included |
| `lines` | Every line with content, comment lines included |
| `codeLines` (LOC) | Content lines that are not entirely comment |
| `commentLines` | Content lines that are. A line of code with a trailing comment counts as code |
| `functions` / `classes` / `branches` | From tree-sitter, across 13 languages |

No line measure counts blank lines, and `lines = codeLines + commentLines` always.

Tokens, Lines, or LOC is the unit every total, bar, and ranking is expressed in.
The unit belongs to the columns that display it, so you choose it there: from the source tree's numbers heading, which is a menu, or by sorting a file table on one of those columns.
Tokens answer what a review or a context window will cost.
LOC answers how much logic is actually there, which is the question a comment-padded file distorts.

Structure counts come from prebuilt WASM grammars for thirteen languages.
A file outside them still gets token and line counts, and reports zero structure rather than a guess.
Comment spans come from the grammar where there is one, and from a marker table covering some fifty other formats where there is not.

Every file gets a flavor you can switch on and off: Code, Tests, Docs, i18n, Data & Config, or Other, with generated output as a switch of its own.
Flavor comes from the file itself before it comes from where the file sits, so a fixture in a test folder is reported as the format it is rather than as test code.

[docs/classification.md](docs/classification.md) has the full rules: which files enter a scan, how a grammar is chosen, and every deliberate divergence from `cloc`.

## Options

```bash
slopsplorer <path>              # defaults to the current folder
  --port 9000                   # default 8765, use 0 for any free port
  --host 0.0.0.0                # default 127.0.0.1
  --all-files                   # walk the filesystem and ignore .gitignore
  --exclude vendor              # exclude a directory name, repeatable
  --tokenizer cl100k_base       # default o200k_base
  --no-open                     # do not open a browser on start
  --dev                         # Vite hot reload, for work on Slopsplorer itself
```

Inside a Git worktree the file list comes from the Git index plus untracked files that no ignore rule covers, so dependencies and build output never distort the map.
Outside one, the walker applies `.gitignore` itself, so a plain folder behaves the same way.
`--all-files` disables both.

## Agent skill

Slopsplorer ships an agent skill that teaches a coding agent when to reach for it and how to read its output.
The **Install agent skill** button gives you a command to run; the button itself installs nothing.
The skill goes to `~/.agents/skills/slopsplorer`, with a symlink from `~/.claude/skills/slopsplorer`, so any agent tool can find it.

## Safety

The server binds to loopback by default and is read-only.
It serves only files that were part of the scan, and refuses any path outside it.

## Development

```bash
npm install
npm run dev      # scan the current folder and serve it with hot reload
npm test
```

`npm run dev` needs Node 22.18 or later, because it runs the TypeScript sources directly.
A published install runs the compiled output and needs only Node 20.19.

[AGENTS.md](AGENTS.md) covers the architecture, the conventions, and [how a release reaches npm](AGENTS.md#changelog-and-releasing).

## License

MIT
