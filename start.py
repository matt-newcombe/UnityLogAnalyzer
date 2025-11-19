#!/usr/bin/env python3
"""
Simple HTTP server for local development.
Required because Web Workers cannot load from file:// protocol.
"""

import http.server
import socketserver
import webbrowser
import sys
import os

PORT = 8765

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def guess_type(self, path):
        mimetype = super().guess_type(path)
        if path.endswith('.js'):
            return 'application/javascript'
        if path.endswith('.css'):
            return 'text/css'
        return mimetype

def main():
    # Change to script directory
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    try:
        with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
            url = f"http://localhost:{PORT}/index.html"
            print(f"Starting server at {url}")
            print("Press Ctrl+C to stop")
            webbrowser.open(url)
            httpd.serve_forever()
    except OSError as e:
        if "Address already in use" in str(e):
            print(f"Port {PORT} is already in use. Using existing server...")
            webbrowser.open(f"http://localhost:{PORT}/index.html")
        else:
            print(f"Error: {e}")
            sys.exit(1)

if __name__ == "__main__":
    main()

