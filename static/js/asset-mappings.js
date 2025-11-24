/**
 * Asset Categorization Mappings
 * 
 * This file contains the mappings for asset file extensions to:
 * - Display names (extDisplayMap)
 * - Categories (categoryMap)
 * - Importer types (importerMap)
 * 
 * To add a new asset type:
 * 1. Add the extension to extDisplayMap with its display name
 * 2. Add the extension to categoryMap with its category
 * 3. Optionally add the extension to importerMap if it has a specific importer
 */

/**
 * Extension to display name mapping
 * Maps file extensions to their display names (usually the extension itself)
 */
const ASSET_EXT_DISPLAY_MAP = {
    '.shader': '.shader',
    '.shadergraph': '.shadergraph',
    '.compute': '.compute',
    '.cginc': '.cginc',
    '.hlsl': '.hlsl',
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
    '.fbx': '.fbx',
    '.obj': '.obj',
    '.blend': '.blend',
    '.mat': '.mat',
    '.prefab': '.prefab',
    '.unity': '.unity',
    '.asset': '.asset',
    '.controller': '.controller',
    '.anim': '.anim',
    '.physicmaterial': '.physicmaterial',
    '.cs': '.cs',
    '.js': '.js',
    '.dll': '.dll',
    '.asmdef': '.asmdef',
    '.ttf': '.ttf',
    '.otf': '.otf',
    '.wav': '.wav',
    '.mp3': '.mp3',
    '.ogg': '.ogg',
    '.spriteatlasv2': '.spriteatlasv2',
};

/**
 * Extension to category mapping
 * Maps file extensions to their asset categories for grouping in the dashboard
 */
const ASSET_CATEGORY_MAP = {
    '.shader': 'Rendering',
    '.shadergraph': 'Shaders',
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
};

/**
 * Extension to importer type mapping
 * Maps file extensions to their Unity importer types
 * This is used for identifying the importer used for each asset
 */
const ASSET_IMPORTER_MAP = {
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
};

