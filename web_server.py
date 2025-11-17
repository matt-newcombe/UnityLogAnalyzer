#!/usr/bin/env python3
"""
Unity Log Analyzer Web Server
Flask-based web server for visualizing Unity Editor log data
"""

from flask import Flask, jsonify, render_template, send_from_directory, request, make_response, Response
from werkzeug.utils import secure_filename
import os
import tempfile
import sqlite3
import json
import subprocess
from pathlib import Path

app = Flask(__name__, static_folder='static', template_folder='templates')

# Get version information
def get_version():
    """Get version number and git hash"""
    # Read VERSION file
    version_num = '0.0.0'
    try:
        with open('VERSION', 'r') as f:
            version_num = f.read().strip()
    except:
        pass
    
    # Get git hash
    git_hash = 'unknown'
    try:
        result = subprocess.run(
            ['git', 'rev-parse', '--short', 'HEAD'],
            capture_output=True,
            text=True,
            timeout=1
        )
        if result.returncode == 0:
            git_hash = result.stdout.strip()
    except:
        pass
    
    return f"v{version_num} ({git_hash})"

APP_VERSION = get_version()

# Add CSP headers to allow inline scripts
@app.after_request
def add_security_headers(response):
    # Allow inline scripts and eval for our application
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "font-src 'self' data:; "
        "connect-src 'self' https://cdn.jsdelivr.net;"
    )
    return response

DB_PATH = "unity_log.db"


def get_db():
    """Get database connection"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@app.route('/')
def index():
    """Serve main dashboard page"""
    return render_template('dashboard.html', version=APP_VERSION)


@app.route('/favicon.ico')
def favicon():
    """Handle favicon request to prevent 404 errors"""
    return '', 204  # No Content


@app.route('/log-viewer')
def log_viewer():
    """Serve log viewer page"""
    return render_template('log_viewer.html', version=APP_VERSION)


@app.route('/log-parser')
def log_parser():
    """Serve log parser page"""
    return render_template('log_parser.html', version=APP_VERSION)


@app.route('/api/logs')
def get_logs():
    """Get list of all parsed logs"""
    # Check if database exists
    if not Path(DB_PATH).exists():
        return jsonify([])
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if table exists
        cursor.execute("""
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='log_metadata'
        """)
        if not cursor.fetchone():
            conn.close()
            return jsonify([])
        
        cursor.execute("""
            SELECT id, log_file, unity_version, platform, architecture, project_name,
                   date_parsed, total_lines, total_parse_time_ms
            FROM log_metadata
            ORDER BY date_parsed DESC
        """)
        
        logs = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(logs)
    except sqlite3.OperationalError:
        # Table doesn't exist or database is corrupted
        try:
            conn.close()
        except:
            pass
        return jsonify([])
    except Exception as e:
        try:
            conn.close()
        except:
            pass
        return jsonify({'error': str(e)}), 500


@app.route('/api/parse-log', methods=['POST'])
def parse_log():
    """Parse an uploaded log file with streaming progress"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    # Save uploaded file to temporary location
    temp_dir = tempfile.gettempdir()
    temp_path = os.path.join(temp_dir, secure_filename(file.filename))
    file.save(temp_path)
    
    def generate():
        """Generator function for Server-Sent Events"""
        import sys
        import io
        import threading
        from queue import Queue
        
        try:
            # Import and use the parser
            from log_parser import UnityLogParser
            
            # Clear existing database (or create new one)
            db_path = DB_PATH
            if os.path.exists(db_path):
                os.remove(db_path)
            
            # Send initial message
            yield f"data: {json.dumps({'message': 'Creating parser instance (initializing database schema)...'})}\n\n"
            
            # Create a queue to collect output from the parser thread
            output_queue = Queue()
            parsing_complete = threading.Event()
            parse_exception = [None]  # Use list to allow modification from inner scope
            
            # Custom stream that queues output for real-time streaming
            class StreamingWriter:
                def __init__(self, queue, original_stream):
                    self.queue = queue
                    self.original_stream = original_stream
                    self.buffer = ''
                
                def write(self, text):
                    # Write to original stream as well
                    self.original_stream.write(text)
                    self.original_stream.flush()
                    
                    # Add to buffer and check for complete lines
                    self.buffer += text
                    while '\n' in self.buffer:
                        line, self.buffer = self.buffer.split('\n', 1)
                        if line.strip():
                            self.queue.put(line.strip())
                    # Also check if we have a substantial buffer without newline (for progress updates)
                    if len(self.buffer) > 50 and not '\n' in self.buffer:
                        # Flush partial line if it's getting long
                        self.queue.put(self.buffer)
                        self.buffer = ''
                
                def flush(self):
                    self.original_stream.flush()
                    # Flush any remaining buffer
                    if self.buffer.strip():
                        self.queue.put(self.buffer.strip())
                        self.buffer = ''
            
            # Function to run parser in a thread
            def run_parser():
                try:
                    # Create parser - this will initialize the database schema
                    parser = UnityLogParser(db_path=db_path)
                    
                    # Redirect stdout to our streaming writer
                    old_stdout = sys.stdout
                    old_stderr = sys.stderr
                    stream_writer = StreamingWriter(output_queue, old_stdout)
                    sys.stdout = stream_writer
                    sys.stderr = StreamingWriter(output_queue, old_stderr)
                    
                    try:
                        # Monkey-patch print to flush immediately for real-time output
                        import builtins
                        original_print = builtins.print
                        
                        def flushing_print(*args, **kwargs):
                            """Print that flushes immediately"""
                            result = original_print(*args, **kwargs)
                            sys.stdout.flush()
                            return result
                        
                        builtins.print = flushing_print
                        
                        try:
                            # Parse the log file (this will print progress to stdout)
                            log_id = parser.parse_log_file(temp_path)
                        finally:
                            # Restore original print
                            builtins.print = original_print
                        
                        # Ensure any remaining output is flushed
                        sys.stdout.flush()
                        sys.stderr.flush()
                        
                        # Close parser
                        parser.close()
                        
                        # Restore stdout
                        sys.stdout = old_stdout
                        sys.stderr = old_stderr
                        
                        # Signal completion
                        output_queue.put(('complete', log_id))
                        parsing_complete.set()
                    except Exception as e:
                        # Restore stdout on error
                        sys.stdout = old_stdout
                        sys.stderr = old_stderr
                        parse_exception[0] = e
                        parsing_complete.set()
                except Exception as e:
                    parse_exception[0] = e
                    parsing_complete.set()
            
            # Start parser in a separate thread
            parser_thread = threading.Thread(target=run_parser, daemon=True)
            parser_thread.start()
            
            # Stream output as it arrives with batching for performance
            import time as time_module
            log_id = None
            message_batch = []
            last_yield_time = 0
            BATCH_INTERVAL = 0.05  # Yield batch every 50ms
            
            while not parsing_complete.is_set() or not output_queue.empty():
                try:
                    # Get output with timeout to allow checking completion
                    item = output_queue.get(timeout=0.1)
                    
                    if isinstance(item, tuple) and item[0] == 'complete':
                        # Yield any pending messages first
                        for msg in message_batch:
                            yield f"data: {json.dumps({'message': msg})}\n\n"
                        message_batch = []
                        log_id = item[1]
                        break
                    else:
                        # It's a message line - batch them
                        message_batch.append(item)
                        
                        # Yield batch periodically to prevent queue buildup
                        current_time = time_module.time()
                        if len(message_batch) >= 10 or (current_time - last_yield_time) >= BATCH_INTERVAL:
                            for msg in message_batch:
                                yield f"data: {json.dumps({'message': msg})}\n\n"
                            message_batch = []
                            last_yield_time = current_time
                            
                except:
                    # Timeout - yield any pending messages
                    if message_batch:
                        for msg in message_batch:
                            yield f"data: {json.dumps({'message': msg})}\n\n"
                        message_batch = []
                    
                    # Check if parsing is complete
                    if parsing_complete.is_set():
                        # Process any remaining items
                        while not output_queue.empty():
                            try:
                                item = output_queue.get_nowait()
                                if isinstance(item, tuple) and item[0] == 'complete':
                                    log_id = item[1]
                                else:
                                    yield f"data: {json.dumps({'message': item})}\n\n"
                            except:
                                break
                        break
                    continue
            
            # Yield any remaining batched messages
            for msg in message_batch:
                yield f"data: {json.dumps({'message': msg})}\n\n"
            
            # Wait for thread to finish
            parser_thread.join(timeout=1)
            
            # Check for exceptions
            if parse_exception[0]:
                raise parse_exception[0]
            
            if log_id is None:
                raise Exception("Parsing completed but no log ID returned")
            
            # Clean up temp file
            os.remove(temp_path)
            
            # Send completion message
            yield f"data: {json.dumps({'complete': True, 'log_id': log_id, 'message': 'Log file parsed successfully!'})}\n\n"
            
        except Exception as e:
            import traceback
            error_details = traceback.format_exc()
            yield f"data: {json.dumps({'error': str(e), 'message': f'Error: {str(e)}'})}\n\n"
            # Clean up temp file on error
            if os.path.exists(temp_path):
                os.remove(temp_path)
    
    # Return streaming response
    return app.response_class(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        }
    )


