# Unity Log File Watcher Service (PowerShell)
# Watches a Unity log file and serves new lines via HTTP API
# No Python or executables required - uses built-in PowerShell

param(
    [int]$Port = 8767
)

# Set output encoding to UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Global state
$script:watchedFile = $null
$script:lastPosition = 0
$script:fileWatcher = $null
$script:lock = [System.Threading.ReaderWriterLockSlim]::new()
$script:lastLineSent = $null  # Track last line sent to site

function Get-DefaultUnityEditorLogPath {
    <#
    .SYNOPSIS
    Get the default Unity Editor.log path based on the operating system.
    #>
    $homeDir = $env:USERPROFILE
    if (-not $homeDir) {
        $homeDir = $env:HOME
    }
    
    $os = [System.Environment]::OSVersion.Platform
    if ($os -eq [System.PlatformID]::Win32NT) {
        # Windows: %LOCALAPPDATA%\Unity\Editor\Editor.log
        $localAppData = $env:LOCALAPPDATA
        if ($localAppData) {
            return Join-Path $localAppData "Unity\Editor\Editor.log"
        } else {
            return Join-Path $homeDir "AppData\Local\Unity\Editor\Editor.log"
        }
    } elseif ($IsMacOS -or $os -eq [System.PlatformID]::Unix) {
        # macOS: ~/Library/Logs/Unity/Editor.log
        # Linux: ~/.config/unity3d/Editor.log
        if ($IsMacOS) {
            return Join-Path $homeDir "Library/Logs/Unity/Editor.log"
        } else {
            return Join-Path $homeDir ".config/unity3d/Editor.log"
        }
    }
    return $null
}

function Start-FileWatcher {
    <#
    .SYNOPSIS
    Start watching a file for changes using FileSystemWatcher.
    #>
    param(
        [string]$FilePath
    )
    
    if (-not $FilePath -or -not (Test-Path $FilePath)) {
        Write-Warning "File does not exist: $FilePath"
        return
    }
    
    # Stop existing watcher
    if ($script:fileWatcher) {
        $script:fileWatcher.Dispose()
        $script:fileWatcher = $null
    }
    
    # Initialize position
    $fileInfo = Get-Item $FilePath
    $script:lastPosition = $fileInfo.Length
    $script:watchedFile = $FilePath
    
    # Create FileSystemWatcher
    $watcher = New-Object System.IO.FileSystemWatcher
    $watcher.Path = Split-Path $FilePath -Parent
    $watcher.Filter = Split-Path $FilePath -Leaf
    $watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::Size
    $watcher.EnableRaisingEvents = $true
    
    # Store watcher
    $script:fileWatcher = $watcher
    
    Write-Host "✓ Watching Unity editor log file: $FilePath" -ForegroundColor Green
}

function Stop-FileWatcher {
    <#
    .SYNOPSIS
    Stop watching the file.
    #>
    if ($script:fileWatcher) {
        $script:fileWatcher.Dispose()
        $script:fileWatcher = $null
    }
    $script:watchedFile = $null
    $script:lastPosition = 0
}

function Get-NewLines {
    <#
    .SYNOPSIS
    Get new lines since last read. Returns hashtable with 'lines' and 'was_reset' keys.
    #>
    if (-not $script:watchedFile -or -not (Test-Path $script:watchedFile)) {
        return @{ lines = @(); was_reset = $false }
    }
    
    $script:lock.EnterWriteLock()
    try {
        $fileInfo = Get-Item $script:watchedFile
        $currentSize = $fileInfo.Length
        $wasReset = $false
        
        if ($currentSize -lt $script:lastPosition) {
            # File was truncated or recreated
            $oldPosition = $script:lastPosition
            $wasReset = $true
            $script:lastPosition = 0
            Write-Host "⚠️  File reset detected! File size decreased from $oldPosition to $currentSize bytes" -ForegroundColor Yellow
        }
        
        if ($currentSize -le $script:lastPosition) {
            return @{ lines = @(); was_reset = $wasReset }
        }
        
        # Read new content
        $stream = [System.IO.File]::Open($script:watchedFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try {
            $stream.Position = $script:lastPosition
            $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8, $false, 1024, $true)
            $newContent = $reader.ReadToEnd()
            $script:lastPosition = $stream.Position
        } finally {
            $stream.Close()
        }
        
        # Split into lines
        $lines = $newContent -split "`n"
        # Remove empty last line if content doesn't end with newline
        if ($newContent -and -not $newContent.EndsWith("`n")) {
            if ($lines.Count -gt 0) {
                $lines = $lines[0..($lines.Count - 2)]
            }
        }
        
        return @{ lines = $lines; was_reset = $wasReset }
    } catch {
        Write-Host "Error reading file: $_" -ForegroundColor Red
        return @{ lines = @(); was_reset = $false }
    } finally {
        $script:lock.ExitWriteLock()
    }
}

