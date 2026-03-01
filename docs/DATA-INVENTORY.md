# Data Inventory & Gap Analysis

**Date:** 2026-03-02

## Overview

This document tracks all available data sources for the WoW Model Viewer, their coverage, and what's needed for full Turtle WoW item rendering.

**Target:** 6,657 visible equippable items across all slots (from 17,604 total items in DB).

---

## Data Sources

### MPQ Archives (`data/model/`)

| Archive | Size | Files | Content |
|---------|------|-------|---------|
| `model.MPQ` | 182M | 7,838 M2s | Item models (weapons, helmets, shoulders, shields) |
| `texture.MPQ` | 634M | 42,045 BLPs | 8,569 armor region textures + 4,301 character textures + weapon/shield/shoulder/head textures |

**model.MPQ breakdown:**

| Category | M2 Count |
|----------|----------|
| Weapons | 437 |
| Helmets (race-specific variants) | 980 |
| Shoulders | 152 |
| Shields | 63 |
| Other | ~6,200 (character models, creatures, etc.) |

**texture.MPQ armor region breakdown:**

| Region | BLP Count |
|--------|-----------|
| ArmUpperTexture | 802 |
| ArmLowerTexture | 1,119 |
| HandTexture | 489 |
| TorsoUpperTexture | 1,390 |
| TorsoLowerTexture | 1,364 |
| LegUpperTexture | 1,427 |
| LegLowerTexture | 1,384 |
| FootTexture | 594 |
| **Total** | **8,569** |

Other texture.MPQ contents: 1,011 weapon BLPs, 135 shield BLPs, 260 shoulder BLPs, 229 head BLPs, 4,301 character BLPs.

### Patch Extractions (`data/patch/`)

| Patch | Size | M2s | BLPs | Has Character/ | Has Item/ |
|-------|------|-----|------|----------------|-----------|
| `patch/` (base) | 154M | 1,358 | 2,090 | Yes (9 races) | Yes (weapons, shields) |
| `patch-2` | 23M | 3 | 0 | No | Minimal |
| `patch-3` | 203M | 1,260 | 3,038 | Yes (BloodElf + updates) | Yes (TBC-era content) |
| `patch-4` | 76M | 556 | 1,593 | No | Yes |
| `patch-5` | 80M | 13 | 1,268 | Yes (Goblin) | Minimal |
| `patch-6` | 125M | 319 | 671 | No | Yes |
| `patch-7` | 97M | 158 | 404 | Yes (9 races) | Yes |
| `patch-8` | 67M | 117 | 385 | Yes (BloodElf) | Yes |
| `patch-9` | 37M | 21 | 25 | No | Minimal |
| `patch-y` | 0B | 0 | 0 | No | No |
| **Total** | **862M** | **~5,800** | **~9,500** | | |

**Key notes:**
- No `.skin` or `.wmo` files in any patch (M2 v256 has embedded skin data)
- Patch-3 is the largest content patch (TBC-era textures with different naming conventions)
- Base `patch/` has all 9 vanilla races (male + female = 18 character M2s)

### DBC JSON Files (`data/dbc/`)

| File | Size | Records | Purpose |
|------|------|---------|---------|
| ItemDisplayInfo.json | 18M | 29,604 | Maps displayId → models + textures |
| CreatureDisplayInfo.json | 6.3M | ~18,000 | Creature rendering data |
| CharSections.json | 863K | ~4,000 | Skin/face/hair textures per race |
| CreatureModelData.json | 359K | ~2,000 | Creature model paths |
| AnimationData.json | 26K | — | Animation definitions |
| ItemSubClass.json | 22K | — | Weapon/armor subclass names |
| ChrRaces.json | 17K | — | Race definitions |
| ItemVisualEffects.json | 3.4K | — | Enchant glow effects |
| ItemVisuals.json | 3.2K | — | Visual effect sets |
| ItemClass.json | 3.0K | — | Item class definitions |
| HelmetGeosetVisData.json | 2.9K | — | Helmet hide-hair rules |

### External Data (`data/external/`)

| File | Size | Records | Purpose |
|------|------|---------|---------|
| items.json | 2.0M | 17,604 | itemId → displayId + name + quality + class/subclass |
| unmodified.sql | 8.4M | — | Full SQL database dump (unused) |

**Items by equip slot (from items.json):**

| Slot | Type | Count | Rendering |
|------|------|-------|-----------|
| Head | 1 | 626 | M2 model (race-specific) |
| Shoulder | 3 | 636 | M2 model (left + right) |
| Chest | 5 | 698 | Texture compositing |
| Waist | 6 | 736 | Texture compositing |
| Legs | 7 | 784 | Texture compositing |
| Boots | 8 | 810 | Texture compositing |
| Wrist | 9 | 668 | Texture compositing |
| Gloves | 10 | 771 | Texture compositing |
| 1H Weapon | 13 | 716 | M2 model |
| Shield | 14 | 369 | M2 model |
| Ranged (bow) | 15 | 122 | M2 model |
| Cloak | 16 | 507 | Texture + geoset |
| 2H Weapon | 17 | 831 | M2 model |
| Main Hand | 21 | 386 | M2 model |
| Off Hand | 22 | 30 | M2 model |
| Held in OH | 23 | 275 | M2 model |
| Thrown | 25 | 26 | M2 model |
| Ranged (gun/wand) | 26 | 259 | M2 model |
| Non-equip | 0 | 6,936 | N/A |

---

## Currently Converted Assets (`public/`)

