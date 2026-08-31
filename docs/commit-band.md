# The commit band

## Purpose

A comparison from one revision to another revision or the working tree holds a sequence of changes.
A reviewer reads those changes one at a time as often as they read the whole change.
The band lists each commit, appends the uncommitted working tree when it has source changes, states what each entry cost, and is the control that opens one.

It draws when the base is a commit and the target is a commit or the working tree.
The index has no band because a span cannot yet compare an arbitrary revision to the index.

For the comparison itself, read [diff-mode.md](./diff-mode.md).

## One control, no modes

Every layer of a review is a span over the listed entries, both ends included:

| Span | What it is |
| --- | --- |
| the range | the change as one thing |
| one entry | that commit or the uncommitted working tree on its own |
| the first N | everything up to a point |
| a run in the middle | one part of the branch, without the rest |

A span that ends at a commit is a `revisionPair` request.
A span that ends at the working tree is a `revisionToWorkingTree` request.
Individual and cumulative are two spans and not a switch, which is why the band needs no mode.

`requestForSpan()` and `spanOf()` in `src/shared/api.ts` convert between a span and a comparison.
A span compares from the parent revision of the entry it starts at, which `SpineEntry.parent` holds.
The working-tree entry uses HEAD as its parent, so selecting it alone means `HEAD -> working tree` and selecting a run through it means that run's base to the working tree.
`slideSpan()` moves a span by whole entries and keeps its width, so one step control walks single changes and slides a window.
`spanBetween()` is what a shift-click asks for.

The whole change is not a span.
It is `CommitSpine.range`, the comparison the spine was built for, because a capped list or a merge at the target would make a span of everything a claim the list cannot support.

The selection is one run and never a set.
Commits 2, 7, and 19 are not a comparison, and a union of three patches would break `net = added - removed` as soon as a line added in one comes out in another.

## The list is not always a chain

A range holds every commit a merge brought in, so a branch that has taken `main` in lists commits from both lines.
The commit above such a row is on the other line, and comparing from it would draw that whole line beside the one commit that was asked for.
Each row therefore carries the parent it was measured against, and a span starts from that parent, so the figures in a row and the page it opens can never describe different changes.

A run of commits over two lines is not a comparison of what it selects, so only a chain is offered.
The working-tree entry extends the chain only when the listed commit before it is HEAD.
`chainedSpan()` is the rule: a shift-click stops at the first seam, a window will not step over one, and `spanOf()` refuses a request that crosses one, which drops the spine and rebuilds it for the comparison that was asked for.
The row under a seam is drawn with a break above it, so a selection that stops there reads as the history it stopped at.

## What the figures are

`buildSpine()` in `src/scanner/spine.ts` measures each commit against its own first parent, with the same scanner that measures the range.
It measures the working-tree entry against HEAD and appends it only when the scanner finds accepted source files in that change.
`git diff --numstat` is not used, for the reason it is not used anywhere else: it counts physical lines and knows nothing about blank, comment, and code.
A figure in the band and a figure in the page therefore mean the same thing.

The band reads no filter, and it sits above the filter bar to say so.
It is the frame a review happens inside, so which commit is the heavy one has to stay one answer while the page below it is narrowed.

It does follow the measure, because a measure is a unit and not a filter, and one pass per commit produces every measure at once.
It states added, removed, and net together, so the aspect switch has nothing to change.
Each row draws its two sides from a centre axis, removed left and added right, which is how `SourceTree` already draws a net row: a commit that traded 4,000 for 3,900 and a commit that added 100 read alike as one figure, and the halves tell them apart.

Generated files are left out, always.
One commit that regenerates a lockfile flattens every other commit into noise, and nobody wrote it.

The column does not sum to the range.
A line a later commit rewrites is counted in both, and the difference is the branch's own rework rather than a fault in either figure.

## What a row says

The subject is the row, and the whole message is its tooltip: the subject in full and the body under it, trimmed at `MAX_COMMIT_BODY`.
The panel is wide enough to hold a hard-wrapped body without wrapping it a second time, and it prints the lines as they were written, because reflowing them would run a bullet list into one line.

The object name opens the commit on the forge when the remote is one.
`commitUrlBase()` in `src/scanner/gitdiff.ts` builds it from the remote URL: GitLab writes `/-/commit/<sha>` and every other forge writes `/commit/<sha>`, and the host name decides which.
Guessing is safe here in a way it is not for a fetch, because the worst a wrong guess does is offer a link that does not open, and no figure depends on it.
The project keeps the case it was written with, since a link is followed rather than compared.

That link is why the row is a grid holding a cover button rather than one button holding cells: a link cannot sit inside a button.
The button is the selector and lies under the cells, which are positioned so they paint over it and pass their clicks through.
The working-tree row says `working tree` instead of an object name and has no author or forge link.

The band is dragged by the same `HeightSplitter` the workspace uses, and the height is remembered.

## Where the spine is held

`GET /api/spine` answers with the spine of the range being reviewed, and not of the open comparison.
A step opens a comparison of one commit, and a spine rebuilt from that would list one commit and collapse the band as the reader walked it.

The server keeps the built spine while `spansRequest()` says the open comparison is still inside it, so a reload in the middle of a walk still answers with the range.
The page holds it under the same rule, so a step costs no round trip.
One function decides for both, which is why it lives in the wire contract.

The band draws before its commits arrive, as `PendingSpineBand`, saying that it is measuring.
A wide range takes a moment, and a control that appears late reads as one that was broken.
The held spine is dropped before the ask rather than after it, so the band never draws a selection read from a range the page has already left.

Measuring costs one diff for each commit, so the answer is built once.
`MAX_SPINE_COMMITS` caps the list at the newest commits of the range, and `CommitSpine.omitted` counts what it left out.
The working-tree entry follows that capped list and does not count toward the cap.

## What a step keeps

A new comparison clears the exclusions, the drill scope, and the selection, because it replaces the file list.
A step does not.
It opens a comparison inside the range already being read, and throwing the reader back to the project root on every step would make walking commits unusable.
`reaim()` in `src/web/App.tsx` takes `keepPlace` for exactly this, and only the band passes it.

## Collapsed

The band opens shut and remembers what it was left as, in `preferences.ts` beside the other stored choices.
One rule rather than a default for each way a run was started.

Shut it is one row, and it still states the span and still steps.
A page drawing one commit of fifty must never look like it is drawing the whole change, so the collapsed row carries the span in words, a tick for each commit with the span marked, the step, and the way back to the whole change.

`[` and `]` step from anywhere on the page, because stepping is the one thing a reviewer does dozens of times.
A field that takes text keeps its own keys.