@app.route('/api/log/<int:log_id>/export')
def export_log_data(log_id):
    """Export all parsed data for a log as JSON for IndexedDB storage (streaming for large files)"""
    if not Path(DB_PATH).exists():
        return jsonify({'error': 'Database not found. Please parse a log file first.'}), 404
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Get log metadata
    cursor.execute("""
        SELECT id, log_file, unity_version, platform, architecture, project_name,
               date_parsed, total_lines, total_parse_time_ms
        FROM log_metadata
        WHERE id = ?
    """, (log_id,))
    metadata_row = cursor.fetchone()
    if not metadata_row:
        conn.close()
        return jsonify({'error': 'Log not found'}), 404
    
    metadata = dict(metadata_row)
    
    def generate():
        """Generator function to stream JSON data in chunks"""
        import json
        
        # Send metadata first
        yield json.dumps({'type': 'metadata', 'data': metadata}) + '\n'
        
        # Stream asset imports in batches
        batch_size = 5000
        cursor.execute("""
            SELECT id, line_number, asset_path, asset_name, asset_type,
                   asset_category, guid, artifact_id, importer_type, 
                   import_time_seconds, import_time_ms
            FROM asset_imports
            WHERE log_id = ?
        """, (log_id,))
        
        batch = []
        for row in cursor:
            batch.append(dict(row))
            if len(batch) >= batch_size:
                yield json.dumps({'type': 'asset_imports', 'data': batch}) + '\n'
                batch = []
        if batch:
            yield json.dumps({'type': 'asset_imports', 'data': batch}) + '\n'
        
        # Get pipeline refreshes (usually small, send all at once)
        cursor.execute("""
            SELECT id, line_number, refresh_id, total_time_seconds, initiated_by,
                   imports_total, imports_actual, asset_db_process_time_ms, 
                   asset_db_callback_time_ms, domain_reloads, domain_reload_time_ms, 
                   compile_time_ms, scripting_other_ms
            FROM pipeline_refreshes
            WHERE log_id = ?
        """, (log_id,))
        pipeline_refreshes = [dict(row) for row in cursor.fetchall()]
        yield json.dumps({'type': 'pipeline_refreshes', 'data': pipeline_refreshes}) + '\n'
        
        # Get domain reload steps (usually small, send all at once)
        cursor.execute("""
            SELECT id, line_number, parent_id, step_name, time_ms, indent_level
            FROM domain_reload_steps
            WHERE log_id = ?
        """, (log_id,))
        domain_reload_steps = [dict(row) for row in cursor.fetchall()]
        yield json.dumps({'type': 'domain_reload_steps', 'data': domain_reload_steps}) + '\n'
        
        # Get script compilation (usually small, send all at once)
        cursor.execute("""
            SELECT id, line_number, assembly_path, defines_count, references_count
            FROM script_compilation
            WHERE log_id = ?
        """, (log_id,))
        script_compilation = [dict(row) for row in cursor.fetchall()]
        yield json.dumps({'type': 'script_compilation', 'data': script_compilation}) + '\n'
        
        # Get telemetry data (usually small, send all at once)
        cursor.execute("""
            SELECT id, line_number, telemetry_type, json_data
            FROM telemetry_data
            WHERE log_id = ?
        """, (log_id,))
        telemetry_data = [dict(row) for row in cursor.fetchall()]
        yield json.dumps({'type': 'telemetry_data', 'data': telemetry_data}) + '\n'
        
        # Get operations (usually small, send all at once)
        cursor.execute("""
            SELECT id, line_number, operation_type, operation_name, 
                   duration_seconds, duration_ms, memory_mb
            FROM operations
            WHERE log_id = ?
        """, (log_id,))
        operations = [dict(row) for row in cursor.fetchall()]
        yield json.dumps({'type': 'operations', 'data': operations}) + '\n'
        
        # Stream log lines in batches (this is usually the largest dataset)
        cursor.execute("""
            SELECT id, line_number, content, line_type, indent_level, 
                   is_error, is_warning, timestamp
            FROM log_lines
            WHERE log_id = ?
            ORDER BY line_number
        """, (log_id,))
        
        batch = []
        for row in cursor:
            batch.append(dict(row))
            if len(batch) >= batch_size:
                yield json.dumps({'type': 'log_lines', 'data': batch}) + '\n'
                batch = []
        if batch:
            yield json.dumps({'type': 'log_lines', 'data': batch}) + '\n'
        
        # Send completion marker
        yield json.dumps({'type': 'complete'}) + '\n'
        
        conn.close()
    
    return Response(generate(), mimetype='application/json', headers={
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no'
    })


