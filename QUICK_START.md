# Quick Start

## Running Locally

A local server is required (ES modules don't work via `file://`).

**Windows:** Double-click `start-windows.bat`  
**macOS/Linux:** Run `./start-macos-linux.sh`

Both require Python 3. The browser will open automatically.

## Folder Structure

```
├── static/js/       # Application code
│   ├── parser/      # Log parsing logic
│   ├── database/    # IndexedDB storage
│   ├── components/  # UI components (tables, timeline)
│   └── core/        # Dashboard and utilities
├── watcher/         # Live log monitoring service
├── logs/            # Sample log files
├── tests/           # Test suite
└── docs/            # Documentation
```
