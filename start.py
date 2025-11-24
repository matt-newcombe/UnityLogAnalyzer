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
import urllib.request
import urllib.parse
import http.client

PORT = 8765
FILE_WATCHER_PORT = 8767

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        # CORS headers for file watcher API
        if self.path.startswith('/api/file-watcher'):
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        super().end_headers()

    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        if self.path.startswith('/api/file-watcher'):
            self.send_response(200)
            self.end_headers()
        else:
            super().do_OPTIONS()

    def do_GET(self):
        """Handle GET requests, proxy file watcher API to standalone service"""
        # Proxy file watcher API requests to standalone service
        if self.path.startswith('/api/file-watcher'):
            try:
                # Parse the path and query string
                parsed = urllib.parse.urlparse(self.path)
                # Map /api/file-watcher/* to /api/*
                proxy_path = parsed.path.replace('/api/file-watcher', '/api', 1)
                # Reconstruct URL with query string
                proxy_url = f'http://localhost:{FILE_WATCHER_PORT}{proxy_path}'
                if parsed.query:
                    proxy_url += f'?{parsed.query}'
                
                # Forward the request
                req = urllib.request.Request(proxy_url)
                
                # Check if this is an SSE stream endpoint
                is_sse_stream = proxy_path == '/api/stream'
                
                if is_sse_stream:
                    # Handle SSE streams specially using http.client for better control
                    try:
                        conn = http.client.HTTPConnection('localhost', FILE_WATCHER_PORT, timeout=None)
                        conn.request('GET', proxy_path + ('?' + parsed.query if parsed.query else ''))
                        upstream_response = conn.getresponse()
                        
                        # Copy response status
                        self.send_response(upstream_response.status)
                        
                        # Copy headers (preserve SSE headers, especially Content-Type)
                        # Exclude CORS headers since end_headers() will set them
                        for header, value in upstream_response.getheaders():
                            header_lower = header.lower()
                            if header_lower not in ['connection', 'transfer-encoding', 'content-length', 'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers']:
                                self.send_header(header, value)
                        self.end_headers()
                        
                        # Stream data chunk by chunk
                        try:
                            while True:
                                chunk = upstream_response.read(8192)  # Read 8KB chunks
                                if not chunk:
                                    break
                                self.wfile.write(chunk)
                                self.wfile.flush()
                        except (BrokenPipeError, OSError):
                            # Client disconnected
                            pass
                        finally:
                            conn.close()
                    except Exception as e:
                        # If SSE proxying fails, return error
                        self.send_response(500)
                        self.send_header('Content-Type', 'application/json')
                        self.end_headers()
                        import json
                        self.wfile.write(json.dumps({'error': f'SSE proxy error: {str(e)}'}).encode())
                else:
                    # Regular request - read entire response
                    with urllib.request.urlopen(req, timeout=5) as response:
                        # Copy response
                        self.send_response(response.getcode())
                        # Copy headers
                        # Exclude CORS headers since end_headers() will set them
                        for header, value in response.headers.items():
                            header_lower = header.lower()
                            if header_lower not in ['connection', 'transfer-encoding', 'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers']:
                                self.send_header(header, value)
                        self.end_headers()
                        # Copy body
                        self.wfile.write(response.read())
                return
            except urllib.error.URLError as e:
                # File watcher service not available
                self.send_response(503)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                import json
                self.wfile.write(json.dumps({
                    'error': 'File watcher service not available',
                    'message': 'Make sure editor_log_watcher.py is running on port 8767'
                }).encode())
                return
            except Exception as e:
                # Error proxying request
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                import json
                self.wfile.write(json.dumps({'error': str(e)}).encode())
                return
        
        # Handle regular file requests
        super().do_GET()

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

