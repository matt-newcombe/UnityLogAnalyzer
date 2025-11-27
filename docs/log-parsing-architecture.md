# Unity Editor Log Parsing Architecture

This document explains the mechanisms involved in parsing a Unity Editor log file in this application.

---

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              LOG FILE PARSING FLOW                                   │
└─────────────────────────────────────────────────────────────────────────────────────┘

  ┌──────────┐     ┌───────────────┐     ┌────────────────┐     ┌──────────────────┐
  │ Log File │────▶│ File Reader   │────▶│ Stream         │────▶│ Line Callback    │
  │ (.log)   │     │ (Chunked I/O) │     │ Processor      │     │ (per line)       │
  └──────────┘     └───────────────┘     └────────────────┘     └────────┬─────────┘
                                                                         │
                                                                         ▼
  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │                              UNITY LOG PARSER                                     │
  │  ┌─────────────────────────────────────────────────────────────────────────────┐ │
  │  │                         Handler Dispatch Chain                               │ │
  │  │                                                                              │ │
  │  │  ┌──────────────┐   ┌─────────────────┐   ┌────────────────┐                │ │
  │  │  │  Metadata    │──▶│  Worker Thread  │──▶│   Pipeline     │                │ │
  │  │  │  Handler     │   │  Handler        │   │   Handler      │                │ │
  │  │  └──────────────┘   └─────────────────┘   └────────────────┘                │ │
  │  │         │                   │                     │                          │ │
  │  │         ▼                   ▼                     ▼                          │ │
  │  │  ┌──────────────┐   ┌─────────────────┐   ┌────────────────┐                │ │
  │  │  │ Accelerator  │──▶│  Sprite Atlas   │──▶│    Asset       │                │ │
  │  │  │ Handler      │   │  Handler        │   │    Handler     │                │ │
  │  │  └──────────────┘   └─────────────────┘   └────────────────┘                │ │
  │  │         │                   │                     │                          │ │
  │  │         ▼                   ▼                     ▼                          │ │
  │  │  ┌───────────────────────────────────────────────────────────────────────┐  │ │
  │  │  │                     Script Compilation Handler                         │  │ │
  │  │  └───────────────────────────────────────────────────────────────────────┘  │ │
  │  └─────────────────────────────────────────────────────────────────────────────┘ │
  │                                       │                                           │
  │                                       ▼                                           │
  │  ┌─────────────────────────────────────────────────────────────────────────────┐ │
  │  │                          Parser State                                        │ │
  │  │  • Pending imports    • Worker thread states   • Timestamp tracking          │ │
  │  │  • Pipeline state     • Accelerator blocks     • Metadata state              │ │
  │  └─────────────────────────────────────────────────────────────────────────────┘ │
  └──────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │                     PARSING DATABASE OPERATIONS                                   │
  │                                                                                   │
  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                   │
  │  │ Asset Imports   │  │ Pipeline        │  │ Worker Phases   │                   │
  │  │ Collection      │  │ Refreshes       │  │ Collection      │                   │
  │  └─────────────────┘  └─────────────────┘  └─────────────────┘                   │
  │  ┌─────────────────┐  ┌─────────────────┐                                        │
  │  │ Processes       │  │ Accelerator     │                                        │
  │  │ Collection      │  │ Blocks          │                                        │
  │  └─────────────────┘  └─────────────────┘                                        │
  │                              │                                                    │
  │                              ▼                                                    │
  │               executeBatchOperations() / flush()                                  │
  └──────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │                          INDEXEDDB (via Dexie.js)                                 │
  │                                                                                   │
  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  │
  │  │ log_metadata   │  │ asset_imports  │  │ pipeline_      │  │ processes      │  │
  │  │                │  │                │  │ refreshes      │  │                │  │
  │  └────────────────┘  └────────────────┘  └────────────────┘  └────────────────┘  │
  │  ┌────────────────┐  ┌────────────────┐                                          │
  │  │ cache_server_  │  │ worker_thread_ │                                          │
  │  │ download_blocks│  │ phases         │                                          │
  │  └────────────────┘  └────────────────┘                                          │
  └──────────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. File Reader (`file-reader.js`)

