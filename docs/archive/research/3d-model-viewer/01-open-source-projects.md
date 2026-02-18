# Open Source Projects for WoW 3D Model Viewing

## Web-Based Libraries (Most Relevant)

### 1. wow-model-viewer (Miorey) -- RECOMMENDED START
- **GitHub**: https://github.com/Miorey/wow-model-viewer
- **npm**: `wow-model-viewer` (v1.5.2+)
- **License**: MIT
- **Stars**: ~100+
- **Last activity**: Active (2024-2025)
- **Tech**: Wraps Wowhead's ZamModelViewer (minified WebGL), jQuery 3.x dependency
- **Classic support**: Yes -- set `CONTENT_PATH` to classic CDN, pass `"classic"` to `generateModels()`
- **Item equipping**: Yes -- `findItemsInEquipments()` takes `{entry, displayid}` pairs
- **CORS handling**: Requires proxy. Author provides `bypass-cors-policies` Docker image:
  ```
  docker: miorey/bypass-cors-policies:v1
  env: SERVER_NAME=https://wow.zamimg.com
  ```
  Or build a Next.js API route proxy (we had this before in the deprecated version)
- **How it works**:
  1. Loads ZamModelViewer JS from Wowhead CDN (or your proxy)
  2. Takes character config (race, gender, items as `[slot, displayId]` pairs)
  3. Renders via WebGL canvas
  4. Handles all internal resolution (displayId -> model -> textures -> geosets)
- **Key config for Classic**:
  ```js
  window.CONTENT_PATH = 'http://localhost:3000/modelviewer/classic/'
  window.WOTLK_TO_RETAIL_DISPLAY_ID_API = undefined
  generateModels(1.5, '#model_3d', character, "classic")
  ```
- **Limitations**:
  - Depends on Wowhead's minified viewer (breaks when they update)
  - jQuery dependency
  - CORS proxy required
  - Only renders what Wowhead has model data for

### 2. @wowserhq/scene -- Best for Custom Implementation
- **GitHub**: https://github.com/wowserhq/scene
- **npm**: `@wowserhq/scene`
- **License**: MIT
- **Tech**: Three.js rendering classes for WoW model formats
- **Dependencies**: `@wowserhq/format` (BLP parser), `three` (rendering)
- **What it does**: Three.js classes that can load and render WoW M2/WMO formats
- **WoW version**: Targets WotLK 3.3.5a primarily
- **Limitations**: Very early stage, primitive rendering, no equipment system built-in
- **Value**: Good architecture reference for a custom Three.js implementation

### 3. three-m2loader
- **GitHub**: https://github.com/Mugen87/three-m2loader
- **Stars**: 32
- **License**: MIT
- **Last commit**: January 2022 (89 commits)
- **Tech**: Three.js loader for M2 files
- **Features**:
  - Parses M2 binary format
  - Loads .blp textures and .skin files
  - Animation playback via SequenceManager
  - Supports global sequences (idle breathing, weapon glow)
- **Limitations**:
  - Requires THREE.js r144+
  - Needs pre-extracted M2/BLP/skin files
  - No character equipment compositing built-in
  - May not support vanilla (1.12) M2 format specifically

### 4. jsWoWModelViewer (vjeux)
- **GitHub**: https://github.com/vjeux/jsWoWModelViewer
- **Tech**: Pure JavaScript M2 parser, raw WebGL (no Three.js)
- **Uses**: jDataView, jBinary for binary parsing
- **Value**: Reference implementation for understanding M2 format in JS
- **Limitations**: Very old, unmaintained, proof-of-concept quality

### 5. WebWoWViewerCpp (Deamon87)
- **GitHub**: https://github.com/Deamon87/WebWowViewerCpp
- **Used by**: wow.tools/mv/ (the wow.tools model viewer)
- **Tech**: C++ compiled to WebAssembly, requires WebGL 2.0
- **Features**: Renders M2, WMO, ADT (terrain) files
- **Limitations**:
  - Characters currently unsupported (only object M2 models)
  - Complex C++ build with CMake + Emscripten
  - Heavy WebAssembly payload

## Desktop Tools (Reference Value)

### 6. WoW Model Viewer (Desktop)
- **GitHub**: https://github.com/wowmodelviewer/wowmodelviewer
- **Stars**: 51
- **Last commit**: June 2023 (dormant)
- **Tech**: C/C++, OpenGL
- **Value**: The original reference implementation for all WoW model rendering. Comprehensive M2 parsing, equipment display, animation. Good source code to study for understanding attachment points, geoset system, texture compositing.

### 7. WMVx (Frostshake)
- **GitHub**: https://github.com/Frostshake/WMVx
- **Tech**: C++, fork/rewrite of WoW Model Viewer
- **Classic support**: Yes -- supports Classic Era using equivalent retail profile
- **Item loading**: CSV export from vmangos/trinitycore for Vanilla and WotLK
- **Value**: Most modern desktop viewer that explicitly supports vanilla item loading

### 8. wow.export (Kruithne)
- **GitHub**: https://github.com/Kruithne/wow.export
- **Stars**: 500+
- **License**: MIT
- **Tech**: Electron app, JavaScript
- **Features**:
  - Reads MPQ archives (legacy 1.x-3.x support!)
  - Exports M2 to OBJ and glTF (with armature/animations)
  - Exports character models as GLB
  - Converts BLP textures to PNG
  - Full 3D preview
- **Value**: Could be used as part of a build-time asset conversion pipeline (M2 -> glTF -> web)

## Format Parsing Libraries

### 9. @wowserhq/format
- **npm**: `@wowserhq/format`
- **License**: MIT
- **Supports**: BLP format (load + save)
- **Status**: Early stage, only BLP support so far

### 10. blizzardry (wowserhq)
- **GitHub**: https://github.com/wowserhq/blizzardry
- **Tech**: JavaScript library for Blizzard game file parsing
- **Supports**: M2, BLP, WMO, DBC, MPQ
- **WoW target**: WotLK primarily
- **Value**: Full JavaScript parsing library for all relevant formats

### 11. WoW Blender Studio
- **GitLab**: https://gitlab.com/skarnproject/blender-wow-studio
- **Purpose**: Blender addon for WoW M2/WMO/ADT editing
- **Value**: Could be used in asset pipeline to convert models

## Key Repository for Data

### 12. Turtle-WOW-DBC
- **GitHub**: https://github.com/oplancelot/Turtle-WOW-DBC
- **Contents**: 261 exported DBC files from Turtle WoW, with JSON conversions
- **Critical file**: `ItemDisplayInfo.dbc` -- maps displayId to models/textures
- **Value**: THE key data source for mapping our items to their visual representations

### 13. wow-classic-items
- **GitHub**: https://github.com/nexus-devs/wow-classic-items
- **npm**: `wow-classic-items`
- **Contents**: All WoW Vanilla/TBC/WotLK Classic items scraped from Wowhead + Blizzard API
- **Format**: JSON with structured item data
- **Value**: May contain displayId data we can cross-reference

## Recommendation Matrix

| Approach | Effort | Quality | Maintenance |
|----------|--------|---------|-------------|
| wow-model-viewer (Miorey) + proxy | Low | High (Wowhead quality) | Dependent on Wowhead |
| Custom Three.js + three-m2loader | High | Medium-High | Self-maintained |
| Pre-exported glTF + model-viewer | Very High | Highest | Self-maintained |
| WebAssembly (WebWoWViewerCpp) | Very High | Highest | Complex |
| Iframe embed Wowhead dressing room | Very Low | High | No control |