| Asset | Location | Count | Size |
|-------|----------|-------|------|
| Race models | `public/models/` | 20 (10 races × 2 genders) | 68M |
| Weapons | `public/items/weapon/` | 111 models | 51M |
| Helmets | `public/items/head/` | 90 models (×4 race variants) | — |
| Shoulders | `public/items/shoulder/` | 28 models (×2 sides) | — |
| Armor textures | `public/item-textures/` | 9,522 .tex files | 292M |
| Item catalog | `public/item-catalog.json` | 4,500 items | 1.0M |

**Armor texture breakdown (from patch-3 conversion only):**

| Region | .tex Files |
|--------|-----------|
| ArmUpperTexture | 889 |
| ArmLowerTexture | 1,210 |
| HandTexture | 539 |
| TorsoUpperTexture | 1,632 |
| TorsoLowerTexture | 1,604 |
| LegUpperTexture | 1,537 |
| LegLowerTexture | 1,482 |
| FootTexture | 628 |

---

## Coverage Analysis

### ItemDisplayInfo Texture Coverage

Total unique texture references in IDI: **7,734**

| Source | Found | % |
|--------|-------|---|
| texture.MPQ | 6,341 | 82.0% |
| Patch .tex files (not in MPQ) | 7 | 0.1% |
| Patch BLPs (unconverted) | 1 | 0.0% |
| **Not found anywhere** | **1,385** | **17.9%** |

The 1,385 missing textures all use `Generic_` prefix naming (e.g., `Generic_HuWk_01_Chest_TU`, `Generic_OrWr_01_Boot_FO`). These are vanilla base-game textures that may exist in the original WoW 1.12 `texture.MPQ`, which is different from the Turtle WoW `texture.MPQ` we have.

**Update:** The `texture.MPQ` in `data/model/` IS the Turtle WoW texture MPQ. It uses material-based prefixes (Plate_, Leather_, Cloth_, Mail_, Robe_) rather than the Generic_ class-race prefixes from vanilla. These Generic_ textures may be in a separate base MPQ from the Turtle WoW client that hasn't been extracted yet.

### ItemDisplayInfo Model Coverage

Total unique model references in IDI: **825** (weapons, shields, helmets, shoulders)

| Match Type | Count |
|------------|-------|
| Direct match in model.MPQ | 443 |
| Helmet base → race-variant match | 1,932 (race-specific M2s) |
| In MPQ OR patches | 446 |
| Missing (not in MPQ or patches) | 379 |

Missing models break down to:
- Helmets without race-suffix match: 255
- Weapons/shields: 343
- Shoulders + other: 325

### Cross-Reference: IDI Model Names vs Patch M2s

The patch M2 files use **TBC-era naming** (e.g., `axe_1h_blood_a_01.m2`) while IDI references **vanilla naming** (e.g., `Axe_1H_Hatchet_A_01.m2`). Only 3 case-insensitive matches out of 825 IDI refs × 1,253 patch M2s.

This means patches contain **additional** items not in vanilla IDI, while vanilla IDI items need models from MPQ archives.

---

## Extraction Status

### Scripts Available

| Script | Purpose | Status |
|--------|---------|--------|
| `scripts/extract-from-mpq.ts` | Extract specific files from MPQ (manual list) | Run once (23 test files) |
| `scripts/extract-mpq-textures.ts` | Extract ALL IDI textures from texture.MPQ → .tex | **NOT YET RUN** |
| `scripts/convert-item.ts` | Convert M2+BLP → public/items/ | Run (patches only) |
| `scripts/convert-item-textures.ts` | Convert patch BLP → public/item-textures/ | Run (patch-3 only) |
| `scripts/build-item-catalog.ts` | Build item-catalog.json from converted assets | Run |

### Priority Extraction Tasks

1. **Run `extract-mpq-textures.ts`** — Extract ~6,341 armor textures from texture.MPQ. Merges with existing 9,522 patch textures. Single biggest coverage win.

2. **Extract weapon M2s from model.MPQ** — 437 vanilla weapon models not yet converted.

3. **Extract helmet M2s from model.MPQ** — 980 race-specific helmet models.

4. **Extract shoulder M2s from model.MPQ** — 152 shoulder models.

5. **Extract shield M2s from model.MPQ** — 63 shield models.

6. **Locate vanilla base texture.MPQ** — For the 1,385 Generic_ textures (18% gap). May be in the Turtle WoW client directory as a separate MPQ archive.

7. **Rebuild item catalog** — After extractions, re-run `build-item-catalog.ts` to include all new assets.

---

## Naming Convention Reference

### Texture Prefixes by Source

| Source | Naming Pattern | Example |
|--------|---------------|---------|
| texture.MPQ (Turtle WoW) | Material-based | `Plate_A_01Red_Glove_HA_U.blp` |
| Patches (TBC-era) | Material + set | `Leather_Blood_A_01Blue_Pant_LU.blp` |
| Vanilla IDI references | Generic + race-class | `Generic_HuWk_01_Chest_TU` |

### Model Naming

| Source | Pattern | Example |
|--------|---------|---------|
| model.MPQ | Vanilla names | `Axe_1H_Hatchet_A_01.m2` |
| Patches | TBC + custom names | `axe_1h_blood_a_01.m2` |
| IDI references | `.mdx` extension | `Axe_1H_Hatchet_A_01.mdx` |

### Helmet Race Suffixes

IDI stores base name (e.g., `Helm_Leather_D_01.m2`), actual files have race-gender suffix (e.g., `Helm_Leather_D_01_HuM.m2`). Suffix codes: HuM/HuF (Human), DwM/DwF (Dwarf), NiM/NiF (Night Elf), GnM/GnF (Gnome), OrM/OrF (Orc), TrM/TrF (Troll), ScM/ScF (Scourge/Undead), TaM/TaF (Tauren), GoM/GoF (Goblin).
