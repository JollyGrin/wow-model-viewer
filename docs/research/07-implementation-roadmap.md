# 07 - Implementation Roadmap

## Recommended Approach

Build a Three.js-based character renderer using `@wowserhq/format` for parsing, with a build pipeline that pre-converts assets to web-friendly formats.

**This is NOT the zamimg/Wowhead approach.** We are rendering directly from game files.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  BUILD PIPELINE                  │
│                                                  │
│  Turtle WoW     ┌──────────┐    ┌────────────┐  │
│  Installation ──>│ MPQ      │──> │ Assets     │  │
│  (Data/*.MPQ)    │ Extract  │    │ (raw)      │  │
│                  └──────────┘    └─────┬──────┘  │
│                                        │         │
│                  ┌──────────┐    ┌─────▼──────┐  │
│                  │ BLP->PNG │    │ M2->JSON   │  │
│                  │ DBC->JSON│    │ +Binary    │  │
│                  └────┬─────┘    └─────┬──────┘  │
│                       │                │         │
│                  ┌────▼────────────────▼──────┐  │
│                  │    Static CDN Assets       │  │
│                  │    /models /textures /meta  │  │
│                  └────────────────────────────┘  │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│                   WEB APP                        │
│                                                  │
│  ┌──────────┐   ┌────────────┐   ┌───────────┐  │
│  │ Item     │   │ Character  │   │ Three.js  │  │
│  │ Search   │──>│ Compositor │──>│ Renderer  │  │
│  │ + Equip  │   │ (geosets,  │   │ (WebGL)   │  │
│  │          │   │  textures, │   │           │  │
│  │          │   │  attach)   │   │           │  │
│  └──────────┘   └────────────┘   └───────────┘  │
│                                                  │
│  ┌──────────────────────────────────────┐        │
│  │ Data Layer                           │        │
│  │ - display-id-lookup.json             │        │
│  │ - ItemDisplayInfo batches            │        │
│  │ - CharSections data                  │        │
│  └──────────────────────────────────────┘        │
└─────────────────────────────────────────────────┘
```

---

## Phase 1: Build Pipeline (~1-2 weeks)

### Goal
Extract and convert all necessary assets from the Turtle WoW installation into web-ready formats.

### Tasks

1. **MPQ Extraction Script**
   - Extract `Character\`, `Item\`, `DBFilesClient\` from all MPQs
   - Handle patch priority (later patches override earlier files)
   - Tool: `@wowserhq/stormjs` (Node.js) or `mpq-tools` (CLI)

2. **DBC -> JSON Converter**
   - Parse and export essential DBC files to JSON
   - Join `item_template` SQL with `ItemDisplayInfo.dbc` to create `display-id-lookup.json`
   - Generate batched ItemDisplayInfo JSON files
   - Tool: Custom Node.js script using `@wowserhq/format` DBC parser

3. **BLP -> PNG/WebP Converter**
   - Batch convert all needed BLP textures
   - Organize into flat structure keyed by lowercase filename
   - Tool: Custom Node.js script using `@wowserhq/format` BLP decoder + sharp (for WebP)

4. **M2 -> Web Binary Converter**
   - Parse M2 + SKIN files
   - Serialize to JSON manifest (metadata) + binary ArrayBuffer (vertex/index data)
   - Strip unused data for initial version (particles, ribbons, cameras)
   - Tool: Custom Node.js script using `@wowserhq/format` M2 parser

### Deliverable
A `scripts/` directory with build scripts and an `assets/` directory with all converted files.

---

## Phase 2: Basic Model Renderer (~2-3 weeks)

### Goal
Render a static character model in Three.js with correct geometry and base skin texture.

### Tasks

1. **Three.js Scene Setup**
   - Camera, lights, orbit controls
   - Model loading from pre-parsed JSON+binary format
   - Apply base skin texture

2. **Skeleton & Animation**
   - Build bone hierarchy from M2 data
   - Implement bone animation evaluation (keyframe interpolation)
   - Support animation ID 0 (Stand) as default idle loop
   - Vertex skinning (GPU-based via Three.js SkinnedMesh)

3. **Coordinate System Handling**
   - WoW Z-up -> Three.js Y-up conversion
   - Triangle winding correction

4. **Race/Gender Selection**
   - Load different character models on selection
   - Skin color selection via CharSections.dbc data

### Deliverable
A working Three.js viewer that can display any race/gender character model with idle animation and base skin.

---

## Phase 3: Equipment System (~3-4 weeks)

This is the most complex phase. Port the character compositing logic from WoW Model Viewer C++ source to TypeScript.

### Tasks

1. **Geoset Visibility Manager** (~500 lines)
   - Track which geosets are visible based on equipped items
   - Handle all geoset groups (hair, gloves, boots, sleeves, robe, cape, tabard, belt)
   - Default state for each group
   - HelmetGeosetVisData integration (hide hair/ears for helmets)
   - Robe logic (robe geoset replaces leg geosets)

2. **Texture Compositor** (~500 lines)
   - Canvas 2D-based texture layering
   - Load base skin -> face -> underwear -> equipment textures
   - Correct body region mapping (8 regions with correct UV rects)
   - Layer order (shirt -> chest -> tabard -> legs -> boots -> bracers -> gloves)
   - Equipment texture filename resolution (race/gender fallback)
   - Upload composited canvas to Three.js texture

3. **Model Attachment System** (~400 lines)
   - Load equipment M2 models (weapons, helmets, shoulders, shields)
   - Find attachment points on character skeleton
   - Transform equipment to attachment bone position
   - Shoulder mirroring (negate X scale for left shoulder)
   - Helmet race/gender suffix resolution

4. **ItemDisplayInfo Resolver** (~300 lines)
   - `itemId -> displayId -> ItemDisplayInfo` lookup chain
   - Determine if item is texture-only, geoset-switching, or separate model
   - Resolve file paths for all textures and models
   - Handle missing assets gracefully

### Deliverable
A character viewer where you can equip items and see them rendered correctly -- texture overlays, geoset changes, and attached 3D models.

---

## Phase 4: Polish & Integration (~1-2 weeks)

### Tasks

1. **Multiple Animations**
   - Add Walk, Run, Attack, Cast, Dance animations
   - Animation selection UI

2. **Character Customization**
   - Hair style selection (geoset switching + texture)
   - Facial hair selection
   - Skin color selection
   - Face selection

3. **Performance Optimization**
   - Texture caching (IndexedDB for repeat visits)
   - Model preloading for common races
   - WebWorker for texture compositing
   - Asset manifest for cache busting

4. **Integration with Main App**
   - Connect to item search/equip UI
   - Paperdoll equipment slots
   - Level-based equipment display

---

## Effort Estimates

| Phase | Effort | Complexity |
|-------|--------|-----------|
| Phase 1: Build Pipeline | 1-2 weeks | Medium (tooling) |
| Phase 2: Basic Renderer | 2-3 weeks | Medium (Three.js + M2 format) |
| Phase 3: Equipment System | 3-4 weeks | **High** (compositing, geosets, attachment) |
| Phase 4: Polish | 1-2 weeks | Low-Medium |
| **Total** | **7-11 weeks** | |

Phase 3 is the hardest and most time-consuming. The geoset/compositing/attachment system is where most WoW model viewer projects stall.

---

## Risk Mitigation

### Risk: @wowserhq/format doesn't handle Vanilla M2 correctly
**Mitigation**: WotLK M2 format is very close to Vanilla. Test early. If gaps found, the format is well-documented on wowdev.wiki and we can patch the parser.

### Risk: Texture compositing region alignment is wrong
**Mitigation**: Study WMV/WMVx C++ source for exact UV rect coordinates per race. Test with known items. The existing research docs have partial UV mapping.

### Risk: Turtle WoW custom races (High Elf, Goblin) have non-standard model format
**Mitigation**: They were built with standard WoW Blender Studio tools, so they should follow conventions. Test early by extracting from Turtle WoW's patch MPQs.

### Risk: Asset extraction produces too many files to manage
**Mitigation**: Start with a subset (one race, a few items) to validate the pipeline. Scale up only after the renderer works correctly.

### Risk: Missing itemId -> displayId for Turtle WoW custom items
**Mitigation**: Start with vanilla items only (86% coverage). Add custom items later by scraping database.turtle-wow.org or accessing server data.

---

## Quick Win: Parallel Development Track

While building the full pipeline, we can still use the `wow-model-viewer` npm package (Wowhead wrapper) for vanilla items as a fallback. This lets the main app progress while the custom renderer is built:

```
Phase 1-2 (Build pipeline + basic renderer): Use Wowhead wrapper for vanilla items
Phase 3 (Equipment system): Switch to custom renderer for all items
Phase 4 (Polish): Remove Wowhead dependency entirely
```

This de-risks the project -- the app is usable from day one, even as we build the self-hosted renderer.

---

## Key Dependencies to Verify

Before starting implementation, verify these are current and functional:

```bash
# Check npm packages
npm info @wowserhq/format
npm info @wowserhq/scene
npm info @wowserhq/stormjs
npm info three-m2loader

# Check GitHub repos
gh repo view wowserhq/format --json stargazersCount,updatedAt
gh repo view wowserhq/scene --json stargazersCount,updatedAt
gh repo view Mugen87/three-m2loader --json stargazersCount,updatedAt
gh repo view oplancelot/Turtle-WOW-DBC --json stargazersCount,updatedAt
gh repo view thatsmybis/classic-wow-item-db --json stargazersCount,updatedAt

# Verify Turtle WoW MPQ structure
ls ~/TurtleWoW/Data/*.MPQ
```
