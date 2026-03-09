# Data Request: Complete Turtle WoW Item Viewer

## Goal

Build a web-based model viewer that can render **every equippable item** in Turtle WoW. Currently we have ~8,600 items in our catalog out of an estimated 15,000+ equippable items (vanilla + Turtle WoW custom).

## Current Coverage

| What We Have | Count | Source |
|---|---|---|
| Weapons | 2,547 | Patch-extracted M2s |
| Shields | 369 | Patch-extracted M2s |
| Helmets | 492 | Patch-extracted M2s |
| Shoulders | 502 | Patch-extracted M2s |
| Chest armor | 1,190 | Patch-3 body textures |
| Legs | 1,674 | Patch-3 body textures |
| Boots | 942 | Patch-3 body textures |
| Gloves | 865 | Patch-3 body textures |
| **Total** | **8,581** | |

| What We Have | Details |
|---|---|
| Item database | 17,604 items (vanilla classic only, no Turtle WoW custom items) |
| ItemDisplayInfo.dbc | 29,604 display records (includes some Turtle WoW additions) |
| Character models | All 20 race/gender combinations fully rendering |
| Patch files extracted | patch-2 through patch-9 + patch-y |
| Base MPQ archives | Copied but NOT extracted (model.MPQ, texture.MPQ, patch.MPQ) |

### What's Missing

- **Turtle WoW custom items** — our item database is vanilla-only, missing all custom itemId → displayId mappings
- **Base vanilla assets** — only patch overrides are extracted; the base MPQ `Item/` directory is untouched
- **Capes/Cloaks** — zero cape models or textures (507 cloaks in vanilla alone)
- **Shirts, Bracers, Belts, Tabards** — not yet in catalog
- **Base body textures** — only TBC-era patch-3 textures extracted; vanilla base textures missing

---

## Request 1: Item Database Table (highest priority)

We need the server's `item_template` table exported as SQL or CSV. This is the only source for Turtle WoW custom items.

**Fields needed:**

| Column | Purpose |
|---|---|
| `entry` (itemId) | Primary key |
| `displayid` | Links to ItemDisplayInfo for model/texture lookup |
| `inventory_type` | Equipment slot (head, chest, legs, etc.) |
| `name` | Display name |
| `quality` | Rarity tier (common, rare, epic, etc.) |
| `class` | Item class (weapon, armor, etc.) |
| `subclass` | Item subclass (sword, plate, cloth, etc.) |

Our current `items.json` is from `thatsmybis/classic-wow-item-db` and caps at itemId 25818. Turtle WoW custom items are likely above 50000 and completely absent.

---

## Request 2: Full Extracted Item Assets (highest priority)

We need the complete `Item/` directory tree extracted from all MPQ archives (base + all patches), merged with patch-priority ordering (higher patch overrides lower).

### M2 Models + Companion BLP Textures

| MPQ Path | What | Current State |
|---|---|---|
| `Item/ObjectComponents/Weapon/*.m2, *.blp` | Weapon models + textures | Partial (patches only) |
| `Item/ObjectComponents/Head/*.m2, *.blp` | Helmet models + textures | Partial (patches only) |
| `Item/ObjectComponents/Shoulder/*.m2, *.blp` | Shoulder models + textures | Partial (patches only) |
| `Item/ObjectComponents/Shield/*.m2, *.blp` | Shield models + textures | Partial (patches only) |
| `Item/ObjectComponents/Cape/*.m2, *.blp` | Cape/cloak models + textures | **Missing entirely** |

### Body Region Textures (BLP)

