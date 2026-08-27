# Changelog

All notable user-facing changes to Slopsplorer are recorded here.

<!-- towncrier release notes start -->

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
