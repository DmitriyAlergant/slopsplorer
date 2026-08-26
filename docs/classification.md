# Classification and measurement heuristics

## Purpose

Every file on the map carries a flavor, a generated flag, a token count, and a line split.
This document states the rules that produce them.

The code is in `src/scanner/`: `walk.ts`, `classify.ts`, `structure.ts`, `lines.ts`, and `tokenize.ts`.
For how those parts fit together, read [architecture.md](./architecture.md).

## Which files enter a scan

A file must pass three checks before it is measured.

1. The listing accepts it.
   Inside a Git worktree the list is `git ls-files --cached --others --exclude-standard`.
   Outside one, the walker reads the tree and applies every `.gitignore` above the file.
   `--all-files` turns both off.
   The filesystem walker does not follow symlinks.
2. `isSourceFile()` accepts it.
   The extension must be in `SOURCE_EXTENSIONS`, and no folder on its path may be in `EXCLUDED_DIRECTORIES`, which holds `node_modules`, `vendor`, `target`, `venv`, `.venv`, and the tool cache folders.
   Build output such as `dist` is not excluded by name.
   Where it is committed, or where `--all-files` is used, it is scanned and marked generated.
   `--exclude <name>` adds more folder names.
3. It is not larger than `--max-file-bytes`, which is 2 MiB by default.

`SOURCE_EXTENSIONS` is an allow list, so a file type that is not in it is invisible to a scan.
Several formats have comment rules in `lines.ts` that a scan never reaches for that reason, among them Terraform, INI, SVG, `Dockerfile`, and every script with no extension.

## Flavors

Six flavors, plus a generated flag that is independent of them.

| Flavor | Holds |
| --- | --- |
| `code` | Source and application code. |
| `test` | Test code. |
| `text` | Markdown and other prose. |
| `i18n` | Translation catalogues and locale files. |
| `data` | Structured data and configuration. |
| `other` | Text files that fit nothing else, such as HTML. |

`generated` is a separate boolean rather than a flavor, so a generated file also keeps its own flavor.
The client draws it as one more switch beside the flavors.

## Path rules, in order

`classifyFile()` in `src/scanner/classify.ts` applies these tests in this order and returns the first match.

1. `.po` or `.pot`, or any folder on the path named `i18n`, `intl`, `lang`, `locale`, `locales`, `translation`, or `translations`: `i18n`.
2. A `.json`, `.yaml`, or `.yml` file whose name is a language code, with an optional region, such as `de-DE.json` or `pt_BR.json`: `i18n`.
   The language codes are an explicit list.
3. A filename that names itself a test: `test_*`, `spec_*`, `*_test.*`, `*_spec.*`, `*.test.*`, `*.spec.*`: `test`.
4. `requirements.txt`, and the data extensions `.csv`, `.json`, `.jsonc`, `.toml`, `.tsv`, `.xml`, `.yaml`, `.yml`: `data`.
5. The prose extensions `.adoc`, `.md`, `.mdx`, `.rst`, `.txt`: `text`.
6. A code extension: `test` if a folder on the path is `__tests__`, `e2e`, `spec`, `specs`, `test`, or `tests`, and `code` otherwise.
7. Everything else: `other`.

### The test folder and the file's own format

A test-shaped filename applies wherever the file sits, and it is read before the extension.
A test folder applies to code extensions only, so a file of another format keeps the flavor of that format.
A JSON fixture in `tests/fixtures/` is `data`, a recorded clipboard payload in `tests/paste/msword_clipboard.html` is `other`, and `tests/utils/websocket_client.py` is `test`.

Hiding the tests therefore leaves the weight of the fixtures beside them on the map.
To remove a whole test folder from the numbers, use the search box or the tree checkboxes.

## The content rule for literal-heavy source

`refineKindByContent()` re-files source code that is a payload rather than logic, such as a translation catalogue written as a TypeScript module.

The rule applies only to a file that the path rules called `code`, and it needs four conditions together:

- The grammar is not `bash` and not `powershell`.
- The file has at least 1,000 characters of non-comment, non-whitespace content.
- At least 90 percent of that content is inside string literals.
- No single literal holds more than 25 percent of the literal content.

A file that passes becomes `i18n` if its name contains `i18n`, `intl`, `translat`, or `locale`, and `data` otherwise.

`structure.ts` produces the three numbers during the same tree walk that finds the comments, so no file is read or parsed twice.
A pre-order walk visits nodes in non-decreasing start offset, so one recorded end offset for each kind of span is enough to count a nested node once: an escape sequence inside a literal, an expression inside a template literal, and the string node of a Python docstring are all inside a span that was already counted.
A docstring counts as comment and not as literal.

A file with no grammar has no literal measurement, so this rule never applies to it.

## Generated output

`isGenerated()` decides from the path alone, without reading the file.
It marks a folder named `__generated__`, `coverage`, `dist`, `generated`, or `gen`; the known lock files; and the suffixes that build tools use, among them `.generated.ts`, `.g.dart`, `.pb.go`, `_pb2.py`, `.min.js`, `.map`, and `.lock`.

## Grammar selection

`grammarForFile()` in `src/scanner/structure.ts` reads the extension first and the `#!` line second, so a Python file with a `#!/bin/sh` wrapper line is still parsed as Python.

Thirteen grammars ship as prebuilt WASM and load on first use, so a scan of a Python repository never starts the Rust parser.
The whole Bourne family runs through the `bash` grammar: `.sh`, `.bash`, `.ksh`, `.bats`, `.zsh`, and any script whose shebang names `sh`, `bash`, `zsh`, `ksh`, `dash`, `ash`, or `mksh`.
Fish is not sent there. It takes the marker table instead.

A file with no grammar still gets token and line counts.
It reports `language: null` and zero functions, classes, and branches.

## Structure counts

The node types that count as a function, a class, or a branch are an explicit table for each grammar.

`branches` counts decision points.
A clause that the grammar puts inside its parent, such as `else_clause` or `catch_clause`, is left out so that one decision is counted once, while a clause that is a real extra decision, such as `elif_clause`, is counted.

## Lines

Slopsplorer classifies lines itself. `cloc` is not a dependency and is never run.

`lines` counts non-blank lines only, and `lines === codeLines + commentLines`.
The three buckets do not overlap.
A line with code and a trailing comment counts as code, which is the rule `cloc` uses.
Comment detection can move a line between code and comment and nothing else. It never changes `lines` and never changes `tokens`.

Where a grammar exists, the comment spans come from the grammar, so block comments and doc comments need no rule for each language.
A Python docstring counts as comment. This differs from `cloc`, which counts a docstring as code.

Everything else uses the marker table in `src/scanner/lines.ts`.
The table gives the line markers and the block delimiters for each format, so `/* ... */`, `<!-- ... -->`, and `--[[ ... ]]` are read across lines.
It also tracks string literals, so a `/*` inside a quoted value does not open a comment.
String state is reset on each line and block state is not, so an unbalanced quote costs one line at most.
A format is matched by filename first, then by extension, then by the `#!` line, so `Dockerfile` and `.env` are recognised without an extension.

A format with no rule reports every line with content as code.
Markdown and JSON are left out of the table.

`tests/comment-corpus.test.ts` holds one expectation for each file in `tests/corpus/`, beside the numbers `cloc 2.00` reported for the same file.
Every file asserts that the content total and the blank count match `cloc` exactly, so a change can only move a line between code and comment.
A file whose split differs from `cloc` must carry a written reason, and a file whose split matches must not carry one.

## Tokens

The token count covers the whole file, including comments and whitespace.

`o200k_base` is the default. It matches the current OpenAI models and is close enough to Claude's tokenizer to be useful for an estimate of context cost.
`--tokenizer cl100k_base` selects the older GPT-4 and GPT-3.5 encoding instead.
Text that spells a tokenizer control token is counted as ordinary text, so one source file cannot stop a scan.
