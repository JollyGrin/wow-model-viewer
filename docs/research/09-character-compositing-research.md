# 09 — Character Texture Compositing Research

## Survey of Open-Source Implementations

| Project | Texture Compositing | Geoset Selection | Notes |
|---------|---------------------|------------------|-------|
| **WoWModelViewer** (C++) | Full `CharTexture.compose()` with `burnComponent()` | `setGeosetGroupDisplay()` with formula `(group+1)*100 + value` | Most complete reference implementation |
| **WMVx** (C++ rewrite) | Same compositing pipeline as WoWModelViewer | Same formula | Modern rewrite, same architecture |
| **wowserhq/scene** | None — renders all submeshes unconditionally | None — no geoset filtering | WebGL viewer, doesn't even preserve geoset IDs |
| **three-m2loader** | None — loads first texture only | Basic group visibility | Three.js M2 loader, no character pipeline |
| **WoWee** | None | Basic | Minimal viewer |
| **wow-mdx-viewer** | None | None | Raw M2 rendering only |

**Key finding**: Only WoWModelViewer/WMVx implement the full compositing pipeline. All web-based viewers skip it entirely, which is why they can't render naked characters correctly.

## The Correct Rendering Pipeline

From WoWModelViewer's character rendering (6 steps):

1. **Load skeleton** — Parse M2 bones, set up animation system
2. **Composite skin texture** — Layer skin base + face + underwear + equipment textures into a single 256×256 atlas using `CharTexture.compose()`
3. **Select geosets** — For each of 26 geoset groups, pick which variant to show based on equipment and customization. Formula: `meshId = (groupIndex + 1) * 100 + value`, default value = 1
4. **Render body** — Draw visible geosets with the composited skin texture
5. **Render attachments** — Weapons, shoulders, helmets at attachment points
6. **Render effects** — Enchant glows, particle systems

Steps 2–3 are the critical ones we're missing. We have step 4 partially working (with bridge geometry workaround) and none of the others.

## Texture Compositing Architecture

### WoWModelViewer's `CharTexture.compose()` and `burnComponent()`

```
CharTexture {
  components[]: array of { texture, region, layer }

  compose(canvas 256×256):
    1. Clear canvas to black
    2. Sort components by layer (lower layers drawn first)
    3. For each component:
       region = CharComponentTextureSections lookup → (x, y, w, h)
       burnComponent(canvas, texture, region)
    4. Return composited canvas

  burnComponent(canvas, texture, region):
    Draw texture into region rect with alpha-over blending
    Handles scaling (source texture may differ from region size)
}
```

### Canvas-Based Approach for Web

The compositing is straightforward 2D image layering — perfect for HTML5 Canvas:

```typescript
const canvas = document.createElement('canvas');
canvas.width = 256;
canvas.height = 256;
const ctx = canvas.getContext('2d')!;

// Draw base skin (full canvas)
ctx.drawImage(skinImage, 0, 0, 256, 256);

// Overlay face regions
ctx.drawImage(faceLowerImage, regionX, regionY, regionW, regionH);
ctx.drawImage(faceUpperImage, regionX, regionY, regionW, regionH);

// Overlay underwear
ctx.drawImage(pelvisImage, regionX, regionY, regionW, regionH);

// Result: composited atlas as CanvasTexture
const texture = new THREE.CanvasTexture(canvas);
```

## CharSections DBC Schema

Each record maps `(RaceID, SexID, BaseSection, VariationIndex, ColorIndex)` to texture filenames.

