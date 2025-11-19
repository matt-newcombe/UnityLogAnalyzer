#!/usr/bin/env python3
"""
Local File Watcher Service
Watches a Unity log file and serves new lines via HTTP API
This allows the browser to access files in system directories

Can be used with both local and remote websites (GitHub Pages, etc.)
"""

import http.server
import socketserver
import json
import os
import time
import platform
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import threading
try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
    HAS_WATCHDOG = True
except ImportError:
    HAS_WATCHDOG = False
    print("Warning: watchdog not installed. File watching will use polling only.")
    print("Install with: pip install watchdog")

PORT = 8767  # Different from start.py (8765) to avoid conflicts

def get_default_unity_editor_log_path():
    """
    Get the default Unity Editor.log path based on the operating system.
    Based on: https://docs.unity3d.com/6000.2/Documentation/Manual/log-files.html
    """
    system = platform.system()
    home = Path.home()
    
    if system == 'Windows':
        # Windows: %LOCALAPPDATA%\Unity\Editor\Editor.log
        localappdata = os.environ.get('LOCALAPPDATA', '')
        if localappdata:
            return Path(localappdata) / 'Unity' / 'Editor' / 'Editor.log'
        else:
            # Fallback
            return home / 'AppData' / 'Local' / 'Unity' / 'Editor' / 'Editor.log'
    elif system == 'Darwin':  # macOS
        # macOS: ~/Library/Logs/Unity/Editor.log
        return home / 'Library' / 'Logs' / 'Unity' / 'Editor.log'
    elif system == 'Linux':
        # Linux: ~/.config/unity3d/Editor.log
        return home / '.config' / 'unity3d' / 'Editor.log'
    else:
        # Unknown OS - return None
        return None

if HAS_WATCHDOG:
    class LogFileHandler(FileSystemEventHandler):
        """Handles file system events for log files"""
        
        def __init__(self, file_path, callback):
            self.file_path = file_path
            self.callback = callback
            self.last_size = 0
            
        def on_modified(self, event):
            if event.src_path == str(self.file_path):
                self.callback()

