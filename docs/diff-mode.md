# Diff mode

## Purpose

Scan mode answers one question: how much of this repository must an agent read.
Diff mode answers the neighbouring question: how much of this change must a reviewer read, and where does it sit.

The map does not change.
A folder that holds most of a diff reads the same way as a folder that holds most of a tree.
That is why diff mode is a second producer of `ScanIndex` and not a second program.

For the commits inside a comparison, read [commit-band.md](./commit-band.md).
For the parts it shares, read [architecture.md](./architecture.md).
For the rules that decide what each file is, read [scanning-and-classification.md](./scanning-and-classification.md).

## The command line

| Command | Compares |
| --- | --- |
| `slopsplorer` | Nothing. Scans the current folder. |
| `slopsplorer <dir>` | Nothing. Scans that folder. |
| `slopsplorer --diff` | HEAD to the working tree. |
| `slopsplorer --staged` | HEAD to the index. |
| `slopsplorer <rev>` | That revision to the working tree. |
| `slopsplorer <commit>` | A raw object name: that commit to its parent. |
| `slopsplorer <rev>^!` | The same, whatever names the commit. |
| `slopsplorer <revA> <revB>` | A to B. |
| `slopsplorer <revA>..<revB>` | A to B. |
| `slopsplorer <revA>...<revB>` | The merge base of A and B, to B. |
| `slopsplorer --pr <number>` | A pull request, fetched from the remote first. |
| `slopsplorer <pull request URL>` | The same, named by the page a reviewer was reading. |

A single revision carries two intents, and the text tells them apart.
A named one, such as `origin/main` or `HEAD~5`, is a place to measure from, so it compares to the working tree.
A raw object name is one commit, because a bare `f53f4f9eb` arrives from a log, a review page, or another tool, and never from a person describing how far back to look.
`OBJECT_NAME` in `src/scanner/gitdiff.ts` is the whole rule, and `<rev>^!` is Git's own notation for the same thing when a name rather than an object name points at the commit.

A positional is a directory when the filesystem holds one at that path.
A folder named `main` therefore still scans, and the rule needs no escape syntax.
A positional that is not a directory is a revision when `git rev-parse --verify` accepts it, and an error otherwise.

`A..B` compares A to B, as `git diff A B` does.
`A...B` compares B to the merge base, as `git diff A...B` does, which is what a pull request shows.

`-C <dir>` names the repository, because the positional slot holds the revisions.
`--all-files` widens a filesystem walk, a diff runs none, and asking for both is refused.
`--exclude` and `--max-file-bytes` apply to both modes.

The scan root is the top of the worktree, because `git diff` reports paths from there.

`resolveComparison()` refuses a comparison whose two sides are one commit.
`main..main` can only draw an empty page, and saying so is better than measuring nothing and serving it.
The same rule catches `A...B` where B is already an ancestor of A, because the merge base is then B itself.

## Reviewing a pull request

A squash merge deletes the branch and keeps none of its commits, so a pull request's own revisions are in no local branch and `git rev-parse` refuses every one of them.
`--pr` fetches the change instead of asking the repository for something it does not hold.
When `--export` receives the full review URL, `pullRequestBacklink()` also retains that exact URL for the static header.
A numeric `--pr` value has no page address to retain.

`--pr` needs `gh` or `glab` installed and signed in, and that is not a convenience.
The branch a request is against is the one fact Git has no record of.
A repository holds the head and the base branch as commits, and nothing in it anywhere says the two were ever proposed against each other.
Guessing the repository default is wrong for every request raised against anything else, and wrong quietly: the page draws a comparison and never says it measured a different one.

`readPullRequestMetadata()` in `src/scanner/gitdiff.ts` asks for three things: the base branch, the head commit, and the commit that took the request in, which is `null` while it is open.
The host decides which command answers, and the failure is a message naming the command rather than a wrong measurement.

`pullRequestBase()` then applies one rule for every state a request can be in: the merge base of the head and the base branch **as it stood the last time the request was measured against it**.
While the request is open that is the branch tip.
Once it has landed the branch has moved past it, and where the merge sat is where it stood, whether the forge squashed, rebased, or merged.
Taking the branch tip after a merge would be wrong twice over: for a squash or a rebase it is too far ahead, and for a merge commit the head is inside the branch, so the merge base would be the head and the change would read as empty.

The head lands in `refs/slopsplorer/pull/<number>`, which is a namespace of ours, so no branch a person named is touched.
`shortRevision()` prints that ref as `PR <number>`.

