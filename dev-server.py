#!/usr/bin/env python3
"""Local dev server for Daybreak that disables browser caching entirely.

Use this instead of `python3 -m http.server` while iterating — it means an
edited file always shows up on the very next refresh, with no hard-reload
or "clear site data" step needed.

Usage:
    python3 dev-server.py            # serves on http://localhost:8000
    python3 dev-server.py 5173       # or pick a different port
"""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
    print(f"Serving Daybreak (no caching) at http://localhost:{PORT}")
    print("Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
