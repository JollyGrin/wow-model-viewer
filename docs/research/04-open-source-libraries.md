# 04 - Open Source Libraries & Tools

## Overview

A comprehensive landscape of open-source projects relevant to building a web-based WoW model viewer from raw game files.

---

## Tier 1: Primary Building Blocks

These are the projects most directly useful for our viewer.

### @wowserhq/format

- **GitHub**: https://github.com/wowserhq/format
- **npm**: `@wowserhq/format`
- **Language**: TypeScript
- **License**: MIT
- **Target WoW Version**: WotLK (3.3.5) -- very close to Vanilla 1.12.x format
- **Description**: The most complete JavaScript/TypeScript parser library for WoW file formats.
- **Supported Formats**:
  - **M2**: Full model parser (geometry, bones, animations, texture refs, particle/ribbon emitters, attachments, geosets)
  - **BLP**: BLP1 and BLP2 texture decoding (JPEG, palettized, DXT1/3/5)
  - **DBC**: Database Client files with typed record access
  - **SKIN**: Mesh/submesh split files
  - **ADT/WDT/WMO**: Terrain and world objects (not needed for character viewer)
- **How to use**: PRIMARY PARSER. Use for runtime M2 parsing and/or build-time preprocessing of game files to web-friendly formats.
- **Gap**: Does not implement character compositing logic (geoset toggling, texture layering, equipment attachment) -- that's rendering logic, not parsing.

### @wowserhq/scene

- **GitHub**: https://github.com/wowserhq/scene
- **npm**: `@wowserhq/scene`
- **Language**: TypeScript
- **License**: MIT
- **Description**: Three.js rendering classes built on top of `@wowserhq/format`.
- **Key Features**:
  - `M2Model` / `ModelManager` producing Three.js objects from parsed M2 data
  - BLP -> Three.js Texture conversion
  - Skeletal animation playback via Three.js animation system
  - Material/shader setup matching WoW rendering (blending modes, render flags, transparency)
- **Gap**: Character compositing pipeline (skin texture layering, equipment geosets) not fully implemented. Focus is more on world rendering than character paperdoll.
- **How to use**: RENDERING LAYER. Use as the base for Three.js integration, extend with custom character compositing.

### Mugen87/three-m2loader

- **GitHub**: https://github.com/Mugen87/three-m2loader
- **Language**: JavaScript
- **License**: MIT
- **Target WoW Version**: Verify -- may target modern chunked M2 (Legion+). Vanilla's pre-chunked format may need adaptation.
- **Description**: Three.js loader following standard loader pattern (like GLTFLoader). By Mugen87, a Three.js core contributor.
- **Key Features**:
  - Loads M2 files into Three.js as renderable meshes
  - Handles geometry, UVs, bone/skeleton, potentially animations
  - Integrated BLP texture decoder
  - Follows Three.js conventions (`THREE.BufferGeometry`, `THREE.SkinnedMesh`, `THREE.AnimationClip`)
- **Gap**: No character equipment pipeline (geosets, compositing, attachment). May not support vanilla M2 format directly.
- **How to use**: REFERENCE for Three.js M2 integration pattern. Even if not directly usable for vanilla format, the loader architecture is excellent.

### @wowserhq/stormjs

- **GitHub**: https://github.com/wowserhq/stormjs
- **Language**: C/JavaScript (WASM compilation of StormLib)
- **License**: MIT
- **Description**: JavaScript/WASM wrapper around StormLib for reading MPQ archives.
- **Key Features**: Open, read, list, and extract files from MPQ archives in Node.js or browser.
- **How to use**: BUILD PIPELINE tool. Use in Node.js to extract assets from MPQ archives during the asset conversion step.

---

## Tier 2: Reference Implementations

Study these for implementation details, but don't use directly.

### WoW Model Viewer (WMV)

- **GitHub**: https://github.com/WoWModelViewer/wowmodelviewer
- **Language**: C++ / OpenGL
- **License**: GPL
- **Target WoW Version**: Vanilla through retail (different branches)
- **Description**: The classic desktop WoW Model Viewer. Has been around since ~2005.
- **Why study it**: **THE most comprehensive reference** for character rendering logic:
  - Geoset visibility rules (which body parts show/hide based on equipment)
  - Texture compositing (layering skin, underwear, equipment textures)
  - Equipment attachment points (shoulders, weapons, helms)
  - Animation blending
  - Race-specific handling
- **How to use**: Read the C++ source to understand the exact character rendering pipeline, then port the logic to TypeScript.

### WMVx

- **GitHub**: https://github.com/WMVx (or search "WMVx wow model viewer")
- **Language**: C++ / Qt
- **License**: GPL
- **Description**: Modern rewrite of WoW Model Viewer with better architecture.
- **Why study it**: Cleaner code than original WMV. Easier to understand the character rendering pipeline.

### WebWoWViewerCpp

- **GitHub**: Search "WebWoWViewerCpp" or "Deamon87 WebWoWViewerCpp"
- **Language**: C++ compiled to WebAssembly
- **Description**: Full WoW world renderer compiled to WASM for browser use. Used by wow.tools.
- **Key Features**: Full world rendering (M2, WMO, ADT, water, skyboxes), particle effects, high-fidelity rendering.
- **Gap**: Does NOT do character equipment compositing. Large WASM binary.
- **How to use**: Reference for how a complete WoW renderer works in the browser via WASM. Potentially useful if we want WASM-level performance.

### wow.export (by Kruithne/Marlamin)

