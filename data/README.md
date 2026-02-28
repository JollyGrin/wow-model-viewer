# data/ — WoW Client Files

These files are extracted from Turtle WoW (1.12.x) game client and are **not git-tracked**. You must populate this directory manually.

## Required Structure

```
data/
├── dbc/                        # Pre-converted DBC → JSON (25 MB)
│   ├── AnimationData.json
│   ├── CharSections.json
│   ├── ChrRaces.json
│   ├── CreatureDisplayInfo.json
│   ├── CreatureModelData.json
│   ├── HelmetGeosetVisData.json
│   ├── ItemClass.json
│   ├── ItemDisplayInfo.json
│   ├── ItemSubClass.json
│   ├── ItemVisualEffects.json
│   └── ItemVisuals.json
│
├── model/                      # Base game archives (816 MB)
│   ├── model.MPQ               # Base character + item M2 models
│   └── texture.MPQ             # Base BLP textures
│
└── patch/                      # Extracted patch MPQ overrides (~850 MB)
    ├── patch/                  # Base patch
    ├── patch-2/
    ├── patch-3/
    ├── patch-4/
    ├── patch-5/
    ├── patch-6/
    ├── patch-7/
    ├── patch-8/
    └── patch-9/
```

## What Goes in Each Patch Directory

Each `patch-N/` directory should contain **only** these subdirectories:

### `Character/` — Player race models & textures
```
Character/<Race>/<Gender>/
  ├── <Race><Gender>.m2          # Model file
  ├── <Race><Gender>Skin00_00.blp  # Skin textures
  ├── <Race><Gender>00_00Hair00.blp
  └── ...
```

Races: BloodElf, Dwarf, Gnome, Goblin, Human, NightElf, Orc, Scourge, Tauren, Troll, Tuskarr

### `Item/` — Equipment models & textures
```
Item/
├── ObjectComponents/           # 3D item models (.m2 + .blp)
│   ├── Ammo/
│   ├── Cape/
│   ├── Head/
│   ├── Shield/
│   ├── Shoulder/
│   └── Weapon/
│
└── TextureComponents/          # Equipment texture overlays (.blp)
    ├── ArmLowerTexture/
    ├── ArmUpperTexture/
    ├── FootTexture/
    ├── HandTexture/
    ├── LegLowerTexture/
    ├── LegUpperTexture/
    ├── TorsoLowerTexture/
    └── TorsoUpperTexture/
```

### `DBFilesClient/` — Patch DBC overrides
Binary `.dbc` files that override base game data. These are the raw DBC files from each patch MPQ.

## How to Populate

1. **DBC JSON files** — Extract DBC tables from the game client using a DBC dump tool, then convert to JSON. Each JSON file has 14 lines of tool log output followed by the JSON array on line 15.

2. **model.MPQ + texture.MPQ** — Copy directly from the Turtle WoW game client `Data/` directory.

3. **Patch directories** — Extract each patch MPQ (`patch.MPQ`, `patch-2.MPQ`, ... `patch-9.MPQ`) using an MPQ extraction tool (e.g., StormLib, mpq-tools). Only keep `Character/`, `Item/`, and `DBFilesClient/` subdirectories. Delete everything else (World, Creature, Sound, Interface, Textures, Dungeons, Spells, etc.).

## File Types

| Extension | Format | Purpose |
|-----------|--------|---------|
| `.m2` | Binary (M2 v256) | 3D model (vertices, bones, geosets, animations) |
| `.blp` | Binary (BLP) | Texture image (DXT compressed) |
| `.dbc` | Binary (DBC) | Database table (game data lookups) |
| `.MPQ` | Binary (MPQ archive) | Compressed game archive |
| `.json` | Text | Pre-converted DBC data |

## Total Size

~1.7 GB after removing non-character/equipment data.
