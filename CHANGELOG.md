# Changelog

All notable user-facing changes to Slopsplorer are recorded here.
Each entry is one sentence written for a user, under `Features`, `Bug Fixes`, `Documentation`, or `Other Changes`.
Write yours under Unreleased as you make the change, and rename that heading to the version when you cut a release.

## [Unreleased]

### Features

- Scans now include extensionless `README`, `CHANGELOG`, `CHANGES`, `CITATION`, `CONTRIBUTING`, `COPYING`, `LICENSE`, and `LICENCE` files as Docs, plus `.htm` and `.xhtml` files as Other.
- Flavor detection now recognizes legacy language aliases and locale names that contain both a script and a region, such as `zh-Hant-TW`.
- Generated-file detection now recognizes .NET designer and SpecFlow output, Yarn Plug'n'Play files, generator header warnings, and HTML generator metadata.
- `Read all`, above the file table, opens every file the table lists in one scrolling preview, always in path order, so a change reads end to end instead of one file at a time. Each file folds away on its own, and the whole selection reads the same way in a static export.
- `--export <dir>` writes a portable static explorer with filters, rankings, source or diff previews, a read-only commit band, and a backlink when a full GitHub or GitLab review URL names the comparison, then prints its path and exits. Serve the folder over HTTP to read it: a browser loads no module, worker, or data file from a `file://` address, and the page says so when opened that way.

### Other Changes

- Stylesheets are now Other rather than Code, beside the HTML they dress. Neither holds logic to reason about, so hiding Other now takes presentation off the map in one switch.
- Compiled JavaScript and CSS is now recognised as generated wherever it was committed, not only under `dist/`. A bundler's content hash in the name, a source map comment, and minified line shape each mark a file, so a React, Vite, or SvelteKit build under `build/`, `out/`, `public/`, or `static/` no longer counts as code somebody wrote.

### Bug Fixes

- `Read all` now opens every matching file instead of only the current 100-row table page, and compact previous and next controls make all table pages available.
- Flavor filters now start with all flavors on and generated files off on every visit instead of restoring the last selection.
- Choosing one commit in the band now draws that commit alone on a branch that has taken `main` in with a merge. It used to compare from the commit listed above it, which for a commit the merge brought in sits on the other line of history, so one commit of a pull request drew the whole branch. A run of commits stops at such a seam, and the band draws the seam.

## [0.5.1](https://github.com/DmitriyAlergant/slopsplorer/releases/tag/v0.5.1) - 2026-08-28

### Features

