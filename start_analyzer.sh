#!/bin/bash

# Unity Editor Log Analyzer - Simple Launcher
# Starts a simple HTTP server (required for Web Workers)

# Color codes for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo -e "${YELLOW}⚠ Python 3 is required to run the local server.${NC}"
    echo -e "  Please install Python 3 from https://www.python.org/downloads/"
    exit 1
fi

echo ""
echo "============================================================"
echo -e "${BLUE}Unity Editor Log Analyzer${NC}"
echo "============================================================"
echo ""
echo -e "${GREEN}Starting local server...${NC}"
echo ""

# Start the server
python3 start.py
