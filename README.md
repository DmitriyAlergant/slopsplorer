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

![Slopsplorer reading its own repository: a measure switch and flavor filters above a source tree, a folder panel that holds the folder totals, the share cards, and the heaviest files, then the whole-project readouts and the mass ribbon.](https://raw.githubusercontent.com/DmitriyAlergant/slopsplorer/main/docs/screenshot.png)

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
slopsplorer f53f4f9eb          # just that commit, against its parent
slopsplorer v1.4 v1.5          # any two revisions
slopsplorer --pr 619           # a pull request, fetched from the remote first
```

An argument that names an existing folder is a path.
Anything else is a revision.
A named revision is a place to measure from, so it compares against the working tree.
A pasted commit is that commit alone, against its parent, which is what a sha copied out of a log or a review page means.
Write `<rev>^!` for one commit when a name points at it.
`-C <dir>` points at a repository elsewhere.
On the page, a picker on each side switches the comparison to any other branch, tag, or commit.

## Reviewing a pull request

```bash
slopsplorer --pr 619
slopsplorer https://github.com/owner/repo/pull/619
slopsplorer https://gitlab.com/group/project/-/merge_requests/42
```

A squash merge deletes the branch and keeps none of its commits, so nothing local holds the change any more.
`--pr` fetches it from the remote, works out the commit it was written against, and opens that.
It reads the same range the forge shows, including a request raised against a release line rather than against the default branch.

It needs `gh` or `glab` installed and signed in.
That is the only way to learn which branch a request is against: Git holds both branches and no record that they were ever proposed against each other.
No other command reaches the network.

## Walking the commits

A band above the filters lists the commits the comparison spans, with what each one added and removed.

Click one to see that commit alone, shift-click to take a run of them, or step with `[` and `]`.
Everything the band can select is one comparison of two commits, so there is no mode to keep track of: one commit, the first six, the middle four, or the whole change.

The band answers to no filter, because it is the frame the review happens inside.
Generated files stay out of it, so one regenerated lockfile cannot flatten every other commit.
It opens shut, and shut it still says where you are and still steps.

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
The file table shows 100 matches on each page and provides previous and next controls.
`Read all`, above the file table, opens every matching file in one scrolling page, in path order, so a change reads end to end like a review.
Each file there folds away on its own, and the same switch hides the unchanged lines across all of them.

![Slopsplorer's file comparison for src/shared/api.ts: two line-number columns, removed lines in red, added lines in green, and a fold strip for seven unchanged lines above.](https://raw.githubusercontent.com/DmitriyAlergant/slopsplorer/main/docs/screenshot-file-comparison.png)

*One file inside the comparison, changed lines only.*

## Export a static snapshot

Write the complete explorer as a static folder instead of keeping a local server alive:

```bash
slopsplorer --export ./site
slopsplorer --export ./branch-review main...HEAD
slopsplorer --export ./pr-619 https://github.com/owner/repo/pull/619
```

The command scans once, writes the interactive bundle, prints its absolute path, and exits.
The static page keeps the filters, measures, tree controls, drilling, rankings, linked URL state, and source or diff previews.
When a full GitHub pull request or GitLab merge request URL names the comparison, the snapshot header links back to that review page.
It is a frozen snapshot, so it cannot rescan, open another folder, change the comparison, or run a local coding agent.
The commit band is present but read-only.

The destination can be missing or empty, and a non-empty destination is refused without changing it.
Invalid comparison input and scan failures do not create a missing destination.
A marker in the bundle keeps an export inside the source tree out of later scans.
Assets and data use relative URLs, so the folder can be served at a domain root or below a path prefix by any static HTTP server.
The bundle contains every accepted source preview, so protect or distribute the output as you would the repository itself.

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
- **The tree checkboxes** drop a folder from every total and from the file table.
- **Drill down** (**double-click**) rescopes the page to one subfolder.
- **This folder / All below** lists the files of the selected folder alone or of everything under it. It moves the file list only, and changes no total.

Click a column heading to sort the file list. The file name sorts A to Z; every other column sorts heaviest first.

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

[docs/scanning-and-classification.md](docs/scanning-and-classification.md) has the full rules: which files enter a scan, how a grammar is chosen, and every deliberate divergence from `cloc`.

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
  --pr 619                      # fetch a pull request and compare it, by number or URL
  --report                      # print a text report and exit, no server
  --export ./site               # write a complete static snapshot and exit
  --unit loc                    # report unit: tokens (default), lines, or loc
  --aspect net                  # report side of a change: churn (default), net, added, removed, after
  --threshold 1                 # report expands a node at this share of its section, default 3
```

Inside a Git worktree the file list comes from the Git index plus untracked files that no ignore rule covers, so dependencies and build output never distort the map.
Outside one, the walker applies `.gitignore` itself, so a plain folder behaves the same way.
`--all-files` disables both.

## Ask an agent about it

The map says where the weight sits, not why it sits there.
If you have Claude Code, Codex, Cursor, or opencode installed, the **Ask** button in the header hands that question to one of them.

Slopsplorer finds them at startup and asks each one whether it is signed in.
The menu names every tool that starts, with its mark and what it answered, and a tool that reports no sign-in can still be asked: the answer comes back, or the card says what the tool complained about.
Nothing is sent anywhere by Slopsplorer: the agent runs on your machine, under your own sign-in, in the folder being measured.

You type the question.
Slopsplorer adds what you have on screen - the scan or the comparison, the drill, the selection, the unit, the flavors counted, and the last file you opened - so the agent starts where you are instead of at the top of the repository.
An answer takes minutes, so the question runs in the background and waits in a card at the corner of the window until it is ready.
Open the card to read the answer, and open **What the agent was told** under it to see exactly what was sent.
Dismissing a card stops the agent and the tools it started.

Each tool is asked in the most restricted mode it offers: `plan` mode for Claude Code, the `read-only` sandbox for Codex, `ask` mode for Cursor, and the `plan` agent for opencode.
The first three cannot write.
What opencode's `plan` agent may do is decided by your own opencode configuration, so check that if it matters to you.

## Agent skill

Slopsplorer ships an agent skill that teaches a coding agent when to reach for it and how to read its output.
The **Install the agent skill** link at the foot of the page gives you a command to run; the link itself installs nothing.
The command copies the skill to `~/.claude/skills/slopsplorer` for Claude Code and to `~/.agents/skills/slopsplorer` for Codex and the other agent tools.
On Windows you get the same command written for PowerShell.

## Safety

The server binds to loopback by default and is read-only.
It serves only files that were part of the scan, and refuses any path outside it.
`--export <dir>` writes every accepted source preview into the output folder and states that before it scans.
Protect or distribute that folder as you would the repository itself.
Your question is passed to an agent as one argument and never through a shell.
Each agent is asked in the most restricted mode it offers, which for three of the four cannot write; see [Ask an agent about it](#ask-an-agent-about-it).

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
