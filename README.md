# Slopsplorer

![Slopsplorer: a pig explorer in a pith helmet plants a flag on a summit of source files, beside a bar chart of the weight it found.](https://raw.githubusercontent.com/DmitriyAlergant/slopsplorer/main/docs/hero.jpg)

Slopsplorer is an interactive map of where the slop sits in a codebase.

Point it at a repository.
It weighs every file in tokens, lines, and structure, then shows you which folders and which files carry the mass.
Code is slop until proven otherwise, and the bigger the number, the bigger the slop.
Slopsplorer sniffs out where it piled up.

```bash
npx slopsplorer /path/to/repository
```

The scan runs, then Slopsplorer opens <http://127.0.0.1:8765> in your browser.

```bash
# Install it if you use it often
npm install -g slopsplorer

cd vibe-coded-repo
slopsplorer .
```

![Slopsplorer reading its own repository: flavor filters above a source tree and a folder panel, then the headline readouts, the mass ribbon, and the heaviest-files table.](https://raw.githubusercontent.com/DmitriyAlergant/slopsplorer/main/docs/screenshot.png)

*Slopsplorer sniffing its own source tree.*

## Diff mode

The same map, pointed at a change instead of a tree.
How much slop does this branch bring, and where does it land?

```bash
slopsplorer --diff             # HEAD against the working tree, untracked files included
slopsplorer --staged           # HEAD against the index
slopsplorer main...HEAD        # what a pull request would show
slopsplorer HEAD~5             # what the last five commits touched
slopsplorer origin/main        # everything since origin/main, committed or not
slopsplorer v1.4 v1.5          # any two revisions
```

An argument that names an existing folder is a path.
Anything else is a revision.
`-C <dir>` points at a repository elsewhere.
On the page, a picker on each side switches the comparison to any other branch, tag, or commit.

A switch beside the unit picks which side of the change every figure describes:

| Aspect | Means |
| --- | --- |
| **Added** / **Removed** | one side on its own. |
| **Net** | added - removed. What the change leaves behind, signed. The default. |
| **Churn** | added + removed. How much moved, never negative. |
| **After** | the whole file as the change leaves it. |

Net and churn differ for a reason: a rewrite at `+500 / -480` and an addition of `+20` have nearly the same net and are not the same change.
Renames are followed rather than counted twice.

![Slopsplorer in diff mode: the aspect switch set to net, a source tree drawing removed and added bands from a centre axis, and a file table of added, removed, net, churn, and after tokens.](https://raw.githubusercontent.com/DmitriyAlergant/slopsplorer/main/docs/screenshot-diff.png)

*Slopsplorer comparing a release tag against the working tree.*

Click a file for its diff, whole, with the unchanged runs folded.

![Slopsplorer's file comparison for src/shared/api.ts: two line-number columns, removed lines in red, added lines in green, and a fold strip for seven unchanged lines above.](https://raw.githubusercontent.com/DmitriyAlergant/slopsplorer/main/docs/screenshot-file-comparison.png)

*One file inside the comparison, changed lines only.*

## Text report

A coding agent cannot open the page, and it has some slop to answer for.
`--report` prints the same map as text and exits, for a tree or for a change.

```bash
slopsplorer --report                                                    # the current folder, in tokens
slopsplorer --report main...HEAD --unit loc --aspect net --threshold 1   # a pull request, in LOC, net, expanded deep
```

The report has one section per flavor.
Code and tests are walked as a tree.
Docs, data, i18n, and other files get one line each, with their heaviest files.
Generated files are excluded from every figure and reported last.

The walk follows one rule: a node is expanded when it reaches the threshold share of its section, 3% by default.
An expanded folder lists the children that pass the same test, then one `...` row for the rest, so every level sums to its parent.
A folder above the threshold with no child above it prints as a leaf.
To see more, lower the threshold or point the command at a subfolder.

```
CODE  99k tokens, 48 files, 17% comment
./                   99k  100%  48 files
  src/               99k  100%  46 files
    web/             48k   49%  31 files
      components/    22k   22%  19 files
      styles.css     15k   15%  1.1k loc
      ... 11 files   12k   12%
    scanner/         23k   24%  10 files
    server/          18k   18%  3 files
    ... 2 files     9.0k    9%
  ... 2 files        191   <1%
```

*Slopsplorer reporting its own source tree at `--threshold 8`.*

## Three ways to narrow the hunt

They do different things, and they compose.

- **The flavor switches and the search box** decide which files count at all.
  - Code
  - Tests
  - Docs
  - i18n
  - Data, Config and Other files
  - Generated files (lockfiles and friends), off by default
- **The tree checkboxes** drop a folder from every total and from the heaviest-files table.
- **Drill down** (**double-click**) rescopes the page to one subfolder.

## What it counts

| Metric | Counts |
| --- | --- |
| `tokens` | Tokenizer weight of the whole file, comments and whitespace included |
| `lines` | Non-blank lines |
| `codeLines` (LOC) | Non-blank lines that are not entirely comment |
| `commentLines` | The rest. `lines = codeLines + commentLines` |
| `functions` / `classes` / `branches` | From tree-sitter, for 13 languages |

Pick one unit at the top of the page: Tokens, Lines, or LOC.
Every total, bar, and ranking uses it.
Tokens tell you what a context window will pay.
LOC tells you how much logic is there, which is the question a comment-padded file dodges.

A file outside the 13 grammars still gets tokens and lines, and reports zero structure rather than a guess.
Comment spans come from the grammar where there is one, and from a marker table for some fifty other formats where there is not.

Every file gets a flavor: Code, Tests, Docs, i18n, Data & Config, or Other, with generated output as a switch of its own.
The file decides its flavor before its folder does, so a fixture in a test folder counts as the format it is, not as test code.

[docs/classification.md](docs/classification.md) has the full rules: which files enter a scan, how a grammar is chosen, and every deliberate divergence from `cloc`.

## Options

```bash
slopsplorer <path>              # defaults to the current folder
  --port 9000                   # exact port, or 0 for any free one
                                # default 8765, moves to the next free port when busy
  --host 0.0.0.0                # default 127.0.0.1
  --all-files                   # walk the filesystem and ignore .gitignore
  --exclude vendor              # exclude a directory name, repeatable
  --tokenizer cl100k_base       # default o200k_base
  --no-open                     # do not open a browser on start
  --dev                         # Vite hot reload, for work on Slopsplorer itself
  --report                      # print a text report and exit, no server
  --unit loc                    # report unit: tokens (default), lines, or loc
  --aspect net                  # report side of a change: churn (default), net, added, removed, after
  --threshold 1                 # report expands a node at this share of its section, default 3
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