function Get-FileInfo {
    <#
    .SYNOPSIS
    Get current file information.
    #>
    if (-not $script:watchedFile -or -not (Test-Path $script:watchedFile)) {
        return @{
            exists = $false
            size = 0
            last_position = $script:lastPosition
            path = $null
        }
    }
    
    $fileInfo = Get-Item $script:watchedFile
    return @{
        exists = $true
        size = $fileInfo.Length
        last_position = $script:lastPosition
        path = $script:watchedFile
    }
}

function Send-JsonResponse {
    <#
    .SYNOPSIS
    Send a JSON response with CORS headers.
    #>
    param(
        [System.Net.HttpListenerContext]$Context,
        [object]$Data,
        [int]$StatusCode = 200
    )
    
    $response = $Context.Response
    $response.StatusCode = $StatusCode
    $response.ContentType = "application/json"
    $response.AddHeader("Access-Control-Allow-Origin", "*")
    $response.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    $response.AddHeader("Access-Control-Allow-Headers", "Content-Type")
    
    $json = $Data | ConvertTo-Json -Depth 10 -Compress
    $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response.ContentLength64 = $buffer.Length
    $response.OutputStream.Write($buffer, 0, $buffer.Length)
    $response.OutputStream.Close()
}

function Handle-Request {
    <#
    .SYNOPSIS
    Handle an HTTP request.
    #>
    param(
        [System.Net.HttpListenerContext]$Context
    )
    
    $request = $Context.Request
    $response = $Context.Response
    $url = $request.Url
    $path = $url.AbsolutePath
    $query = $url.Query
    
    # Parse query string
    $queryParams = @{}
    if ($query) {
        $query = $query.TrimStart('?')
        $query -split '&' | ForEach-Object {
            $parts = $_ -split '=', 2
            if ($parts.Length -eq 2) {
                $key = [System.Uri]::UnescapeDataString($parts[0])
                $value = [System.Uri]::UnescapeDataString($parts[1])
                $queryParams[$key] = $value
            }
        }
    }
    
    # Log requests (except frequent polling)
    if ($path -ne "/api/poll" -and $path -ne "/api/info") {
        Write-Host "📥 Request: $path" -ForegroundColor Cyan
    }
    
    # Handle OPTIONS (CORS preflight)
    if ($request.HttpMethod -eq "OPTIONS") {
        $response.StatusCode = 200
        $response.AddHeader("Access-Control-Allow-Origin", "*")
        $response.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $response.AddHeader("Access-Control-Allow-Headers", "Content-Type")
        $response.OutputStream.Close()
        return
    }
    
    # Handle SSE stream endpoint
    if ($path -eq "/api/stream") {
        Write-Host "📡 SSE stream request received" -ForegroundColor Cyan
        if (-not $script:watchedFile) {
            $response.StatusCode = 400
            $response.ContentType = "text/plain"
            $response.AddHeader("Access-Control-Allow-Origin", "*")
            $buffer = [System.Text.Encoding]::UTF8.GetBytes("No file being watched. Call /api/watch first.")
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.OutputStream.Close()
            return
        }
        
        # Set up SSE headers
        $response.StatusCode = 200
        $response.ContentType = "text/event-stream"
        $response.AddHeader("Cache-Control", "no-cache")
        $response.AddHeader("Connection", "keep-alive")
        $response.AddHeader("Access-Control-Allow-Origin", "*")
        $response.SendChunked = $true
        
        $startLine = 1
        if ($queryParams.ContainsKey("start_line")) {
            $startLine = [int]$queryParams["start_line"]
        }
        $currentLine = $startLine
        
        try {
            $writer = New-Object System.IO.StreamWriter($response.OutputStream, [System.Text.Encoding]::UTF8)
            $writer.AutoFlush = $true
            
            # Send initial connection message
            $connectMsg = @{ type = "connected"; start_line = $startLine } | ConvertTo-Json -Compress
            $writer.WriteLine("data: $connectMsg")
            $writer.WriteLine()
            $writer.Flush()
            
            # Continuously read and send new lines
            while ($true) {
                try {
                    $result = Get-NewLines
                    $newLines = $result.lines
                    $wasReset = $result.was_reset
                    
                    if ($wasReset) {
                        # Send reset event
                        $resetMsg = @{ type = "reset"; line = $currentLine } | ConvertTo-Json -Compress
                        $writer.WriteLine("data: $resetMsg")
                        $writer.WriteLine()
                        $writer.Flush()
                        $currentLine = 1
                    }
                    
                    # Send each new line
                    foreach ($line in $newLines) {
                        if ($line.Trim()) {
                            $script:lastLineSent = $line
                            $preview = if ($line.Length -gt 100) { $line.Substring(0, 100) + "..." } else { $line }
                            Write-Host "📤 Last line sent: $preview" -ForegroundColor Cyan
                            $lineMsg = @{ type = "line"; line = $line; line_number = $currentLine } | ConvertTo-Json -Compress
                            $writer.WriteLine("data: $lineMsg")
                            $writer.WriteLine()
                            $writer.Flush()
                            $currentLine++
                        }
                    }
                    
                    # Small sleep to avoid busy-waiting
                    Start-Sleep -Milliseconds 100
                } catch {
                    # Client disconnected or error
                    break
                }
            }
        } catch {
            try {
                $errorMsg = @{ type = "error"; message = $_.Exception.Message } | ConvertTo-Json -Compress
                $writer.WriteLine("data: $errorMsg")
                $writer.WriteLine()
                $writer.Flush()
            } catch {
                # Ignore errors when client is disconnected
            }
        } finally {
            try {
                $writer.Close()
            } catch {
                # Ignore
            }
            Write-Host "📤 SSE client disconnected" -ForegroundColor Cyan
        }
        return
    }
    
    # Handle other endpoints
    switch ($path) {
        "/api/watch" {
            $filePath = $queryParams["file"]
            
            if (-not $filePath) {
                # Auto-detect Unity Editor.log
                $defaultPath = Get-DefaultUnityEditorLogPath
                if ($defaultPath -and (Test-Path $defaultPath)) {
                    $filePath = $defaultPath
                    Write-Host "✓ Auto-detected Unity Editor.log: $filePath" -ForegroundColor Green
                } else {
                    $defaultPathStr = if ($defaultPath) { $defaultPath } else { $null }
                    Send-JsonResponse -Context $Context -Data @{
                        error = if ($defaultPath) {
                            "Unity Editor.log not found at default location: $defaultPath`n`nPlease specify the file path manually."
                        } else {
                            "Could not determine default Unity Editor.log path for this operating system.`n`nPlease specify the file path manually."
                        }
                        default_path = $defaultPathStr
                        os = [System.Environment]::OSVersion.Platform.ToString()
                    }
                    return
                }
            }
            
            # Validate file exists
            if (-not (Test-Path $filePath)) {
                $defaultPath = Get-DefaultUnityEditorLogPath
                Send-JsonResponse -Context $Context -Data @{
                    error = "File not found: $filePath"
                    default_path = if ($defaultPath) { $defaultPath } else { $null }
                    os = [System.Environment]::OSVersion.Platform.ToString()
                }
                return
            }
            
            try {
                Stop-FileWatcher
                Start-FileWatcher -FilePath $filePath
                $fileInfo = Get-FileInfo
                $defaultPath = Get-DefaultUnityEditorLogPath
                $autoDetected = ($filePath -eq $defaultPath)
                
                Send-JsonResponse -Context $Context -Data @{
                    success = $true
                    message = "Watching file: $filePath"
                    file_path = $filePath
                    auto_detected = $autoDetected
                    info = $fileInfo
                }
                Write-Host "✓ Watching Unity editor log file: $filePath" -ForegroundColor Green
            } catch {
                Send-JsonResponse -Context $Context -Data @{ error = $_.Exception.Message }
            }
        }
        
        "/api/poll" {
            if (-not $script:watchedFile) {
                Send-JsonResponse -Context $Context -Data @{
                    error = "No file being watched. Call /api/watch first."
                }
                return
            }
            
            $result = Get-NewLines
            $fileInfo = Get-FileInfo
            
            # Log last line sent if there are new lines
            if ($result.lines.Count -gt 0) {
                $lastLine = $result.lines[-1]
                $script:lastLineSent = $lastLine
                $preview = if ($lastLine.Length -gt 100) { $lastLine.Substring(0, 100) + "..." } else { $lastLine }
                Write-Host "📤 Last line sent (poll): $preview" -ForegroundColor Cyan
            }
            
            Send-JsonResponse -Context $Context -Data @{
                new_lines = $result.lines
                line_count = $result.lines.Count
                file_info = $fileInfo
                file_reset = $result.was_reset
            }
        }
        
        "/api/read" {
            if (-not $script:watchedFile) {
                Send-JsonResponse -Context $Context -Data @{
                    error = "No file being watched. Call /api/watch first."
                }
                return
            }
            
            $startPos = 0
            if ($queryParams.ContainsKey("start")) {
                $startPos = [int]$queryParams["start"]
            }
            
            $fileInfo = Get-Item $script:watchedFile
            $currentSize = $fileInfo.Length
            $wasReset = $false
            
            # Check if file was reset
            if ($currentSize -lt $script:lastPosition) {
                $wasReset = $true
                $startPos = 0
                $script:lock.EnterWriteLock()
                try {
                    $oldPosition = $script:lastPosition
                    $script:lastPosition = 0
                } finally {
                    $script:lock.ExitWriteLock()
                }
                Write-Host "⚠️  File reset detected during read! File size decreased from $oldPosition to $currentSize bytes" -ForegroundColor Yellow
            }
            
            try {
                $stream = [System.IO.File]::Open($script:watchedFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
                try {
                    $stream.Position = $startPos
                    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8, $false, 1024, $true)
                    $content = $reader.ReadToEnd()
                    $endPos = $stream.Position
                } finally {
                    $stream.Close()
                }
                
                $lines = $content -split "`n"
                $endsWithNewline = $content.EndsWith("`n")
                
                Send-JsonResponse -Context $Context -Data @{
                    content = $content
                    lines = if ($endsWithNewline) { $lines } else { $lines[0..($lines.Count - 2)] }
                    incomplete_line = if ($endsWithNewline) { $null } else { $lines[-1] }
                    start_position = $startPos
                    end_position = $endPos
                    file_info = Get-FileInfo
                    file_reset = $wasReset
                }
            } catch {
                Send-JsonResponse -Context $Context -Data @{ error = $_.Exception.Message }
            }
        }
        
        "/api/info" {
            if (-not $script:watchedFile) {
                Send-JsonResponse -Context $Context -Data @{
                    service_available = $true
                    file_info = @{
                        exists = $false
                        size = 0
                        last_position = 0
                        path = $null
                    }
                }
                return
            }
            
            $fileInfo = Get-FileInfo
            Send-JsonResponse -Context $Context -Data @{
                service_available = $true
                file_info = $fileInfo
            }
        }
        
        "/api/update_position" {
            if (-not $script:watchedFile) {
                Send-JsonResponse -Context $Context -Data @{
                    error = "No file being watched"
                }
                return
            }
            
            $newPosition = $script:lastPosition
            if ($queryParams.ContainsKey("position")) {
                $newPosition = [int]$queryParams["position"]
            }
            
            $script:lock.EnterWriteLock()
            try {
                $script:lastPosition = $newPosition
            } finally {
                $script:lock.ExitWriteLock()
            }
            
            Send-JsonResponse -Context $Context -Data @{
                success = $true
                position = $newPosition
                file_info = Get-FileInfo
            }
        }
        
        "/api/stop" {
            Stop-FileWatcher
            Send-JsonResponse -Context $Context -Data @{
                success = $true
                message = "Stopped watching"
            }
        }
        
        default {
            Send-JsonResponse -Context $Context -Data @{ error = "Unknown endpoint" }
        }
    }
}

