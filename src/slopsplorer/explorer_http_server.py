"""Serve a fixed source snapshot and bounded source previews over loopback HTTP."""

from __future__ import annotations

import json
import mimetypes
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from .source_tree_scanner import SourceTreeSnapshot


SOURCE_PREVIEW_MAX_BYTES = 512 * 1024


class SourceExplorerRequestHandler(BaseHTTPRequestHandler):
    """Serve static UI assets and read-only APIs for one startup snapshot."""

    snapshot: SourceTreeSnapshot
    snapshot_json: bytes
    source_root: Path
    allowed_source_paths: frozenset[str]
    static_directory: Path

    def do_GET(self) -> None:
        """Route one read-only explorer request."""

        request = urlparse(self.path)
        if request.path == "/api/snapshot":
            self._send_bytes(self.snapshot_json, "application/json; charset=utf-8")
            return
        if request.path == "/api/source":
            self._send_source_preview(parse_qs(request.query))
            return
        if request.path == "/api/health":
            self._send_json({"status": "ok", "rootPath": self.snapshot.root_path})
            return
        self._send_static_asset(request.path)

    def log_message(self, format: str, *args: object) -> None:
        """Keep the server quiet except for startup and explicit failures."""

    def _send_source_preview(self, query: dict[str, list[str]]) -> None:
        requested_path = unquote(query.get("path", [""])[0])
        if requested_path not in self.allowed_source_paths:
            self._send_json({"error": "Source preview path is outside the startup snapshot"}, HTTPStatus.NOT_FOUND)
            return
        source_path = (self.source_root / requested_path).resolve()
        if not source_path.is_relative_to(self.source_root):
            self._send_json({"error": "Source preview path escaped the scan root"}, HTTPStatus.BAD_REQUEST)
            return
        source_bytes = source_path.read_bytes()
        truncated = len(source_bytes) > SOURCE_PREVIEW_MAX_BYTES
        preview_bytes = source_bytes[:SOURCE_PREVIEW_MAX_BYTES]
        self._send_json(
            {
                "path": requested_path,
                "content": preview_bytes.decode("utf-8", errors="replace"),
                "truncated": truncated,
                "totalBytes": len(source_bytes),
            }
        )

    def _send_static_asset(self, request_path: str) -> None:
        relative_asset = "index.html" if request_path in {"", "/"} else request_path.lstrip("/")
        asset_path = (self.static_directory / relative_asset).resolve()
        if not asset_path.is_relative_to(self.static_directory) or not asset_path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type = mimetypes.guess_type(asset_path.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type in {"application/javascript", "application/json"}:
            content_type += "; charset=utf-8"
        self._send_bytes(asset_path.read_bytes(), content_type)

    def _send_json(self, payload: dict[str, object], status: HTTPStatus = HTTPStatus.OK) -> None:
        self._send_bytes(
            json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            "application/json; charset=utf-8",
            status,
        )

    def _send_bytes(
        self,
        payload: bytes,
        content_type: str,
        status: HTTPStatus = HTTPStatus.OK,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)


def create_source_explorer_server(
    snapshot: SourceTreeSnapshot,
    host: str,
    port: int,
) -> ThreadingHTTPServer:
    """Create a source explorer server fixed to one immutable startup snapshot."""

    static_directory = Path(__file__).parent / "static"
    handler = type(
        "BoundSourceExplorerRequestHandler",
        (SourceExplorerRequestHandler,),
        {
            "snapshot": snapshot,
            "snapshot_json": json.dumps(snapshot.to_dict(), separators=(",", ":")).encode("utf-8"),
            "source_root": Path(snapshot.root_path),
            "allowed_source_paths": frozenset(file.path for file in snapshot.files),
            "static_directory": static_directory,
        },
    )
    return ThreadingHTTPServer((host, port), handler)