```
┌────────────────────────────────────────────────────────────────────┐
│                        FILE READER                                  │
│                                                                     │
│   ┌─────────────┐                                                  │
│   │  File API   │  Reads file in 1MB chunks                        │
│   │  .slice()   │                                                  │
│   └──────┬──────┘                                                  │
│          │                                                          │
│          ▼                                                          │
│   ┌─────────────┐                                                  │
│   │ FileReader  │  Converts to ArrayBuffer                         │
│   │ .readAs     │                                                  │
│   │ ArrayBuffer │                                                  │
│   └──────┬──────┘                                                  │
│          │                                                          │
│          ▼                                                          │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │              LogStreamProcessor                              │  │
│   │                                                              │  │
│   │  • Decodes UTF-8 bytes to text                              │  │
│   │  • Handles line boundaries across chunks                     │  │
│   │  • Tracks byte offsets for each line                        │  │
│   │  • Handles \n and \r\n line endings                         │  │
│   │  • Manages buffer for partial lines                         │  │
│   └─────────────────────────────────────────────────────────────┘  │
│          │                                                          │
│          ▼                                                          │
│   lineCallback(line, lineNumber, byteOffset)                       │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

**Key Features:**
- Streams file in 1MB chunks to handle large log files
- Yields to event loop periodically for UI responsiveness
- Supports cancellation via signal
- Reports progress as percentage read

---

### 2. Unity Log Parser (`log-parser.js`)

The main orchestrator that coordinates all parsing activities.

```
┌────────────────────────────────────────────────────────────────────┐
│                      UNITY LOG PARSER                               │
│                                                                     │
│   parseLogFile(file)                                               │
│        │                                                            │
│        ├──▶ _cacheFile()           Store file reference            │
│        ├──▶ _createLogMetadata()   Create DB entry                 │
│        ├──▶ _processFile()         Stream & parse all lines        │
│        │         │                                                  │
│        │         └──▶ _parseLine() ◀──── For each line             │
│        │                   │                                        │
│        │                   ├──▶ Strip timestamp                    │
│        │                   ├──▶ Dispatch to handlers               │
│        │                   └──▶ Update parser state                │
│        │                                                            │
│        ├──▶ _finalizeParsing()     Close open blocks               │
│        ├──▶ executeBatchOps()      Write to database               │
│        └──▶ _updateFinalMetadata() Store final stats               │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

---

### 3. Handler Dispatch Chain

Each line is processed through a chain of specialized handlers. The first handler that matches "claims" the line.

```
┌────────────────────────────────────────────────────────────────────┐
│                    HANDLER DISPATCH ORDER                           │
│                                                                     │
│   Line Input                                                        │
│       │                                                             │
│       ▼                                                             │
│   ┌───────────────────────────────────────────────────────────┐    │
│   │ 1. METADATA HANDLER                                        │    │
│   │    • Unity version, platform, architecture                 │    │
│   │    • Project path detection                                │    │
│   │    • Only active during initial log lines                  │    │
│   └───────────────────────────────────────────────────────────┘    │
│       │ (if not matched)                                            │
│       ▼                                                             │
│   ┌───────────────────────────────────────────────────────────┐    │
│   │ 2. WORKER THREAD HANDLER                                   │    │
│   │    • Matches "[Worker N]" prefixed lines                   │    │
│   │    • Tracks worker barriers (parallel import periods)      │    │
│   │    • Per-thread time tracking                              │    │
│   └───────────────────────────────────────────────────────────┘    │
│       │ (if not matched)                                            │
│       ▼                                                             │
│   ┌───────────────────────────────────────────────────────────┐    │
│   │ 3. PIPELINE HANDLER                                        │    │
│   │    • "Asset Pipeline Refresh" blocks                       │    │
│   │    • Tracks refresh IDs and durations                      │    │
│   └───────────────────────────────────────────────────────────┘    │
│       │ (if not matched)                                            │
│       ▼                                                             │
│   ┌───────────────────────────────────────────────────────────┐    │
│   │ 4. ACCELERATOR HANDLER                                     │    │
│   │    • Unity Cache Server / Accelerator blocks               │    │
│   │    • "Querying for cacheable assets" detection             │    │
│   │    • Downloaded artifact tracking                          │    │
│   └───────────────────────────────────────────────────────────┘    │
│       │ (if not matched)                                            │
│       ▼                                                             │
│   ┌───────────────────────────────────────────────────────────┐    │
│   │ 5. SPRITE ATLAS HANDLER                                    │    │
│   │    • Sprite atlas import tracking                          │    │
│   │    • "Processing Atlas" detection                          │    │
│   └───────────────────────────────────────────────────────────┘    │
│       │ (if not matched)                                            │
│       ▼                                                             │
│   ┌───────────────────────────────────────────────────────────┐    │
│   │ 6. ASSET HANDLER                                           │    │
│   │    • Main thread asset imports                             │    │
│   │    • "Start importing X using Guid(Y)"                     │    │
│   │    • Single-line and multi-line import formats             │    │
│   │    • Animation detection (keyframe reduction)              │    │
│   └───────────────────────────────────────────────────────────┘    │
│       │ (if not matched)                                            │
│       ▼                                                             │
│   ┌───────────────────────────────────────────────────────────┐    │
│   │ 7. SCRIPT COMPILATION HANDLER                              │    │
│   │    • "Requested script compilation" detection              │    │
│   │    • Compilation time tracking                             │    │
│   └───────────────────────────────────────────────────────────┘    │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

---

### 4. Parser State (`parser-state.js`)

Maintains all stateful information during parsing:

```
┌────────────────────────────────────────────────────────────────────┐
│                        PARSER STATE                                 │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │ METADATA STATE                                               │  │
│   │  • unityVersion, platform, architecture                     │  │
│   │  • projectName                                               │  │
│   │  • inMetadata flag                                           │  │
│   └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │ WORKER THREAD STATE                                          │  │
│   │  • workerThreadStates: Map<threadId, importState>           │  │
│   │  • workerThreads: Map<threadId, barrierState>               │  │
│   │  • pendingWorkerThreads: awaiting end timestamp             │  │
│   │  • threadLocalTimes: per-thread time cursors                │  │
│   └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │ IMPORT STATE                                                 │  │
│   │  • pendingImports: Map<guid, pendingImportData>             │  │
│   │  • Tracks multi-line imports awaiting completion            │  │
│   └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │ TIMESTAMP TRACKING                                           │  │
│   │  • firstTimestamp, lastTimestamp                            │  │
│   │  • logCurrentTime (virtual clock for non-timestamped logs)  │  │
│   │  • timestampsEnabled (auto-detected)                        │  │
│   └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │ BLOCK STATES                                                 │  │
│   │  • pipelineRefreshState                                     │  │
│   │  • spriteAtlasState                                         │  │
│   │  • scriptCompilationState                                   │  │
│   │  • acceleratorBlock                                         │  │
│   └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