@app.route('/api/log/<int:log_id>/summary')
def get_log_summary(log_id):
    """Get summary statistics for a specific log"""
    if not Path(DB_PATH).exists():
        return jsonify({'error': 'Database not found. Please parse a log file first.'}), 404
    
    conn = get_db()
    cursor = conn.cursor()
    
    summary = {}
    
    # Asset imports summary
    cursor.execute("""
        SELECT COUNT(*) as count,
               SUM(import_time_ms) as total_time,
               AVG(import_time_ms) as avg_time,
               MAX(import_time_ms) as max_time
        FROM asset_imports
        WHERE log_id = ?
    """, (log_id,))
    row = cursor.fetchone()
    summary['asset_imports'] = dict(row) if row else {}
    
    # By category
    cursor.execute("""
        SELECT asset_category,
               COUNT(*) as count,
               SUM(import_time_ms) as total_time,
               AVG(import_time_ms) as avg_time
        FROM asset_imports
        WHERE log_id = ?
        GROUP BY asset_category
        ORDER BY total_time DESC
    """, (log_id,))
    summary['by_category'] = [dict(row) for row in cursor.fetchall()]
    
    # By type
    cursor.execute("""
        SELECT asset_type,
               COUNT(*) as count,
               SUM(import_time_ms) as total_time,
               AVG(import_time_ms) as avg_time
        FROM asset_imports
        WHERE log_id = ?
        GROUP BY asset_type
        ORDER BY total_time DESC
    """, (log_id,))
    summary['by_type'] = [dict(row) for row in cursor.fetchall()]
    
    # By importer type
    cursor.execute("""
        SELECT importer_type,
               COUNT(*) as count,
               SUM(import_time_ms) as total_time,
               AVG(import_time_ms) as avg_time
        FROM asset_imports
        WHERE log_id = ?
        GROUP BY importer_type
        ORDER BY total_time DESC
    """, (log_id,))
    summary['by_importer'] = [dict(row) for row in cursor.fetchall()]
    
    # Pipeline refreshes
    cursor.execute("""
        SELECT COUNT(*) as count,
               SUM(total_time_seconds) as total_time_seconds
        FROM pipeline_refreshes
        WHERE log_id = ?
    """, (log_id,))
    row = cursor.fetchone()
    summary['pipeline_refreshes'] = dict(row) if row else {}
    
    # Script compilation
    cursor.execute("""
        SELECT COUNT(*) as count
        FROM script_compilation
        WHERE log_id = ?
    """, (log_id,))
    row = cursor.fetchone()
    summary['script_compilation'] = dict(row) if row else {}
    
    # Telemetry
    cursor.execute("""
        SELECT telemetry_type, json_data
        FROM telemetry_data
        WHERE log_id = ?
    """, (log_id,))
    summary['telemetry'] = [dict(row) for row in cursor.fetchall()]
    
    # Get project load time from log file (same method as timeline endpoint)
    cursor.execute("SELECT log_file FROM log_metadata WHERE id = ?", (log_id,))
    row = cursor.fetchone()
    project_load_time = None
    if row:
        log_file = row['log_file']
        try:
            import re
            with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
                lines = f.readlines()
            
            # Search backward (more efficient, completion message is usually near end)
            # Use case-insensitive matching like timeline endpoint
            loading_pattern = r'\[Project\].*Loading completed in ([\d.]+) seconds'
            for line in reversed(lines):
                match = re.search(loading_pattern, line, re.IGNORECASE)
                if match:
                    project_load_time = float(match.group(1))
                    break
        except Exception as e:
            # If pattern not found, try to get from pipeline refresh total time as fallback
            cursor.execute("""
                SELECT total_time_seconds
                FROM pipeline_refreshes
                WHERE log_id = ?
                ORDER BY total_time_seconds DESC
                LIMIT 1
            """, (log_id,))
            refresh_row = cursor.fetchone()
            if refresh_row:
                project_load_time = refresh_row['total_time_seconds']
    
    summary['project_load_time_seconds'] = project_load_time
    
    # Get Unity version from metadata
    cursor.execute("SELECT unity_version FROM log_metadata WHERE id = ?", (log_id,))
    row = cursor.fetchone()
    summary['unity_version'] = row['unity_version'] if row and row['unity_version'] else None
    
    conn.close()
    return jsonify(summary)


@app.route('/api/log/<int:log_id>/assets')
def get_assets(log_id):
    """Get all asset imports for a specific log"""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT id, line_number, asset_path, asset_name, asset_type,
               asset_category, importer_type, import_time_ms
        FROM asset_imports
        WHERE log_id = ?
        ORDER BY import_time_ms DESC
    """, (log_id,))
    
    assets = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify(assets)


@app.route('/api/log/<int:log_id>/assets/category/<category>')
def get_assets_by_category(log_id, category):
    """Get asset imports filtered by category"""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT id, line_number, asset_path, asset_name, asset_type,
               asset_category, importer_type, import_time_ms
        FROM asset_imports
        WHERE log_id = ? AND asset_category = ?
        ORDER BY import_time_ms DESC
    """, (log_id, category))
    
    assets = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify(assets)


@app.route('/api/log/<int:log_id>/assets/type/<asset_type>')
def get_assets_by_type(log_id, asset_type):
    """Get asset imports filtered by type"""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT id, line_number, asset_path, asset_name, asset_type,
               asset_category, importer_type, import_time_ms
        FROM asset_imports
        WHERE log_id = ? AND asset_type = ?
        ORDER BY import_time_ms DESC
    """, (log_id, asset_type))
    
    assets = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify(assets)


@app.route('/api/log/<int:log_id>/pipeline-refreshes')
def get_pipeline_refreshes(log_id):
    """Get all pipeline refresh events with detailed breakdown"""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT id, line_number, refresh_id, total_time_seconds, initiated_by,
               imports_total, imports_actual, asset_db_process_time_ms, asset_db_callback_time_ms,
               domain_reloads, domain_reload_time_ms, compile_time_ms, scripting_other_ms
        FROM pipeline_refreshes
        WHERE log_id = ?
        ORDER BY total_time_seconds DESC
    """, (log_id,))
    
    refreshes = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify(refreshes)


