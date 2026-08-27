---
name: slopsplorer
description: Open a browser UI where the user explores where a repository's token weight sits - what fills a context budget, and where bloated, comment-padded, or generated bulk is concentrated. Slopsplorer serves a page for a person to read and returns no analysis to you. Use it to start that UI for the user, not to obtain measurements yourself.
---

# Slopsplorer

Slopsplorer measures a source tree by tokenizer weight and serves the result as a local browser UI.

## What this skill does, and does not do

The command starts a web server, prints a URL, and prints no measurements.
You cannot see the page.
Start the tool for the user, give them the URL, and let them explore it themselves.
Do not run it to collect numbers for your own analysis, and do not report figures you have not been given.
The rest of this page exists so you can explain what a number in the UI means and tell the user where to look next.

Suggest the tool when the user asks where the weight of a repository sits, rather than whether the code is any good.

## Diff mode

The tool can map a change instead of a tree.
`--diff` compares HEAD against the working tree, untracked files included, `--staged` compares the index, `main...HEAD` maps a branch the way a pull request shows it, and a bare revision compares that revision against the working tree.
In this mode every metric below splits into what the change added and what it removed: churn is their sum and is never negative, net is their signed difference.
The user picks a side in the same menu that picks the unit, and because net is signed the page draws shares against churn and orders by magnitude, so a large deletion ranks as a large change.

## What it measures

For every file that enters the scan it reports:

| Metric | Meaning |
| --- | --- |
| `tokens` | Tokenizer count for the whole file, including comments and whitespace. |
| `lines` | Lines with content, that is `codeLines + commentLines`. Blank lines are excluded. |
| `codeLines` | Non-blank lines that are not entirely comment. A statement with a trailing comment counts here. |
| `commentLines` | Non-blank lines whose whole content is commentary. Python docstrings count as comment. |
| `blankLines` | Whitespace-only lines. |
| `functions` | Function, method, lambda, and arrow-function definitions. |
| `classes` | Class-like declarations: classes, interfaces, enums, structs, traits, records. |
| `branches` | Decision points: `if`, loops, `switch`/`match`, `try`. Nested `else`/`catch` clauses are not double counted. |
| `language` | The tree-sitter grammar that produced the structure counts, or `null`. |

Structure counts come from 13 tree-sitter grammars: `python`, `typescript`, `tsx`, `javascript`, `go`, `rust`, `java`, `ruby`, `cpp`, `c-sharp`, `php`, `bash`, `powershell`.
A file outside those grammars still gets accurate `tokens`, `lines`, and `blankLines`; its `functions`, `classes`, and `branches` are `0`, and `language` is `null`.
Its comment split comes from a comment-marker table that covers some fifty other formats.
Markdown and JSON report zero comment lines, and a format with no rule at all reports its content as `codeLines`, so a file with content is never reported as empty.

## What it does not measure

Token weight is a proxy for review surface and agent context cost.
It is not a measure of cyclomatic complexity, coupling, correctness, or code quality.
A 30,000-token vendored dataset and a 30,000-token core module weigh the same here, and they are not the same problem.

`branches` is a raw count of decision nodes per file, not a per-function cyclomatic complexity score, and it is not comparable across languages.

A high `commentLines:codeLines` ratio is a signal worth a look, not a verdict.
A well-documented public API and a model-generated file that narrates every line both score high.

Nothing is inferred from file content.
`generated` detection is a check of path and name conventions, so it will miss generated files with ordinary names.

These numbers tell the user where to look.
They are not a quality judgement, and neither you nor the user should quote them as one.

## Running it

```bash
npx slopsplorer /path/to/repo                    # map a tree
npx slopsplorer -C /path/to/repo main...HEAD     # map a change
```

It prints a loopback URL and serves the UI there.
It runs until it is stopped, so start it in the background and hand the URL to the user.
`npx slopsplorer --help` lists every flag.

Inside a Git worktree the file list is the Git index plus untracked files that no ignore rule covers; outside one the walker applies `.gitignore` itself, and `--all-files` disables both.
`node_modules`, `.venv`, `dist`, `target`, `vendor`, `__pycache__`, and similar directories are excluded structurally as well.

## Reading the UI

- The **Measure** switch picks the unit for every total, bar, and ranking: `Tokens` (the default), `Lines`, or `LOC`, none of which counts blank lines. It changes the unit, never which files are counted. Tokens answer what a review or a context window costs; LOC answers how much logic is present.
- The visibility switches separate `code`, `test`, `text`, `i18n`, `data`, `other`, and `generated`. Clear one switch and that weight leaves every total.
- The folder and `.` checkboxes narrow the scope, where `.` is the row holding the files that sit directly in a folder.
- The percentage baseline is the whole scanned tree before any filter, so shares stay comparable between two views.
- The ranked file list sorts by one metric, floors at a minimum size in the active measure, and reports the match count before its display limit.

## Recipes to give the user

- Context budget before a refactor: leave every switch on, read the top-level ribbon, and check whether each heavy folder is a few large files or a long tail.
- Comment-padded bulk: clear `test`, `data`, `i18n`, and `generated`, compare `Lines` against `LOC`, then rank by `commentLines` and open the files where commentary approaches code.
- Apparent-size inflation: clear `test`, `i18n`, `data`, and `generated` one at a time and read how much the total drops.
- An agent's ignore list: start from the code-only view, exclude the folders irrelevant to the task, and read the remaining total.
- An unfamiliar repository: compare the default view against `--all-files`; a large gitignored gap is normal for build output and suspicious for anything else.

## Safety

Slopsplorer is read-only and never writes to the scanned tree.
The server binds to loopback by default.
It serves only the files that the scan accepted at startup, so it cannot read arbitrary paths.
Source previews are capped at 512 KiB.
