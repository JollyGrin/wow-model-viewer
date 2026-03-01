# 09 - Equipment Rendering Plan

## Research Summary (2026-03-01)

Comprehensive investigation into what's needed to add equipment/armor/weapons across all 20 race/gender combinations.

---

## What We Have

### ItemDisplayInfo.json
- **24,000+ total records** (display IDs)
- **9,222 with 3D models** (`ModelName[0]` populated) — weapons, shields, helmets, shoulders
- **4,625 with ArmUpper texture** — chest/leg/boot armor that overlays body texture
- Fields confirmed from actual JSON (different from older docs):
  ```json
  {
    "ID": 20190,
    "ModelName": ["Sword_2H_Claymore_C_01.mdx", ""],
    "ModelTexture": ["Sword_1H_Long_D_01_V01", ""],
    "GeosetGroup": [0, 0, 0],
    "Texture": ["", "", "", "", "", "", "", ""],  // 8 body regions
    "HelmetGeosetVisID": [0, 0],                 // [male, female] mask
    "InventoryIcon": ["INV_Sword_19"]
  }
  ```

### Item M2 Models Available (in patch files)
| Category | Count | Path pattern |
|----------|-------|-------------|
| Weapon   | 162   | `data/patch/*/Item/ObjectComponents/Weapon/*.m2` |
| Head     | 1,831 | `data/patch/*/Item/ObjectComponents/Head/*.m2` |
| Shoulder | 224   | `data/patch/*/Item/ObjectComponents/Shoulder/*.m2` |
| Shield   | 28    | `data/patch/*/Item/ObjectComponents/Shield/*.m2` |

**Note:** These are patch overrides only (not base MPQ). Most vanilla items won't have models here; only TBC/custom additions.

### Body Texture Components Available
Located in `data/patch/patch-3/Item/TextureComponents/`:
| Region | File count | Directory |
|--------|-----------|-----------|
| ArmUpper | 139 | `ArmUpperTexture/` |
| ArmLower | ~100 | `ArmLowerTexture/` |
| Hand | ~80 | `HandTexture/` |
| TorsoUpper | 293 | `TorsoUpperTexture/` |
| TorsoLower | ~120 | `TorsoLowerTexture/` |
| LegUpper | 194 | `LegUpperTexture/` |
| LegLower | ~150 | `LegLowerTexture/` |
| Foot | ~80 | `FootTexture/` |

~1,483 total BLP files across all regions. All patch-3 only. Most vanilla raid/dungeon items (which live in base MPQ) won't have textures unless they're in patch-2 through patch-9 overrides.

### Helm Model File Naming (Race/Gender Suffixes)
Confirmed mapping from patch directory scan:

| Slug | Suffix | Helm count |
|------|--------|-----------|
| human-male | HuM | 62 |
| human-female | HuF | 61 |
| dwarf-male | DwM | 59 |
| dwarf-female | DwF | 59 |
| gnome-male | GnM | 61 |
| gnome-female | GnF | 59 |
| night-elf-male | NiM | 64 |
| night-elf-female | NiF | 62 |
| orc-male | OrM | 63 |
| orc-female | OrF | 62 |
| scourge-male | ScM | 62 |
| scourge-female | ScF | 61 |
| tauren-male | TaM | 64 |
| tauren-female | TaF | 65 |
| troll-male | TrM | 61 |
| troll-female | TrF | 58 |
| blood-elf-male | BeM | 233 |
| blood-elf-female | BeF | 232 |
| goblin-male | GoM | 179 |
| goblin-female | GoF | 180 |

**Warning:** Casing is inconsistent across patches. Files exist as `_HuM.m2`, `_HuM.M2`, `_hum.m2`, `_HUM.M2`. Always use case-insensitive glob when looking up by suffix.

---

## Key Technical Findings