@app.route('/api/log/<int:log_id>/pipeline-breakdown')
def get_pipeline_breakdown(log_id):
    """Get aggregated pipeline refresh breakdown for visualization"""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT 
            SUM(asset_db_process_time_ms) as total_asset_db_process,
            SUM(asset_db_callback_time_ms) as total_asset_db_callback,
            SUM(domain_reload_time_ms) as total_domain_reload,
            SUM(compile_time_ms) as total_compile,
            SUM(scripting_other_ms) as total_scripting_other
        FROM pipeline_refreshes
        WHERE log_id = ?
    """, (log_id,))
    
    row = cursor.fetchone()
    breakdown = dict(row) if row else {}
    conn.close()
    
    return jsonify(breakdown)


@app.route('/api/log/<int:log_id>/project-load-time')
def get_project_load_time(log_id):
    """Get project load time from '[Project] Loading completed in X seconds' message"""
    import re
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Get log file path
    cursor.execute("SELECT log_file FROM log_metadata WHERE id = ?", (log_id,))
    row = cursor.fetchone()
    if not row:
        return jsonify({'error': 'Log not found'}), 404
    
    log_file = row['log_file']
    
    try:
        with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
        
        # Look for "[Project] Loading completed in X seconds" pattern
        # More flexible pattern to handle variations
        loading_pattern = r'\[Project\].*Loading completed in ([\d.]+) seconds'
        
        # Search entire file (but check from end first for efficiency)
        for line in reversed(lines):
            match = re.search(loading_pattern, line, re.IGNORECASE)
            if match:
                total_seconds = float(match.group(1))
                conn.close()
                return jsonify({
                    'total_seconds': total_seconds,
                    'source': 'project_loading_message',
                    'found': True
                })
        
        # Fallback: sum asset import times
        cursor.execute("""
            SELECT SUM(import_time_seconds) as total
            FROM asset_imports
            WHERE log_id = ?
        """, (log_id,))
        row = cursor.fetchone()
        conn.close()
        return jsonify({
            'total_seconds': row['total'] or 0,
            'source': 'summed_imports',
            'found': False,
            'message': 'Project loading completion message not found in log'
        })
            
    except Exception as e:
        conn.close()
        return jsonify({'error': str(e)}), 500


@app.route('/api/log/<int:log_id>/error-warning-counts')
def get_error_warning_counts(log_id):
    """Get total error and warning counts"""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT 
            SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END) as error_count,
            SUM(CASE WHEN is_warning = 1 THEN 1 ELSE 0 END) as warning_count
        FROM log_lines
        WHERE log_id = ?
    """, (log_id,))
    
    row = cursor.fetchone()
    conn.close()
    
    return jsonify({
        'errors': row['error_count'] or 0,
        'warnings': row['warning_count'] or 0
    })


@app.route('/api/log/<int:log_id>/assets-by-importer/<importer_type>')
def get_assets_by_importer(log_id, importer_type):
    """Get asset imports filtered by importer type"""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT id, line_number, asset_path, asset_name, asset_type,
               asset_category, importer_type, import_time_ms
        FROM asset_imports
        WHERE log_id = ? AND importer_type = ?
        ORDER BY import_time_ms DESC
    """, (log_id, importer_type))
    
    assets = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify(assets)


@app.route('/api/log/<int:log_id>/script-compilation')
def get_script_compilation(log_id):
    """Get script compilation data"""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT id, line_number, assembly_path, defines_count, references_count
        FROM script_compilation
        WHERE log_id = ?
        ORDER BY line_number
    """, (log_id,))
    
    assemblies = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify(assemblies)


@app.route('/api/log/<int:log_id>/top-slowest/<int:limit>')
def get_top_slowest(log_id, limit=20):
    """Get top slowest asset imports"""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT id, line_number, asset_path, asset_name, asset_type,
               asset_category, importer_type, import_time_ms
        FROM asset_imports
        WHERE log_id = ?
        ORDER BY import_time_ms DESC
        LIMIT ?
    """, (log_id, limit))
    
    assets = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify(assets)


@app.route('/api/log/<int:log_id>/log-viewer')
def get_log_lines(log_id):
    """Get log lines for the log viewer with pagination support"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Get pagination parameters
    center_line = request.args.get('line', type=int)
    offset = request.args.get('offset', type=int, default=0)
    limit = request.args.get('limit', type=int, default=100)
    search_query = request.args.get('search', type=str)
    
    # Get total line count first
    cursor.execute("SELECT COUNT(*) as total FROM log_lines WHERE log_id = ?", (log_id,))
    total_lines = cursor.fetchone()['total']
    
    # Get filter type
    filter_type = request.args.get('filter', type=str)
    
    if search_query:
        # Search mode: return matching lines with context
        cursor.execute("""
            SELECT line_number, content, line_type, indent_level, 
                   is_error, is_warning, timestamp
            FROM log_lines
            WHERE log_id = ? AND content LIKE ?
            ORDER BY line_number
            LIMIT ?
        """, (log_id, f'%{search_query}%', 500))  # Limit search results to 500
        
        lines = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({
            'lines': lines,
            'total_lines': total_lines,
            'is_search': True,
            'search_results': len(lines)
        })
    
    elif filter_type:
        # Filter mode: return filtered lines (server-side)
        if filter_type == 'error':
            cursor.execute("""
                SELECT line_number, content, line_type, indent_level, 
                       is_error, is_warning, timestamp
                FROM log_lines
                WHERE log_id = ? AND is_error = 1
                ORDER BY line_number
                LIMIT 1000
            """, (log_id,))
        elif filter_type == 'warning':
            cursor.execute("""
                SELECT line_number, content, line_type, indent_level, 
                       is_error, is_warning, timestamp
                FROM log_lines
                WHERE log_id = ? AND is_warning = 1
                ORDER BY line_number
                LIMIT 1000
            """, (log_id,))
        elif filter_type == 'import':
            cursor.execute("""
                SELECT line_number, content, line_type, indent_level, 
                       is_error, is_warning, timestamp
                FROM log_lines
                WHERE log_id = ? AND line_type = 'import'
                ORDER BY line_number
                LIMIT 1000
            """, (log_id,))
        elif filter_type == 'pipeline':
            cursor.execute("""
                SELECT line_number, content, line_type, indent_level, 
                       is_error, is_warning, timestamp
                FROM log_lines
                WHERE log_id = ? AND line_type = 'pipeline'
                ORDER BY line_number
                LIMIT 1000
            """, (log_id,))
        else:
            # Unknown filter, return first page
            cursor.execute("""
                SELECT line_number, content, line_type, indent_level, 
                       is_error, is_warning, timestamp
                FROM log_lines
                WHERE log_id = ?
                ORDER BY line_number
                LIMIT ? OFFSET ?
            """, (log_id, limit, offset))
        
        lines = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({
            'lines': lines,
            'total_lines': total_lines,
            'is_filtered': True,
            'filter_type': filter_type,
            'filter_results': len(lines)
        })
    
    elif center_line:
        # Get context around specific line (for highlighting)
        start = max(1, center_line - 50)
        end = min(total_lines, center_line + 50)
        
        cursor.execute("""
            SELECT line_number, content, line_type, indent_level, 
                   is_error, is_warning, timestamp
            FROM log_lines
            WHERE log_id = ? AND line_number BETWEEN ? AND ?
            ORDER BY line_number
        """, (log_id, start, end))
        
        lines = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({
            'lines': lines,
            'total_lines': total_lines,
            'center_line': center_line,
            'range_start': start,
            'range_end': end
        })
    
    else:
        # Paginated view: get chunk of lines
        cursor.execute("""
            SELECT line_number, content, line_type, indent_level, 
                   is_error, is_warning, timestamp
            FROM log_lines
            WHERE log_id = ?
            ORDER BY line_number
            LIMIT ? OFFSET ?
        """, (log_id, limit, offset))
        
        lines = [dict(row) for row in cursor.fetchall()]
        conn.close()
        
        return jsonify({
            'lines': lines,
            'total_lines': total_lines,
            'offset': offset,
            'limit': limit,
            'has_more': offset + limit < total_lines
        })


