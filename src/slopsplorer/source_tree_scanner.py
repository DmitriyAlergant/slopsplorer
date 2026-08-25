"""Scan one source tree into token and structure metrics."""

from __future__ import annotations

import ast
import re
import subprocess
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

import tiktoken


DEFAULT_SOURCE_EXTENSIONS = frozenset(
    {
        ".c",
        ".cc",
        ".cpp",
        ".csv",
        ".css",
        ".go",
        ".h",
        ".hpp",
        ".html",
        ".java",
        ".js",
        ".json",
        ".jsx",
        ".kt",
        ".kts",
        ".lua",
        ".md",
        ".mdx",
        ".php",
        ".po",
        ".pot",
        ".prisma",
        ".py",
        ".rb",
        ".rs",
        ".rst",
        ".scss",
        ".sh",
        ".sql",
        ".svelte",
        ".swift",
        ".toml",
        ".txt",
        ".ts",
        ".tsx",
        ".tsv",
        ".vue",
        ".xml",
        ".yaml",
        ".yml",
        ".zsh",
        ".adoc",
        ".lock",
    }
)
DEFAULT_EXCLUDED_DIRECTORIES = frozenset(
    {
        ".git",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".tox",
        ".venv",
        "__pycache__",
        "node_modules",
        "target",
        "vendor",
    }
)


@dataclass(frozen=True)
class SourceFileMetrics:
    """Measurements for one source file, with paths relative to the scan root."""

    path: str
    name: str
    parent_path: str
    extension: str
    tokens: int
    lines: int
    bytes: int
    functions: int
    classes: int
    async_functions: int
    branches: int
    file_kind: str
    generated: bool


@dataclass(frozen=True)
class SourceFolderMetrics:
    """Recursive totals and explicit hierarchy links for one source folder."""

    path: str
    name: str
    parent_path: str | None
    child_paths: tuple[str, ...]
    direct_file_paths: tuple[str, ...]
    tokens: int
    lines: int
    bytes: int
    file_count: int


@dataclass(frozen=True)
class SourceTreeSnapshot:
    """Serializable, immutable source tree snapshot served to the browser."""

    root_name: str
    root_path: str
    tokenizer: str
    files: tuple[SourceFileMetrics, ...]
    folders: tuple[SourceFolderMetrics, ...]

    def to_dict(self) -> dict[str, object]:
        """Convert the snapshot into the browser API payload."""

        return {
            "rootName": self.root_name,
            "rootPath": self.root_path,
            "tokenizer": self.tokenizer,
            "files": [asdict(file) for file in self.files],
            "folders": [asdict(folder) for folder in self.folders],
        }