- The file preview can wrap a long line instead of scrolling it sideways, in a scan and in a comparison. The switch stands in the dialog head beside Only changed lines, and both are drawn as switches. ([7c4345b](https://github.com/DmitriyAlergant/slopsplorer/commit/7c4345b))

### Bug Fixes

- The caption over the file list now reads "showing 100 of 128 matches" instead of "matchs", and it breaks between the caption and that count rather than leaving one word on a line of its own. ([e80246d](https://github.com/DmitriyAlergant/slopsplorer/commit/e80246d))

### Documentation

- The README shows the page as it stands, with the measure switch, the folder summary and its share cards, and the whole-project readouts under the panels. ([44f5b94](https://github.com/DmitriyAlergant/slopsplorer/commit/44f5b94))

## [0.5.0](https://github.com/DmitriyAlergant/slopsplorer/releases/tag/v0.5.0) - 2026-08-27

### Features

- A pasted commit, such as `slopsplorer f53f4f9eb`, now compares that commit against its parent instead of against the working tree. A named revision such as `origin/main` or `HEAD~5` still measures from there to the working tree, and `<rev>^!` names one commit whatever points at it. ([b489f28](https://github.com/DmitriyAlergant/slopsplorer/commit/b489f28))
- `--pr <number>` reviews a pull request: it fetches the change from the remote, so it reaches one whose branch a squash merge deleted, and measures it against the branch it is actually against rather than against the repository default. GitHub and GitLab, through `gh` or `glab`. A pull request URL works as a positional argument. ([b489f28](https://github.com/DmitriyAlergant/slopsplorer/commit/b489f28))
- A comparison of two commits now draws a band of the commits it spans, above the filters. Click one to read that commit alone, shift-click for a run of them, or step with `[` and `]`. The band states each commit's added, removed, and net weight, leaves generated files out, and links each commit to the forge. ([b489f28](https://github.com/DmitriyAlergant/slopsplorer/commit/b489f28))
- Ask a question about what you are looking at: if Claude Code, Codex, Cursor, or opencode is installed, the header hands your question to it, with the scan or comparison, the drill, the selection, and the unit you have on screen, and draws the answer on the page; the menu names each tool by its own mark and says whether it reported a sign-in. ([3f134f5](https://github.com/DmitriyAlergant/slopsplorer/commit/3f134f5))
- The File column of the file list is now sortable, A to Z by path, and its heading stands over the paths it names. ([fe23fb7](https://github.com/DmitriyAlergant/slopsplorer/commit/fe23fb7))
- The file list of the folder panel has a scope switch: list the files that sit directly in the selected folder, or every file below it. It moves the list alone and changes no total. ([fe23fb7](https://github.com/DmitriyAlergant/slopsplorer/commit/fe23fb7))
- Flavor detection is more accurate: it reads the JVM, .NET, Pester, and vitest test-naming conventions and the Gradle test source sets, recognises a generated file from the header its generator writes, which reaches emitted SDK clients that no path convention marks, and reads a folder of translations from the languages it holds, so a site that keeps `content/pl` beside `content/zh-cn` reports them as translations rather than as docs. The code and prose inside a `lang` or `translations` folder are no longer filed as catalogues, and a `.txt` or `.md` fixture counts as data rather than as documentation. ([7020935](https://github.com/DmitriyAlergant/slopsplorer/commit/7020935))

### Other Changes

- A comparison whose two sides are the same commit is refused with a message instead of drawing an empty page. ([b489f28](https://github.com/DmitriyAlergant/slopsplorer/commit/b489f28))


## [0.4.2](https://github.com/DmitriyAlergant/slopsplorer/releases/tag/v0.4.2) - 2026-08-27

### Features

- A folder's own files now take a tile of their own in the folder panel, ranked among the subfolder tiles by weight and selectable like them, so the tiles divide the whole folder. ([c289028](https://github.com/DmitriyAlergant/slopsplorer/commit/c289028))
- Expand and Collapse in the source tree now act on the selected folder's subtree rather than on the whole tree. ([80cea2c](https://github.com/DmitriyAlergant/slopsplorer/commit/80cea2c))
- A folder's own files now read as the first row of every level of the source tree, above the subfolders, whichever order the level is sorted by. ([da6f3ce](https://github.com/DmitriyAlergant/slopsplorer/commit/da6f3ce))
- The folder panel now holds the heaviest files below its subfolder tiles, so one panel divides a folder by folder and by file, and the separate heaviest-files table at the foot of the page is gone with its threshold moved beside the rows it thins. ([da6f3ce](https://github.com/DmitriyAlergant/slopsplorer/commit/da6f3ce))
- The subfolder tiles are one row high, so the file table below them always starts in the same position. ([da6f3ce](https://github.com/DmitriyAlergant/slopsplorer/commit/da6f3ce))
- A folder tile's bar now divides by flavor in a comparison as well as in a scan, and it draws against a whole the flavor filters never change, so turning a flavor off shortens the bars instead of stretching the rest, and generated files are never in one. ([deca33d](https://github.com/DmitriyAlergant/slopsplorer/commit/deca33d))
- The install command for the agent skill now copies the skill into both `~/.claude/skills` and `~/.agents/skills` instead of linking one to the other, reads as PowerShell on Windows, and the dialog offers `SKILL.md` in the same preview the scanned files open in. ([fe01977](https://github.com/DmitriyAlergant/slopsplorer/commit/fe01977))

### Other Changes

- The app icon draws the snout bars in ink rather than orange, which holds its edges at a favicon's size. ([1346acd](https://github.com/DmitriyAlergant/slopsplorer/commit/1346acd))
- The flavor filters now take a row of their own when the filter bar runs out of width, instead of folding into two rows beside the switches, and the side and the unit switch stand further apart. ([449c500](https://github.com/DmitriyAlergant/slopsplorer/commit/449c500))
- The instrument bar is re-dressed: the artwork sits beside the wordmark, Rescan and Recompare are one icon beside what they re-read, the drill trail is now the source tree's heading instead of a row above the panels, and the agent skill is a link at the foot of the page. ([80cea2c](https://github.com/DmitriyAlergant/slopsplorer/commit/80cea2c))
- The change column now marks a file with Git's own letter - A, M, D, R - instead of a second coloured tag beside the flavor. ([da6f3ce](https://github.com/DmitriyAlergant/slopsplorer/commit/da6f3ce))
- The scope strip under the workspace now states the same columns as the folder head, in the same order, and every figure on the page keeps its place when the unit, the side of the change, or the drill scope moves. ([da6f3ce](https://github.com/DmitriyAlergant/slopsplorer/commit/da6f3ce))
- The bundled agent skill now states that Slopsplorer sorts every file into a flavor by itself, from the path and the content, with no configuration. ([8183fa4](https://github.com/DmitriyAlergant/slopsplorer/commit/8183fa4))


## [0.4.1](https://github.com/DmitriyAlergant/slopsplorer/releases/tag/v0.4.1) - 2026-08-27

### Features

- A busy default port no longer stops a run: Slopsplorer takes the next free port, and names the processes holding the ones it skipped with a `kill` command to reclaim them. A port you name with `--port` is still used or the run fails, with the same hint. ([c8d94c1](https://github.com/DmitriyAlergant/slopsplorer/commit/c8d94c1))
- The folder head states one figure at full strength and mutes the rest, holds every number in a fixed place as you move between folders, and colours a tile's headline by the side it names. ([9f0d89c](https://github.com/DmitriyAlergant/slopsplorer/commit/9f0d89c))

### Bug Fixes

- The file comparison dialog no longer slices its last visible row, and a fold at the top or bottom of a file sits flush against the edge. ([30ae917](https://github.com/DmitriyAlergant/slopsplorer/commit/30ae917))
- Every percentage now divides by the scope the filters leave, so a share names the tree on screen, and the net aspect states no percentage at all because a signed quantity has no honest whole. ([9f0d89c](https://github.com/DmitriyAlergant/slopsplorer/commit/9f0d89c))
- Scrolling the folder tree or a metrics table no longer traps the wheel: once a grid reaches its own end, or has nothing to scroll, the page scrolls instead. ([fa88116](https://github.com/DmitriyAlergant/slopsplorer/commit/fa88116))

### Documentation

- The README opens with a hero illustration and now shows diff mode as well as a scan. ([96a9e76](https://github.com/DmitriyAlergant/slopsplorer/commit/96a9e76))
- The README now shows a single file inside a comparison, and states more plainly what each mode is for. ([b0ec673](https://github.com/DmitriyAlergant/slopsplorer/commit/b0ec673))

### Other Changes

- The favicon and the app icons now draw the snout nostrils as a bar chart, on a larger snout. ([5b8a6e4](https://github.com/DmitriyAlergant/slopsplorer/commit/5b8a6e4))


## [0.4.0](https://github.com/DmitriyAlergant/slopsplorer/releases/tag/v0.4.0) - 2026-08-26

### Features

- The headline readouts and the proportion bar now sit below the source tree and the folder panel, so the page reads downstream from the filters that drive it, and a folder's file table no longer repeats its heading in a caption above. ([0257653a](https://github.com/DmitriyAlergant/slopsplorer/commit/0257653a))
- The unit and the side of a change are now switches at the top of the page - Tokens, Lines, or LOC beside Net, Added, Removed, Churn, and After - and every numeric column of both file tables still sorts on click and picks the same thing, so the old measure switch and the "rank by" list are gone. ([0257653a](https://github.com/DmitriyAlergant/slopsplorer/commit/0257653a))
- The heaviest-files list can now be curtailed by dragging the boundary under it, remembered across visits like the workspace height. ([73a2695](https://github.com/DmitriyAlergant/slopsplorer/commit/73a2695))
- The default tokenizer is now `o200k_base`; pass `--tokenizer cl100k_base` for the older encoding. ([8b1cec9](https://github.com/DmitriyAlergant/slopsplorer/commit/8b1cec9))
- The preview of a compared file now draws the diff in the language of the file, with a line number on each side and a switch that hides the unchanged lines. ([b198b0a](https://github.com/DmitriyAlergant/slopsplorer/commit/b198b0a))
- Source files that are almost entirely string literals, such as a hand-maintained translation catalogue written as a `.ts` module, are now counted as Data & Config or as i18n rather than as code, without misfiling shell scripts, icon components, or files holding one large embedded template. ([b35bd95](https://github.com/DmitriyAlergant/slopsplorer/commit/b35bd95))
- Net mode states the added and removed figures on each source tree row, over the two halves of the band, and drops a figure that a long name would cross. ([881c9e8](https://github.com/DmitriyAlergant/slopsplorer/commit/881c9e8))
- Added a Measure switch that expresses every total, bar, and ranking in tokens, lines, or LOC, orthogonally to the file-kind and scope filters. ([c6062fb](https://github.com/DmitriyAlergant/slopsplorer/commit/c6062fb))
- The folder panel now states every figure at once in one fixed strip - net, added, removed, churn, after, comment share, and file count in a comparison, and each measure in a scan - and every folder tile carries its weight, its file count, its share, and both sides of the change in the same shape whichever switch is selected. ([24d2f0a](https://github.com/DmitriyAlergant/slopsplorer/commit/24d2f0a))
- `--report` prints a text report of a tree or a change to stdout and exits: code and tests walked to a threshold share of their section, the other flavors one line each, steered by `--unit`, `--aspect`, and `--threshold`. ([416389e](https://github.com/DmitriyAlergant/slopsplorer/commit/416389e))
- Diff mode: point Slopsplorer at a comparison instead of a tree with `--diff`, `--staged`, or any revision range, and read where the weight of a change sits by churn or by signed net. ([14e19de](https://github.com/DmitriyAlergant/slopsplorer/commit/14e19de))
- The comparison in the diff header is now one chip for each side: each chip picks its own revision and measures at once, either side accepts a commit typed by hand, the arrow between them swaps the two sides, the "From" panel carries the merge-base switch and the chip says so when it is on, and a whole commit hash is abbreviated where it is drawn. ([e8270bf](https://github.com/DmitriyAlergant/slopsplorer/commit/e8270bf))
- Comment detection now covers formats with no tree-sitter grammar, reading block comments across lines for CSS, HTML, XML, SVG, Vue, Svelte, Lua, Terraform, INI, Kotlin, Swift, Scala, Dart, `Dockerfile`, `Makefile`, and more, and the whole shell family (`.bash`, `.ksh`, `.bats`, `.fish`, and `#!` scripts) is now measured. ([ef51006](https://github.com/DmitriyAlergant/slopsplorer/commit/ef51006))
- Drilling into a folder now re-roots the whole page: the headline readouts and the proportion bar describe the drilled folder, with a new "of project" readout keeping the global figure in view, and selecting a `.` row now shows that folder's own files as their own subject instead of repeating the folder's panel. ([952382f](https://github.com/DmitriyAlergant/slopsplorer/commit/952382f))
- The source tree and folder panel can now be resized in height together by dragging the boundary below them, and scrolling a table or the tree past either end no longer rubber-bands its sticky column headings. ([fb2e0b1](https://github.com/DmitriyAlergant/slopsplorer/commit/fb2e0b1))

### Bug Fixes

- A test folder no longer overrides a file's own format: fixtures, corpora, and sample documents under `tests/` are now counted as Data, Docs, or Other, and the Tests flavor is reserved for source files in a test folder plus anything named by a test convention. ([b35bd95](https://github.com/DmitriyAlergant/slopsplorer/commit/b35bd95))

### Other Changes

- The `--help` text and the bundled agent skill are rewritten to be shorter and drier. ([c4b4083](https://github.com/DmitriyAlergant/slopsplorer/commit/c4b4083))
- The share readout in the folder panel now uses the page's own tooltip instead of the browser's, so its hint is styled and appears without a delay. ([fa54cf1](https://github.com/DmitriyAlergant/slopsplorer/commit/fa54cf1))
- The favicon and the app icons are now a pig snout. ([f8fb970](https://github.com/DmitriyAlergant/slopsplorer/commit/f8fb970))


## [0.3.0](https://github.com/DmitriyAlergant/slopsplorer/releases/tag/v0.3.0) - 2026-08-26

### Features

- Drill into any folder with breadcrumbs while measuring source-tree and folder-detail bars against the active scope's unfiltered token total. ([32a6d6a](https://github.com/DmitriyAlergant/slopsplorer/commit/32a6d6a))
- Copy full project-relative file paths, mark ranked paths relative to the active drill root, and resize the source tree with a remembered draggable boundary. ([7a979f7](https://github.com/DmitriyAlergant/slopsplorer/commit/7a979f7))
- Explain every content flavor with a styled tooltip available on hover and keyboard focus, and label the fallback flavor accurately as Other. ([200ba91](https://github.com/DmitriyAlergant/slopsplorer/commit/200ba91))
- Show clear scan progress while opening a new source root and streamline the header controls around path editing and rescanning. ([d0293fa](https://github.com/DmitriyAlergant/slopsplorer/commit/d0293fa))
- Slopsplorer now opens the interactive map in your default browser when a scan finishes; pass `--no-open` to keep it closed. ([9e369d4](https://github.com/DmitriyAlergant/slopsplorer/commit/9e369d4))
- Remember content-flavor and source-tree sort preferences across visits, and display file paths relative to the selected folder or drill root. ([843e95f](https://github.com/DmitriyAlergant/slopsplorer/commit/843e95f))
- Copy the selected folder's project-relative path from a control beside its name in the detail panel. ([4983913](https://github.com/DmitriyAlergant/slopsplorer/commit/4983913))

### Bug Fixes

- Keep project-level selected-token figures aligned with content-flavor filters and tree checkboxes regardless of which folder is open. ([32a6d6a](https://github.com/DmitriyAlergant/slopsplorer/commit/32a6d6a))
- Keep page content fixed behind an open file preview and stop the development server promptly on Ctrl-C with an active hot-reload connection. ([a25a6c8](https://github.com/DmitriyAlergant/slopsplorer/commit/a25a6c8))
- Classify `requirements.txt` as Data & Config instead of Docs and use the clearer Data & Config label throughout the interface. ([124e08d](https://github.com/DmitriyAlergant/slopsplorer/commit/124e08d))

### Other Changes

- Polish repository exploration with stable token sorting during exclusions, fixed-width folder cards, responsive filter placement, clearer scope labels, and compact drill controls. ([32a6d6a](https://github.com/DmitriyAlergant/slopsplorer/commit/32a6d6a))


## [0.2.3](https://github.com/DmitriyAlergant/slopsplorer/releases/tag/v0.2.3) - 2026-08-26

### Features

- Show a live file-count and percentage progress bar while scanning larger repositories in an interactive terminal. ([2c6b6bb](https://github.com/DmitriyAlergant/slopsplorer/commit/2c6b6bb))
- Sort source-tree siblings by name or token weight, use one expand-or-collapse control, and remove the unexplained token subtotal from the panel header. ([724cade](https://github.com/DmitriyAlergant/slopsplorer/commit/724cade))

### Bug Fixes

- Scan files containing tokenizer control-token spellings such as `<|endoftext|>` instead of aborting the entire repository scan. ([e346510](https://github.com/DmitriyAlergant/slopsplorer/commit/e346510))