@app.route('/api/log/<int:log_id>/log-line/<int:line_number>')
def get_single_log_line(log_id, line_number):
    """Get a single log line with context"""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT line_number, content, line_type, indent_level, 
               is_error, is_warning, timestamp
        FROM log_lines
        WHERE log_id = ? AND line_number = ?
    """, (log_id, line_number))
    
    line = cursor.fetchone()
    conn.close()
    
    if line:
        return jsonify(dict(line))
    return jsonify({'error': 'Line not found'}), 404


@app.route('/api/log/<int:log_id>/folder-analysis')
def get_folder_analysis(log_id):
    """Get folder analysis showing heaviest folders by import time"""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT asset_path, import_time_ms
        FROM asset_imports
        WHERE log_id = ?
    """, (log_id,))
    
    assets = cursor.fetchall()
    conn.close()
    
    # Aggregate by folder (3-4 levels deep)
    folder_times = {}
    folder_counts = {}
    folder_assets = {}
    
    for asset in assets:
        path = asset['asset_path']
        time_ms = asset['import_time_ms']
        
        # Split path and get folder at appropriate depth
        parts = path.split('/')
        
        # Try 3-4 levels deep, or as deep as possible
        if len(parts) >= 4:
            folder = '/'.join(parts[:4])
        elif len(parts) >= 3:
            folder = '/'.join(parts[:3])
        elif len(parts) >= 2:
            folder = '/'.join(parts[:2])
        else:
            folder = parts[0] if parts else 'Root'
        
        if folder not in folder_times:
            folder_times[folder] = 0
            folder_counts[folder] = 0
            folder_assets[folder] = []
        
        folder_times[folder] += time_ms
        folder_counts[folder] += 1
        folder_assets[folder].append({
            'path': path,
            'time_ms': time_ms
        })
    
    # Convert to list and sort by time
    folders = []
    for folder, total_time in folder_times.items():
        folders.append({
            'folder': folder,
            'total_time_ms': total_time,
            'asset_count': folder_counts[folder],
            'avg_time_ms': total_time / folder_counts[folder],
            'assets': sorted(folder_assets[folder], key=lambda x: x['time_ms'], reverse=True)[:5]  # Top 5 assets
        })
    
    folders.sort(key=lambda x: x['total_time_ms'], reverse=True)
    
    return jsonify(folders)