class SourceTreeScanner:
    """Measure tracked or filesystem source files beneath one fixed root."""

    def __init__(
        self,
        root_path: Path,
        *,
        tracked_files_only: bool = True,
        excluded_directories: Iterable[str] = (),
        source_extensions: Iterable[str] = DEFAULT_SOURCE_EXTENSIONS,
        tokenizer_name: str = "cl100k_base",
        max_file_bytes: int = 2 * 1024 * 1024,
    ) -> None:
        self.root_path = root_path.expanduser().resolve(strict=True)
        if not self.root_path.is_dir():
            raise ValueError(f"Source scan root is not a directory: {self.root_path}")
        self.tracked_files_only = tracked_files_only
        self.excluded_directories = DEFAULT_EXCLUDED_DIRECTORIES | frozenset(excluded_directories)
        self.source_extensions = frozenset(self._normalize_extension(ext) for ext in source_extensions)
        self.tokenizer_name = tokenizer_name
        self.tokenizer = tiktoken.get_encoding(tokenizer_name)
        self.max_file_bytes = max_file_bytes

    def scan_source_tree(self) -> SourceTreeSnapshot:
        """Build one complete source tree snapshot from the configured root."""

        file_metrics = tuple(self._measure_source_file(path) for path in self._list_source_files())
        folder_metrics = self._aggregate_source_folders(file_metrics)
        return SourceTreeSnapshot(
            root_name=self.root_path.name,
            root_path=str(self.root_path),
            tokenizer=self.tokenizer_name,
            files=file_metrics,
            folders=folder_metrics,
        )

    def _list_source_files(self) -> list[Path]:
        if self.tracked_files_only and self._is_inside_git_worktree():
            candidates = self._list_git_tracked_files()
        else:
            candidates = [path for path in self.root_path.rglob("*") if path.is_file()]
        return sorted(path for path in candidates if self._accept_source_file(path))

    def _list_git_tracked_files(self) -> list[Path]:
        result = subprocess.run(
            ["git", "ls-files", "-z", "--", "."],
            cwd=self.root_path,
            check=True,
            capture_output=True,
        )
        return [self.root_path / raw.decode("utf-8") for raw in result.stdout.split(b"\0") if raw]

    def _is_inside_git_worktree(self) -> bool:
        result = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=self.root_path,
            capture_output=True,
            text=True,
        )
        return result.returncode == 0 and result.stdout.strip() == "true"

    def _accept_source_file(self, path: Path) -> bool:
        try:
            relative_path = path.relative_to(self.root_path)
        except ValueError:
            return False
        if any(part in self.excluded_directories for part in relative_path.parts[:-1]):
            return False
        if path.suffix.lower() not in self.source_extensions:
            return False
        try:
            return path.stat().st_size <= self.max_file_bytes
        except FileNotFoundError:
            return False

    def _measure_source_file(self, path: Path) -> SourceFileMetrics:
        relative_path = path.relative_to(self.root_path).as_posix()
        text = path.read_text(encoding="utf-8", errors="replace")
        structure = self._measure_python_structure(text) if path.suffix.lower() == ".py" else self._empty_structure()
        return SourceFileMetrics(
            path=relative_path,
            name=path.name,
            parent_path=("" if Path(relative_path).parent.as_posix() == "." else Path(relative_path).parent.as_posix()),
            extension=path.suffix.lower(),
            tokens=len(self.tokenizer.encode(text)),
            lines=text.count("\n") + (1 if text and not text.endswith("\n") else 0),
            bytes=len(text.encode("utf-8")),
            file_kind=self._classify_source_file(relative_path),
            generated=self._is_generated_source_file(relative_path),
            **structure,
        )

    @staticmethod
    def _classify_source_file(relative_path: str) -> str:
        """Classify code, test, text, and other files with modern-stack conventions."""

        path = Path(relative_path)
        name = path.name.lower()
        parts = {part.lower() for part in path.parts}
        extension = path.suffix.lower()
        locale_stem = path.stem.lower()
        if (
            parts & {"i18n", "locale", "locales", "translation", "translations"}
            or (
                extension in {".json", ".yaml", ".yml", ".po", ".pot"}
                and re.fullmatch(r"[a-z]{2,3}(?:[-_][a-z]{2,4})?", locale_stem)
            )
        ):
            return "i18n"
        if extension in {".csv", ".json", ".toml", ".tsv", ".xml", ".yaml", ".yml"}:
            return "data"
        if (
            name.startswith("test_")
            or name.endswith(("_test.py", "_test.go", "_test.rs"))
            or any(marker in name for marker in (".test.", ".spec."))
            or "tests" in parts
            or "__tests__" in parts
        ):
            return "test"
        if extension in {".md", ".mdx", ".txt", ".rst", ".adoc"}:
            return "text"
        if extension in {
            ".c", ".cc", ".cpp", ".go", ".h", ".hpp", ".java", ".js", ".jsx", ".kt",
            ".kts", ".lua", ".php", ".py", ".rb", ".rs", ".sh", ".swift", ".ts", ".tsx",
            ".vue", ".zsh",
        }:
            return "code"
        return "other"

    @staticmethod
    def _is_generated_source_file(relative_path: str) -> bool:
        """Detect common generated-source conventions without inspecting file contents."""

        path = Path(relative_path)
        name = path.name.lower()
        parts = {part.lower() for part in path.parts[:-1]}
        if parts & {"generated", "gen", "dist", "build", "coverage"}:
            return True
        return (
            name.endswith((".generated.ts", ".generated.tsx", ".generated.js", ".g.ts", ".gen.go"))
            or name.endswith(("_generated.go", ".pb.go", "_pb2.py", "_pb2_grpc.py"))
            or name.endswith((".min.js", ".min.css", ".map"))
            or name.endswith(".lock")
            or name in {"package-lock.json", "pnpm-lock.yaml", "yarn.lock"}
        )

    @staticmethod
    def _measure_python_structure(text: str) -> dict[str, int]:
        try:
            tree = ast.parse(text)
        except SyntaxError:
            return SourceTreeScanner._empty_structure()
        counts = Counter(type(node).__name__ for node in ast.walk(tree))
        return {
            "functions": counts["FunctionDef"] + counts["AsyncFunctionDef"],
            "classes": counts["ClassDef"],
            "async_functions": counts["AsyncFunctionDef"],
            "branches": counts["If"]
            + counts["For"]
            + counts["AsyncFor"]
            + counts["While"]
            + counts["Try"]
            + counts["Match"],
        }

    @staticmethod
    def _empty_structure() -> dict[str, int]:
        return {"functions": 0, "classes": 0, "async_functions": 0, "branches": 0}

    def _aggregate_source_folders(
        self, files: tuple[SourceFileMetrics, ...]
    ) -> tuple[SourceFolderMetrics, ...]:
        folder_paths = {""}
        for file in files:
            parent = Path(file.parent_path)
            while parent.as_posix() not in {".", ""}:
                folder_paths.add(parent.as_posix())
                parent = parent.parent

        folders: list[SourceFolderMetrics] = []
        for folder_path in sorted(folder_paths, key=lambda path: (path.count("/"), path)):
            prefix = f"{folder_path}/" if folder_path else ""
            descendant_files = [file for file in files if not folder_path or file.path.startswith(prefix)]
            direct_files = tuple(sorted(file.path for file in files if file.parent_path == folder_path))
            child_paths = tuple(
                sorted(
                    candidate
                    for candidate in folder_paths
                    if candidate
                    and self._parent_folder_path(candidate) == folder_path
                )
            )
            folders.append(
                SourceFolderMetrics(
                    path=folder_path,
                    name=Path(folder_path).name if folder_path else self.root_path.name,
                    parent_path=self._parent_folder_path(folder_path) if folder_path else None,
                    child_paths=child_paths,
                    direct_file_paths=direct_files,
                    tokens=sum(file.tokens for file in descendant_files),
                    lines=sum(file.lines for file in descendant_files),
                    bytes=sum(file.bytes for file in descendant_files),
                    file_count=len(descendant_files),
                )
            )
        return tuple(folders)

    @staticmethod
    def _parent_folder_path(path: str) -> str:
        parent = Path(path).parent.as_posix()
        return "" if parent == "." else parent

    @staticmethod
    def _normalize_extension(extension: str) -> str:
        normalized = extension.lower()
        return normalized if normalized.startswith(".") else f".{normalized}"
