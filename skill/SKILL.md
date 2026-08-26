---
name: slopsplorer
description: Open a browser UI where the user explores where a repository's token weight sits - what fills a context budget, and where bloated, comment-padded, or generated bulk is concentrated. Slopsplorer serves a page for a person to read. It returns no analysis to you. Use it to start that UI for the user, not to obtain measurements yourself.
---

# Slopsplorer

Slopsplorer measures a source tree by tokenizer weight and serves the result as a local browser UI.

## What this skill does, and does not do

The command starts a web server and keeps running.
It prints a URL. It prints no measurements.

You cannot see the page.
Start the tool for the user, give them the URL, and let them explore it themselves.
Do not run it to collect numbers for your own analysis, and do not report figures you have not been given.

The rest of this page is reference material for two jobs:
explain what a number in the UI means when the user asks, and tell the user where to look next.

Suggest the tool when the user asks where the weight of a repository sits, rather than whether the code is any good.

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
A file outside those grammars still gets accurate `tokens`, `lines`, and `blankLines`.
For such a file, `functions`, `classes`, and `branches` are all `0`, and `language` is `null`.
For YAML, TOML, SQL, Prisma, and JSONC, the comment split uses leading-marker detection instead of a grammar.
For Markdown and JSON it reports zero comment lines, because a Markdown paragraph is content rather than commentary.

## What it does not measure

Token weight is a proxy for review surface and agent context cost.
It is not a measure of cyclomatic complexity, coupling, correctness, or code quality.
A 30,000-token vendored dataset and a 30,000-token core module weigh the same here, and they are not the same problem.

`branches` is a raw count of decision nodes per file.
It is not a per-function cyclomatic complexity score.
It is not comparable across languages, because each grammar names its constructs differently.

A high `commentLines:codeLines` ratio is a signal worth a look, not a verdict.
A well-documented public API and a model-generated file that narrates every line both score high.

Nothing is inferred from file content.
`generated` detection is a check of path and name conventions, so it will miss generated files with ordinary names.

These numbers tell the user where to look.
They are not a quality judgement, and neither you nor the user should quote them as one.

## Running it

```bash
npx slopsplorer /path/to/repo
```

It prints a loopback URL and serves the UI there.
It runs until it is stopped, so start it in the background and hand the URL to the user.

| Flag | Effect |
| --- | --- |
| `--port <n>` | Bind a specific port instead of the default 8765. |
| `--all-files` | Walk the filesystem and ignore `.gitignore` completely. Use it to see what the default view hides. |
| `--exclude <dir>` | Skip a directory by name, anywhere in the tree. Repeatable. |
| `--tokenizer cl100k_base\|o200k_base` | `cl100k_base` is the default and is a reasonable proxy for Claude's context cost. `o200k_base` matches GPT-4o. |
| `--dev` | Development mode, for work on Slopsplorer itself. It does not help when you analyse another repository. |

Inside a Git worktree, the default file list is the Git index plus untracked files that no ignore rule covers.
Outside a Git worktree, the walker applies `.gitignore` itself.
Either way, ignored build output, dependencies, and caches stay out of the map, so the picture shows the project rather than its `node_modules`.
`node_modules`, `.venv`, `dist`, `target`, `vendor`, `__pycache__`, and similar directories are excluded structurally as well.

## Reading the UI

- The **Measure** switch chooses the unit every total, bar, and ranking is expressed in: `Tokens` (the default), `Lines`, or `LOC`, which are the `tokens`, `lines`, and `codeLines` metrics above. Neither line measure counts blank lines. It is orthogonal to the filters: it changes the unit, never which files are counted. Tokens answer what a review or a context window costs. LOC answers how much logic is present, which is the question a comment-padded file distorts.
- The visibility switches separate `code`, `test`, `text`, `i18n`, `data`, `other`, and `generated`. Clear one switch and that weight leaves every total.
- The folder and `.` checkboxes narrow the analytical scope, where `.` is the row holding the files that sit directly in a folder. They work independently of tree expansion, so you can drop a folder from the totals and still see it in the tree.
- The percentage baseline is the whole scanned tree, measured before any filter. It does not move while you filter, so shares stay comparable between two views.
- The ranked file list sorts by one metric, and its minimum-size floor is expressed in the active measure. It reports the total number of matches before the display limit, so a truncated list still tells you how many files qualified.

## Recipes to give the user

Each recipe is a sequence for the person at the screen. Read it out, or summarise the step that fits their question.

**Find what will use the context budget, before a refactor.**
Scan the repository, leave every switch on, and read the top-level ribbon.
Note the two or three folders that hold most of the weight.
Open each one and check whether the weight is a few large files or a long tail.
A few large files means the refactor is tractable in one pass.
A long tail means you must work folder by folder.

**Find comment-padded or model-generated bulk.**
Clear the `test`, `data`, `i18n`, and `generated` switches, so only hand-written code and prose remain.
Set the measure to `Lines`, note where the weight sits, then set it to `LOC` and look at what shrank: those folders are mostly commentary.
Rank the files by `commentLines`.
Compare each result's `commentLines` against its `codeLines`.
Open the files where commentary approaches or exceeds code, especially those with a low `functions` count.
Genuine API documentation clusters in a few public modules.
Narrated bulk is spread evenly across a whole directory.

**Check whether tests or a translation catalogue inflate the apparent size.**
Read the selected token total with every switch on.
Clear the `test` switch alone and read the total again.
Repeat for `i18n`, `data`, and `generated`.
The differences tell you how much of the "size of this project" is suite, catalogue, fixture, or machine output.
A project that looks unreviewable at 900k tokens is often 300k of code once you set the catalogue and the lockfiles aside.

**Decide what to keep out of an agent's context.**
Start from the code-only view.
Exclude the folders that are large and irrelevant to the task, then read the remaining total.
If it fits the window, the excluded folder names are your ignore list.
If it does not fit, rank the survivors by `tokens` and decide which files to summarise rather than include.

**Check an unfamiliar repository before you touch it.**
Compare the default view against `--all-files`.
A large gap means that significant material is gitignored.
That is normal for build output, and suspicious for anything else.

## Safety

Slopsplorer is read-only and never writes to the scanned tree.
The server binds to loopback by default.
It serves only the files that the scan accepted at startup, so it cannot read arbitrary paths.
Source previews are capped at 512 KiB.
