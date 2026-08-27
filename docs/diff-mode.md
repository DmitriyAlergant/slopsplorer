# Diff mode

## Purpose

Scan mode answers one question: how much of this repository must an agent read.
Diff mode answers the neighbouring question: how much of this change must a reviewer read, and where does it sit.

The map does not change.
A folder that holds most of a diff reads the same way as a folder that holds most of a tree.
That is why diff mode is a second producer of `ScanIndex` and not a second program.

For the parts it shares, read [architecture.md](./architecture.md).
For the rules that decide what each file is, read [classification.md](./classification.md).

## The command line

| Command | Compares |
| --- | --- |
| `slopsplorer` | Nothing. Scans the current folder. |
| `slopsplorer <dir>` | Nothing. Scans that folder. |
| `slopsplorer --diff` | HEAD to the working tree. |
| `slopsplorer --staged` | HEAD to the index. |
| `slopsplorer <rev>` | That revision to the working tree. |
| `slopsplorer <revA> <revB>` | A to B. |
| `slopsplorer <revA>..<revB>` | A to B. |
| `slopsplorer <revA>...<revB>` | The merge base of A and B, to B. |

A positional is a directory when the filesystem holds one at that path.
A folder named `main` therefore still scans, and the rule needs no escape syntax.
A positional that is not a directory is a revision when `git rev-parse --verify` accepts it, and an error otherwise.

`A..B` compares A to B, as `git diff A B` does.
`A...B` compares B to the merge base, as `git diff A...B` does, which is what a pull request shows.

`-C <dir>` names the repository, because the positional slot holds the revisions.
`--all-files` widens a filesystem walk, a diff runs none, and asking for both is refused.
`--exclude` and `--max-file-bytes` apply to both modes.

The scan root is the top of the worktree, because `git diff` reports paths from there.

## Changing the comparison

The comparison in the instrument bar is two chips with a link between them, drawn by `ComparisonPicker` in `src/web/components/ComparisonPicker.tsx`.
Each chip opens a panel over its own side: "From" over the revisions, "To" over the same list plus the working tree and the index.
A panel filters by name and groups branches, remote branches, and tags, and offers what is typed as a revision of its own, because a commit that no ref holds is reachable no other way.
The arrow between the chips swaps the sides, which two revisions always allow and the working tree and the index never do, because neither can be the side a comparison starts from.
The merge-base switch sits at the foot of the "From" panel, because `A...B` changes what "from" means, and the chip then carries a `merge base` tag so that the bar never draws one silently.
Choosing measures at once, so the picker keeps no half-chosen state: the chips read the drawn `DiffMeta.request` on every render.
The index has one base, so choosing it settles the other chip on HEAD.
`shortRevision()` in `src/web/format.ts` abbreviates a whole object name and nothing else, because a prefix somebody typed is already as short as it can safely be.
`GET /api/refs` supplies the lists from `listRefs()` in `src/scanner/gitdiff.ts`, newest first, capped at `MAX_REFS`.

The picker sends a `ComparisonRequest`, defined in `src/shared/api.ts`, so the page writes no argument grammar.
`parseComparisonSpec()` in `src/scanner/gitdiff.ts` only turns command-line tokens into a `ComparisonRequest` and does not touch the repository.
`verifyComparisonRequest()` is the single place that decides whether a named revision exists, and both the command line and the route call it.
`DiffMeta.request` echoes the request, so the chips read as the comparison being drawn.

`POST /api/compare` takes a `ComparisonRequest` directly, resolves it against the same repository root, and measures it again.
The repository never moves, so the scan-root control is not offered in a comparison.
A revision the repository does not hold is answered with 400 and the message from Git, and the open comparison stays.
A new comparison replaces the file list, so the client clears the exclusions, the drill, and the selection before it asks.
`tests/diff-server.test.ts` covers the route and the ref list.

## The file list

`git diff --name-status -z -M <base> <target>` gives the changed paths, the status letter, and the rename pairs.

Rename detection is not optional.
Without `-M`, one renamed file reads as a whole-file add beside a whole-file delete, and a branch that moves a folder fills the map with change that nobody wrote.
A renamed row is filed under its target path, which is where the change now sits, and keeps its source in `FileRow.previousPath`.

When the target side is the working tree, `git ls-files --others --exclude-standard` adds the untracked files as additions.
`git diff` cannot see them, but a file written a minute ago is most of what uncommitted work is, and a scan already counts it.

`acceptSourcePaths()` in `src/scanner/walk.ts` then reduces the list exactly as it reduces a walk, so a diff and a scan agree about what a source file is.

Content at a revision comes from one long-lived `git cat-file --batch` process.
One `git show` for each file would spend seconds of process startup on a diff of several hundred files.
Sizes are asked first, through `git cat-file --batch-check`, so a blob over `--max-file-bytes` is never pulled through the pipe.
Content for the working tree comes from `readFile`, as it does in a scan.
A file over the ceiling on either side is skipped and counted in `ScanMeta.skippedLargeFiles`.

