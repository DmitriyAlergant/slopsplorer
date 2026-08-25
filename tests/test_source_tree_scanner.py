from __future__ import annotations

import tempfile
import unittest
import subprocess
from pathlib import Path

from slopsplorer.source_tree_scanner import SourceTreeScanner


class SourceTreeScannerTests(unittest.TestCase):
    def test_nested_git_folder_uses_only_tracked_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory) / "repository"
            nested_root = repository / "apps" / "chat"
            nested_root.mkdir(parents=True)
            subprocess.run(["git", "init", "-q"], cwd=repository, check=True)
            (nested_root / "tracked.py").write_text("print('tracked')\n")
            (nested_root / "untracked.py").write_text("print('untracked')\n")
            subprocess.run(["git", "add", "apps/chat/tracked.py"], cwd=repository, check=True)

            snapshot = SourceTreeScanner(nested_root).scan_source_tree()

            self.assertEqual([file.path for file in snapshot.files], ["tracked.py"])

    def test_explicit_folder_hierarchy_keeps_siblings_under_their_real_parent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "chat"
            (root / "chainlit" / "backend").mkdir(parents=True)
            (root / "chainlit-datalayer" / "prisma").mkdir(parents=True)
            (root / "chainlit" / "backend" / "socket.py").write_text("def route():\n    return 1\n")
            (root / "chainlit-datalayer" / "prisma" / "schema.prisma").write_text("model User {}\n")

            snapshot = SourceTreeScanner(root, tracked_files_only=False).scan_source_tree()
            folders = {folder.path: folder for folder in snapshot.folders}

            self.assertEqual(folders[""].child_paths, ("chainlit", "chainlit-datalayer"))
            self.assertEqual(folders["chainlit"].child_paths, ("chainlit/backend",))
            self.assertEqual(
                folders["chainlit-datalayer"].child_paths,
                ("chainlit-datalayer/prisma",),
            )

    def test_modern_stack_file_kinds_and_generated_markers_are_independent(self) -> None:
        cases = {
            "src/service.py": ("code", False),
            "tests/test_service.py": ("test", False),
            "src/service.test.ts": ("test", False),
            "src/service_test.go": ("test", False),
            "src/service_test.rs": ("test", False),
            "docs/design.md": ("text", False),
            "translations/de-DE.json": ("i18n", False),
            "src/locales/en.yaml": ("i18n", False),
            "config/models.yaml": ("data", False),
            "fixtures/events.json": ("data", False),
            "generated/client.gen.go": ("code", True),
            "src/contracts.generated.ts": ("code", True),
            "Cargo.lock": ("other", True),
            "uv.lock": ("other", True),
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "project"
            for relative_path in cases:
                path = root / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("generated or source content\n")

            snapshot = SourceTreeScanner(root, tracked_files_only=False).scan_source_tree()
            files = {file.path: file for file in snapshot.files}

            self.assertEqual(set(files), set(cases))
            for path, expected in cases.items():
                self.assertEqual((files[path].file_kind, files[path].generated), expected)


if __name__ == "__main__":
    unittest.main()