def format_time_verbose(seconds):
    """Format time for timeline tooltips with verbose units"""
    if seconds >= 3600:
        # Hours and minutes (omit seconds)
        hours = int(seconds // 3600)
        mins = int((seconds % 3600) // 60)
        if mins > 0:
            return f'{hours} hour{"s" if hours != 1 else ""} {mins} minute{"s" if mins != 1 else ""}'
        return f'{hours} hour{"s" if hours != 1 else ""}'
    elif seconds >= 60:
        # Minutes and seconds
        minutes = int(seconds // 60)
        secs = int(seconds % 60)
        if secs > 0:
            return f'{minutes} minute{"s" if minutes != 1 else ""} {secs} second{"s" if secs != 1 else ""}'
        return f'{minutes} minute{"s" if minutes != 1 else ""}'
    else:
        # Just seconds
        return f'{seconds:.2f} seconds'


@app.route('/api/log/<int:log_id>/timeline')
def get_timeline(log_id):
    """Get timeline data for visualization showing project load phases in actual sequence"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Get pipeline refresh data
    cursor.execute("""
        SELECT id, line_number, refresh_id, total_time_seconds, initiated_by,
               imports_total, imports_actual, asset_db_process_time_ms, asset_db_callback_time_ms,
               domain_reloads, domain_reload_time_ms, compile_time_ms, scripting_other_ms
        FROM pipeline_refreshes
        WHERE log_id = ?
        ORDER BY total_time_seconds DESC
        LIMIT 1
    """, (log_id,))
    
    refresh = cursor.fetchone()
    if not refresh:
        conn.close()
        return jsonify({'error': 'No pipeline refresh found'}), 404
    
    refresh_dict = dict(refresh)
    
    # Get log file path
    cursor.execute("SELECT log_file FROM log_metadata WHERE id = ?", (log_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'Log not found'}), 404
    
    log_file = row['log_file']
    
    # Get all imports ordered by line number to see actual sequence
    # Check if asset_category column exists (for backwards compatibility)
    cursor.execute("PRAGMA table_info(asset_imports)")
    columns = [col[1] for col in cursor.fetchall()]
    has_category = 'asset_category' in columns
    
    if has_category:
        cursor.execute("""
            SELECT line_number, import_time_ms, asset_name, asset_type, asset_category
            FROM asset_imports
            WHERE log_id = ?
            ORDER BY line_number
        """, (log_id,))
    else:
        # Fallback for old databases without asset_category
        cursor.execute("""
            SELECT line_number, import_time_ms, asset_name, asset_type
            FROM asset_imports
            WHERE log_id = ?
            ORDER BY line_number
        """, (log_id,))
    
    imports = cursor.fetchall()
    import_count = len(imports)
    total_import_time_ms = sum(imp[1] for imp in imports) if imports else 0
    
    # Get all operations (Sprite Atlas, etc.) ordered by line number
    cursor.execute("""
        SELECT line_number, operation_type, operation_name, duration_ms
        FROM operations
        WHERE log_id = ?
        ORDER BY line_number
    """, (log_id,))
    
    operations = cursor.fetchall()
    
    # Get project load time
    import re
    project_load_time = None
    try:
        with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
        
        loading_pattern = r'\[Project\].*Loading completed in ([\d.]+) seconds'
        for line in reversed(lines):
            match = re.search(loading_pattern, line, re.IGNORECASE)
            if match:
                project_load_time = float(match.group(1))
                break
    except:
        pass
    
    # Parse detailed breakdown from log to get phase timings
    scan_time_ms = 0
    categorize_time_ms = 0
    import_in_process_ms = 0
    post_process_ms = 0
    untracked_ms = 0
    
    refresh_line_num = refresh_dict['line_number']
    try:
        with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
            log_lines = f.readlines()
        
        if refresh_line_num <= len(log_lines):
            for i in range(refresh_line_num, min(refresh_line_num + 35, len(log_lines))):
                line = log_lines[i]
                
                if re.search(r'^\s+Scan:\s+([\d.]+)ms', line):
                    match = re.search(r'^\s+Scan:\s+([\d.]+)ms', line)
                    scan_time_ms = float(match.group(1))
                elif re.search(r'^\s+CategorizeAssets:\s+([\d.]+)ms', line):
                    match = re.search(r'^\s+CategorizeAssets:\s+([\d.]+)ms', line)
                    categorize_time_ms = float(match.group(1))
                elif re.search(r'^\s+ImportInProcess:\s+([\d.]+)ms', line):
                    match = re.search(r'^\s+ImportInProcess:\s+([\d.]+)ms', line)
                    import_in_process_ms = float(match.group(1))
                elif re.search(r'^\s+PostProcessAllAssets:\s+([\d.]+)ms', line):
                    match = re.search(r'^\s+PostProcessAllAssets:\s+([\d.]+)ms', line)
                    post_process_ms = float(match.group(1))
                elif re.search(r'^\s+Untracked:\s+([\d.]+)ms', line):
                    match = re.search(r'^\s+Untracked:\s+([\d.]+)ms', line)
                    untracked_ms = float(match.group(1))
    except Exception as e:
        print(f"Error parsing log breakdown: {e}")
    
    # Calculate untracked time in ImportInProcess
    untracked_in_imports_ms = max(0, import_in_process_ms - total_import_time_ms)
    
    # Build timeline segments in actual sequence
    timeline_segments = []
    current_time = 0
    
    # Pre-import phases (from breakdown)
    if scan_time_ms > 0:
        # Find scan line number from log
        scan_line_num = refresh_line_num + 10  # Approximate, will find actual line
        try:
            with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
                log_lines = f.readlines()
            for i in range(refresh_line_num, min(refresh_line_num + 35, len(log_lines))):
                if re.search(r'^\s+Scan:\s+', log_lines[i]):
                    scan_line_num = i + 1
                    break
        except:
            pass
        
        timeline_segments.append({
            'phase': 'Scan',
            'start_time': current_time,
            'duration_ms': scan_time_ms,
            'color': '#9E9E9E',
            'description': f'Scanning for asset changes ({format_time_verbose(scan_time_ms/1000)})',
            'line_number': scan_line_num
        })
        current_time += scan_time_ms
    
    if categorize_time_ms > 0:
        # Find categorize line number
        categorize_line_num = refresh_line_num + 12
        try:
            with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
                log_lines = f.readlines()
            for i in range(refresh_line_num, min(refresh_line_num + 35, len(log_lines))):
                if re.search(r'^\s+CategorizeAssets:\s+', log_lines[i]):
                    categorize_line_num = i + 1
                    break
        except:
            pass
        
        timeline_segments.append({
            'phase': 'CategorizeAssets',
            'start_time': current_time,
            'duration_ms': categorize_time_ms,
            'color': '#FF9800',
            'description': f'Categorizing assets ({format_time_verbose(categorize_time_ms/1000)})',
            'line_number': categorize_line_num
        })
        current_time += categorize_time_ms
    
    # Merge imports and operations by line number to get actual sequence
    all_events = []
    
    # Add imports as events
    for imp in imports:
        if has_category:
            line_num, time_ms, name, asset_type, category = imp
        else:
            line_num, time_ms, name, asset_type = imp
            category = 'Other'  # Default for old databases
        
        all_events.append({
            'line_number': line_num,
            'type': 'import',
            'time_ms': time_ms,
            'name': name,
            'asset_type': asset_type,
            'category': category or 'Other'
        })
    
    # Add operations as events
    for line_num, op_type, op_name, duration_ms in operations:
        all_events.append({
            'line_number': line_num,
            'type': 'operation',
            'time_ms': duration_ms,
            'operation_type': op_type,
            'operation_name': op_name
        })
    
    # Sort all events by line number to get actual sequence
    all_events.sort(key=lambda x: x['line_number'])
    
    # Now process events sequentially to find chunks and gaps
    if all_events:
        # Group consecutive imports into chunks (gap <= 3 lines = same chunk)
        import_chunks = []
        current_chunk = []
        operations_in_sequence = []
        
        for event in all_events:
            if event['type'] == 'import':
                if not current_chunk:
                    current_chunk.append(event)
                else:
                    # Check gap from previous event and category change
                    prev_line = current_chunk[-1]['line_number']
                    prev_category = current_chunk[-1].get('category', 'Other')
                    current_category = event.get('category', 'Other')
                    gap = event['line_number'] - prev_line
                    
                    # Category changed = always start new chunk (even if gap is small)
                    # Same category = allow larger gaps (for worker thread imports which are interleaved)
                    if current_category != prev_category:
                        # Category changed - finish current chunk, start new one
                        chunk_time = sum(imp['time_ms'] for imp in current_chunk)
                        prev_end = import_chunks[-1]['end_line'] if import_chunks else refresh_line_num + 20
                        
                        # Use the consistent category from the chunk (all should be same now)
                        chunk_category = current_chunk[0].get('category', 'Other')
                        
                        import_chunks.append({
                            'start_line': current_chunk[0]['line_number'],
                            'end_line': current_chunk[-1]['line_number'],
                            'time_ms': chunk_time,
                            'count': len(current_chunk),
                            'gap_before': current_chunk[0]['line_number'] - prev_end,
                            'category': chunk_category
                        })
                        current_chunk = [event]
                    elif gap <= 50:
                        # Same category and reasonable gap - continue chunk
                        # Allowing larger gaps (50 lines) for worker thread imports
                        current_chunk.append(event)
                    else:
                        # Same category but very large gap - start new chunk
                        chunk_time = sum(imp['time_ms'] for imp in current_chunk)
                        prev_end = import_chunks[-1]['end_line'] if import_chunks else refresh_line_num + 20
                        
                        # Use the consistent category from the chunk (all should be same now)
                        chunk_category = current_chunk[0].get('category', 'Other')
                        
                        import_chunks.append({
                            'start_line': current_chunk[0]['line_number'],
                            'end_line': current_chunk[-1]['line_number'],
                            'time_ms': chunk_time,
                            'count': len(current_chunk),
                            'gap_before': current_chunk[0]['line_number'] - prev_end,
                            'category': chunk_category
                        })
                        current_chunk = [event]
            elif event['type'] == 'operation':
                # If there's a current chunk, finish it before the operation
                if current_chunk:
                    chunk_time = sum(imp['time_ms'] for imp in current_chunk)
                    prev_end = import_chunks[-1]['end_line'] if import_chunks else refresh_line_num + 20
                    
                    # Use the consistent category from the chunk (all should be same)
                    chunk_category = current_chunk[0].get('category', 'Other')
                    
                    import_chunks.append({
                        'start_line': current_chunk[0]['line_number'],
                        'end_line': current_chunk[-1]['line_number'],
                        'time_ms': chunk_time,
                        'count': len(current_chunk),
                        'gap_before': current_chunk[0]['line_number'] - prev_end,
                        'category': chunk_category
                    })
                    current_chunk = []
                # Store operations to insert at correct positions
                operations_in_sequence.append(event)
        
        # Finish last chunk
        if current_chunk:
            chunk_time = sum(imp['time_ms'] for imp in current_chunk)
            prev_end = import_chunks[-1]['end_line'] if import_chunks else refresh_line_num + 20
            
            # Use the consistent category from the chunk (all should be same)
            chunk_category = current_chunk[0].get('category', 'Other')
            
            import_chunks.append({
                'start_line': current_chunk[0]['line_number'],
                'end_line': current_chunk[-1]['line_number'],
                'time_ms': chunk_time,
                'count': len(current_chunk),
                'gap_before': current_chunk[0]['line_number'] - prev_end,
                'category': chunk_category
            })
        
        # Now build timeline with operations inserted at correct positions
        # We need to merge import chunks and operations based on line numbers
        timeline_events = []
        
        # Add import chunks
        for chunk in import_chunks:
            timeline_events.append({
                'line_number': chunk['start_line'],
                'type': 'import_chunk',
                'data': chunk
            })
        
        # Add operations
        for op in operations_in_sequence:
            timeline_events.append({
                'line_number': op['line_number'],
                'type': 'operation',
                'data': op
            })
        
        # Sort by line number
        timeline_events.sort(key=lambda x: x['line_number'])
        
        # Distribute untracked time proportionally based on gaps
        total_gap_lines = sum(chunk['gap_before'] for chunk in import_chunks if chunk['gap_before'] > 3)
        
        # Function to analyze log lines in a gap and create description
        def analyze_gap_lines(start_line, end_line):
            """Analyze log lines in a gap to identify what's happening"""
            try:
                with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
                    log_lines = f.readlines()
                
                if start_line > len(log_lines) or end_line < start_line:
                    return 'unknown operations'
                
                gap_lines = log_lines[max(0, start_line-1):min(end_line, len(log_lines))]
                
                # Count various patterns
                sprite_place_count = sum(1 for line in gap_lines if 'Placed sprite' in line)
                sprite_atlas_count = sum(1 for line in gap_lines if 'Sprite Atlas' in line or 'Processing Atlas' in line)
                texture_warning_count = sum(1 for line in gap_lines if 'Source Texture' in line and 'compressed format' in line)
                processing_atlas_count = sum(1 for line in gap_lines if 'Processing Atlas' in line)
                worker_count = sum(1 for line in gap_lines if '[Worker' in line)
                compile_count = sum(1 for line in gap_lines if 'Compiling' in line or 'Compile' in line or 'compilation' in line.lower())
                reload_count = sum(1 for line in gap_lines if 'Reload' in line and ('asset' in line.lower() or 'domain' in line.lower()))
                texture_import_count = sum(1 for line in gap_lines if 'TextureImporter' in line or 'texture' in line.lower()[:50])
                shader_count = sum(1 for line in gap_lines if 'shader' in line.lower() and ('compile' in line.lower() or 'process' in line.lower()))
                material_count = sum(1 for line in gap_lines if 'material' in line.lower() and ('process' in line.lower() or 'import' in line.lower()))
                prefab_count = sum(1 for line in gap_lines if 'prefab' in line.lower() and ('process' in line.lower() or 'import' in line.lower()))
                
                # Build description with priority
                activities = []
                
                # High priority: Sprite operations
                if sprite_place_count > 0:
                    if sprite_place_count > 50:
                        activities.append(f'sprite packing ({sprite_place_count} sprites placed)')
                    else:
                        activities.append(f'{sprite_place_count} sprite placement{"s" if sprite_place_count > 1 else ""}')
                
                if sprite_atlas_count > 0 or processing_atlas_count > 0:
                    activities.append('sprite atlas generation')
                
                if texture_warning_count > 0:
                    activities.append(f'{texture_warning_count} texture format validation{"s" if texture_warning_count > 1 else ""}')
                
                # Medium priority: Processing operations
                if worker_count > 0:
                    activities.append(f'worker thread coordination ({worker_count} worker event{"s" if worker_count > 1 else ""})')
                
                if compile_count > 0:
                    activities.append('script compilation')
                
                if reload_count > 0:
                    activities.append('asset/domain reload')
                
                # Lower priority: Asset type processing
                if texture_import_count > 10:
                    activities.append('texture processing')
                elif texture_import_count > 0:
                    activities.append(f'{texture_import_count} texture operation{"s" if texture_import_count > 1 else ""}')
                
                if shader_count > 0:
                    activities.append('shader processing')
                
                if material_count > 0:
                    activities.append('material processing')
                
                if prefab_count > 0:
                    activities.append('prefab processing')
                
                # Create readable description
                if activities:
                    # Join with natural language
                    if len(activities) == 1:
                        return activities[0]
                    elif len(activities) == 2:
                        return f'{activities[0]} and {activities[1]}'
                    else:
                        return ', '.join(activities[:-1]) + f', and {activities[-1]}'
                elif len(gap_lines) > 0:
                    # Fallback: describe by line count
                    if len(gap_lines) > 100:
                        return f'extensive operations ({len(gap_lines)} log lines)'
                    elif len(gap_lines) > 10:
                        return f'various operations ({len(gap_lines)} log lines)'
                    else:
                        return f'minor operations ({len(gap_lines)} log lines)'
                else:
                    return 'unknown operations'
            except Exception as e:
                return f'operations (analysis error: {str(e)[:50]})'
        
        # Build timeline segments in sequence
        for event in timeline_events:
            if event['type'] == 'import_chunk':
                chunk = event['data']
                
                # Add gap before this chunk (if significant)
                if chunk['gap_before'] > 3:
                    # Estimate gap time: proportional to line gap vs total gap lines
                    if total_gap_lines > 0:
                        gap_time_ms = (chunk['gap_before'] / total_gap_lines) * untracked_in_imports_ms
                    else:
                        gap_time_ms = 0
                    
                    if gap_time_ms > 10:  # Only show gaps > 10ms
                        # Find the actual line range for this gap
                        prev_end = import_chunks[import_chunks.index(chunk) - 1]['end_line'] if import_chunks.index(chunk) > 0 else refresh_line_num + 20
                        gap_start_line = prev_end + 1
                        gap_end_line = chunk['start_line'] - 1
                        
                        # Analyze what's happening in this gap
                        gap_analysis = analyze_gap_lines(gap_start_line, gap_end_line)
                        
                        timeline_segments.append({
                            'phase': 'ImportOverhead',
                            'start_time': current_time,
                            'duration_ms': gap_time_ms,
                            'color': '#9E9E9E',  # Grey for unknown time
                            'description': f'Unknown Time: {gap_analysis} ({format_time_verbose(gap_time_ms/1000)})',
                            'line_number': gap_start_line
                        })
                        current_time += gap_time_ms
                
                # Add import chunk (color will be determined by category on frontend)
                timeline_segments.append({
                    'phase': 'AssetImports',
                    'start_time': current_time,
                    'duration_ms': chunk['time_ms'],
                    'color': '#4CAF50',  # Default fallback color
                    'category': chunk.get('category', 'Other'),  # Pass category for frontend coloring
                    'description': f'Asset imports - {chunk["count"]} assets ({format_time_verbose(chunk["time_ms"]/1000)})',
                    'asset_count': chunk['count'],
                    'line_number': chunk['start_line']
                })
                current_time += chunk['time_ms']
            
            elif event['type'] == 'operation':
                op = event['data']
                # Check if this is a Tundra operation - treat as Script Compilation
                if op['operation_type'] == 'Tundra':
                    timeline_segments.append({
                        'phase': 'CompileScripts',
                        'start_time': current_time,
                        'duration_ms': op['time_ms'],
                        'color': '#9966FF',  # Purple, same as script compilation
                        'description': f'Script Compilation: {op["operation_name"]} ({format_time_verbose(op["time_ms"]/1000)})',
                        'operation_type': op['operation_type'],
                        'operation_name': op['operation_name'],
                        'line_number': op['line_number']
                    })
                else:
                    # Regular operation
                    timeline_segments.append({
                        'phase': 'Operation',
                        'start_time': current_time,
                        'duration_ms': op['time_ms'],
                        'color': '#FF5722',
                        'description': f'{op["operation_type"]}: {op["operation_name"]} ({format_time_verbose(op["time_ms"]/1000)})',
                        'operation_type': op['operation_type'],
                        'operation_name': op['operation_name'],
                        'line_number': op['line_number']
                    })
                current_time += op['time_ms']
        
    
    # Post-import phases
    if post_process_ms > 0:
        # Find post-process line number
        post_process_line_num = refresh_line_num + 25
        try:
            with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
                log_lines = f.readlines()
            for i in range(refresh_line_num, min(refresh_line_num + 35, len(log_lines))):
                if re.search(r'^\s+PostProcessAllAssets:\s+', log_lines[i]):
                    post_process_line_num = i + 1
                    break
        except:
            pass
        
        timeline_segments.append({
            'phase': 'PostProcessAllAssets',
            'start_time': current_time,
            'duration_ms': post_process_ms,
            'color': '#2196F3',
            'description': f'Post-processing assets ({format_time_verbose(post_process_ms/1000)})',
            'line_number': post_process_line_num
        })
        current_time += post_process_ms
    
    if untracked_ms > 0:
        # Find untracked line number
        untracked_line_num = refresh_line_num + 30
        try:
            with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
                log_lines = f.readlines()
            for i in range(refresh_line_num, min(refresh_line_num + 35, len(log_lines))):
                if re.search(r'^\s+Untracked:\s+', log_lines[i]):
                    untracked_line_num = i + 1
                    break
        except:
            pass
        
        timeline_segments.append({
            'phase': 'Untracked',
            'start_time': current_time,
            'duration_ms': untracked_ms,
            'color': '#9E9E9E',  # Grey for unknown time
            'description': f'Unknown Time ({format_time_verbose(untracked_ms/1000)})',
            'line_number': untracked_line_num
        })
        current_time += untracked_ms
    
    total_time = refresh_dict.get('total_time_seconds', 0) * 1000
    
    # Calculate total time accounted for by all segments
    total_accounted_time = sum(seg['duration_ms'] for seg in timeline_segments)
    
    # Calculate unknown time (time not accounted for)
    unknown_time_ms = max(0, total_time - total_accounted_time)
    
    # Add unknown time segment at the end if there's significant unaccounted time
    if unknown_time_ms > 100:  # Only show if > 100ms
        timeline_segments.append({
            'phase': 'UnknownTime',
            'start_time': current_time,
            'duration_ms': unknown_time_ms,
            'color': '#9E9E9E',  # Grey for unknown time
            'description': f'Unknown Time ({format_time_verbose(unknown_time_ms/1000)})',
            'line_number': None
        })
    
    # Calculate time by category for summary
    scan_time_total = sum(seg['duration_ms'] for seg in timeline_segments if seg['phase'] == 'Scan')
    categorize_time_total = sum(seg['duration_ms'] for seg in timeline_segments if seg['phase'] == 'CategorizeAssets')
    asset_imports_time_total = sum(seg['duration_ms'] for seg in timeline_segments if seg['phase'] == 'AssetImports')
    operations_time_total = sum(seg['duration_ms'] for seg in timeline_segments if seg['phase'] == 'Operation')
    script_compilation_time_total = sum(seg['duration_ms'] for seg in timeline_segments if seg['phase'] == 'CompileScripts')
    post_process_time_total = sum(seg['duration_ms'] for seg in timeline_segments if seg['phase'] == 'PostProcessAllAssets')
    import_overhead_time_total = sum(seg['duration_ms'] for seg in timeline_segments if seg['phase'] == 'ImportOverhead')
    untracked_time_total = sum(seg['duration_ms'] for seg in timeline_segments if seg['phase'] == 'Untracked')
    
    conn.close()
    
    return jsonify({
        'total_time_ms': total_time,
        'project_load_time_seconds': project_load_time,
        'segments': timeline_segments,
        'summary': {
            'asset_import_time_ms': asset_imports_time_total,
            'unknown_time_ms': unknown_time_ms,
            'total_imports': import_count,
            'scan_time_ms': scan_time_total,
            'categorize_time_ms': categorize_time_total,
            'operations_time_ms': operations_time_total,
            'script_compilation_time_ms': script_compilation_time_total,
            'post_process_time_ms': post_process_time_total,
            'import_overhead_time_ms': import_overhead_time_total,
            'untracked_time_ms': untracked_time_total
        }
    })


def main():
    """Start the web server"""
    import sys
    
    # Database will be created automatically if it doesn't exist
    # No need to exit if database doesn't exist - user can upload via web UI
    
    print("=" * 60)
    print("Unity Log Analyzer - Web Server")
    print("=" * 60)
    print(f"Database: {DB_PATH}")
    print()
    print("Starting server at http://localhost:8765")
    print("Press Ctrl+C to stop")
    print("=" * 60)
    
    app.run(host='0.0.0.0', port=8765, debug=True)


if __name__ == '__main__':
    main()
