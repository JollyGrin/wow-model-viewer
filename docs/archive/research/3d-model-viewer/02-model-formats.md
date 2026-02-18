# WoW Model Formats & Equipment Rendering System

## M2 Format (Character & Item Models)

M2 files (also called MDX in older versions) contain 3D model data. The vanilla 1.12 format uses the `MD20` magic signature.

### Structure Overview
```
MD20 Header
├── Vertices (position, normal, UV, bone weights, bone indices)
├── Submeshes / Geosets (groups of triangles that can be shown/hidden)
├── Textures (references to BLP files)
├── Bones (skeletal hierarchy with animation tracks)
├── Animation Sequences (Stand, Walk, Attack, etc.)
├── Attachment Points (where weapons/helmets mount)
└── Skin files (.skin) -- mesh data split into separate files
```

### Key Concepts

**Geosets (Submeshes)**: Character models contain ALL possible geometry -- bare arms, gloved arms, robed legs, cape, different hair styles, etc. Equipment rendering works by enabling/disabling the right geosets.

**Geoset Groups** (numbering system):
| Range | Controls |
|-------|----------|
| 0xx | Hair styles |
| 1xx | Facial hair (beards, tusks, markings) |
| 2xx | Facial hair 2 |
| 3xx | Facial hair 3 |
| 4xx | Gloves |
| 5xx | Boots |
| 8xx | Shirt sleeves / chest armor |
| 9xx | Leg armor lower |
| 10xx | Chest armor undershirt |
| 11xx | Pants upper |
| 12xx | Tabard |
| 13xx | Robe/kilt |
| 15xx | Cape/Cloak |
| 18xx | Belt buckle |
| 22xx | Chest - extra |
| 23xx | Gloves - extra |
| 26xx | Shoulders |
| 27xx | Helmet |
| 28xx | Chest - extra 2 |

## BLP Format (Textures)

WoW's proprietary texture format. Contains DXT1/DXT3 compressed data or palettized color data.

