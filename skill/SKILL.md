---
name: slopsplorer
description: Map where a repository's token weight actually sits, so you can budget context, pick what to exclude from an agent's window, and spot bloated, comment-padded, or AI-generated bulk before planning a refactor or a review.
---

# Slopsplorer

Slopsplorer measures a source tree by tokenizer weight and serves the result as a local, read-only browser UI.
Reach for it when the question is "where is the mass?" rather than "is this code any good?".

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
A file outside those grammars still gets accurate `tokens`, `lines`, and `blankLines`, but `functions`, `classes`, and `branches` are all `0` and `language` is `null`.
For YAML, TOML, SQL, Prisma, and JSONC the comment split falls back to leading-marker detection; for Markdown and JSON it reports zero comment lines, because a Markdown paragraph is content rather than commentary.

## What it does not measure

Token weight is a proxy for review surface and agent context cost.
It is not a measure of cyclomatic complexity, coupling, correctness, or code quality.
A 30,000-token vendored dataset and a 30,000-token core module weigh the same here and are not the same problem.

`branches` is a raw count of decision nodes per file, not a per-function cyclomatic complexity score, and it is not comparable across languages because each grammar names its constructs differently.
A high `commentLines:codeLines` ratio is a signal worth looking at, not a verdict: a well-documented public API and a model-generated file that narrates every line both score high.
Nothing is inferred from file content, so `generated` detection is a path-and-name convention check that will miss generated files with ordinary names.

Use it to decide where to look.
Do not quote its numbers as a quality judgement.

## Running it

```bash
npx slopsplorer /path/to/repo
```

It prints a loopback URL, serves the UI there, and keeps running until interrupted.

| Flag | Effect |
| --- | --- |
| `--port <n>` | Bind a specific port instead of the default. |
| `--all-files` | Walk the filesystem and ignore `.gitignore` entirely. Use it to see what the default view is hiding. |
| `--exclude <dir>` | Skip a directory by name, anywhere in the tree. Repeatable. |
| `--tokenizer cl100k_base\|o200k_base` | `cl100k_base` is the default and is a reasonable proxy for Claude's context cost. `o200k_base` matches GPT-4o. |
| `--dev` | Development mode for working on Slopsplorer itself. Not useful for analysing another repo. |

By default, inside a Git worktree, the file list comes from the Git index plus untracked non-ignored files.
Outside a Git worktree the walker applies `.gitignore` itself.
Either way, ignored build output, dependencies, and caches stay out of the map, so the picture reflects the project rather than its `node_modules`.
`node_modules`, `.venv`, `dist`, `target`, `vendor`, `__pycache__`, and similar directories are excluded structurally as well.

## Reading the UI

- The visibility switches separate `code`, `test`, `text`, `i18n`, `data`, `other`, and `generated`. Turning one off removes that weight from every total.
- The folder and `(files)` checkboxes narrow the analytical scope. They are independent of expanding the tree, so you can exclude a folder without collapsing it.
- The percentage baseline is the whole non-generated project. It stays fixed while you filter, so shares remain comparable between two views.
- The ranked file list sorts by any single metric and reports the total number of matches before the display limit, so a truncated list still tells you how many files qualified.

## Recipes

**Find what will eat the context budget before planning a refactor.**
Scan the repo, leave every switch on, and read the top-level ribbon.
Note the two or three folders holding most of the weight, then open each one and check whether the weight is a few large files or a long tail.
A few large files means the refactor is tractable in one pass; a long tail means you need to work folder by folder.

**Find comment-padded or model-generated bulk.**
Turn off `test`, `data`, `i18n`, and `generated` so only hand-written code and prose remain.
Rank files by `commentLines`, then compare each result's `commentLines` against its `codeLines`.
Files where commentary approaches or exceeds code, especially with a low `functions` count, are the ones to open.
Genuine API documentation clusters in a few public modules; narrated bulk is spread evenly across a whole directory.

**Check whether tests or a translation catalogue are inflating the apparent size.**
Read the selected token total with everything on, then turn off `test` alone and read it again.
Repeat for `i18n`, `data`, and `generated`.
The differences tell you how much of the "size of this project" is actually suite, catalogue, fixture, or machine output.
A project that looks unreviewable at 900k tokens is often 300k of code once the catalogue and the lockfiles are set aside.

**Decide what to keep out of an agent's context.**
Start from the code-only view, exclude the folders that are large and irrelevant to the task, and read the remaining total.
If it fits the window, the excluded folder names are your ignore list.
If it does not, rank the survivors by `tokens` and decide which files to summarise rather than include.

**Sanity-check an unfamiliar repository before touching it.**
Compare the default view against `--all-files`.
A large gap means significant material is gitignored, which is normal for build output and suspicious for anything else.

## Safety

Slopsplorer is read-only and never writes to the scanned tree.
The server binds to loopback by default.
It serves only files that were accepted into the scan snapshot taken at startup, so it cannot be used to read arbitrary paths, and source previews are size-capped.