function Start-Server {
    <#
    .SYNOPSIS
    Start the HTTP server.
    #>
    Write-Host ("=" * 60) -ForegroundColor Cyan
    Write-Host "Unity Log File Watcher Service" -ForegroundColor Cyan
    Write-Host ("=" * 60) -ForegroundColor Cyan
    Write-Host "Starting on port $Port" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "This service allows the browser to monitor Unity log files"
    Write-Host "even when they're in system directories."
    Write-Host ""
    Write-Host "API endpoints:"
    Write-Host "  GET /api/watch?file=<path>  - Start watching a file (auto-detects if no path)"
    Write-Host "  GET /api/poll               - Get new lines since last poll"
    Write-Host "  GET /api/read?start=<pos>   - Read file content from position"
    Write-Host "  GET /api/stream?start_line=<n> - SSE stream for real-time line delivery"
    Write-Host "  GET /api/info               - Get file information"
    Write-Host "  GET /api/update_position?position=<pos> - Update last processed position"
    Write-Host "  GET /api/stop               - Stop watching"
    Write-Host ""
    Write-Host "✓ CORS enabled - works with GitHub Pages and remote sites" -ForegroundColor Green
    Write-Host "✓ Auto-detects Unity Editor.log at default OS location" -ForegroundColor Green
    Write-Host "✓ Keep this running while using the Unity Log Analyzer" -ForegroundColor Green
    Write-Host ""
    Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
    Write-Host ("=" * 60) -ForegroundColor Cyan
    Write-Host ""
    
    # Check if port is available
    $listener = New-Object System.Net.HttpListener
    $prefix = "http://localhost:$Port/"
    $listener.Prefixes.Add($prefix)
    
    try {
        $listener.Start()
        Write-Host "✓ Successfully connected to server on port $Port" -ForegroundColor Green
        Write-Host "✓ Waiting for file watch requests..." -ForegroundColor Green
        Write-Host ""
    } catch {
        $errorMsg = $_.Exception.Message
        Write-Host ""
        if ($errorMsg -like "*Access is denied*" -or $errorMsg -like "*Access denied*") {
            Write-Host "⚠️  ERROR: Access denied when starting server!" -ForegroundColor Red
            Write-Host ""
            Write-Host "This may require administrator privileges or URL reservation."
            Write-Host "Try running PowerShell as Administrator, or run this command:"
            Write-Host "  netsh http add urlacl url=http://localhost:$Port/ user=$env:USERNAME"
            Write-Host ""
        } elseif ($errorMsg -like "*already in use*" -or $errorMsg -like "*Address already in use*") {
            Write-Host "⚠️  ERROR: Port $Port is already in use!" -ForegroundColor Red
            Write-Host ""
            Write-Host "This usually means:"
            Write-Host "  1. Another instance of the watcher is already running"
            Write-Host "  2. The integrated file watcher in start.py is using this port"
            Write-Host "  3. Another application is using port $Port"
            Write-Host ""
            Write-Host "To fix this:"
            Write-Host "  - If using start.py, you don't need to run the watcher separately"
            Write-Host "  - If you need the standalone watcher, stop the other instance first"
            Write-Host "  - Or find and kill the process using port $Port:"
            Write-Host "    netstat -ano | findstr :$Port"
            Write-Host ""
        } else {
            Write-Host "⚠️  ERROR: Failed to start server: $errorMsg" -ForegroundColor Red
            Write-Host ""
        }
        exit 1
    }
    
    # Handle requests
    try {
        while ($listener.IsListening) {
            try {
                $context = $listener.GetContext()
                Handle-Request -Context $context
            } catch {
                Write-Host "Error handling request: $_" -ForegroundColor Red
            }
        }
    } catch {
        Write-Host ""
        Write-Host "⚠️  ERROR: Failed to start server: $_" -ForegroundColor Red
        Write-Host ""
        exit 1
    } finally {
        Write-Host ""
        Write-Host "Shutting down..." -ForegroundColor Yellow
        Stop-FileWatcher
        $listener.Stop()
        $listener.Close()
        Write-Host "✓ File watcher stopped" -ForegroundColor Green
    }
}

# Start the server
Start-Server

