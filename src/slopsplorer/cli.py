"""Command-line entry point for scanning and serving a source folder."""

from __future__ import annotations

import argparse
from pathlib import Path

from .explorer_http_server import create_source_explorer_server
from .source_tree_scanner import SourceTreeScanner


def build_source_explorer_parser() -> argparse.ArgumentParser:
    """Define the stable command-line contract for the explorer."""

    parser = argparse.ArgumentParser(description="Explore a source folder by tokenizer-measured weight.")
    parser.add_argument("root", type=Path, help="Folder to scan and expose read-only")
    parser.add_argument("--host", default="127.0.0.1", help="HTTP bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="HTTP port (default: 8765)")
    parser.add_argument(
        "--all-files",
        action="store_true",
        help="Walk the filesystem instead of using git ls-files in a Git worktree",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        metavar="DIRECTORY",
        help="Exclude a directory name; repeat for multiple names",
    )
    parser.add_argument("--tokenizer", default="cl100k_base", help="Tiktoken encoding name")
    return parser


def run_slopsplorer() -> None:
    """Scan the requested root once and serve the interactive explorer until interrupted."""

    args = build_source_explorer_parser().parse_args()
    scanner = SourceTreeScanner(
        args.root,
        tracked_files_only=not args.all_files,
        excluded_directories=args.exclude,
        tokenizer_name=args.tokenizer,
    )
    snapshot = scanner.scan_source_tree()
    server = create_source_explorer_server(snapshot, args.host, args.port)
    total_tokens = sum(file.tokens for file in snapshot.files)
    print(
        f"Slopsplorer scanned {len(snapshot.files):,} files and "
        f"{total_tokens:,} tokens under {snapshot.root_path}"
    )
    print(f"Open http://{args.host}:{server.server_port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Slopsplorer")
    finally:
        server.server_close()


if __name__ == "__main__":
    run_slopsplorer()