### Item M2 Format
Weapon/armor M2 files use the same MD20 v256 format as character models. Key differences:
- **No attachment points** (count=0 for weapons — they're just geometry)
- **Single-bone skinning**: all vertices use bone 0, weight 255. No multi-bone deformation.
- **Same vertex format**: 48-byte M2Vertex → same 40-byte output as character conversion
- **Can reuse `convert-model.ts`** logic, just skip the character-specific parts

### Character Attachment Points (Confirmed)
Extracted from `HumanMale.m2` — 12 attachment entries at offset 0x34d2bb, 48 bytes each:

| ID | Name | Bone | WoW pos (Z-up) |
|----|------|------|----------------|
| 1 | HandRight | 125 | [-0.059, -0.476, 0.904] |
| 2 | HandLeft | 126 | [-0.059, +0.471, 0.904] |
| 5 | ShoulderRight | 111 | [-0.060, -0.211, 1.725] |
| 6 | ShoulderLeft | 112 | [-0.051, +0.211, 1.725] |

Other IDs present: 0 (MountMain), 3, 4, 7, 8 (likely elbow/knee). ID 11 (Head) may be in entries 0-2 which have a parsing issue (unaligned offset 0x34d2bb causes first few reads to be garbage).

**Action needed:** Export attachment data from `convert-model.ts` into `model.json`. Use the same 48-byte struct but validate results by cross-checking bone index ranges and position plausibility.

### Current `model.json` — Missing Attachment Data
The current manifest only has: `vertexCount, indexCount, triangleCount, vertexBufferSize, indexBufferSize, vertexStride, bones, groups`.

Need to add:
```json
{
  "attachments": [
    { "id": 1, "bone": 125, "pos": [-0.059, -0.476, 0.904] },
    { "id": 2, "bone": 126, "pos": [-0.059,  0.471, 0.904] },
    { "id": 5, "bone": 111, "pos": [-0.060, -0.211, 1.725] },
    { "id": 6, "bone": 112, "pos": [-0.051,  0.211, 1.725] }
  ]
}
```

### GeosetGroup → meshId Formula (Confirmed)
From research doc 03 + ItemDisplayInfo schema:
```
meshId = (slotGroup * 100) + geosetGroupValue + 1
```

Equipment slot → geoset group:
| Slot | Group | Example: value=1 → meshId |
|------|-------|--------------------------|
| Gloves | 4 | 402 (short gloves) |
| Boots | 5 | 502 (short boots) |
| Chest sleeves | 8 | 802 (short sleeves) |
| Belt buckle | 18 | 1802 (buckle visible) |

GeosetGroup[0] in ItemDisplayInfo maps to the slot's primary group. GeosetGroup[1] and [2] affect secondary groups (e.g., chest also sets sleeves and potentially undershirt).

---

## What Needs to Be Built

### Phase A: Body Texture Armor (No 3D Attachment)

**Goal:** Equip a chest/leg piece that overrides body texture regions.

**Steps:**
1. Pick a target item with textures in our patch files (e.g., search ItemDisplayInfo for items where `Texture[0]` is a name that exists in `ArmUpperTexture/`)
2. In `convert-textures.ts` or a new script: convert the BLP item textures to `.tex` format
3. In `charTexture.ts`: extend `composeCharTexture()` to accept equipment layers with explicit region assignments
4. In `loadModel.ts`: after compositing skin, add item texture overlays into the atlas before creating `CanvasTexture`
5. Adjust geoset selection: `resolveDefaultGeosets()` should accept equipment overrides per group

**Texture compositing order (from research doc 03):**
```
1. Base skin
2. Face overlay
3. Underwear
4. Shirt (ArmUpper, TorsoUpper, ArmLower)
5. Chest (ArmUpper, TorsoUpper, TorsoLower, ArmLower)
6. Tabard (TorsoUpper, TorsoLower)
7. Legs (LegUpper, LegLower)
8. Boots (LegLower, Foot)
9. Bracers (ArmLower)
10. Gloves (Hand, ArmLower)
```

**Texture region index mapping (ItemDisplayInfo `Texture[]` array):**
| Index | Region | charTexture.ts CharRegion |
|-------|--------|--------------------------|
| 0 | ArmUpper | CharRegion.ARM_UPPER |
| 1 | ArmLower | CharRegion.ARM_LOWER |
| 2 | Hand | CharRegion.HAND |
| 3 | TorsoUpper | CharRegion.TORSO_UPPER |
| 4 | TorsoLower | CharRegion.TORSO_LOWER |
| 5 | LegUpper | CharRegion.LEG_UPPER |
| 6 | LegLower | CharRegion.LEG_LOWER |
| 7 | Foot | CharRegion.FOOT |

**File paths for body textures:**
```
data/patch/patch-3/Item/TextureComponents/ArmUpperTexture/{name}.blp
data/patch/patch-3/Item/TextureComponents/TorsoUpperTexture/{name}.blp
...etc
```

**Coverage caveat:** Only patch-3 items have textures. Most vanilla items won't display because their textures come from the base MPQ (not extracted). This is acceptable for phase A.

---

### Phase B: Weapon Attachment

**Goal:** Place a weapon M2 model at the character's right hand.

**Steps:**

1. **Update `convert-model.ts`**: Extract attachment points and add to `model.json`:
   - Parse M2 attachment table at offset 252 (48-byte structs: `id u32 + bone u16 + unk u16 + pos f32[3] + animTrack`)
   - Export only IDs 1, 2, 5, 6, 11 (HandRight, HandLeft, ShoulderRight, ShoulderLeft, Head)
   - Run `bun run convert-model` to regenerate all 20 model.json files

2. **Add item M2 converter** (`scripts/convert-item.ts`):
   - Same vertex extraction as `convert-model.ts`
   - Simpler: no character-specific geoset logic, just convert all submeshes
   - Output: `public/items/{displayId}/model.bin + model.json`
   - Handle ModelTexture[0] → hardcoded texture type 0 (filename baked in M2)
   - Texture is stored next to the .m2 as `{ModelTexture}.blp`

3. **Attach in `loadModel.ts`**: After building character `THREE.Group`:
   ```typescript
   // Find attachment by ID
   const att = manifest.attachments.find(a => a.id === 1); // HandRight
   if (att) {
     const bone = skeleton.bones[att.bone];
     // pos is in WoW space (Z-up) → our pivot rotates X by -PI/2
     const attGroup = new THREE.Group();
     attGroup.position.set(att.pos[0], att.pos[1], att.pos[2]);
     bone.add(attGroup);
     // Load weapon model and add to attGroup
     const weapon = await loadItemModel('/items/20190');
     attGroup.add(weapon);
   }
   ```

4. **Weapon texture**: ItemDisplayInfo `ModelTexture[0]` is a bare filename (no path, no extension). Texture BLP is alongside the M2:
   ```
   Item/ObjectComponents/Weapon/Sword_2H_Claymore_C_01.m2
   Item/ObjectComponents/Weapon/Sword_1H_Long_D_01_V01.blp  ← ModelTexture
   ```

**Left/right convention:**
- Attachment ID 1 = HandRight (Y negative, main hand)
- Attachment ID 2 = HandLeft (Y positive, off-hand)
- In WoW's coordinate system: +Y is the model's left, −Y is right (facing +X)

**Shoulder mirroring:** When adding left shoulder, negate local X scale:
```typescript
leftShoulderGroup.scale.x = -1;
```

---

### Phase C: Helmet

**Goal:** Attach a race/gender-specific helmet M2 to the head bone.

**Steps:**

1. Build suffix lookup from slug:
   ```typescript
   const HELM_SUFFIX: Record<string, string> = {
     'human-male': 'HuM', 'human-female': 'HuF',
     'dwarf-male': 'DwM', 'dwarf-female': 'DwF',
     // ...all 20
   };
   ```

2. Find helm M2 path (case-insensitive):
   ```
   Item/ObjectComponents/Head/{baseName}_{suffix}.m2
   ```
   `baseName` comes from `ItemDisplayInfo.ModelName[0]` stripped of extension.

3. Apply `HelmetGeosetVisData`: use `HelmetGeosetVisID[genderIdx]` to look up which geoset groups to hide (hair=group 0, facial1=group 1, ears=group 7, etc.)

4. Attach at attachment ID 11 (Head bone).

---

### Phase D: Geoset Switching for Equipped Items

Already partially in place. Extend `resolveDefaultGeosets()` to accept equipment overrides:

```typescript
interface EquipmentGeosetOverride {
  group: number;   // geoset group (4=gloves, 5=boots, 8=sleeves...)
  variant: number; // GeosetGroup value from ItemDisplayInfo (1=short, 2=long...)
}
```

Formula: `meshId = group * 100 + variant + 1`

For robe-type chests: enable group 13 (1301+), disable group 11 (leg geometry shows through robe).

---

## Implementation Order (Risk-Adjusted)

| Phase | Difficulty | Visual Impact | Risk |
|-------|-----------|---------------|------|
| A: Body textures | Medium | High — armor visible on body | Low texture coverage from patches only |
| B: Weapon | Medium | Very high — dramatic visual change | Need to fix attachment extraction first |
| C: Helmet | Hard | High | Case-insensitive path lookup needed |
| D: Geoset switching | Low | Medium — correct geometry for armor type | Low |

**Recommended order:** D → A → B → C
- D first: zero new files, just fix geoset logic
- A next: uses existing BLP→tex pipeline, adds item texture compositing
- B: requires attachment extraction fix + new item converter
- C last: most complex (race-specific paths, hide logic)

---

## Data Gaps & Risks

### Low Coverage for Vanilla Items
- Base MPQ textures (model.mpq, texture.mpq) were not extracted
- Most vanilla TBC/WotLK raid gear won't have BLPs in patch-3
- **Mitigation:** Focus on items that DO exist (patch-3 custom content); show blank regions for missing textures rather than erroring

### No itemId → displayId Mapping
- ItemDisplayInfo.json is keyed by displayId, not itemId
- We don't have a SQL dump of item_template
- **Mitigation for now:** Expose displayId directly in UI (user types displayId to preview). Add itemId lookup later.

### Attachment Extraction Bug
- First 3 attachment entries in human male read as garbage (unaligned offset)
- ID 11 (Head attachment) is likely in one of these entries
- **Mitigation:** Validate by checking bone index < boneCount and |pos| < 5.0. Use fallback to known-good head bone index if needed.

### Inconsistent Item M2 Versions
- Some patch items may use version 260+ (not 256)
- `convert-model.ts` asserts version === 256 and throws
- **Mitigation:** Relax version check to `version >= 256 && version <= 264` for item converter

### File Path Case Inconsistency
- Head models exist as `_HuM.m2`, `_HuM.M2`, `_hum.m2`
- Need case-insensitive glob lookup at runtime or build time
- **Mitigation:** Pre-build an index file mapping baseName → actual file path

---

## Proposed Data Flow

```
User selects item (by displayId)
  │
  ▼
Look up ItemDisplayInfo.json[displayId]
  │
  ├─ Has ModelName[0]?
  │   └─ YES → determine slot from context (weapon/shield/helm/shoulder)
  │              → look up item M2 path
  │              → convert/load item M2
  │              → attach to character at attachment point
  │
  ├─ Has Texture[0..7]?
  │   └─ YES → load BLPs from TextureComponents dirs
  │              → composite into body atlas at correct regions
  │
  └─ Has GeosetGroup?
      └─ YES → override geoset selection for affected group(s)
```

---

## Files to Create/Modify

| File | Change |
|------|--------|
| `scripts/convert-model.ts` | Add attachment extraction → `model.json` |
| `scripts/convert-item.ts` | New: convert item M2s to `public/items/{id}/` |
| `src/loadModel.ts` | Accept equipment config, attach item models |
| `src/charTexture.ts` | Accept equipment texture layers |
| `src/itemData.ts` | New: load ItemDisplayInfo records by displayId |
| `src/main.ts` | Add equipment picker UI (displayId input) |

---

## Quick-Win Starting Point

To validate the whole pipeline end-to-end, target this specific item:

**displayId 20190 — Thunderfury, Blessed Blade of the Windseeker**
- `ModelName[0]`: `Sword_2H_Claymore_C_01.mdx`
- `ModelTexture[0]`: `Sword_1H_Long_D_01_V01`
- No body textures, no geoset changes → pure 3D attachment test
- Check if the M2 file exists: `find data/patch -iname "Sword_2H_Claymore_C_01.m2"` (may be missing — if so, pick one that exists in patch-3)

To find an item with textures in our patch files:
```bash
ls data/patch/patch-3/Item/TextureComponents/TorsoUpperTexture/ | head -5
# Take the filename (no extension) and find it in ItemDisplayInfo.json:
sed -n '15p' data/dbc/ItemDisplayInfo.json | jq '[.[] | select(.Texture[3] == "Chest_Plate_RaidWarrior_A_01")] | .[0]'
```