Both sides are put on one line-ending convention before they are compared.
A blob is stored as Git holds it while a working-tree file may have been written back with CRLF, and without this every line of such a file would read as changed.

## Churn and net

Each file in a diff has two contents, so each measure yields two numbers: what the change added, and what the change removed.

- Churn is `added + removed`. It is the volume of the change, and it is never negative.
- Net is `added - removed`. It is what the change leaves behind, and it is signed.

Both identities hold for every measure, and `tests/diff-scan.test.ts` pins them for every file of a fixture.

Net tokens is therefore not the same number as `tokens(after) - tokens(before)`.
A tokenizer reads the seam between a changed line and the unchanged line above it, so the two differ by a little.
The identity is worth more than the seam.

## How a side is measured

Slopsplorer does its own line classification, so it cannot take the counts from `git diff --numstat`.
`--numstat` counts physical lines and knows nothing about blank, comment, and code.

The measurement runs in three steps.

1. `classifyLines()` and `classifyLinesByMarkers()` in `src/scanner/lines.ts` return a verdict for each line: blank, code, or comment.
   `measureLines()` and `measureLinesByMarkers()` are reductions over those verdicts, so one pass produces both and the two cannot disagree.
   Each side is classified whole, before anything is compared, so an added line inside a block comment is judged in the context that opened it.
2. `diffLines()` in `src/scanner/linediff.ts` aligns the two line arrays and reports which lines each side does not share.
3. Each side sums its own verdicts over its own changed lines.

The result is `addedCodeLines`, `removedCommentLines`, and the rest, each defined exactly as the same name is defined in scan mode.
Blank lines fall out of the counts as they already do, which is why `addedLines` is at most `addedPhysicalLines`.

Tokens follow the same shape: the added lines are tokenized together, and the removed lines are tokenized together.

## The line diff

`diffLines()` is Myers' algorithm in linear space: a forward and a reverse search advance until they overlap, and the problem splits at the diagonal run where they meet.
`tests/linediff.test.ts` checks the result against a brute-force longest common subsequence over a random corpus, so a shared line can never be reported as churn.

The common head and tail are trimmed first, and `MAX_DIFF_REGION_LINES` caps what remains.
Above the cap the differing region counts as fully replaced, and the file is counted in `ScanMeta.diff.cappedFiles`.
The CLI summary reports that count, and the page does not show it.
Trimming before capping is what keeps a long generated file with a three-line edit from being read as a rewrite: the cap bounds the file that changed nearly everywhere, where the alignment costs quadratic time and tells the reader nothing.

## What does not diff

A function count is a whole-file structural fact, so there is no such thing as churn in functions.
`functions`, `classes`, and `branches` hold the after-image count, with `beforeFunctions` and its siblings beside them, and they stay outside the churn and net switch.
Both sides are parsed anyway, because a per-line verdict needs the grammar's comment spans, so the before-image counts cost nothing.

## The weight field

A measure alone named a numeric `FileRow` field.
A measure and an aspect together do the same job through one table:

```
Measure  = tokens | lines | codeLines
Aspect   = churn | net | added | removed | after
```

`weightField(measure, aspect)` returns a whole field name, such as `churnLines`.
The table holds every name in full.
Building a name from fragments would save a few lines and would break the rule that every name worth searching for appears whole in the source.

`churn*` and `net*` are stored fields, computed once while the index is built, not derived at read time.
That keeps the aggregator a single index expression and keeps each `ScanIndex.weightPrefix` entry a plain prefix sum.
A scan leaves every one of them at zero, which is exactly true of a file nothing changed, so no reader has to guard an index expression.

`parseViewRequest()` validates the aspect against `ASPECTS` before it reaches the table, as it validates the measure.
`buildView()` then forces the aspect to `after` unless the index is a diff.

## Signed weight

Churn is never negative, so it breaks nothing.
Net is signed, and it changes three things that scan mode takes for granted.

- Every share assumes `0 <= part <= whole`.
  A folder can be -400 inside a project of +10,000, a folder can hold more than all of its scope, and a change whose adds and deletes nearly cancel makes every percentage explode.
  So net has no honest whole, and the page states no percentage of it: the folder head drops its share figure and the tiles drop theirs.
  The shares still exist on the wire in that aspect, drawn against the scope's churn, because the bands need a length and a length is not a claim.
- Heaviest first means largest in magnitude.
  The tree sort, `rankFiles()`, and the folder tiles all order by absolute weight, and `rank.minWeight` is a floor on magnitude, or a threshold would silently drop every deletion.
  The sign is shown beside the number rather than folded into the order.
- The `--mass` custom property assumes a fill from 0 to 1.
  In net the row draws two fills instead, `--share-removed` left of a centre axis and `--share-added` right of it.

## The bars

In every aspect that is not net, each row of the source tree keeps the single `--mass` bar of scan mode.

