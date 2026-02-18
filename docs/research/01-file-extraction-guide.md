# 01 - File Extraction Guide

## What Files Are Needed from the WoW Installation

Everything needed to render characters with equipment lives inside MPQ (Mo'PaQ) archives in the WoW `Data/` directory.

---

## MPQ Archives

WoW 1.12.x stores all game data in MPQ archives. The key archives:

| Archive | Contents |
|---------|----------|
| `model.MPQ` | M2 models (.m2), skin files (.skin) |
| `texture.MPQ` | BLP textures (.blp) |
| `misc.MPQ` (or `dbc.MPQ`) | DBC database files (.dbc) |
| `patch.MPQ` | Base patch overrides |
| `patch-2.MPQ` | Additional patches |
| `patch-*.MPQ` | Turtle WoW custom content patches |

### Patch Load Priority

Patches override base archives. Load order is alphabetical:
```
model.MPQ < texture.MPQ < patch.MPQ < patch-2.MPQ < patch-3.MPQ < ... < patch-Z.MPQ
```

**Later patches override earlier files.** Turtle WoW's custom races and items are in the higher-numbered patches.

### Extraction Tools

| Tool | Platform | Notes |
|------|----------|-------|
| Ladik's MPQ Editor | Windows (GUI) | Drag-and-drop extraction, most user-friendly |
| mpq-tools | Linux/Mac (CLI) | `mpqextract model.MPQ -o ./extracted/` |
| StormLib | C library | Programmatic extraction, bindings for many languages |
| `@wowserhq/stormjs` | Node.js (WASM) | JavaScript wrapper around StormLib |
| wow.export | Electron (GUI) | Can read legacy MPQ, has 3D preview |

---

## Character Models

### Race/Gender Model Paths

Each race/gender has one M2 model file containing ALL geometry (every hair style, facial hair option, glove/boot variants, robes, capes, etc.):

| Race | RaceID | Male | Female |
|------|--------|------|--------|
| Human | 1 | `Character\Human\Male\HumanMale.m2` | `Character\Human\Female\HumanFemale.m2` |
| Orc | 2 | `Character\Orc\Male\OrcMale.m2` | `Character\Orc\Female\OrcFemale.m2` |
| Dwarf | 3 | `Character\Dwarf\Male\DwarfMale.m2` | `Character\Dwarf\Female\DwarfFemale.m2` |
| Night Elf | 4 | `Character\NightElf\Male\NightElfMale.m2` | `Character\NightElf\Female\NightElfFemale.m2` |
| Undead | 5 | `Character\Scourge\Male\ScourgeMale.m2` | `Character\Scourge\Female\ScourgeFemale.m2` |
| Tauren | 6 | `Character\Tauren\Male\TaurenMale.m2` | `Character\Tauren\Female\TaurenFemale.m2` |
| Gnome | 7 | `Character\Gnome\Male\GnomeMale.m2` | `Character\Gnome\Female\GnomeFemale.m2` |
| Troll | 8 | `Character\Troll\Male\TrollMale.m2` | `Character\Troll\Female\TrollFemale.m2` |

**Turtle WoW additions:**

| Race | RaceID | Male | Female |
|------|--------|------|--------|
| High Elf | 10 | `Character\BloodElf\Male\BloodElfMale.m2` | `Character\BloodElf\Female\BloodElfFemale.m2` |
| Goblin | 9 | `Character\Goblin\Male\GoblinMale.m2` | `Character\Goblin\Female\GoblinFemale.m2` |

**Note:** Undead uses "Scourge" internally. High Elves reuse Blood Elf model paths with different textures (blue eyes instead of green).

### Companion Files

In vanilla 1.12.x, each M2 file has associated `.skin` files for mesh/LOD data:

```
Character\Human\Male\HumanMale.m2          # Main model (geometry, bones, animations)
Character\Human\Male\HumanMale00.skin      # Primary skin (submesh definitions)
Character\Human\Male\HumanMale01.skin      # Lower LOD (optional, for distance rendering)
```

**Important:** In vanilla 1.12.x, ALL animation data is embedded inside the `.m2` file. External `.anim` files were introduced in WotLK (3.x). You only need the `.m2` and `.skin` files.

---

## Character Customization Textures

Each race/gender has a directory of customization textures:

```
Character\<Race>\<Gender>\<Race><Gender>Skin00_<SkinColor>.blp     -- Body skin
Character\<Race>\<Gender>\<Race><Gender>FaceLower<FaceID>_<SkinColor>.blp
Character\<Race>\<Gender>\<Race><Gender>FaceUpper<FaceID>_<SkinColor>.blp
Character\<Race>\Hair\<Race><Gender>Hair<Style><Color>.blp
Character\<Race>\Hair\<Race><Gender>FacialLower<Style><Color>.blp  -- Beard bottom
Character\<Race>\Hair\<Race><Gender>FacialUpper<Style><Color>.blp  -- Mustache
Character\<Race>\Hair\<Race><Gender>Scalp<Style><Color>.blp        -- Scalp under hair
```

Approximate count: ~50-100 textures per race/gender = ~800-2000 textures total.

---

## Equipment Models (Separate M2 Files)

Items that have their own 3D models (not just texture overlays on the character body):

### Weapons
```
Item\ObjectComponents\Weapon\*.m2          -- ~500+ weapon models
Item\ObjectComponents\Weapon\*.skin
Item\ObjectComponents\Weapon\*.blp         -- Weapon textures
```

### Shields
```
Item\ObjectComponents\Shield\*.m2          -- ~100+ shield models
Item\ObjectComponents\Shield\*.blp
```

### Helmets (Race/Gender Specific!)
```
Item\ObjectComponents\Head\<ModelName><RaceGenderSuffix>.m2
```

Helmets have separate model files per race/gender. Suffix codes:

| Race | Male | Female |
|------|------|--------|
| Human | `HuM` | `HuF` |
| Orc | `OrM` | `OrF` |
| Dwarf | `DwM` | `DwF` |
| Night Elf | `NEM` | `NEF` |
| Undead | `ScM` | `ScF` |
| Tauren | `TaM` | `TaF` |
| Gnome | `GnM` | `GnF` |
| Troll | `TrM` | `TrF` |

Example: `Helm_Plate_Judgement_A_01HuM.m2` (Human Male variant)

~200 base helmet models x 16 race/gender variants = ~3,200 helmet files.

### Shoulders
```
Item\ObjectComponents\Shoulder\*.m2        -- ~200+ shoulder models
Item\ObjectComponents\Shoulder\*.blp
```

Shoulders are NOT race-specific -- the same model is used for all races, scaled by the attachment point.

---

## Equipment Body Region Textures

Items that render as texture overlays on the character body (chest, legs, boots, gloves, bracers, belt, shirt, tabard):

```
Item\TextureComponents\ArmUpperTexture\*.blp
Item\TextureComponents\ArmLowerTexture\*.blp
Item\TextureComponents\HandTexture\*.blp
Item\TextureComponents\TorsoUpperTexture\*.blp
Item\TextureComponents\TorsoLowerTexture\*.blp
Item\TextureComponents\LegUpperTexture\*.blp
Item\TextureComponents\LegLowerTexture\*.blp
Item\TextureComponents\FootTexture\*.blp
```

Total across all regions: ~5,000-8,000 texture files.

### Texture Filename Resolution

Equipment textures follow a fallback order based on race/gender:
1. `<Name>_<Gender>_<Race>.blp` (race+gender specific)
2. `<Name>_<Gender>.blp` (gender specific)
3. `<Name>_<Race>.blp` (race specific)
4. `<Name>.blp` (universal)

### Cape/Cloak Textures
```
Item\ObjectComponents\Cape\*.blp           -- ~200 cloak texture files
```

---

## DBC Database Files

```
DBFilesClient\ItemDisplayInfo.dbc          -- ESSENTIAL: displayId -> visual info
DBFilesClient\CharSections.dbc             -- ESSENTIAL: character customization textures
DBFilesClient\ChrRaces.dbc                 -- ESSENTIAL: race definitions
DBFilesClient\AnimationData.dbc            -- ESSENTIAL: animation type definitions
DBFilesClient\HelmetGeosetVisData.dbc      -- ESSENTIAL: helmet hair/beard hiding rules
DBFilesClient\CreatureModelData.dbc        -- Optional: NPC models
DBFilesClient\CreatureDisplayInfo.dbc      -- Optional: NPC visuals
DBFilesClient\ItemVisuals.dbc              -- Optional: enchant glows
DBFilesClient\ItemVisualEffects.dbc        -- Optional: enchant glow models
DBFilesClient\ItemClass.dbc                -- Reference: item classification
DBFilesClient\ItemSubClass.dbc             -- Reference: item subclassification
```

---

## BLP Texture Format

Vanilla 1.12.x uses **BLP1** (the original format).

### BLP1 Compression Types

| Type | Description | Usage |
|------|-------------|-------|
| JPEG (type 0) | JPEG-compressed with separate alpha channel | Some older textures |
| Palettized (type 1, alpha=0/1) | 256-color palette + optional 1-bit alpha | Character skin textures |
| DXT1 (type 1, alpha=0) | S3TC block compression, 4:1 ratio | Most equipment textures |
| DXT3 (type 1, alpha=8, flag bit 4) | S3TC with explicit 4-bit alpha | Textures with sharp alpha |
| DXT5 (type 1, alpha=8, flag bit 3) | S3TC with interpolated alpha | Textures with smooth alpha |

### Texture Dimensions
Always power of 2. Character body textures: 256x256 or 512x512. Equipment textures: 64x64 to 512x512.

---

## Estimated File Counts and Sizes

| Category | File Count | Raw Size | Web-Converted Size |
|----------|-----------|----------|-------------------|
| DBC files (essential) | ~10 | ~15 MB | ~3 MB (JSON gzipped) |
| Character models (.m2 + .skin) | ~40 | ~30 MB | ~5 MB |
| Character customization textures | ~1,500 | ~200 MB | ~40 MB (WebP) |
| Equipment models (.m2 + .skin) | ~4,000 | ~150 MB | ~70 MB |
| Equipment model textures | ~2,000 | ~300 MB | ~150 MB (WebP) |
| Equipment body region textures | ~6,000 | ~500 MB | ~80 MB (WebP) |
| Cape textures | ~200 | ~30 MB | ~15 MB (WebP) |
| **Total** | **~14,000** | **~1.2 GB** | **~350-400 MB (WebP)** |

### Per-Character Load (what one viewer session downloads)

| Asset | Size |
|-------|------|
| 1 character model | ~300 KB |
| 1 skin texture | ~100 KB |
| 8-12 equipment textures | ~400-800 KB |
| 3-5 equipment models (weapon, helm, shoulders) | ~100-300 KB |
| Metadata JSON | ~50 KB |
| **Total per outfit** | **~1-1.5 MB** |

---

## Extraction Steps

1. Locate your Turtle WoW installation (e.g., `~/TurtleWoW/`)
2. List all MPQ archives in `<TurtleWoW>/Data/`
3. Extract from base archives first (`model.MPQ`, `texture.MPQ`, `misc.MPQ`)
4. Then extract from patches in alphabetical order (later patches override earlier files)
5. Key directories to extract:
   - `DBFilesClient\` (all .dbc files)
   - `Character\` (all character models and textures)
   - `Item\` (all equipment models and textures)
6. Convert DBC to JSON using WDBX Editor or a custom parser
7. Convert BLP to PNG/WebP using BLPConverter, wow.export, or `@wowserhq/format`
