# Changelog

All notable user-facing changes to Slopsplorer are recorded here.

<!-- towncrier release notes start -->

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
