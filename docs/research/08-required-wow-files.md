# 08 - Required WoW Client Files

## Overview

The 5 essential DBC files are just the metadata layer. You also need all 3D models and textures — everything lives inside MPQ archives in the WoW `Data/` directory.

---

## 1. DBC Files (Essential)

| File | Size (est.) | Purpose |
|------|-------------|---------|
| `ItemDisplayInfo.dbc` | ~5 MB | displayId -> visual info |
| `CharSections.dbc` | ~3 MB | character customization textures |
| `ChrRaces.dbc` | ~50 KB | race definitions |
| `AnimationData.dbc` | ~50 KB | animation type definitions |
| `HelmetGeosetVisData.dbc` | ~10 KB | helmet hair/beard hiding rules |
| **Total DBC (essential)** | **~15 MB raw** | **~3 MB as JSON gzipped** |

### Optional DBC

| File | Purpose |
|------|---------|
| `CreatureModelData.dbc` | NPC models |
| `CreatureDisplayInfo.dbc` | NPC visuals |
| `ItemVisuals.dbc` | Enchant glows |
| `ItemVisualEffects.dbc` | Enchant glow models |
| `ItemClass.dbc` | Item classification |
| `ItemSubClass.dbc` | Item subclassification |

---

## 2. Character Models (~40 files, ~30 MB)

Every race/gender M2 + skin files:

```
Character\Human\Male\HumanMale.m2 + HumanMale00.skin
Character\Human\Female\HumanFemale.m2 + HumanFemale00.skin
Character\Orc\Male\OrcMale.m2 + OrcMale00.skin
Character\Orc\Female\OrcFemale.m2 + OrcFemale00.skin
Character\Dwarf\Male\DwarfMale.m2 + DwarfMale00.skin
Character\Dwarf\Female\DwarfFemale.m2 + DwarfFemale00.skin
Character\NightElf\Male\NightElfMale.m2 + NightElfMale00.skin
Character\NightElf\Female\NightElfFemale.m2 + NightElfFemale00.skin
Character\Scourge\Male\ScourgeMale.m2 + ScourgeMale00.skin
Character\Scourge\Female\ScourgeFemale.m2 + ScourgeFemale00.skin
Character\Tauren\Male\TaurenMale.m2 + TaurenMale00.skin
Character\Tauren\Female\TaurenFemale.m2 + TaurenFemale00.skin
Character\Gnome\Male\GnomeMale.m2 + GnomeMale00.skin
Character\Gnome\Female\GnomeFemale.m2 + GnomeFemale00.skin
Character\Troll\Male\TrollMale.m2 + TrollMale00.skin
Character\Troll\Female\TrollFemale.m2 + TrollFemale00.skin
Character\BloodElf\Male\BloodElfMale.m2 + BloodElfMale00.skin   (Turtle WoW High Elf)
Character\BloodElf\Female\BloodElfFemale.m2 + BloodElfFemale00.skin
Character\Goblin\Male\GoblinMale.m2 + GoblinMale00.skin         (Turtle WoW Goblin)
Character\Goblin\Female\GoblinFemale.m2 + GoblinFemale00.skin
```

---

## 3. Character Customization Textures (~1,500 BLP files, ~200 MB)

Skin, face, hair, facial hair, underwear textures per race/gender:

```
Character\<Race>\<Gender>\<Race><Gender>Skin00_<SkinColor>.blp
Character\<Race>\<Gender>\<Race><Gender>FaceLower<FaceID>_<SkinColor>.blp
Character\<Race>\<Gender>\<Race><Gender>FaceUpper<FaceID>_<SkinColor>.blp
Character\<Race>\Hair\<Race><Gender>Hair<Style><Color>.blp
Character\<Race>\Hair\<Race><Gender>FacialLower<Style><Color>.blp
Character\<Race>\Hair\<Race><Gender>FacialUpper<Style><Color>.blp
Character\<Race>\Hair\<Race><Gender>Scalp<Style><Color>.blp
```

Approximate count: ~50-100 textures per race/gender = ~800-2000 textures total.

---

## 4. Equipment Models (~4,000 files, ~150 MB)

Weapons, shields, helmets, shoulders — separate M2 models:

```
Item\ObjectComponents\Weapon\*.m2 + *.skin     (~500+ weapons)
Item\ObjectComponents\Shield\*.m2 + *.skin     (~100+ shields)
Item\ObjectComponents\Head\*.m2 + *.skin       (~3,200 helmets - race/gender variants)
Item\ObjectComponents\Shoulder\*.m2 + *.skin   (~200+ shoulders)
```

---

## 5. Equipment Model Textures (~2,000 BLP files, ~300 MB)

Textures for the above models:

```
Item\ObjectComponents\Weapon\*.blp
Item\ObjectComponents\Shield\*.blp
Item\ObjectComponents\Shoulder\*.blp
```

---

## 6. Equipment Body Region Textures (~6,000 BLP files, ~500 MB)

Chest, legs, boots, gloves, bracers, belt, shirt, tabard overlays:

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

---

## 7. Cape/Cloak Textures (~200 BLP files, ~30 MB)

```
Item\ObjectComponents\Cape\*.blp
```

---

## Totals

| Category | Files | Raw Size | Web-Converted |
|----------|-------|----------|---------------|
| DBC files | ~10 | ~15 MB | ~3 MB |
| Character models | ~40 | ~30 MB | ~5 MB |
| Character textures | ~1,500 | ~200 MB | ~40 MB |
| Equipment models | ~4,000 | ~150 MB | ~70 MB |
| Equipment model textures | ~2,000 | ~300 MB | ~150 MB |
| Body region textures | ~6,000 | ~500 MB | ~80 MB |
| Cape textures | ~200 | ~30 MB | ~15 MB |
| **Total** | **~14,000** | **~1.2 GB** | **~350-400 MB** |

---

## Source: MPQ Archives

All of the above lives in MPQ archives in your Turtle WoW `Data/` directory:

| Archive | Contents |
|---------|----------|
| `model.MPQ` | M2 models (.m2), skin files (.skin) |
| `texture.MPQ` | BLP textures (.blp) |
| `misc.MPQ` (or `dbc.MPQ`) | DBC database files (.dbc) |
| `patch.MPQ` | Base patch overrides |
| `patch-2.MPQ` | Additional patches |
| `patch-*.MPQ` | Turtle WoW custom content patches |

Patches override base archives. Later patches override earlier files. Turtle WoW's custom races and items are in the higher-numbered patches.

### Directories to Extract

```
DBFilesClient\    (all .dbc files)
Character\        (all character models and textures)
Item\             (all equipment models and textures)
```

---

## External Data Sources (NOT from the WoW client)

| Source | URL | Purpose |
|--------|-----|---------|
| `thatsmybis/classic-wow-item-db` | github.com/thatsmybis/classic-wow-item-db | SQL dump with `itemId -> displayId` mapping (~19,679 items). Server-side data that doesn't exist in the client. |
| `oplancelot/Turtle-WOW-DBC` | github.com/oplancelot/Turtle-WOW-DBC | `ItemDisplayInfo.dbc` as JSON (23,852 records). Alternative to parsing the DBC yourself. |
