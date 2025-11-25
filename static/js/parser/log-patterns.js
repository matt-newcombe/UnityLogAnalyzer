/**
 * Log Patterns
 * Centralized repository for all Regex patterns used in log parsing.
 */
export const LogPatterns = {
    // Header / Metadata
    UnityVersion: /Unity Editor version:\s+(\S+)/,
    Architecture: /Architecture:\s+(\S+)/,
    PlatformMacOS: /macOS version:/,
    PlatformWindows: /Windows version:/,
    PlatformLinux: /Linux version:/,
    ProjectPath: /-projectpath\s+([^\s]+)/,
    ProjectPathChange: /Successfully changed project path to:\s+([^\s]+)/,

    // Timestamps
    TimestampPrefix: /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\|[^|]+\|(.*)$/,
    Timestamp: /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/,

    // Worker Threads
    WorkerThread: /^\[Worker\s*(\d+)\]\s+(.+)/,
    WorkerImportStart: /Start importing (.+?) using Guid\(([a-f0-9]+)\)/,
    WorkerImportComplete: /-> \(artifact id: '([a-f0-9]+)'\) in ([\d.]+) seconds/,
    WorkerImporterType: /^\(([A-Za-z0-9\-]+)\)\s*$/,

    // Asset Imports (Main Thread)
    // Primary: Start importing PATH using Guid(GUID) IMPORTER -> (artifact id: 'HASH') in X.XXX seconds
    AssetImportComplete: /Start importing (.+?) using Guid\(([a-f0-9]+)\) (.+?) -> \(artifact id: '([a-f0-9]+)'\) in ([\d.]+) seconds/,
    // Fallback: without artifact id
    AssetImportCompleteNoArtifact: /Start importing (.+?) using Guid\(([a-f0-9]+)\) (.+?) in ([\d.]+) seconds/,
    // Crunched textures
    AssetImportCrunched: /Start importing (.+?) using Guid\(([a-f0-9]+)\) \(([A-Za-z0-9]+)\)crunched in ([\d.]+)/,
    // Generic Start (for multi-line or pending)
    AssetImportStart: /Start importing (.+?) using Guid\(([a-f0-9]+)\) \((\w+)\)/,
    // Simple Start (just path and guid)
    AssetImportStartSimple: /Start importing (.+?) using Guid\(([a-f0-9]+)\)/,

    // Importer Extraction
    ImporterType: /Importer\(([^)]+)\)/,

    // Pipeline Refresh
    PipelineRefreshStart: /Asset Pipeline Refresh \(id=([a-f0-9]+)\): Total: ([\d.]+) seconds - Initiated by (.+?)$/,
    PipelineImports: /total=(\d+).*actual=(\d+)/,
    PipelineAssetDbProcess: /managed=(\d+)\s*ms.*native=(\d+)\s*ms/,
    PipelineAssetDbCallback: /managed=(\d+)\s*ms.*native=(\d+)\s*ms/,
    PipelineDomainReload: /domain reloads=(\d+).*domain reload time=([\d]+)\s*ms.*compile time=([\d]+)\s*ms.*other=([\d]+)\s*ms/,





    // Operations
    Operation: /([^:]+)\s*:\s*"\s*##\s*(.+?)\s*##\s*"\s+took\s+([\d.]+)\s+sec(?:.*current mem:\s*(\d+)\s*MB)?/,

    // Sprite Atlas
    SpriteAtlasStart: /Start importing (.+?\.spriteatlasv2) using Guid\(([a-f0-9]+)\)/,
    SpriteAtlasProcessing: /Processing Atlas\s*:\s*(.+)/,

    // Script Compilation
    ScriptCompilationRequested: /Requested script compilation (?:for )?([^\s]+)/i,
    ScriptCompilationReason: /because:\s*([^,]+)/i,
    ScriptCompilationBee: /@Library\/Bee\/artifacts\/[^\/]+\/([^\.]+)\.rsp/,
    ScriptCompilationTime: /script compilation time:\s*([\d.]+)\s*s/i,

    // Accelerator (Unity Cache Server)
    AcceleratorQuery: /Querying for cacheable assets in Cache Server:/,
    AcceleratorArtifact: /Artifact/, // Simple check
};