| Field | Type | Description |
|-------|------|-------------|
| `ID` | int | Primary key |
| `RaceID` | int | 1=Human, 2=Orc, 3=Dwarf, etc. |
| `SexID` | int | 0=Male, 1=Female |
| `BaseSection` | int | Texture type (see below) |
| `TextureName` | string[3] | Up to 3 BLP texture paths |
| `Flags` | int | Bitfield |
| `VariationIndex` | int | Style variation (hair style, face #, etc.) |
| `ColorIndex` | int | Color variation (skin tone, hair color, etc.) |

### BaseSection Types

| Value | Name | Description | TextureName Usage |
|-------|------|-------------|-------------------|
| 0 | Skin (Base) | Full body skin texture | `[0]` = body skin BLP |
| 1 | Face | Face detail overlay | `[0]` = face lower, `[1]` = face upper |
| 2 | Facial Hair | Beard/sideburns overlay | `[0]` = facial lower, `[1]` = facial upper |
| 3 | Hair | Scalp/hair texture | `[0]` = hair texture, `[1]` = scalp lower, `[2]` = scalp upper |
| 4 | Underwear | Pelvis/torso underwear | `[0]` = pelvis texture, `[1]` = torso texture |

### Example: Human Male, Skin Color 0

```
RaceID=1, SexID=0, BaseSection=0, VariationIndex=0, ColorIndex=0
→ TextureName[0] = "Character\Human\Male\HumanMaleSkin00_00.blp"

RaceID=1, SexID=0, BaseSection=1, VariationIndex=0, ColorIndex=0
→ TextureName[0] = "Character\Human\Male\HumanMaleFaceLower00_00.blp"
→ TextureName[1] = "Character\Human\Male\HumanMaleFaceUpper00_00.blp"

RaceID=1, SexID=0, BaseSection=4, VariationIndex=0, ColorIndex=0
→ TextureName[0] = "Character\Human\Male\HumanMaleNakedPelvisSkin00_00.blp"
→ TextureName[1] = "Character\Human\Male\HumanMaleNakedTorsoSkin00_00.blp"
```

## Compositing Region Layout

The 256×256 body atlas is divided into regions defined by `CharComponentTextureSections.dbc`. Each region specifies where on the atlas a particular body part's texture is painted.

### Regions (from wowdev.wiki / WoWModelViewer `CharComponentTextureLayouts`)

For layout 0 (256×256 character texture), vanilla values:

| Region | Name | X | Y | Width | Height |
|--------|------|---|---|-------|--------|
| 0 | CR_ARM_UPPER | 0 | 0 | 128 | 64 |
| 1 | CR_ARM_LOWER | 0 | 64 | 128 | 64 |
| 2 | CR_HAND | 0 | 128 | 128 | 32 |
| 3 | CR_FACE_UPPER | 0 | 160 | 128 | 32 |
| 4 | CR_FACE_LOWER | 0 | 192 | 128 | 64 |
| 5 | CR_TORSO_UPPER | 128 | 0 | 128 | 64 |
| 6 | CR_TORSO_LOWER | 128 | 64 | 128 | 32 |
| 7 | CR_LEG_UPPER | 128 | 96 | 128 | 64 |
| 8 | CR_LEG_LOWER | 128 | 160 | 128 | 64 |
| 9 | CR_FOOT | 128 | 224 | 128 | 32 |

These regions determine where each `CharSections` texture layer is painted on the atlas. The underwear pelvis texture (type=4) paints into `CR_LEG_UPPER` (128, 96, 128, 64) — exactly the region that covers the body-to-leg boundary at the thigh gap.

## Geoset Selection Rules

### Formula

```
meshId = (groupIndex + 1) * 100 + value
```

Where `value` defaults to 1 for all groups. Equipment and customization options change the value per group.

### `setGeosetGroupDisplay()` Pattern

From WoWModelViewer:
```cpp
void setGeosetGroupDisplay(int groupIndex, int value) {
    int targetMeshId = (groupIndex + 1) * 100 + value;
    for (auto& geoset : model->geosets) {
        int group = geoset.id / 100;
        if (group == groupIndex + 1) {
            geoset.visible = (geoset.id == targetMeshId);
        }
    }
}
```

### CharGeosets Enum (26 Groups)

| Group | Index | Naked Default | Description |
|-------|-------|---------------|-------------|
| CG_HAIRSTYLE | 0 | varies | Hair geometry (0=bald, 1-13=styles) |
| CG_FACIAL1 | 1 | 101 | Jaw/beard |
| CG_FACIAL2 | 2 | 201 | Sideburns |
| CG_FACIAL3 | 3 | 301 | Moustache |
| CG_GLOVES | 4 | 401 | Bare hands |
| CG_BOOTS | 5 | 501 | Bare feet + lower legs |
| CG_EARS | 7 | 701 | Ears visible |
| CG_WRISTBANDS | 8 | (none) | Wrist armor |
| CG_KNEEPADS | 9 | (none) | Knee armor |
| CG_CHEST | 10 | (none) | Undershirt |
| CG_PANTS | 11 | (none) | Pants/underwear geometry |
| CG_TABARD | 12 | (none) | Tabard |
| CG_ROBE | 13 | (none) | Robe/dress |
| CG_CAPE | 15 | (none) | Cape |

For a naked character, groups 8-15 have no visible geoset (value=0 or corresponding geoset doesn't exist in vanilla models).

## Why Geometric Approaches Fail

The body mesh has an intentional empty region between Z 0.20–0.70 (the thighs). This region is:

1. **Not a bug** — it's by design
2. **Filled by equipment geosets** (boots 501-504, kneepads 902-903, pants 1102) when wearing gear
3. **Hidden by texture compositing** when naked — the underwear texture (CharSections type=4) paints skin-colored underwear across the body-to-leg boundary

The body mesh "lip" at Z 0.72–0.84 exists because:
- Inner ring (Z ~0.72, |Y| ~0.48): actual bottom of torso geometry
- Outer ring (Z ~0.84, |Y| ~0.54): hip flare designed to overlap with upper leg equipment geosets
- Triangles between these rings face downward — they're the "skirt" that's visible without texture compositing
- The underwear texture paints matching skin color across this region, making the overlap invisible

After 17 geometric approaches (vertex snapping, centroid shrink, bridge widening, panel fans, easing curves), the conclusion is clear: **no geometry-only approach can hide the body mesh lip**. The lip is designed to be hidden by texture continuity across the composited atlas.

## Data Inventory

### What We Have

| Data | Location | Status |
|------|----------|--------|
| MPQ archives | `data/model.MPQ` (182MB), `data/texture.MPQ` (634MB) | Present, unextracted |
| CharSections.dbc | `data/dbc/CharSections.json` (863KB, ~4000 records) | Converted, queryable |
| Patch textures | `data/patch/patch-*/` (~39K BLP files) | Only Turtle WoW custom skins |
| `@wowserhq/stormjs` | `node_modules/` v0.4.1 | Installed, ready for MPQ extraction |
| `@wowserhq/format` | `node_modules/` v0.28.0 | Installed, BLP decoding works |

### What's Missing (Need to Extract from MPQ)

| Data | MPQ Source | Purpose |
|------|-----------|---------|
| Base skin textures | `texture.MPQ` | `HumanMaleSkin00_00.blp` through `_09` |
| Face textures | `texture.MPQ` | `HumanMaleFaceLower00_00.blp`, `FaceUpper00_00.blp` |
| Underwear textures | `texture.MPQ` | `HumanMaleNakedPelvisSkin00_00.blp`, `NakedTorsoSkin00_00.blp` |
| `CharComponentTextureLayouts.dbc` | `model.MPQ` or `misc.MPQ` | Region layout definitions |
| `CharComponentTextureSections.dbc` | `model.MPQ` or `misc.MPQ` | Region coordinates |
| `CharHairGeosets.dbc` | `model.MPQ` or `misc.MPQ` | Hair geoset mappings |
| `CharacterFacialHairStyles.dbc` | `model.MPQ` or `misc.MPQ` | Facial hair geoset mappings |

## MPQ Extraction Strategy

Use `@wowserhq/stormjs` (already installed) to extract specific files:

```typescript
import { FS, MPQ } from '@wowserhq/stormjs';

// Mount local filesystem into Emscripten's virtual FS
FS.mkdir('/stormjs');
FS.mount(FS.filesystems.NODEFS, { root: 'data' }, '/stormjs');

// Open archive
const mpq = await MPQ.open('/stormjs/texture.MPQ', 'r');

// Search for files
const results = mpq.search('Character\\Human\\Male\\*');

// Read specific file
const file = mpq.openFile('Character\\Human\\Male\\HumanMaleSkin00_00.blp');
const data = file.read();  // Uint8Array
file.close();

mpq.close();
```

Extract only what we need — don't dump entire archives. Target files are known from CharSections.dbc queries.