| MPQ Path | What | Current State |
|---|---|---|
| `Item/TextureComponents/ArmUpperTexture/*.blp` | Sleeve/upper arm textures | Patch-3 TBC-era only |
| `Item/TextureComponents/ArmLowerTexture/*.blp` | Bracer/forearm textures | Patch-3 TBC-era only |
| `Item/TextureComponents/HandTexture/*.blp` | Glove/gauntlet textures | Patch-3 TBC-era only |
| `Item/TextureComponents/TorsoUpperTexture/*.blp` | Chest/robe upper textures | Patch-3 TBC-era only |
| `Item/TextureComponents/TorsoLowerTexture/*.blp` | Chest/robe lower textures | Patch-3 TBC-era only |
| `Item/TextureComponents/LegUpperTexture/*.blp` | Thigh armor textures | Patch-3 TBC-era only |
| `Item/TextureComponents/LegLowerTexture/*.blp` | Shin/calf armor textures | Patch-3 TBC-era only |
| `Item/TextureComponents/FootTexture/*.blp` | Boot textures | Patch-3 TBC-era only |

**What we've already tried:** We have `model.MPQ`, `texture.MPQ`, and `patch.MPQ` locally and a working extraction script (`scripts/extract-mpq-textures.ts`) that reads BLPs directly from MPQ archives via `@wowserhq/stormjs`. Running it yields:

- 9,345 textures already extracted (from previous runs)
- **13,851 "not found"** — ItemDisplayInfo references texture names that don't exist in our 3 MPQ files
- The patch-2 through patch-9 directories were extracted separately but aren't MPQ-mounted

The gap is that our 3 MPQ archives simply don't contain all the BLP files that ItemDisplayInfo references. Many are likely in the numbered patch MPQ archives or custom Turtle WoW patches.

**Simplest ask:** Recursive extraction of `Item/` from all MPQs (base + every patch), merged with patch priority. Or provide all patch MPQ archives so we can mount them in our extraction script.

---

## Request 3: Character Asset Extraction

| MPQ Path | What | Why |
|---|---|---|
| `Character/**/*.skin` | Skin/LOD files for character M2s | Zero .skin files currently extracted |
| `Character/**/*.blp` | Base character textures | Only patch overrides present |

---

## Request 4: Turtle WoW Custom Patch MPQs

Turtle WoW adds custom models and textures in custom patch files beyond the standard set. We currently have:

- `patch-2` through `patch-9`
- `patch-y`

**We need any additional custom patches** (e.g. `patch-A.MPQ`, `patch-T.MPQ`, or however Turtle WoW distributes custom art). These contain:

- Custom item M2 models unique to Turtle WoW
- Custom BLP textures for Turtle WoW items
- Custom DBC overrides (especially `ItemDisplayInfo.dbc` additions)

---

## Request 5: Additional DBC Files (nice-to-have)

| DBC File | Purpose |
|---|---|
| `Item.dbc` | Direct itemId → displayId mapping (if it exists server-side) |
| `ItemSet.dbc` | Armor set groupings for "view full set" feature |
| `SpellItemEnchantment.dbc` | Enchant glow visual definitions |

---

## Ideal Delivery Format

A directory tree of extracted files is easiest for us to work with:

```
turtle-wow-extracted/
├── Item/
│   ├── ObjectComponents/
│   │   ├── Weapon/          (.m2 + .blp files)
│   │   ├── Head/            (.m2 + .blp files)
│   │   ├── Shoulder/        (.m2 + .blp files)
│   │   ├── Shield/          (.m2 + .blp files)
│   │   └── Cape/            (.m2 + .blp files)
│   └── TextureComponents/
│       ├── ArmUpperTexture/  (.blp files)
│       ├── ArmLowerTexture/  (.blp files)
│       ├── HandTexture/      (.blp files)
│       ├── TorsoUpperTexture/ (.blp files)
│       ├── TorsoLowerTexture/ (.blp files)
│       ├── LegUpperTexture/  (.blp files)
│       ├── LegLowerTexture/  (.blp files)
│       └── FootTexture/      (.blp files)
├── Character/                (.m2 + .skin + .blp files)
├── DBFilesClient/            (.dbc files)
└── item_template.sql         (or .csv)
```

Tools like Ladik's MPQ Editor or MPQ Extract can do the full recursive extraction. Files should be merged across all MPQs with higher-numbered patches taking priority over base archives.
