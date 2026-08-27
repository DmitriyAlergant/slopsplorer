---
name: slopsplorer
description: Start a local browser UI where the user explores where a repository's token or LOC weight sits, in a tree or in a change. It serves a page for a person to read and returns no analysis to you. Use it to start that UI for the user, not to obtain measurements yourself.
---

# Slopsplorer

## What it does

Slopsplorer scans a source tree, measures every file by tokenizer weight, line composition, and structure, and serves an interactive map of where the mass sits. Pointed at a Git revision or range instead of a tree, it maps a change the same way: what it added, what it removed, churn and net.

The command starts a web server, prints a URL, and prints no measurements. You cannot see the page.
Start it for the user, hand them the URL, and let them explore. Do not run it to collect numbers, and do not report figures you have not been given.

## Install

Nothing to install for a one-off run:

```bash
npx slopsplorer /path/to/repo
```

For repeated use:

```bash
npm install -g slopsplorer
```

Node 20.19 or later. No native build, no network access after install.

## CLI basics

```bash
slopsplorer                    # scan the current folder
slopsplorer /path/to/repo      # scan a folder elsewhere
slopsplorer --diff             # HEAD against the working tree, untracked included
slopsplorer --staged           # HEAD against the index
slopsplorer main...HEAD        # what a pull request would show
slopsplorer -C ~/src/app v1 v2 # two revisions of a repository elsewhere
```

It serves on <http://127.0.0.1:8765> and runs until stopped, so start it in the background. Outside a terminal the user is watching, pass `--no-open` so it does not try to launch a browser. `slopsplorer --help` lists every flag.
