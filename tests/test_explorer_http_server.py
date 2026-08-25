from __future__ import annotations

import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

from slopsplorer.explorer_http_server import create_source_explorer_server
from slopsplorer.source_tree_scanner import SourceTreeScanner


class ExplorerHttpServerTests(unittest.TestCase):
    def test_server_exposes_snapshot_and_only_snapshot_source_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "project"
            root.mkdir()
            (root / "main.py").write_text("print('hello')\n")
            (root / "secret.bin").write_bytes(b"not in snapshot")
            snapshot = SourceTreeScanner(root, tracked_files_only=False).scan_source_tree()
            server = create_source_explorer_server(snapshot, "127.0.0.1", 0)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base_url = f"http://127.0.0.1:{server.server_port}"
            try:
                with urlopen(f"{base_url}/api/snapshot") as response:
                    payload = json.load(response)
                self.assertEqual(payload["files"][0]["path"], "main.py")

                with urlopen(f"{base_url}/api/source?path=main.py") as response:
                    preview = json.load(response)
                self.assertEqual(preview["content"], "print('hello')\n")

                with urlopen(f"{base_url}/highlight.min.js") as response:
                    highlight_javascript = response.read()
                self.assertIn(b"hljs", highlight_javascript)

                with self.assertRaises(HTTPError) as error:
                    urlopen(f"{base_url}/api/source?path=secret.bin")
                self.assertEqual(error.exception.code, 404)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