- **GitHub**: https://github.com/Kruithne/wow.export (or Marlamin/wow.export)
- **Language**: JavaScript (Electron app)
- **License**: MIT
- **Target WoW Version**: **Retail only** (CASC storage, not MPQ)
- **Description**: GUI tool for exporting WoW models to standard formats.
- **Export Formats**: OBJ, glTF/GLB, PNG from BLP
- **Why study it**: Contains excellent reference code for M2 -> glTF conversion logic, even though it targets retail. The conversion pipeline concepts apply to vanilla.
- **Limitation**: Cannot directly read 1.12.x MPQ data. Would need adaptation for our use case.

---

## Tier 3: Data Sources

### oplancelot/Turtle-WOW-DBC

- **GitHub**: https://github.com/oplancelot/Turtle-WOW-DBC
- **Description**: 261 DBC files from Turtle WoW exported as JSON.
- **Key Data**: `ItemDisplayInfo.dbc` with **23,852 records** covering vanilla + Turtle WoW custom items.
- **How to use**: PRIMARY DATA SOURCE for displayId -> model/texture mapping. Already JSON format, ready to use.

### thatsmybis/classic-wow-item-db

- **GitHub**: https://github.com/thatsmybis/classic-wow-item-db
- **Description**: SQL dump of classic WoW `item_template` table (~19,679 items).
- **Key Data**: `itemId -> displayId` mapping (this mapping doesn't exist client-side in vanilla).
- **How to use**: Parse SQL dump to build the itemId -> displayId bridge table.

### wowdev/WoWDBDefs

- **GitHub**: https://github.com/wowdev/WoWDBDefs
- **Description**: Database definitions for ALL WoW versions. Defines the schema (column names, types) for every DBC/DB2 file.
- **How to use**: Reference for understanding what fields exist in each DBC file.

### StormLib

- **GitHub**: https://github.com/ladislav-zezula/StormLib
- **Language**: C
- **License**: MIT
- **Description**: The definitive C library for reading/writing MPQ archives. Used by most WoW tools.
- **How to use**: Native MPQ extraction. Use via stormjs WASM wrapper or build pipeline.

---

## Tier 4: Additional Relevant Projects

### Miorey/wow-model-viewer (npm package)

- **GitHub**: https://github.com/Miorey/wow-model-viewer
- **npm**: `wow-model-viewer`
- **License**: MIT
- **Description**: Wraps Wowhead's ZamModelViewer for use in web apps.
- **Relevance**: Our PREVIOUS approach. Depends on Wowhead CDN. Cannot render Turtle WoW custom content. Included for reference of what we're moving away from.

### vjeux/jsWoWModelViewer

- **Description**: The original proof-of-concept JavaScript M2 viewer. Very old but educational for understanding M2 format parsing in JavaScript.
- **How to use**: Historical reference only.

### Adrinalin4ik/world-of-warcraft

- **Description**: Three.js-based WoW world renderer targeting WotLK.
- **Key Features**: M2 loading, WMO/ADT rendering, world exploration.
- **How to use**: Reference for Three.js world rendering, but not character-specific.

---

## Capability Matrix

| Capability | wowserhq/format+scene | three-m2loader | WMV/WMVx (C++) | wow.export |
|-----------|----------------------|----------------|-----------------|------------|
| M2 parsing | Yes | Yes | Yes | Yes |
| BLP decoding | Yes | Yes | Yes | Yes |
| Bone/skeleton | Yes | Yes | Yes | Partial |
| Animation playback | Yes | Yes | Yes | No (static) |
| Geoset toggling | Format knows geosets | No | **Yes (full)** | No |
| Texture compositing | No | No | **Yes (full)** | No |
| Equipment attachment | No | No | **Yes (full)** | No |
| DBC reading | Yes | No | Yes | Yes |
| MPQ reading | Yes (stormjs) | No | Yes | No (CASC) |
| Vanilla 1.12.x support | Good (close to WotLK) | Needs adaptation | Yes | No (retail) |
| Browser rendering | Yes (Three.js) | Yes (Three.js) | No (desktop) | No (Electron) |

**The gap**: No JavaScript project fully implements the character equipment rendering pipeline. The wowserhq stack provides parsing infrastructure. The rendering logic for character compositing must be written custom, using WMV/WMVx C++ source as reference.

---

## Recommended Stack

```
Parsing Layer:     @wowserhq/format (M2, BLP, DBC, SKIN parsing)
Rendering Layer:   Three.js (via @wowserhq/scene or custom)
M2 Loading:        Custom loader based on three-m2loader pattern + wowserhq parsing
Build Pipeline:    @wowserhq/stormjs (MPQ extraction) + custom BLP->PNG converter
Data:              Turtle-WOW-DBC (ItemDisplayInfo JSON) + classic-wow-item-db (SQL)
Reference:         WMV/WMVx source (C++) for character compositing logic

Custom Code Needed (~2000-3000 lines TypeScript):
  - Texture compositor (Canvas 2D layering)
  - Geoset visibility manager
  - Equipment model attachment system
  - CharSections.dbc resolver
  - ItemDisplayInfo.dbc -> file path resolver
```

---

## GitHub Search Queries

Run these to find additional/updated projects:

```bash
gh search repos "wow m2 viewer" --sort stars
gh search repos "wow model viewer javascript" --sort stars
gh search repos "three m2 loader" --sort stars
gh search repos "wowserhq" --sort stars
gh search repos "blp decoder javascript" --sort stars
gh search repos "wow gltf converter" --sort stars
gh search repos "wow format parser typescript" --sort stars
gh search repos "WebWoWViewerCpp" --sort stars
gh repo list wowserhq --limit 50
```

Also check npm:
```bash
npm search wow m2
npm info @wowserhq/format
npm info @wowserhq/scene
npm info three-m2loader
```