---

### 5. Database Operations (`parsing-database-operations.js`)

Collects parsed data and writes to IndexedDB:

```
┌────────────────────────────────────────────────────────────────────┐
│                 PARSING DATABASE OPERATIONS                         │
│                                                                     │
│   SYNCHRONOUS COLLECTION (during parsing)                          │
│   ─────────────────────────────────────────                        │
│                                                                     │
│   addAssetImport(data)      ──▶  collectArrays.assetImports[]     │
│   addProcess(data)          ──▶  collectArrays.processes[]        │
│   addPipelineRefresh(data)  ──▶  collectArrays.pipelineRefreshes[]│
│   addAcceleratorBlock(data) ──▶  collectArrays.acceleratorBlocks[]│
│   addWorkerPhase(data)      ──▶  collectArrays.workerPhases[]     │
│                                                                     │
│                                                                     │
│   ASYNC DATABASE WRITES                                            │
│   ─────────────────────────                                        │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │ executeBatchOperations()                                     │  │
│   │                                                              │  │
│   │  For offline file parsing:                                   │  │
│   │  • Called once after all lines processed                    │  │
│   │  • Bulk inserts all collected data                          │  │
│   │  • Reports progress for large datasets                      │  │
│   └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │ flush()                                                      │  │
│   │                                                              │  │
│   │  For live monitoring:                                        │  │
│   │  • Called after each line                                   │  │
│   │  • Immediately writes to database                           │  │
│   │  • Clears collection arrays                                 │  │
│   └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

---

### 6. Log Patterns (`log-patterns.js`)

Centralized regex patterns for parsing:

```
┌────────────────────────────────────────────────────────────────────┐
│                        LOG PATTERNS                                 │
│                                                                     │
│   METADATA                                                          │
│   ────────                                                          │
│   • UnityVersion:  /Unity Editor version:\s+(\S+)/                 │
│   • Architecture:  /Architecture:\s+(\S+)/                         │
│   • ProjectPath:   /-projectpath\s+([^\s]+)/                       │
│                                                                     │
│   TIMESTAMPS                                                        │
│   ──────────                                                        │
│   • TimestampPrefix: /^(\d{4}-\d{2}-\d{2}T...)Z\|[^|]+\|(.*)$/     │
│                                                                     │
│   WORKER THREADS                                                    │
│   ──────────────                                                    │
│   • WorkerThread:       /^\[Worker\s*(\d+)\]\s+(.+)/               │
│   • WorkerImportStart:  /Start importing (.+?) using Guid\(...\)/  │
│   • WorkerImportComplete: /-> \(artifact id: '...'\) in X sec/     │
│                                                                     │
│   ASSET IMPORTS                                                     │
│   ─────────────                                                     │
│   • AssetImportComplete:  Full single-line import                  │
│   • AssetImportStartSimple: Multi-line import start                │
│   • AssetImportCrunched:  Texture compression format               │
│                                                                     │
│   PIPELINE                                                          │
│   ────────                                                          │
│   • PipelineRefreshStart: /Asset Pipeline Refresh \(id=...\)/      │
│                                                                     │
│   ACCELERATOR                                                       │
│   ───────────                                                       │
│   • AcceleratorQuery: /Querying for cacheable assets.../           │
│   • AcceleratorDownloaded: /Artifact ... downloaded for '...'/     │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Example

