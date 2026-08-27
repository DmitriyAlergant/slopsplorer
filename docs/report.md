# Text report

## Purpose

The page is for a person.
The report is for a reader that cannot open a page: a coding agent, a log, a pull request comment.

`slopsplorer --report` prints one text report to stdout and exits.
It starts no server.
`buildReport()` in `src/server/report.ts` builds the report from the same `ScanIndex` the page reads, so the report and the page always describe one tree.

For the parts the report shares with the page, read [architecture.md](./architecture.md).
For what a comparison measures, read [diff-mode.md](./diff-mode.md).

## The command line

| Flag | Meaning |
| --- | --- |
| `--report` | Print the report and exit. Every other flag that decides the index applies: the positionals, `-C`, `--diff`, `--staged`, `--exclude`, `--all-files`, `--tokenizer`, `--max-file-bytes`. |
| `--unit tokens\|lines\|loc` | The unit of every figure. Default `tokens`. |
| `--aspect churn\|net\|added\|removed\|after` | The side of the change the figures describe. Default `churn`. A comparison only. |
| `--threshold <percent>` | The share of its section at which a node is expanded. Default 3. |

`readReportOptions()` in `src/cli.ts` reads these.
A report flag without `--report` is an error, and so is a server flag with it, so a flag never silently does nothing.
`--aspect` on a scan is an error, because a scanned file has one content.

`REPORT_UNITS` maps the unit names to a `Measure`.
The flag says `loc` because the page says LOC, and the code keeps `codeLines` because that is the name every other file searches for.

## The sections

The report has one section per flavor, in a fixed order.

| Section | Treatment |
| --- | --- |
| `CODE` | Walked as a tree. A file row carries its structure trailer. |
| `TESTS` | Walked as a tree, without trailers. |
| `DOCS`, `I18N`, `DATA & CONFIG`, `OTHER` | One line each: the total, the file count, and the three heaviest files. |
| `GENERATED` | One line, last. Excluded from every figure above it. |

Code and tests are walked because that is where a reader goes next.
The other flavors are in the report so that a reader knows how much of the tree is not code and where it sits.
A one-line section is omitted when the tree holds no file of that flavor.
`CODE` and `TESTS` print `none` instead, because their absence is a fact worth a line.

Four header lines come first: the root, the whole tree in every measure, the unit split by flavor against the whole tree, and two sentences.
The first sentence is the weight of tests against code, or in a comparison the churn of tests against the churn of code.
The second states the threshold.

## The rule

A node is expanded when its weight reaches the threshold share of its section total.
An expanded folder lists the children that pass the same test, heaviest first, then one `...` row that sums the rest.

Everything else follows from that one rule.

- Every level is a partition of its parent. The listed children and the `...` row add up to the folder above them, so nothing is hidden, only folded.
- A file that reaches the threshold always appears in place, however deep it sits, because a child never outweighs its parent.
- A folder that passes but has no child that passes prints as a leaf with its file count.
- The walk always ends, because a `...` row closes every level.
- Output size follows how concentrated the weight is, not how large the tree is.

A chain of folders that each hold one folder and no file of the section collapses into one row, such as `src/main/java/com/acme/`.
Without this, a Java package would spend the report on rows at 100%.
The root row collapses the same way, and prints as `./` when it holds a file of the section or more than one child.

There is no line budget.
A budget would turn the walk into a search, and the same folder would print at a different depth depending on what else is in the tree.
To see more, lower `--threshold` or point the command at a subfolder.

## The figures

Shares inside a section divide by the section total.
A code-only view of a repository that is mostly vendored data would print nothing against the whole tree.

In `net` the weight is signed, so shares divide by churn, as the page does.
The root row of a net section therefore reads below 100%, and that figure is the net as a share of the churn.
Ordering is by magnitude, so a large deletion ranks as a large change.

Counts are compact: `62k`, not `61,678`.
The long form costs a reader of the report four tokens where the short form costs one, and the last three digits carry nothing a share of the tree needs.
`formatCompact()` keeps one decimal below ten and none above.

A row has a label, a weight, a share, and a trailer.

| Row | Trailer |
| --- | --- |
| Folder | The file count. In a comparison, `+added -removed` as well. |
| Code file in a scan | `loc`, then `comment` when a fifth or more of its lines are comment, then `fn` and `br` when a grammar parsed it. |
| Test file in a scan | None. |
| File in a comparison | The status letter, `+added -removed`, and `from <path>` for a rename. |

## Testing

`tests/report.test.ts` builds a `ScanIndex` from a list of paths and weights, without a scan, so every figure is chosen.
Weights stay under a thousand so that every printed number is exact and a test can add the rows of a level and compare them with the row above.

The tests pin the rule and its consequences: expansion at the threshold, the `...` row and the partition it closes, the leaf folder, the chain collapse, and the file that always appears.
They pin the header, each section's heading, the one-line sections, the diff trailers, the signed figures of `net`, and the errors for a scan with an aspect and a threshold outside 0 to 100.
