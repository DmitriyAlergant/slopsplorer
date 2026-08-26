# Changelog

All notable user-facing changes to Slopsplorer are recorded here.

<!-- towncrier release notes start -->

## [0.2.3](https://github.com/DmitriyAlergant/slopsplorer/releases/tag/v0.2.3) - 2026-08-26

### Features

- Show a live file-count and percentage progress bar while scanning larger repositories in an interactive terminal. ([2c6b6bb](https://github.com/DmitriyAlergant/slopsplorer/commit/2c6b6bb))
- Sort source-tree siblings by name or token weight, use one expand-or-collapse control, and remove the unexplained token subtotal from the panel header. ([724cade](https://github.com/DmitriyAlergant/slopsplorer/commit/724cade))

### Bug Fixes

- Scan files containing tokenizer control-token spellings such as `<|endoftext|>` instead of aborting the entire repository scan. ([e346510](https://github.com/DmitriyAlergant/slopsplorer/commit/e346510))
