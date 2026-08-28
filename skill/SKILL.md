---
name: slopsplorer
description: Map where the weight of a repository or of a change sits, by tokens, lines, or LOC. Run `slopsplorer --report` to read the map as text, start the local browser UI, or use `--export <dir>` to write an interactive static snapshot.
---

# Slopsplorer

## What it does

Slopsplorer scans a source tree and measures every file: tokenizer weight, line composition, and structure.
Pointed at a Git revision or range, it measures a change the same way: what it added, what it removed, churn and net.
It sorts every file into a flavor - code, tests, docs, i18n, data and config - and keeps generated files out of the figures, from the path and the content, with no configuration.

It has three outputs.
`--report` prints a text report to stdout and exits.
Without it, the command starts a local web server for a person, prints a URL, and prints no measurements.
`--export <dir>` writes a frozen static explorer with source previews, prints its path, and exits.

## Install

Nothing to install for a one-off run:

```bash
npx slopsplorer --report
```

For repeated use:

```bash
npm install -g slopsplorer
```

Node 20.19 or later. No native build, no network access after install.

## Read the report

```bash
slopsplorer --report                      # the current folder
slopsplorer --report /path/to/repo        # a folder elsewhere
slopsplorer --report --diff               # HEAD against the working tree, untracked included
slopsplorer --report main...HEAD          # what a pull request would show
slopsplorer --report -C ~/src/app v1 v2   # two revisions of a repository elsewhere
slopsplorer --report --pr 619             # a pull request, fetched from the remote first
```

`--pr <number>` takes a pull request number or the URL of its page, on GitHub or GitLab.
Use it when the change is not in a local branch, which is what a squash merge leaves behind.
It needs `gh` or `glab` signed in, because only the forge knows which branch a request is against, and it is the one command here that uses the network.

The report has one section per flavor.
`CODE` and `TESTS` are trees.
`DOCS`, `I18N`, `DATA & CONFIG`, and `OTHER` are one line each, with their heaviest files.
`GENERATED` is excluded from every figure and listed last.

A node is expanded when it reaches 3% of its section.
An expanded folder lists the children that pass, then one `...` row for the rest, so every level sums to its parent.
A folder that passes with no child that passes prints as a leaf.
Shares inside a section are of that section. Shares in the header are of the whole tree.

To see more of a folder, pass `--threshold 1` or point the command at that folder.
`--unit lines` or `--unit loc` changes the unit.
In a comparison, `--aspect net` (or `added`, `removed`, `after`) changes which side of the change the figures describe. The default is `churn`.

## Start the UI for the user

```bash
slopsplorer /path/to/repo      # a tree
slopsplorer main...HEAD        # a change
slopsplorer --pr 619           # a pull request
```

A comparison of two commits also draws a band of the commits it spans, so the user can read one commit at a time.

It serves on <http://127.0.0.1:8765> and runs until stopped, so start it in the background and give the user the URL.
Outside a terminal the user is watching, pass `--no-open` so it does not try to launch a browser.
`slopsplorer --help` lists every flag.

## Export a static snapshot

```bash
slopsplorer --export ./site
slopsplorer --export ./branch-review main...HEAD
slopsplorer --export ./pr-619 https://github.com/owner/repo/pull/619
```

Use this when the user needs a static artifact and the complete source can be shared with whoever receives it.
The snapshot keeps the interactive tree, filters, rankings, and file previews.
If a full GitHub or GitLab review URL names the comparison, the snapshot links back to it from the header.
It cannot rescan, change the comparison, or ask a local agent, and its commit band is read-only.
Serve the folder through a static HTTP server.
