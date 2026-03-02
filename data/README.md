# data/ — WoW Client Files

Game files from Turtle WoW (1.12.x) client. **Not git-tracked** — populate manually.

## Structure

```
data/
├── dbc/                        # DBC → JSON (25 MB, 11 files)
│   ├── ItemDisplayInfo.json    # 29,604 records — displayId → textures/models/geosets
│   ├── CharSections.json       # ~4,000 records — skin/face/hair textures per race
│   ├── ChrRaces.json           # Race definitions
│   ├── HelmetGeosetVisData.json # Helmet hide-hair rules per race
│   ├── AnimationData.json
│   ├── CreatureDisplayInfo.json
│   ├── CreatureModelData.json
│   ├── ItemClass.json
│   ├── ItemSubClass.json
│   ├── ItemVisualEffects.json
│   └── ItemVisuals.json
│
├── external/                   # External databases
│   ├── items.json              # 17,604 items — itemId → displayId + name + quality
│   └── unmodified.sql          # Schema reference (not full DB)
│
├── model/                      # MPQ archives from client Data/ (~2.6 GB)
│   ├── model.MPQ               # 182M — 7,838 M2s (437 weapons, 980 helmets, 152 shoulders, 63 shields)
│   ├── texture.MPQ             # 634M — 42,045 BLPs (8,569 armor textures, 1,011 weapon, 4,301 character)
│   └── patch.MPQ               # 1.8G — 26,352 files (vanilla endgame: AQ, Naxx, ZG, BWL, PVP)
│
├── extracted/                  # One-off test extractions (23 files)
│
└── patch/                      # Extracted patch-N.mpq directories (~850 MB)
    ├── patch/                  # Base — 1,358 M2s, 2,090 BLPs (all 9 vanilla races)
    ├── patch-2/                # 3 M2s
    ├── patch-3/                # 1,260 M2s, 3,038 BLPs (TBC-era, BloodElf)
    ├── patch-4/                # 556 M2s, 1,593 BLPs
    ├── patch-5/                # 13 M2s, 1,268 BLPs
    ├── patch-6/                # 319 M2s, 671 BLPs
    ├── patch-7/                # 158 M2s, 404 BLPs
    ├── patch-8/                # 117 M2s, 385 BLPs
    ├── patch-9/                # 21 M2s, 25 BLPs
    └── patch-y/                # Empty
```

## Source: Turtle WoW `Data/` Directory

Copy these MPQ files from your client:

| Client File | Destination | Size | Needed |
|-------------|-------------|------|--------|
| `model.MPQ` | `data/model/` | 182M | Yes — item + character M2 models |
| `texture.MPQ` | `data/model/` | 634M | Yes — item + character BLP textures |
| `patch.MPQ` | `data/model/` | 1.8G | Yes — vanilla endgame content |
| `patch-2.mpq` → `patch-9.mpq` | Extract into `data/patch/patch-N/` | ~850M total | Yes — Turtle WoW custom content |
| `terrain.MPQ` | — | 1.0G | No — world terrain |
| `sound.MPQ` / `speech.MPQ` | — | 1.1G | No — audio |
| `wmo.MPQ` | — | 347M | No — world map objects |
| `interface.MPQ` | — | 66M | No — UI icons |
| `base.MPQ` / `misc.MPQ` / `dbc.MPQ` / `backup.MPQ` / `fonts.MPQ` | — | ~24M | No |

## DBC JSON Format

Each file has **14 lines of log output** before the JSON array on line 15:

```bash
sed -n '15p' data/dbc/ItemDisplayInfo.json | jq 'length'         # count
sed -n '15p' data/dbc/ItemDisplayInfo.json | jq '.[0:2]'         # sample
sed -n '15p' data/dbc/ItemDisplayInfo.json | jq '.[] | select(.ID == 20190)'  # lookup
```

## MPQ Contents

### model.MPQ — 3D Models

| Path | Count | Content |
|------|-------|---------|
| `Item\ObjectComponents\Weapon\` | 437 | Weapon M2s (axes, swords, staves, bows, etc.) |
| `Item\ObjectComponents\Head\` | 980 | Helmet M2s (race-gender variants like `_HuM`, `_NiF`) |
| `Item\ObjectComponents\Shoulder\` | 152 | Shoulder M2s (L/R variants) |
| `Item\ObjectComponents\Shield\` | 63 | Shield M2s |
| Character + Creature | ~6,200 | Character race models, creatures |

### texture.MPQ — Textures

| Path | Count | Content |
|------|-------|---------|
| `Item\TextureComponents\*` | 8,569 | Armor region BLPs (Plate_, Leather_, Cloth_, Mail_, Robe_) |
| `Item\ObjectComponents\Weapon\` | 1,011 | Weapon texture BLPs |
| `Item\ObjectComponents\Shield\` | 135 | Shield texture BLPs |
| `Item\ObjectComponents\Shoulder\` | 260 | Shoulder texture BLPs |
| `Item\ObjectComponents\Head\` | 229 | Helmet texture BLPs |
| `Character\*` | 4,301 | Race skin/face/hair/underwear textures |

### patch.MPQ — Vanilla Endgame

Same structure as model.MPQ/texture.MPQ but for endgame content:
- 254 weapon M2s, 119 shoulder M2s, 22 shield M2s
- 1,433 armor region textures
- Content from: AhnQiraj, Blackwing Lair, Naxxramas, ZulGurub, Stratholme, PVP sets

## Known Gaps

~1,385 ItemDisplayInfo texture references use `Generic_` prefix naming that doesn't exist in any MPQ. These are legacy vanilla references replaced by material-based naming in Turtle WoW. Items referencing them will have no texture.