`nameForBase()` says what the base is rather than spelling it.
A ref that points exactly at the commit says what an object name cannot, and the base branch is the one worth naming.
Failing that, `git describe` still places it, as `v2.0.0-23-g6bf16a921`: the last release, how far past it the branch forked, and the commit.
That is a landmark and a revision at once, because the trailing object name pins it, so the name on the chip can never drift away from the commit it was measured at.

The remote is the one serving the project a URL names, or `origin` when only a number was given.
Its URL is read from the config rather than through `git remote get-url`, which applies `insteadOf` and would answer with the mirror a fetch is rewritten to.
Only `--pr` and a pull request URL reach the network.
A revision this repository does not hold is still an error and never a fetch, because a read-only tool must not talk to a remote by surprise.
Git is told not to prompt, so a missing credential is an error the command line prints rather than a wait with nothing on screen.

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

## Reading the repository around a change

The Before / Diff / After switch in `InstrumentBar` changes the question without losing the comparison.
Diff measures only the paths the change touched.
Before and After measure every accepted source file in that side of the repository, so a reviewer can see where the change sits in the complete tree and return to the change itself.

Every choice rescans.
`POST /api/review-mode` keeps the active `Comparison` and installs either its diff producer or a `reviewSide` producer.
`ScanMeta.review` keeps the comparison and the active choice visible while `ScanMeta.diff` stays `null` in a repository view.
The diff remains the only mode that reports churn.

`scanReviewSide()` in `src/scanner/scan.ts` reads a revision without checking it out.
`listRevisionFiles()` asks `git ls-tree` for the complete path list, and `GitObjectReader` asks `git cat-file --batch` for each `<revision>:<path>` blob.
The index uses `git ls-files --cached` and `:<path>` blobs.
A working-tree side uses the normal filesystem scan, because uncommitted and untracked files have no Git object.
`openSourceReader()` uses the same source for a file preview, so the full-tree figures and the text beside them describe one repository image.

Opening another folder leaves the review and installs a plain scan.
Changing the comparison from a repository-side view measures the new diff first.
A static snapshot offers none of these choices because each one needs a new index.

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
`FlavorBar` is the same bar as in a scan: it divides a tile by flavor, in the magnitude of the active measure and aspect, because what a folder is made of is the question the tile's own figures do not answer.
The Git letter in the file table carries the change status instead, one file at a time.

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

The aligner that `openDiffAligner()` opens reads both sides again and `alignedLines()` interleaves them into one sequence, from the same aligner the figures came from, rather than shelling out to `git diff` a second time.
One aligner serves every row it was opened for through one size batch and one object reader, so the exporter walking a whole index shares two git processes instead of paying two per file.
One producer means the preview and the numbers beside it can never describe different changes, and it reaches an untracked file, which `git diff` cannot show at all.
`tests/linediff.test.ts` reads each side back out of one alignment over a random corpus and requires the two files again.

The file table shows 100 changes on each page and provides previous and next controls.
`Read all` opens every matching change, independent of the open table page.
The modal requests the complete list and draws it in path order with `FileStack`.
Each file keeps its own head, which states the Git letter and both sides of its change, and folds the file away.
The two dialog switches move the whole stack, so a comparison of fifty files reads as one page.

The route sends the file whole, unchanged lines included, because hunks answer a question the reader did not ask.
A gutter holds the number on each side, so a reader can see where a passage sits and how far apart two changes are.
`Only changed lines` in the dialog head hides every line further than three from a change, and a band counts what it hid.
`Wrap lines` folds a long line into the width of the dialog instead of scrolling the body sideways, in a comparison and in a scan alike.
Both are habits of the reader and not facts about the file, so `src/web/preferences.ts` keeps them in local storage and they open as they were last left.

`DiffView` highlights each side whole with `highlightToLines()`, then hands each row the line that belongs to it.
Highlighting a row on its own would lose every construct that spans lines, and a diff grammar would colour the markers and leave the code grey.

## Testing

The corpus test compares the line split against `cloc`, and diff mode has the same kind of anchor.
`git diff --numstat` counts physical added and removed lines, blank ones included, which is what `addedPhysicalLines` and `removedPhysicalLines` hold, and `tests/diff-scan.test.ts` requires them to match exactly for every file.
The bucketed counts cannot be held to `--numstat` directly, because they exclude blank lines by definition; what is checked instead is that each one stays inside its physical count and that the two identities hold.

The fixtures are a real repository with two commits: a file modified so that a block comment opens inside the added lines, a file added, a file deleted, a file renamed with one edit, and a run with a tiny `--max-file-bytes` for the ceiling.