For a web viewer, BLP textures need to be decoded to RGBA for WebGL upload. Options:
- Use `@wowserhq/format` (JavaScript BLP decoder)
- Use pre-converted PNG/WebP textures (Wowhead's CDN serves these)
- wow.export can batch-convert BLP to PNG

## Equipment Display Pipeline

### The Full Chain: Item ID -> Visual

```
itemId (e.g., 16922 = Leggings of Transcendence)
  └─> Item.dbc column ~10 = displayId
       └─> ItemDisplayInfo.dbc row
            ├── modelName[0], modelName[1]   -- M2 files (weapons, helms, shoulders)
            ├── modelTexture[0,1]            -- texture overrides for models
            ├── geosetGroup[0,1,2]           -- which submeshes to show
            ├── texture[0..7]                -- body region textures (arm, torso, leg)
            ├── helmetGeosetVisID            -- what to hide for helmets
            └── itemVisual                   -- enchant glow effects
```

### ItemDisplayInfo.dbc Fields (Vanilla 1.12)

| Column | Field | Description |
|--------|-------|-------------|
| 0 | ID | Display ID |
| 1-2 | modelName[0,1] | Left/right M2 model paths |
| 3-4 | modelTexture[0,1] | Model texture overrides |
| 5-6 | inventoryIcon[0,1] | Icon filenames |
| 7-9 | geosetGroup[0,1,2] | Geoset modifiers by slot type |
| 10 | spellVisualID | Enchant glow |
| 12-13 | helmetGeosetVisID[0,1] | Helmet hair/beard hiding |
| 14-21 | texture[0..7] | Body region textures |
| 22 | itemVisual | Weapon glow reference |

### Three Types of Equipment Rendering

**1. Texture-Only Items** (no new geometry):
- Chest, Legs, Bracers, Shirt
- Apply BLP textures to specific body regions of the character texture
- Regions: ArmUpper, ArmLower, Hand, TorsoUpper, TorsoLower, LegUpper, LegLower, Foot

**2. Geoset-Switching Items** (show/hide character submeshes):
- Gloves, Boots, Belt, Cape, Tabard, Robe-style chest
- Enable specific geoset IDs on the character model
- Example: `geosetGroup[0] = 2` on gloves -> enable mesh part 403

**3. Separate Model Items** (load additional M2 files):
- Helmets -> attached at head bone (race/gender-specific model variants)
- Shoulders -> attached at shoulder bones (mirrored left/right)
- Weapons -> attached at hand bones
- Shields -> attached at left hand bone

### Attachment Points on Character Models

| ID | Name | Used For |
|----|------|----------|
| 0 | MountMain | Mount attachment |
| 1 | HandRight | Main hand weapon |
| 2 | HandLeft | Off hand weapon/shield |
| 5 | ShoulderRight | Right shoulder pad |
| 6 | ShoulderLeft | Left shoulder pad |
| 11 | Head | Helmet |
| 15 | BackSheath | 2H weapon sheathed |
| 16 | BackSheath2 | Second back sheath |
| 18 | SpellHandRight | Spell effects |
| 19 | SpellHandLeft | Spell effects |
| 26 | ShieldAttach | Shield sheathed (back) |

### Texture Compositing (Runtime)

For body-region armor (chest, legs, etc.), the game composites textures at runtime:

1. Start with **base skin texture** (from CharSections.dbc, based on race/gender/skin color)
2. For each equipped texture-based item:
   - Load body-region BLP textures from ItemDisplayInfo
   - Alpha-blend onto the correct regions of the character body texture
3. Apply composited texture to character model

The body texture layout (256x256 or 512x512):
```
+---------------------------+
| Face/Head region          |
+---------------------------+
| TorsoUpper | ArmUpper (L) |
|            | ArmUpper (R) |
+---------------------------+
| TorsoLower | ArmLower     |
+---------------------------+
| LegUpper   | Hand         |
+---------------------------+
| LegLower   | Foot         |
+---------------------------+
```

## Race/Gender Models (Vanilla)

16 character model combinations:

| Race | Male | Female | Internal Name |
|------|------|--------|---------------|
| Human | `Character\Human\Male\HumanMale.m2` | `Character\Human\Female\HumanFemale.m2` | Human |
| Orc | `Character\Orc\Male\OrcMale.m2` | `...Female\OrcFemale.m2` | Orc |
| Dwarf | `...DwarfMale.m2` | `...DwarfFemale.m2` | Dwarf |
| Night Elf | `...NightElfMale.m2` | `...NightElfFemale.m2` | NightElf |
| Undead | `...ScourgeMale.m2` | `...ScourgeFemale.m2` | Scourge |
| Tauren | `...TaurenMale.m2` | `...TaurenFemale.m2` | Tauren |
| Gnome | `...GnomeMale.m2` | `...GnomeFemale.m2` | Gnome |
| Troll | `...TrollMale.m2` | `...TrollFemale.m2` | Troll |

Race IDs: Human=1, Orc=2, Dwarf=3, NightElf=4, Undead=5, Tauren=6, Gnome=7, Troll=8

Gender: Male=0, Female=1

### Race-Specific Quirks
- **Tauren**: Hooves instead of feet (different boot geosets)
- **Troll**: 2-toed feet (different boot geosets)
- **Undead**: Exposed bones in some skin options
- **Helmets**: Race/gender-specific model variants (suffix like `HuM`, `DwF`, `OrM`)

## Animation (Minimal for Static Viewer)

For an idle character viewer, only Animation ID **0 (Stand)** is needed.

Key animation IDs in AnimationData.dbc:
| ID | Name |
|----|------|
| 0 | Stand (default idle) |
| 4 | Walk |
| 5 | Run |
| 69 | ReadyUnarmed |
| 70 | Ready1H |
| 71 | Ready2H |
| 143-148 | Stand2-Stand4 (idle variants) |

Bone animation uses compressed quaternions (`int16[4]`, mapped to [-1,1]).

## Sources
- [M2 Format - wowdev.wiki](https://wowdev.wiki/M2)
- [BLP Format - wowdev.wiki](https://wowdev.wiki/BLP)
- [ItemDisplayInfo - wowdev.wiki](https://wowdev.wiki/DB/ItemDisplayInfo)
- [Character Customization - wowdev.wiki](https://wowdev.wiki/Character_Customization)
- [CharSections - wowdev.wiki](https://wowdev.wiki/DB/CharSections)
- [ChrRaces - wowdev.wiki](https://wowdev.wiki/DB/ChrRaces)
