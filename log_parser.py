#!/usr/bin/env python3
"""
Unity Editor.Log Parser
Extracts timing information from Unity Editor logs and stores in SQLite database
"""

import re
import sqlite3
import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import datetime


class UnityLogParser:
    """Parser for Unity Editor.log files"""
    
    def __init__(self, db_path: str = "unity_log.db"):
        self.db_path = db_path
        self.conn = None
        self.cursor = None
        self._init_database()
        
    def _init_database(self):
        """Initialize SQLite database with schema"""
        self.conn = sqlite3.connect(self.db_path)
        self.cursor = self.conn.cursor()
        
        # Main log metadata table
        self.cursor.execute("""
            CREATE TABLE IF NOT EXISTS log_metadata (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                log_file TEXT NOT NULL,
                unity_version TEXT,
                platform TEXT,
                architecture TEXT,
                project_name TEXT,
                date_parsed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                total_lines INTEGER,
                total_parse_time_ms REAL
            )
        """)
        
        # Add project_name column if it doesn't exist (migration)
        try:
            self.cursor.execute("ALTER TABLE log_metadata ADD COLUMN project_name TEXT")
        except sqlite3.OperationalError:
            pass  # Column already exists
        
        # Asset imports table
        self.cursor.execute("""
            CREATE TABLE IF NOT EXISTS asset_imports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                log_id INTEGER,
                line_number INTEGER,
                asset_path TEXT NOT NULL,
                asset_name TEXT,
                asset_type TEXT,
                asset_category TEXT,
                guid TEXT,
                artifact_id TEXT,
                importer_type TEXT,
                import_time_seconds REAL NOT NULL,
                import_time_ms REAL NOT NULL,
                FOREIGN KEY (log_id) REFERENCES log_metadata(id)
            )
        """)
        
        # Asset pipeline refresh events
        self.cursor.execute("""
            CREATE TABLE IF NOT EXISTS pipeline_refreshes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                log_id INTEGER,
                line_number INTEGER,
                refresh_id TEXT,
                total_time_seconds REAL NOT NULL,
                initiated_by TEXT,
                imports_total INTEGER,
                imports_actual INTEGER,
                asset_db_process_time_ms REAL,
                asset_db_callback_time_ms REAL,
                domain_reloads INTEGER,
                domain_reload_time_ms REAL,
                compile_time_ms REAL,
                scripting_other_ms REAL,
                FOREIGN KEY (log_id) REFERENCES log_metadata(id)
            )
        """)
        
        # Domain reload profiling data (hierarchical)
        self.cursor.execute("""
            CREATE TABLE IF NOT EXISTS domain_reload_steps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                log_id INTEGER,
                line_number INTEGER,
                parent_id INTEGER,
                step_name TEXT NOT NULL,
                time_ms REAL NOT NULL,
                indent_level INTEGER,
                FOREIGN KEY (log_id) REFERENCES log_metadata(id),
                FOREIGN KEY (parent_id) REFERENCES domain_reload_steps(id)
            )
        """)
        
        # Script compilation data
        self.cursor.execute("""
            CREATE TABLE IF NOT EXISTS script_compilation (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                log_id INTEGER,
                line_number INTEGER,
                assembly_path TEXT,
                defines_count INTEGER,
                references_count INTEGER,
                FOREIGN KEY (log_id) REFERENCES log_metadata(id)
            )
        """)
        
        # JSON telemetry data
        self.cursor.execute("""
            CREATE TABLE IF NOT EXISTS telemetry_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                log_id INTEGER,
                line_number INTEGER,
                telemetry_type TEXT,
                json_data TEXT,
                FOREIGN KEY (log_id) REFERENCES log_metadata(id)
            )
        """)
        
        # Operations table for various Unity operations (Sprite Atlas, etc.)
        self.cursor.execute("""
            CREATE TABLE IF NOT EXISTS operations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                log_id INTEGER,
                line_number INTEGER,
                operation_type TEXT NOT NULL,
                operation_name TEXT,
                duration_seconds REAL NOT NULL,
                duration_ms REAL NOT NULL,
                memory_mb INTEGER,
                FOREIGN KEY (log_id) REFERENCES log_metadata(id)
            )
        """)
        
        # Full log lines for log viewer
        self.cursor.execute("""
            CREATE TABLE IF NOT EXISTS log_lines (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                log_id INTEGER,
                line_number INTEGER,
                content TEXT NOT NULL,
                line_type TEXT,
                indent_level INTEGER DEFAULT 0,
                is_error BOOLEAN DEFAULT 0,
                is_warning BOOLEAN DEFAULT 0,
                timestamp TEXT,
                FOREIGN KEY (log_id) REFERENCES log_metadata(id)
            )
        """)
        
        # Create indexes for common queries
        self.cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_asset_imports_type 
            ON asset_imports(asset_type)
        """)
        self.cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_asset_imports_category 
            ON asset_imports(asset_category)
        """)
        self.cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_asset_imports_time 
            ON asset_imports(import_time_ms DESC)
        """)
        self.cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_log_lines_number 
            ON log_lines(log_id, line_number)
        """)
        
        self.conn.commit()
        
    def _extract_unity_version(self, line: str) -> Optional[str]:
        """Extract Unity version from log header"""
        match = re.search(r'Unity Editor version:\s+(\S+)', line)
        return match.group(1) if match else None
        
    def _extract_platform(self, line: str) -> Optional[str]:
        """Extract platform from log header"""
        if 'macOS version:' in line:
            return 'macOS'
        elif 'Windows version:' in line:
            return 'Windows'
        elif 'Linux version:' in line:
            return 'Linux'
        return None
        
    def _extract_architecture(self, line: str) -> Optional[str]:
        """Extract architecture from log header"""
        match = re.search(r'Architecture:\s+(\S+)', line)
        return match.group(1) if match else None
        
    def _categorize_asset(self, path: str, importer_type: Optional[str] = None) -> Tuple[str, str]:
        """Categorize asset by file extension and return (type, category)
        
        If importer_type is provided and is TextureImporter, the category will be 'Textures'
        regardless of file extension.
        
        File extensions are matched case-insensitively (e.g., .PNG, .png, .Png all match).
        """
        path_lower = path.lower()
        
        # Get file extension (case-insensitive - convert to lowercase)
        ext = Path(path).suffix.lower()
        
        # Map extension to display name - more granular
        ext_display_map = {
            # Shaders
            '.shader': '.shader',
            '.compute': '.compute', 
            '.cginc': '.cginc',
            '.hlsl': '.hlsl',
            # Textures
            '.png': '.png',
            '.jpg': '.jpg',
            '.jpeg': '.jpeg',
            '.tga': '.tga',
            '.psd': '.psd',
            '.exr': '.exr',
            '.hdr': '.hdr',
            '.tif': '.tif',
            '.tiff': '.tiff',
            '.bmp': '.bmp',
            # 3D
            '.fbx': '.fbx',
            '.obj': '.obj',
            '.blend': '.blend',
            # Unity Assets
            '.mat': '.mat',
            '.prefab': '.prefab',
            '.unity': '.unity',
            '.asset': '.asset',
            '.controller': '.controller',
            '.anim': '.anim',
            '.physicmaterial': '.physicmaterial',
            # Scripts
            '.cs': '.cs',
            '.js': '.js',
            '.dll': '.dll',
            '.asmdef': '.asmdef',
            # UI
            '.ttf': '.ttf',
            '.otf': '.otf',
            # Audio
            '.wav': '.wav',
            '.mp3': '.mp3',
            '.ogg': '.ogg',
        }
        
        asset_type = ext_display_map.get(ext, ext if ext else 'no-extension')
        
        # Category grouping for backwards compatibility
        category_map = {
            '.shader': 'Rendering',
            '.compute': 'Rendering',
            '.cginc': 'Rendering',
            '.hlsl': 'Rendering',
            '.png': 'Textures',
            '.jpg': 'Textures',
            '.jpeg': 'Textures',
            '.tga': 'Textures',
            '.psd': 'Textures',
            '.exr': 'Textures',
            '.hdr': 'Textures',
            '.tif': 'Textures',
            '.tiff': 'Textures',
            '.bmp': 'Textures',
            '.mat': 'Materials',
            '.prefab': 'Prefabs',
            '.unity': 'Scenes',
            '.fbx': '3D Models',
            '.obj': '3D Models',
            '.blend': '3D Models',
            '.cs': 'Scripts',
            '.js': 'Scripts',
            '.dll': 'Assemblies',
            '.asmdef': 'Assemblies',
            '.asset': 'Scriptable Objects',
            '.controller': 'Animation',
            '.anim': 'Animation',
            '.physicmaterial': 'Physics',
            '.ttf': 'Fonts',
            '.otf': 'Fonts',
            '.wav': 'Audio',
            '.mp3': 'Audio',
            '.ogg': 'Audio',
        }
        
        category = category_map.get(ext, 'Other')
        
        # Override category if importer is TextureImporter (and not invalid)
        if importer_type and importer_type != '-1' and importer_type == 'TextureImporter':
            category = 'Textures'
        
        return asset_type, category
        
    def _parse_asset_import(self, line: str, line_number: int, log_id: int):
        """Parse asset import line and extract timing info
        Returns True if import was recorded, False/None if not (e.g., pending import)"""
        # Primary pattern: Start importing PATH using Guid(GUID) IMPORTER -> (artifact id: 'HASH') in X.XXX seconds
        # IMPORTER can be:
        #   - Normal: (TextureImporter), (FBXImporter), etc.
        #   - Special: Importer(-1,00000000000000000000000000000000) for some materials
        pattern = r'Start importing (.+?) using Guid\(([a-f0-9]+)\) (.+?)(?: -> \(artifact id: \'([a-f0-9]+)\'\))? in ([\d.]+) seconds'
        match = re.search(pattern, line)
        
        # Fallback pattern 1: Worker thread format without importer type - [Worker0] Start importing PATH using Guid(GUID)
        if not match:
            worker_pattern = r'Start importing (.+?) using Guid\(([a-f0-9]+)\)\s*$'
            match = re.search(worker_pattern, line)
            if match:
                asset_path = match.group(1)
                guid = match.group(2)
                
                # Infer importer type from file extension
                ext = Path(asset_path).suffix.lower()
                importer_map = {
                    '.fbx': 'FBXImporter',
                    '.png': 'TextureImporter',
                    '.jpg': 'TextureImporter',
                    '.jpeg': 'TextureImporter',
                    '.exr': 'TextureImporter',
                    '.tga': 'TextureImporter',
                    '.hdr': 'TextureImporter',
                    '.tif': 'TextureImporter',
                    '.tiff': 'TextureImporter',
                    '.bmp': 'TextureImporter',
                    '.mat': 'NativeFormatImporter',
                    '.prefab': 'PrefabImporter',
                    '.anim': 'NativeFormatImporter',
                    '.controller': 'NativeFormatImporter',
                    '.mp4': 'VideoClipImporter',
                    '.mov': 'VideoClipImporter',
                    '.avi': 'VideoClipImporter',
                    '.webm': 'VideoClipImporter',
                    '.m4v': 'VideoClipImporter',
                    '.mpg': 'VideoClipImporter',
                    '.mpeg': 'VideoClipImporter',
                    '.wav': 'AudioImporter',
                    '.mp3': 'AudioImporter',
                    '.ogg': 'AudioImporter',
                    '.aif': 'AudioImporter',
                    '.aiff': 'AudioImporter',
                    '.flac': 'AudioImporter',
                }
                importer_type = importer_map.get(ext, 'UnknownImporter')
                artifact_id = None
                time_seconds = 0.001  # Placeholder for missing timing data
                time_ms = 1.0
                
                # Skip package folders that look like files (e.g., Packages/com.autodesk.fbx)
                # Real files have uppercase or mixed case extensions after the last dot
                path_parts = asset_path.split('/')
                last_part = path_parts[-1] if path_parts else ''
                
                # Package folders typically look like: com.unity.something or com.autodesk.fbx
                # Real files look like: Model.fbx or texture.png
                if last_part.startswith('com.') and '/' in asset_path and asset_path.count('/') <= 2:
                    return  # Skip package folder
                
                # Also skip if no file extension at all
                if '.' not in last_part:
                    return
                
                asset_name = Path(asset_path).name
                asset_type, asset_category = self._categorize_asset(asset_path, importer_type)
                
                self.cursor.execute("""
                    INSERT INTO asset_imports 
                    (log_id, line_number, asset_path, asset_name, asset_type, asset_category,
                     guid, artifact_id, importer_type, import_time_seconds, import_time_ms)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (log_id, line_number, asset_path, asset_name, asset_type, asset_category,
                      guid, artifact_id, importer_type, time_seconds, time_ms))
                return
        
        # Fallback pattern 2: incomplete/corrupted lines with importer: just get the basics
        if not match:
            fallback_pattern = r'Start importing (.+?) using Guid\(([a-f0-9]+)\) \((\w+)\)'
            match = re.search(fallback_pattern, line)
            if match:
                asset_path = match.group(1)
                guid = match.group(2)
                importer_type = match.group(3)
                
                # Handle invalid importer types (e.g., "-1")
                if importer_type == '-1' or importer_type == '':
                    importer_type = None
                
                # Skip folders
                if importer_type == 'DefaultImporter' and '.' not in Path(asset_path).name:
                    return None
                
                # For importers that might have multi-line timing (VideoClipImporter, etc.),
                # return None so the pending imports system can handle them
                multi_line_importers = ['VideoClipImporter', 'AudioImporter', 'MovieImporter']
                if importer_type in multi_line_importers:
                    return None  # Will be handled as pending import
                
                # For other importers without timing, insert with placeholder
                artifact_id = None
                time_seconds = 0.001  # Estimate time as 0.001 for missing data (will show as incomplete)
                time_ms = 1.0
                
                asset_name = Path(asset_path).name
                asset_type, asset_category = self._categorize_asset(asset_path, importer_type)
                
                self.cursor.execute("""
                    INSERT INTO asset_imports 
                    (log_id, line_number, asset_path, asset_name, asset_type, asset_category,
                     guid, artifact_id, importer_type, import_time_seconds, import_time_ms)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (log_id, line_number, asset_path, asset_name, asset_type, asset_category,
                      guid, artifact_id, importer_type, time_seconds, time_ms))
                return True
            return None
        
        asset_path = match.group(1)
        guid = match.group(2)
        importer_raw = match.group(3)
        artifact_id = match.group(4) if match.lastindex >= 4 else None
        time_seconds = float(match.group(5) if match.lastindex >= 5 else match.group(4))
        time_ms = time_seconds * 1000
        
        # Extract importer type from the captured group
        # e.g., "(TextureImporter)" -> "TextureImporter"  
        # e.g., "Importer(-1,00000000000000000000000000000000) " -> None (invalid)
        # e.g., "-1" -> None (invalid)
        importer_type = importer_raw.strip()
        if importer_type.startswith('(') and importer_type.endswith(')'):
            importer_type = importer_type.strip('()')
        elif importer_type.startswith('Importer('):
            # Check if it's an invalid importer like Importer(-1,...)
            if '-1' in importer_type:
                importer_type = None  # Invalid importer
            else:
                importer_type = 'Importer'
        
        # Handle invalid importer types (e.g., "-1", empty string, etc.)
        if importer_type in ('-1', '', None) or (importer_type and importer_type.strip() == '-1'):
            importer_type = None
        
        # Skip folders/directories and package folders
        path_parts = asset_path.split('/')
        last_part = path_parts[-1] if path_parts else ''
        
        # Skip package folders like "com.autodesk.fbx" 
        if last_part.startswith('com.') and asset_path.count('/') <= 2:
            return
        
        # Skip DefaultImporter folders with no file extension
        if importer_type == 'DefaultImporter' and '.' not in last_part:
            return
        
        asset_name = Path(asset_path).name
        asset_type, asset_category = self._categorize_asset(asset_path, importer_type)
        
        self.cursor.execute("""
            INSERT INTO asset_imports 
            (log_id, line_number, asset_path, asset_name, asset_type, asset_category,
             guid, artifact_id, importer_type, import_time_seconds, import_time_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (log_id, line_number, asset_path, asset_name, asset_type, asset_category,
              guid, artifact_id, importer_type, time_seconds, time_ms))
        return True
                  
    def _parse_pipeline_refresh(self, lines: List[str], start_line: int, log_id: int):
        """Parse Asset Pipeline Refresh line and its summary details"""
        first_line = lines[0]
        # Pattern: Asset Pipeline Refresh (id=XXXXX): Total: X.XXX seconds - Initiated by REASON
        pattern = r'Asset Pipeline Refresh \(id=([a-f0-9]+)\): Total: ([\d.]+) seconds - Initiated by (.+?)$'
        match = re.search(pattern, first_line)
        
        if match:
            refresh_id = match.group(1)
            total_time = float(match.group(2))
            initiated_by = match.group(3)
            
            # Parse summary details from following lines
            imports_total = imports_actual = None
            asset_db_process_ms = asset_db_callback_ms = None
            domain_reloads = domain_reload_ms = compile_ms = scripting_other_ms = None
            
            for line in lines[1:10]:  # Check next few lines for summary
                if 'Imports: total=' in line:
                    # Imports: total=516 (actual=515, local cache=1, cache server=0)
                    imports_match = re.search(r'total=(\d+).*actual=(\d+)', line)
                    if imports_match:
                        imports_total = int(imports_match.group(1))
                        imports_actual = int(imports_match.group(2))
                
                elif 'Asset DB Process Time:' in line:
                    # Asset DB Process Time: managed=79 ms, native=10061 ms
                    time_match = re.search(r'managed=(\d+)\s*ms.*native=(\d+)\s*ms', line)
                    if time_match:
                        asset_db_process_ms = int(time_match.group(1)) + int(time_match.group(2))
                
                elif 'Asset DB Callback time:' in line:
                    # Asset DB Callback time: managed=1099 ms, native=12169 ms
                    time_match = re.search(r'managed=(\d+)\s*ms.*native=(\d+)\s*ms', line)
                    if time_match:
                        asset_db_callback_ms = int(time_match.group(1)) + int(time_match.group(2))
                
                elif 'Scripting:' in line and 'domain reload' in line:
                    # Scripting: domain reloads=1, domain reload time=596 ms, compile time=20859 ms, other=59 ms
                    scripting_match = re.search(
                        r'domain reloads=(\d+).*domain reload time=([\d]+)\s*ms.*compile time=([\d]+)\s*ms.*other=([\d]+)\s*ms',
                        line
                    )
                    if scripting_match:
                        domain_reloads = int(scripting_match.group(1))
                        domain_reload_ms = int(scripting_match.group(2))
                        compile_ms = int(scripting_match.group(3))
                        scripting_other_ms = int(scripting_match.group(4))
            
            self.cursor.execute("""
                INSERT INTO pipeline_refreshes 
                (log_id, line_number, refresh_id, total_time_seconds, initiated_by,
                 imports_total, imports_actual, asset_db_process_time_ms, asset_db_callback_time_ms,
                 domain_reloads, domain_reload_time_ms, compile_time_ms, scripting_other_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (log_id, start_line, refresh_id, total_time, initiated_by,
                  imports_total, imports_actual, asset_db_process_ms, asset_db_callback_ms,
                  domain_reloads, domain_reload_ms, compile_ms, scripting_other_ms))
            
    def _parse_domain_reload(self, lines: List[str], start_line: int, log_id: int):
        """Parse domain reload profiling section (hierarchical)"""
        # Pattern: <tabs>StepName (Xms)
        pattern = r'^(\t*)(.+?) \((\d+)ms\)'
        
        parent_stack = {}  # Map indent level to parent ID
        last_id_at_level = {}
        
        for i, line in enumerate(lines):
            match = re.match(pattern, line)
            if match:
                indent = len(match.group(1))
                step_name = match.group(2)
                time_ms = float(match.group(3))
                line_number = start_line + i
                
                # Determine parent: one level up
                parent_id = last_id_at_level.get(indent - 1) if indent > 0 else None
                
                self.cursor.execute("""
                    INSERT INTO domain_reload_steps 
                    (log_id, line_number, parent_id, step_name, time_ms, indent_level)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (log_id, line_number, parent_id, step_name, time_ms, indent))
                
                step_id = self.cursor.lastrowid
                last_id_at_level[indent] = step_id
                
                # Clear deeper levels
                keys_to_remove = [k for k in last_id_at_level if k > indent]
                for k in keys_to_remove:
                    del last_id_at_level[k]
            else:
                # End of domain reload section
                break
                
    def _parse_script_compilation(self, line: str, line_number: int, log_id: int):
        """Parse script compilation processing line"""
        # Pattern: Processing assembly PATH, with X defines and Y references
        pattern = r'Processing assembly (.+?), with (\d+) defines and (\d+) references'
        match = re.search(pattern, line)
        
        if match:
            assembly_path = match.group(1)
            defines_count = int(match.group(2))
            references_count = int(match.group(3))
            
            self.cursor.execute("""
                INSERT INTO script_compilation 
                (log_id, line_number, assembly_path, defines_count, references_count)
                VALUES (?, ?, ?, ?, ?)
            """, (log_id, line_number, assembly_path, defines_count, references_count))
            
    def _parse_telemetry(self, line: str, line_number: int, log_id: int):
        """Parse JSON telemetry data"""
        # Pattern: ##utp:{JSON}
        match = re.search(r'##utp:(\{.+\})', line)
        
        if match:
            json_str = match.group(1)
            try:
                json_data = json.loads(json_str)
                telemetry_type = json_data.get('type', 'Unknown')
                
                self.cursor.execute("""
                    INSERT INTO telemetry_data 
                    (log_id, line_number, telemetry_type, json_data)
                    VALUES (?, ?, ?, ?)
                """, (log_id, line_number, telemetry_type, json_str))
            except json.JSONDecodeError:
                print(f"Warning: Failed to parse JSON at line {line_number}")
    
    def _parse_operation(self, line: str, line_number: int, log_id: int):
        """Parse operation timing lines like 'Sprite Atlas Operation : " ## Generating Atlas Masks ## " took 81.189218 sec'"""
        # Pattern: OperationType : " ## OperationName ## " took X.XXXXXX sec (current mem: XXXX MB)
        pattern = r'([^:]+)\s*:\s*"\s*##\s*(.+?)\s*##\s*"\s+took\s+([\d.]+)\s+sec(?:.*current mem:\s*(\d+)\s*MB)?'
        match = re.search(pattern, line)
        
        if match:
            operation_type = match.group(1).strip()
            operation_name = match.group(2).strip()
            duration_seconds = float(match.group(3))
            duration_ms = duration_seconds * 1000
            memory_mb = int(match.group(4)) if match.group(4) else None
            
            self.cursor.execute("""
                INSERT INTO operations 
                (log_id, line_number, operation_type, operation_name, duration_seconds, duration_ms, memory_mb)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (log_id, line_number, operation_type, operation_name, duration_seconds, duration_ms, memory_mb))
    
    def _parse_tundra_operation(self, line: str, line_number: int, log_id: int):
        """Parse Tundra build system operations like '*** Tundra requires additional run (10.31 seconds), 1 items updated, 666 evaluated'"""
        # Pattern: *** Tundra <operation_name> (<time> seconds), <items> items updated, <evaluated> evaluated
        pattern = r'\*\*\*\s+Tundra\s+([^\(]+)\s+\(([\d.]+)\s+seconds?\),\s+(\d+)\s+items?\s+updated,\s+(\d+)\s+evaluated'
        match = re.search(pattern, line)
        
        if match:
            operation_name = match.group(1).strip()
            duration_seconds = float(match.group(2))
            duration_ms = duration_seconds * 1000
            items_updated = int(match.group(3))
            items_evaluated = int(match.group(4))
            
            # Store full operation name with details
            full_operation_name = f"{operation_name} ({items_updated} items updated, {items_evaluated} evaluated)"
            
            self.cursor.execute("""
                INSERT INTO operations 
                (log_id, line_number, operation_type, operation_name, duration_seconds, duration_ms)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (log_id, line_number, 'Tundra', full_operation_name, duration_seconds, duration_ms))
                
    def _classify_line(self, line: str) -> Tuple[str, int, bool, bool]:
        """Classify log line type, indent level, and error/warning status"""
        line_type = 'normal'
        indent_level = 0
        is_error = False
        is_warning = False
        
        # Count indentation
        indent_level = len(line) - len(line.lstrip('\t'))
        
        # Check for errors and warnings
        line_lower = line.lower()
        if 'error' in line_lower or 'exception' in line_lower:
            is_error = True
            line_type = 'error'
        elif 'warning' in line_lower:
            is_warning = True
            line_type = 'warning'
        elif line.startswith('['):
            line_type = 'system'
        elif 'Start importing' in line:
            line_type = 'import'
        elif 'Asset Pipeline Refresh' in line:
            line_type = 'pipeline'
        elif 'Domain Reload' in line:
            line_type = 'domain_reload'
        elif '##utp:' in line:
            line_type = 'telemetry'
        
        return line_type, indent_level, is_error, is_warning
                
    def _store_log_lines(self, lines: List[str], log_id: int):
        """Store all log lines for the log viewer"""
        total_lines = len(lines)
        print("Storing log lines for viewer...")
        print(f"Total lines: {total_lines}")
        
        batch_data = []
        batch_size = 1000
        for i, line in enumerate(lines, 1):
            line_type, indent_level, is_error, is_warning = self._classify_line(line)
            
            # Extract timestamp if present (format: YYYY-MM-DDTHH:MM:SS)
            timestamp = None
            ts_match = re.search(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})', line)
            if ts_match:
                timestamp = ts_match.group(1)
            
            batch_data.append((
                log_id, i, line, line_type, indent_level, 
                is_error, is_warning, timestamp
            ))
            
            # Insert in batches of 1000 for performance
            if len(batch_data) >= batch_size:
                self.cursor.executemany("""
                    INSERT INTO log_lines 
                    (log_id, line_number, content, line_type, indent_level, 
                     is_error, is_warning, timestamp)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, batch_data)
                batch_data = []
                
                # Progress update every 1000 lines
                processed = i
                print(f"Stored {processed}/{total_lines} log lines...")
        
        # Insert remaining lines
        if batch_data:
            self.cursor.executemany("""
                INSERT INTO log_lines 
                (log_id, line_number, content, line_type, indent_level, 
                 is_error, is_warning, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, batch_data)
            print(f"Stored {len(lines)}/{total_lines} log lines...")
        
        self.conn.commit()
                
    def parse_log_file(self, log_file_path: str) -> int:
        """Parse Unity log file and extract all timing data"""
        print(f"Parsing log file: {log_file_path}")
        start_time = datetime.now()
        
        # Read file
        with open(log_file_path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
        
        total_lines = len(lines)
        print(f"Total lines: {total_lines}")
        
        # Extract metadata from header
        unity_version = None
        platform = None
        architecture = None
        project_name = None
        
        for line in lines[:100]:  # Check first 100 lines for metadata
            if not unity_version:
                unity_version = self._extract_unity_version(line)
            if not platform:
                platform = self._extract_platform(line)
            if not architecture:
                architecture = self._extract_architecture(line)
            if not project_name:
                # Try to extract project name from -projectpath argument
                project_path_match = re.search(r'-projectpath\s+([^\s]+)', line)
                if project_path_match:
                    project_path = project_path_match.group(1)
                    # Extract project name from path (last directory)
                    project_name = Path(project_path).name
                # Also check for "Successfully changed project path to:"
                elif 'Successfully changed project path to:' in line:
                    # Extract path from line
                    path_match = re.search(r'Successfully changed project path to:\s+([^\s]+)', line)
                    if path_match:
                        project_path = path_match.group(1)
                        project_name = Path(project_path).name
        
        # Fallback: extract from log file path if not found in log
        if not project_name:
            # Try to infer from log file name or path
            log_path = Path(log_file_path)
            # If log file is in a project directory, use parent directory name
            if 'Editor.log' in log_path.name or 'Editor_' in log_path.name:
                # Check if parent directory looks like a project
                parent = log_path.parent
                if (parent / 'Assets').exists() or (parent / 'ProjectSettings').exists():
                    project_name = parent.name
        
        # Create log metadata entry
        self.cursor.execute("""
            INSERT INTO log_metadata 
            (log_file, unity_version, platform, architecture, project_name, total_lines)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (log_file_path, unity_version, platform, architecture, project_name, total_lines))
        log_id = self.cursor.lastrowid
        
        # Parse line by line
        in_domain_reload = False
        domain_reload_lines = []
        domain_reload_start = 0
        
        # Track worker thread states for interleaved imports
        # worker_states[worker_num] = {'asset_path': str, 'guid': str, 'line_number': int, 'importer_type': str}
        worker_states = {}
        
        # Track non-worker pending imports (for videos and other multi-line imports)
        # pending_imports[guid] = {'asset_path': str, 'guid': str, 'line_number': int, 'importer_type': str}
        pending_imports = {}
        
        for i, line in enumerate(lines, 1):
            # Check for worker thread patterns first
            worker_match = re.match(r'\[Worker(\d+)\]\s+(.+)', line)
            if worker_match:
                worker_num = int(worker_match.group(1))
                worker_line = worker_match.group(2)
                
                # Worker starting an import?
                if 'Start importing' in worker_line:
                    start_pattern = r'Start importing (.+?) using Guid\(([a-f0-9]+)\)\s*$'
                    start_match = re.search(start_pattern, worker_line)
                    if start_match:
                        asset_path = start_match.group(1)
                        guid = start_match.group(2)
                        
                        # Store this worker's state (importer_type will be set from next line)
                        worker_states[worker_num] = {
                            'asset_path': asset_path,
                            'guid': guid,
                            'line_number': i,
                            'importer_type': None  # Will be set from next line
                        }
                        continue
                
                # Check for importer type on next line after "Start importing"
                # Pattern: [Worker1] (TextureImporter) or [Worker1] (-1) for invalid
                if worker_num in worker_states and worker_states[worker_num]['importer_type'] is None:
                    importer_match = re.match(r'\(([A-Za-z0-9\-]+)\)\s*$', worker_line)
                    if importer_match:
                        importer_type = importer_match.group(1)
                        # Handle invalid importer types (e.g., "-1")
                        if importer_type == '-1' or not importer_type.endswith('Importer'):
                            importer_type = None
                        worker_states[worker_num]['importer_type'] = importer_type
                        continue
                
                # Worker completing an import?
                if '-> (artifact id:' in worker_line:
                    artifact_pattern = r'-> \(artifact id: \'([a-f0-9]+)\'\) in ([\d.]+) seconds'
                    artifact_match = re.search(artifact_pattern, worker_line)
                    if artifact_match and worker_num in worker_states:
                        artifact_id = artifact_match.group(1)
                        time_seconds = float(artifact_match.group(2))
                        time_ms = time_seconds * 1000
                        
                        # Get the stored import info for this worker
                        state = worker_states[worker_num]
                        asset_path = state['asset_path']
                        guid = state['guid']
                        start_line = state['line_number']
                        importer_type = state.get('importer_type')
                        
                        # Handle invalid importer types
                        if importer_type == '-1' or importer_type == '':
                            importer_type = None
                        
                        # If importer_type wasn't captured from log or is invalid, infer from extension
                        if not importer_type:
                            ext = Path(asset_path).suffix.lower()
                            importer_map = {
                                '.fbx': 'FBXImporter',
                                '.png': 'TextureImporter',
                                '.jpg': 'TextureImporter',
                                '.jpeg': 'TextureImporter',
                                '.exr': 'TextureImporter',
                                '.tga': 'TextureImporter',
                                '.hdr': 'TextureImporter',
                                '.tif': 'TextureImporter',
                                '.tiff': 'TextureImporter',
                                '.bmp': 'TextureImporter',
                                '.mat': 'NativeFormatImporter',
                                '.prefab': 'PrefabImporter',
                                '.anim': 'NativeFormatImporter',
                                '.controller': 'NativeFormatImporter',
                                '.mp4': 'VideoClipImporter',
                                '.mov': 'VideoClipImporter',
                                '.avi': 'VideoClipImporter',
                                '.webm': 'VideoClipImporter',
                                '.m4v': 'VideoClipImporter',
                                '.mpg': 'VideoClipImporter',
                                '.mpeg': 'VideoClipImporter',
                                '.wav': 'AudioImporter',
                                '.mp3': 'AudioImporter',
                                '.ogg': 'AudioImporter',
                                '.aif': 'AudioImporter',
                                '.aiff': 'AudioImporter',
                                '.flac': 'AudioImporter',
                            }
                            importer_type = importer_map.get(ext, 'UnknownImporter')
                        
                        # Skip package folders
                        path_parts = asset_path.split('/')
                        last_part = path_parts[-1] if path_parts else ''
                        if last_part.startswith('com.') and asset_path.count('/') <= 2:
                            del worker_states[worker_num]
                            continue
                        
                        # Skip folders without extensions
                        if '.' not in last_part:
                            del worker_states[worker_num]
                            continue
                        
                        asset_name = Path(asset_path).name
                        asset_type, asset_category = self._categorize_asset(asset_path)
                        
                        # Insert the completed import with real timing
                        self.cursor.execute("""
                            INSERT INTO asset_imports 
                            (log_id, line_number, asset_path, asset_name, asset_type, asset_category,
                             guid, artifact_id, importer_type, import_time_seconds, import_time_ms)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (log_id, start_line, asset_path, asset_name, asset_type, asset_category,
                              guid, artifact_id, importer_type, time_seconds, time_ms))
                        
                        # Clear this worker's state
                        del worker_states[worker_num]
                        continue
            
            # Check for artifact ID completion lines for pending non-worker imports
            # This handles cases where timing is on a separate line (e.g., videos with warnings)
            if '-> (artifact id:' in line and '[Worker' not in line:
                artifact_pattern = r'-> \(artifact id: \'([a-f0-9]+)\'\) in ([\d.]+) seconds'
                artifact_match = re.search(artifact_pattern, line)
                if artifact_match and pending_imports:
                    artifact_id = artifact_match.group(1)
                    time_seconds = float(artifact_match.group(2))
                    time_ms = time_seconds * 1000
                    
                    # Find the most recent pending import (they process in order)
                    guid = list(pending_imports.keys())[-1] if pending_imports else None
                    if guid and guid in pending_imports:
                        state = pending_imports[guid]
                        asset_path = state['asset_path']
                        start_line = state['line_number']
                        importer_type = state['importer_type']
                        
                        # Get asset metadata
                        asset_name = Path(asset_path).name
                        asset_type, asset_category = self._categorize_asset(asset_path, importer_type)
                        
                        # Record the completed import
                        self.cursor.execute("""
                            INSERT INTO asset_imports 
                            (log_id, line_number, asset_path, asset_name, asset_type, asset_category,
                             guid, artifact_id, importer_type, import_time_seconds, import_time_ms)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (log_id, start_line, asset_path, asset_name, asset_type, asset_category,
                              guid, artifact_id, importer_type, time_seconds, time_ms))
                        
                        # Remove from pending
                        del pending_imports[guid]
                    continue
            
            # Non-worker thread asset imports (standard format)
            if 'Start importing' in line and '[Worker' not in line:
                # Try to parse as complete import first (single-line with timing)
                result = self._parse_asset_import(line, i, log_id)
                
                # If no timing found, check if this is a pending import (multi-line case)
                if result is None:
                    # Pattern: Start importing PATH using Guid(GUID) (ImporterType)
                    start_pattern = r'Start importing (.+?) using Guid\(([a-f0-9]+)\) \(([A-Za-z0-9]+)\)'
                    start_match = re.search(start_pattern, line)
                    if start_match:
                        asset_path = start_match.group(1)
                        guid = start_match.group(2)
                        importer_type = start_match.group(3)
                        
                        # Store as pending (timing will come on a later line)
                        pending_imports[guid] = {
                            'asset_path': asset_path,
                            'guid': guid,
                            'line_number': i,
                            'importer_type': importer_type
                        }
            
            # Pipeline refreshes (with summary context)
            elif 'Asset Pipeline Refresh' in line:
                # Get next 10 lines for summary details
                context_lines = [line] + lines[i:min(i+10, len(lines))]
                self._parse_pipeline_refresh(context_lines, i, log_id)
            
            # Domain reload profiling
            elif 'Domain Reload Profiling:' in line:
                in_domain_reload = True
                domain_reload_start = i
                domain_reload_lines = [line]
            elif in_domain_reload:
                if re.match(r'^\t+.+? \(\d+ms\)', line):
                    domain_reload_lines.append(line)
                else:
                    # End of domain reload section
                    self._parse_domain_reload(domain_reload_lines, domain_reload_start, log_id)
                    in_domain_reload = False
                    domain_reload_lines = []
            
            # Script compilation
            elif 'Processing assembly' in line:
                self._parse_script_compilation(line, i, log_id)
            
            # JSON telemetry
            elif '##utp:' in line:
                self._parse_telemetry(line, i, log_id)
            
            # Operations (Sprite Atlas, etc.)
            elif 'Operation' in line and 'took' in line and 'sec' in line:
                self._parse_operation(line, i, log_id)
            
            # Tundra build system operations
            elif '*** Tundra' in line and 'seconds' in line:
                self._parse_tundra_operation(line, i, log_id)
            
            # Progress indicator
            if i % 1000 == 0:
                print(f"  Processed {i}/{total_lines} lines...")
        
        # Store full log lines for viewer
        self._store_log_lines(lines, log_id)
        
        # Update parse time
        end_time = datetime.now()
        parse_duration = (end_time - start_time).total_seconds() * 1000
        
        self.cursor.execute("""
            UPDATE log_metadata 
            SET total_parse_time_ms = ?
            WHERE id = ?
        """, (parse_duration, log_id))
        
        self.conn.commit()
        
        # Print summary
        print(f"\nParsing complete in {parse_duration:.2f}ms")
        self._print_summary(log_id)
        
        return log_id
        
    def _print_summary(self, log_id: int):
        """Print summary statistics"""
        print("\n=== Parsing Summary ===")
        
        # Asset imports
        self.cursor.execute("""
            SELECT COUNT(*), SUM(import_time_ms), AVG(import_time_ms), MAX(import_time_ms)
            FROM asset_imports WHERE log_id = ?
        """, (log_id,))
        count, total_time, avg_time, max_time = self.cursor.fetchone()
        print(f"Asset Imports: {count or 0}")
        if count:
            print(f"  Total time: {total_time:.2f}ms ({total_time/1000:.2f}s)")
            print(f"  Average: {avg_time:.2f}ms")
            print(f"  Longest: {max_time:.2f}ms")
        
        # By category
        self.cursor.execute("""
            SELECT asset_category, COUNT(*), SUM(import_time_ms)
            FROM asset_imports 
            WHERE log_id = ?
            GROUP BY asset_category
            ORDER BY SUM(import_time_ms) DESC
        """, (log_id,))
        print("\n  By Category:")
        for category, count, total in self.cursor.fetchall():
            print(f"    {category}: {count} assets, {total:.2f}ms")
        
        # Pipeline refreshes
        self.cursor.execute("""
            SELECT COUNT(*), SUM(total_time_seconds)
            FROM pipeline_refreshes WHERE log_id = ?
        """, (log_id,))
        count, total_time = self.cursor.fetchone()
        print(f"\nPipeline Refreshes: {count or 0}")
        if count and total_time:
            print(f"  Total time: {total_time:.2f}s")
        
        # Domain reload steps
        self.cursor.execute("""
            SELECT COUNT(*), SUM(time_ms)
            FROM domain_reload_steps WHERE log_id = ?
        """, (log_id,))
        count, total_time = self.cursor.fetchone()
        print(f"\nDomain Reload Steps: {count or 0}")
        if count and total_time:
            print(f"  Total time: {total_time:.2f}ms")
        
        # Script compilation
        self.cursor.execute("""
            SELECT COUNT(*) FROM script_compilation WHERE log_id = ?
        """, (log_id,))
        count = self.cursor.fetchone()[0]
        print(f"\nScript Assemblies Processed: {count or 0}")
        
        # Telemetry
        self.cursor.execute("""
            SELECT COUNT(*) FROM telemetry_data WHERE log_id = ?
        """, (log_id,))
        count = self.cursor.fetchone()[0]
        print(f"\nTelemetry Entries: {count or 0}")
        
    def close(self):
        """Close database connection"""
        if self.conn:
            self.conn.close()


def main():
    """Main entry point"""
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python log_parser.py <path_to_editor_log>")
        print("\nExample:")
        print("  python log_parser.py TEST_EditorLogFiles/Empty_Open_Editor.log")
        sys.exit(1)
    
    log_file = sys.argv[1]
    
    if not Path(log_file).exists():
        print(f"Error: File not found: {log_file}")
        sys.exit(1)
    
    parser = UnityLogParser()
    try:
        parser.parse_log_file(log_file)
    finally:
        parser.close()
    
    print(f"\nDatabase saved to: unity_log.db")


if __name__ == "__main__":
    main()