In net, each row of the source tree shows one figure, the signed net, and beside it a band drawn from a centre axis: removed grows left of the axis and added grows right, as a number line reads.
The band is why the lone figure is safe: a net of -6,448 reads the same whether nothing happened or 33,000 tokens were traded for 39,000, and the band tells those apart.
The two halves are `--share-removed` and `--share-added`, which the server computes as `TreeRow.shareRemoved` and `TreeRow.shareAdded`.
They divide `visibleChurn` in `src/server/aggregate.ts`, the churn the active filters leave in the drill scope.
Because the halves divide the scope's own churn, the scope's own row fills the whole band.

Each side also states its own figure over its own bar, muted, from the axis outwards: the removed figure ends at the axis and the added figure starts at it, so the pair reads either side of one line.
The row is still named and sorted by the net figure at its right edge, and the two muted figures only explain it.
A name is drawn over the band, so a name or the net figure can reach the pixels a side figure wants.
The text wins, and the figure it reaches is not drawn, while the bar below the text stays.
`SourceTree` settles that by measurement after each render and on a resize, because a name is text of an unknown width and the axis is a position in the row.
The row's tooltip carries the pair whether or not the band draws it.
Position carries the direction, because the two halves sit on opposite sides of the axis, so no reading depends on hue.
Around one man in twelve cannot separate red from green.

The folder tiles in `FolderDetail.tsx` say the same thing, and they say it in every aspect: a tile prints its weight, names the side that weight is, and then puts `+added` and `-removed` beneath it.
Only one figure of a tile moves when the aspect switch moves, so a reader who is looking at churn still sees what the change traded.
`FlavorBar` keeps its shape, and in diff mode it draws a better split than file kind: the change status, which is added, modified, deleted, or renamed.

## How a folder is summarised

The head of `FolderDetail` states every aspect at once, as one strip of `Readout` figures: added, removed, net, churn, after, and the file count.
The switch above moves the emphasis along that strip and never changes its shape, so the panel keeps its height and the reader keeps their place.
Only the selected figure keeps full ink and its hue, and the rest are muted, because a strip of equal numbers gives the reader nothing to hold.
The strip is a grid of equal tracks, so a figure stays in the same place when the reader opens the next folder.
A scan draws the same strip from the three measures instead, which is why the two modes read alike.
`MassRibbon` builds its scope figures from the same component, so one figure is stated in one shape wherever the page states it, and it is the one strip that states the comment share of the churn.

The aspect totals come from `detail.added` and `detail.removed` in the active measure, and from the two identities.
The server is not asked for a fifth field it can already imply.

## Where the aspect is chosen

`FilterBar` draws it as a switch beside the unit, and only inside a comparison.
The two read as one phrase, the side and then the unit: "net tokens".
The switch lists the five sides in the order of `ASPECTS`, which is the order the file tables draw them in, and a page opens on net.
A second widget that could also set it would give the page two owners of what it counts.

Every numeric column of `FileTable` is a `RankMetric`, and the diff columns are the five aspects plus the two structure counts.
Sorting one of the aspect columns chooses the aspect, exactly as sorting a measured column chooses the measure.
`rankMetricsFor()` decides which set a mode draws, and `buildView()` clamps a metric the open index cannot draw and echoes what it used.

## The preview

Inside a comparison a file has two contents, so `SourceDialog` draws the change with `DiffView`.
Showing the after-image alone would be a claim the page cannot support.

`diffOneFile()` reads both sides again and `alignedLines()` interleaves them into one sequence, from the same aligner the figures came from, rather than shelling out to `git diff` a second time.
One producer means the preview and the numbers beside it can never describe different changes, and it reaches an untracked file, which `git diff` cannot show at all.
`tests/linediff.test.ts` reads each side back out of one alignment over a random corpus and requires the two files again.

The route sends the file whole, unchanged lines included, because hunks answer a question the reader did not ask.
A gutter holds the number on each side, so a reader can see where a passage sits and how far apart two changes are.
`Unchanged lines` in the dialog head hides every line further than three from a change, and a band counts what it hid.

`DiffView` highlights each side whole with `highlightToLines()`, then hands each row the line that belongs to it.
Highlighting a row on its own would lose every construct that spans lines, and a diff grammar would colour the markers and leave the code grey.

## Testing

The corpus test compares the line split against `cloc`, and diff mode has the same kind of anchor.
`git diff --numstat` counts physical added and removed lines, blank ones included, which is what `addedPhysicalLines` and `removedPhysicalLines` hold, and `tests/diff-scan.test.ts` requires them to match exactly for every file.
The bucketed counts cannot be held to `--numstat` directly, because they exclude blank lines by definition; what is checked instead is that each one stays inside its physical count and that the two identities hold.

The fixtures are a real repository with two commits: a file modified so that a block comment opens inside the added lines, a file added, a file deleted, a file renamed with one edit, and a run with a tiny `--max-file-bytes` for the ceiling.