Here's how a single asset import line flows through the system:

```
Log Line:
"2024-01-15T10:30:45.123Z|INFO|Start importing Assets/Textures/hero.png 
 using Guid(abc123) TextureImporter -> (artifact id: 'def456') in 0.523 seconds"

     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. FILE READER                                                   │
│    • Reads chunk containing this line                           │
│    • LogStreamProcessor extracts line with byte offset          │
│    • Calls lineCallback(line, 1234, 45678)                      │
└─────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. UNITY LOG PARSER - _parseLine()                              │
│    • Strips timestamp: "2024-01-15T10:30:45.123Z"               │
│    • Updates state.logCurrentTime                               │
│    • Extracts content: "Start importing Assets/..."             │
└─────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. HANDLER DISPATCH                                              │
│    • MetadataHandler: No match (not metadata line)              │
│    • WorkerThreadHandler: No match (no [Worker] prefix)         │
│    • PipelineHandler: No match                                  │
│    • AcceleratorHandler: No match                               │
│    • SpriteAtlasHandler: No match                               │
│    • AssetHandler: MATCH! ✓                                     │
└─────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. ASSET HANDLER                                                 │
│    • Matches AssetImportComplete pattern                        │
│    • Extracts: path, guid, importer, artifactId, time           │
│    • Calculates wall-clock duration from timestamps             │
│    • Creates assetImport object                                 │
│    • Calls dbOps.addAssetImport(assetImport)                    │
└─────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. DATABASE OPERATIONS                                           │
│    • Adds to collectArrays.assetImports[]                       │
│    • (Later) executeBatchOperations() bulk inserts              │
└─────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. INDEXEDDB                                                     │
│    asset_imports table:                                          │
│    {                                                             │
│      id: 1,                                                      │
│      line_number: 1234,                                          │
│      byte_offset: 45678,                                         │
│      asset_path: "Assets/Textures/hero.png",                    │
│      asset_type: "Texture",                                      │
│      asset_category: "Textures",                                │
│      guid: "abc123",                                             │
│      importer_type: "TextureImporter",                          │
│      import_time_ms: 523,                                        │
│      start_timestamp: "2024-01-15T10:30:44.600Z",               │
│      end_timestamp: "2024-01-15T10:30:45.123Z"                  │
│    }                                                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Two Parsing Modes

```
┌────────────────────────────────────────────────────────────────────┐
│                     OFFLINE FILE PARSING                            │
│                                                                     │
│   User selects file ──▶ parseLogFile() ──▶ Process all lines      │
│                                                 │                   │
│                                                 ▼                   │
│                                    executeBatchOperations()         │
│                                    (bulk write at end)              │
│                                                                     │
│   ✓ Faster for large files                                         │
│   ✓ Single database transaction                                    │
│   ✓ Progress reporting                                             │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│                     LIVE MONITORING                                 │
│                                                                     │
│   File watcher ──▶ New line detected ──▶ processLine()             │
│                                               │                     │
│                                               ▼                     │
│                                          flush()                    │
│                                    (immediate write)                │
│                                                                     │
│   ✓ Real-time updates                                              │
│   ✓ Incremental parsing                                            │
│   ✓ Live dashboard updates                                         │
└────────────────────────────────────────────────────────────────────┘
```

---

## Key Design Principles

1. **Streaming Architecture**: Files are never loaded entirely into memory; processed in chunks
2. **Handler Chain Pattern**: Modular, extensible parsing with specialized handlers
3. **Stateful Parsing**: ParserState tracks multi-line constructs and pending operations
4. **Deferred Writes**: Batch database operations for performance (offline) or immediate writes (live)
5. **Timestamp Normalization**: Handles both timestamped and non-timestamped log formats
6. **Byte Offset Tracking**: Enables jumping to specific lines in the original file