class FileWatcherService:
    """Service that watches a log file and serves new content"""
    
    def __init__(self, file_path):
        self.file_path = Path(file_path)
        self.last_position = 0
        self.observers = []
        self.lock = threading.Lock()
        
        # Start file watcher (if watchdog is available)
        if self.file_path.exists():
            self.last_position = self.file_path.stat().st_size
            if HAS_WATCHDOG:
                self._start_watcher()
        else:
            print(f"Warning: File {file_path} does not exist yet")
    
    def _start_watcher(self):
        """Start watching the file for changes"""
        if not HAS_WATCHDOG:
            return
        event_handler = LogFileHandler(self.file_path, self._on_file_changed)
        observer = Observer()
        observer.schedule(event_handler, str(self.file_path.parent), recursive=False)
        observer.start()
        self.observers.append(observer)
        print(f"Watching file: {self.file_path}")
    
    def _on_file_changed(self):
        """Called when file is modified"""
        # Just notify that file changed - actual reading happens on request
        pass
    
    def get_new_lines(self):
        """Get new lines since last read. Returns (lines, was_reset) tuple."""
        if not self.file_path.exists():
            return [], False
        
        with self.lock:
            try:
                current_size = self.file_path.stat().st_size
                was_reset = False
                
                if current_size < self.last_position:
                    # File was truncated or recreated - Unity was reopened
                    old_position = self.last_position
                    was_reset = True
                    self.last_position = 0
                    print(f"⚠️  File reset detected! File size decreased from {old_position} to {current_size} bytes", flush=True)
                
                if current_size <= self.last_position:
                    return [], was_reset
                
                # Read new content
                with open(self.file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    f.seek(self.last_position)
                    new_content = f.read()
                    self.last_position = f.tell()
                
                # Split into lines
                lines = new_content.split('\n')
                # Remove empty last line if file doesn't end with newline
                if new_content and not new_content.endswith('\n'):
                    lines = lines[:-1] if lines else []
                
                return lines, was_reset
            except Exception as e:
                print(f"Error reading file: {e}", flush=True)
                return [], False
    
    def get_file_info(self):
        """Get current file information"""
        if not self.file_path.exists():
            return {
                'exists': False,
                'size': 0,
                'last_position': self.last_position
            }
        
        return {
            'exists': True,
            'size': self.file_path.stat().st_size,
            'last_position': self.last_position,
            'path': str(self.file_path)
        }
    
    def stop(self):
        """Stop watching"""
        for observer in self.observers:
            observer.stop()
            observer.join()

# Global file watcher instance
current_watcher = None

class FileWatcherHTTPHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP handler for file watcher API"""
    
    def end_headers(self):
        # CORS headers - allow requests from any origin (including GitHub Pages)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()
    
    def do_GET(self):
        global current_watcher
        
        parsed_path = urlparse(self.path)
        path = parsed_path.path
        query = parse_qs(parsed_path.query)
        
        # Log incoming requests (except for frequent polling)
        if path != '/api/poll':
            print(f"📥 Request: {path}", flush=True)
        
        # Set content type for API responses
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        
        if path == '/api/watch':
            # Start watching a file
            # If no file specified, try to auto-detect Unity Editor.log
            file_path = query.get('file', [None])[0]
            
            if not file_path:
                # Auto-detect Unity Editor.log path
                default_path = get_default_unity_editor_log_path()
                if default_path and default_path.exists():
                    file_path = str(default_path)
                    print(f"✓ Auto-detected Unity Editor.log: {file_path}", flush=True)
                else:
                    if default_path:
                        error_msg = f"Unity Editor.log not found at default location: {default_path}\n\nPlease specify the file path manually."
                    else:
                        error_msg = "Could not determine default Unity Editor.log path for this operating system.\n\nPlease specify the file path manually."
                    self.wfile.write(json.dumps({
                        'error': error_msg,
                        'default_path': str(default_path) if default_path else None,
                        'os': platform.system()
                    }).encode())
                    return
            
            # Validate file exists
            file_path_obj = Path(file_path)
            if not file_path_obj.exists():
                default_path = get_default_unity_editor_log_path()
                self.wfile.write(json.dumps({
                    'error': f'File not found: {file_path}',
                    'default_path': str(default_path) if default_path else None,
                    'os': platform.system()
                }).encode())
                return
            
            try:
                if current_watcher:
                    current_watcher.stop()
                
                current_watcher = FileWatcherService(file_path)
                file_info = current_watcher.get_file_info()
                
                # Check if this was auto-detected
                default_path = get_default_unity_editor_log_path()
                auto_detected = file_path == str(default_path) if default_path else False
                
                self.wfile.write(json.dumps({
                    'success': True,
                    'message': f'Watching file: {file_path}',
                    'file_path': file_path,
                    'auto_detected': auto_detected,
                    'info': file_info
                }).encode())
                print(f"✓ Now watching: {file_path}", flush=True)
            except Exception as e:
                self.wfile.write(json.dumps({'error': str(e)}).encode())
        
        elif path == '/api/poll':
            # Poll for new lines (silent - don't log every poll to avoid spam)
            if not current_watcher:
                self.wfile.write(json.dumps({
                    'error': 'No file being watched. Call /api/watch first.'
                }).encode())
                return
            
            new_lines, was_reset = current_watcher.get_new_lines()
            info = current_watcher.get_file_info()
            
            self.wfile.write(json.dumps({
                'new_lines': new_lines,
                'line_count': len(new_lines),
                'file_info': info,
                'file_reset': was_reset
            }).encode())
        
        elif path == '/api/read':
            # Read file content from a specific position (for processing new content)
            if not current_watcher:
                self.wfile.write(json.dumps({
                    'error': 'No file being watched. Call /api/watch first.'
                }).encode())
                return
            
            start_pos = int(query.get('start', [0])[0])
            current_size = current_watcher.file_path.stat().st_size
            was_reset = False
            
            # Check if file was reset (size decreased)
            if current_size < current_watcher.last_position:
                was_reset = True
                start_pos = 0  # Reset to beginning
                with current_watcher.lock:
                    old_position = current_watcher.last_position
                    current_watcher.last_position = 0
                print(f"⚠️  File reset detected during read! File size decreased from {old_position} to {current_size} bytes", flush=True)
            
            try:
                with open(current_watcher.file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    f.seek(start_pos)
                    content = f.read()
                    current_pos = f.tell()
                
                # Split into lines for easier processing
                lines = content.split('\n')
                # If content doesn't end with newline, the last "line" is incomplete
                ends_with_newline = content.endswith('\n')
                
                self.wfile.write(json.dumps({
                    'content': content,
                    'lines': lines if ends_with_newline else lines[:-1],
                    'incomplete_line': lines[-1] if not ends_with_newline else None,
                    'start_position': start_pos,
                    'end_position': current_pos,
                    'file_info': current_watcher.get_file_info(),
                    'file_reset': was_reset
                }).encode())
            except Exception as e:
                self.wfile.write(json.dumps({
                    'error': str(e)
                }).encode())
        
        elif path == '/api/info':
            # Get file info (returns success even if no file is being watched - indicates service is available)
            # This is called frequently for availability checks, so we don't log it
            if not current_watcher:
                # Service is available but no file is being watched yet
                self.wfile.write(json.dumps({
                    'service_available': True,
                    'file_info': {
                        'exists': False,
                        'size': 0,
                        'last_position': 0,
                        'path': None
                    }
                }).encode())
                return
            
            file_info = current_watcher.get_file_info()
            self.wfile.write(json.dumps({
                'service_available': True,
                'file_info': file_info
            }).encode())
        
        elif path == '/api/update_position':
            # Update the last processed position (called after processing lines)
            if not current_watcher:
                self.wfile.write(json.dumps({
                    'error': 'No file being watched'
                }).encode())
                return
            
            new_position = int(query.get('position', [current_watcher.last_position])[0])
            current_watcher.last_position = new_position
            
            self.wfile.write(json.dumps({
                'success': True,
                'position': new_position,
                'file_info': current_watcher.get_file_info()
            }).encode())
        
        elif path == '/api/stop':
            # Stop watching
            if current_watcher:
                current_watcher.stop()
                current_watcher = None
                self.wfile.write(json.dumps({'success': True, 'message': 'Stopped watching'}).encode())
            else:
                self.wfile.write(json.dumps({'error': 'No file being watched'}).encode())
        
        else:
            self.wfile.write(json.dumps({'error': 'Unknown endpoint'}).encode())
    
    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def log_message(self, format, *args):
        """Suppress default logging"""
        pass

def main():
    import sys
    import socket
    
    # Ensure output is unbuffered for real-time display
    sys.stdout.reconfigure(line_buffering=True) if hasattr(sys.stdout, 'reconfigure') else None
    
    print("=" * 60, flush=True)
    print("Unity Log File Watcher Service", flush=True)
    print("=" * 60, flush=True)
    print(f"Starting on port {PORT}", flush=True)
    print(f"\nThis service allows the browser to monitor Unity log files", flush=True)
    print(f"even when they're in system directories.", flush=True)
    print(f"\nAPI endpoints:", flush=True)
    print(f"  GET /api/watch?file=<path>  - Start watching a file (auto-detects if no path)", flush=True)
    print(f"  GET /api/poll               - Get new lines since last poll", flush=True)
    print(f"  GET /api/read?start=<pos>   - Read file content from position", flush=True)
    print(f"  GET /api/info               - Get file information", flush=True)
    print(f"  GET /api/update_position?position=<pos> - Update last processed position", flush=True)
    print(f"  GET /api/stop               - Stop watching", flush=True)
    print(f"\n✓ CORS enabled - works with GitHub Pages and remote sites", flush=True)
    print(f"✓ Auto-detects Unity Editor.log at default OS location", flush=True)
    print(f"✓ Keep this running while using the Unity Log Analyzer", flush=True)
    print(f"\nPress Ctrl+C to stop", flush=True)
    print("=" * 60, flush=True)
    print("", flush=True)  # Empty line for readability
    
    # Check if port is already in use
    try:
        test_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        test_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        test_socket.bind(("", PORT))
        test_socket.close()
    except OSError:
        print(f"", flush=True)
        print(f"⚠️  ERROR: Port {PORT} is already in use!", flush=True)
        print(f"", flush=True)
        print(f"This usually means:", flush=True)
        print(f"  1. Another instance of file_watcher.py is already running", flush=True)
        print(f"  2. The integrated file watcher in start.py is using this port", flush=True)
        print(f"  3. Another application is using port {PORT}", flush=True)
        print(f"", flush=True)
        print(f"To fix this:", flush=True)
        print(f"  - If using start.py, you don't need to run file_watcher.py separately", flush=True)
        print(f"  - If you need the standalone watcher, stop the other instance first", flush=True)
        print(f"  - Or find and kill the process using port {PORT}:", flush=True)
        print(f"    lsof -ti:{PORT} | xargs kill", flush=True)
        print(f"", flush=True)
        sys.exit(1)
    
    try:
        with socketserver.TCPServer(("", PORT), FileWatcherHTTPHandler) as httpd:
            try:
                print(f"✓ Server started successfully on port {PORT}", flush=True)
                print(f"✓ Waiting for file watch requests...", flush=True)
                print("", flush=True)
                httpd.serve_forever()
            except KeyboardInterrupt:
                print("\n", flush=True)
                print("Shutting down...", flush=True)
                if current_watcher:
                    current_watcher.stop()
                print("✓ File watcher stopped", flush=True)
    except OSError as e:
        if "Address already in use" in str(e):
            print(f"", flush=True)
            print(f"⚠️  ERROR: Port {PORT} is already in use!", flush=True)
            print(f"", flush=True)
            print(f"This usually means:", flush=True)
            print(f"  1. Another instance of file_watcher.py is already running", flush=True)
            print(f"  2. The integrated file watcher in start.py is using this port", flush=True)
            print(f"  3. Another application is using port {PORT}", flush=True)
            print(f"", flush=True)
            print(f"To fix this:", flush=True)
            print(f"  - If using start.py, you don't need to run file_watcher.py separately", flush=True)
            print(f"  - If you need the standalone watcher, stop the other instance first", flush=True)
            print(f"  - Or find and kill the process using port {PORT}:", flush=True)
            print(f"    lsof -ti:{PORT} | xargs kill", flush=True)
            print(f"", flush=True)
        else:
            print(f"", flush=True)
            print(f"⚠️  ERROR: Failed to start server: {e}", flush=True)
            print(f"", flush=True)
        sys.exit(1)

if __name__ == "__main__":
    main()

