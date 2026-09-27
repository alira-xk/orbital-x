"""Tiny static server for the Phase 1 live viewer."""
import http.server
import socketserver
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = 8765

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Allow the page to fetch telemetry.jsonl even when reloaded
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving on http://localhost:{PORT}/")
    print("Open that URL in your browser.")
    httpd.serve_forever()
