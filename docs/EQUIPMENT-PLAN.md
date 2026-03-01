# Equipment Rendering Implementation Plan

> Research basis: [`docs/research/09-equipment-rendering-plan.md`](./research/09-equipment-rendering-plan.md)

---

## Situation Summary

We have two MPQ archives already in the repo (`data/model/model.MPQ` 182MB, `data/model/texture.MPQ` 634MB) plus extracted patch overrides (`data/patch/patch-*`). The stormjs extraction pipeline already works. None of this requires touching the WoW client again.

### What's in the files right now

| Source | Weapon M2 | Head M2 | Shoulder M2 | Shield M2 | Body texture BLPs |
|--------|----------|---------|------------|---------|------------------|
| `model.MPQ` (base) | 368 | 980 | 145 | 30 | — |
| `texture.MPQ` (base) | 983 BLPs | 229 BLPs | 257 BLPs | 125 BLPs | ~8,570 |
| `data/patch/patch-3/` | +60 M2 | +~800 M2 | +100 M2 | — | 1,518 BLPs |
| `data/patch/patch-2,4-9/` | +102 M2 | +~1,031 M2 | +24 M2 | — | — |
| **Combined** | **~530** | **~1,800** | **~269** | **~58** | **~10,100** |

**Classic WoW coverage:** Full. Model.MPQ has all 8 base races × 2 genders for helms, all classic weapons, all classic armor body textures.

**Turtle WoW custom items (IDs > 30,000, up to 38,284):** Covered by patch-3 through patch-9 overrides already in `data/patch/`. Items added to those patches have their models/textures there.

**What's NOT covered:** Any Turtle WoW patches beyond patch-9 that weren't extracted (patch-y is empty). If the live Turtle WoW client has a patch-z or higher, those items would need a fresh extraction from the actual TW Data/ directory.

---

## Full Coverage Requirements

### Classic WoW items — achievable now
Extract from the two base MPQs already present. No WoW client needed.

### Turtle WoW custom items — mostly covered
`patch-3` has 3,544 item files including all the Turtle WoW-specific armor textures and custom race helms (BeM/BeF, GoM/GoF have the most variants: 200+ each).

### Race coverage for helmets
All 10 race × 2 gender combos are confirmed present. Suffixes: `HuM HuF DwM DwF GnM GnF NiM NiF OrM OrF ScM ScF TaM TaF TrM TrF BeM BeF GoM GoF`

---

## Implementation Phases

---

### Phase 1 — Extract Base MPQ Assets
**Goal:** Pull all item models and textures out of the two base MPQs into `data/patch/patch/` (the already-present base patch directory, which currently has 0 item files).

**What to extract from `model.MPQ`:**
```
Item\ObjectComponents\Weapon\*.m2
Item\ObjectComponents\Head\*.m2
Item\ObjectComponents\Shoulder\*.m2
Item\ObjectComponents\Shield\*.m2
```

**What to extract from `texture.MPQ`:**
```
Item\TextureComponents\ArmUpperTexture\*.blp
Item\TextureComponents\ArmLowerTexture\*.blp
Item\TextureComponents\HandTexture\*.blp
Item\TextureComponents\TorsoUpperTexture\*.blp
Item\TextureComponents\TorsoLowerTexture\*.blp
Item\TextureComponents\LegUpperTexture\*.blp
Item\TextureComponents\LegLowerTexture\*.blp
Item\TextureComponents\FootTexture\*.blp
Item\ObjectComponents\Weapon\*.blp
Item\ObjectComponents\Head\*.blp
Item\ObjectComponents\Shoulder\*.blp
Item\ObjectComponents\Shield\*.blp
Item\ObjectComponents\Cape\*.blp
```

**Also extract all character skin textures** (needed for skin color variety across all 8 base races):
```
Character\Human\*\*.blp
Character\Orc\*\*.blp
Character\Dwarf\*\*.blp
Character\NightElf\*\*.blp
Character\Scourge\*\*.blp
Character\Tauren\*\*.blp
Character\Gnome\*\*.blp
Character\Troll\*\*.blp
```

**Script to write:** Extend `scripts/extract-from-mpq.ts` to do a full bulk extraction using `mpq.search(pattern)` + loop over all results. Output to `data/patch/patch/` to preserve the existing load-order convention (base patch is lowest priority, gets overridden by patch-2 through patch-9).

**Estimated output:** ~14,600 files, ~800MB raw BLPs + M2s.

---

### Phase 2 — Export Attachment Points from Character Models

**Goal:** Add attachment point data to all 20 `public/models/*/model.json` files so the renderer knows which bone to attach items to.

**What to add to `model.json`:**
```json
{
  "attachments": [
    { "id": 1,  "bone": 125, "pos": [-0.059, -0.476, 0.904] },
    { "id": 2,  "bone": 126, "pos": [-0.059,  0.471, 0.904] },
    { "id": 5,  "bone": 111, "pos": [-0.060, -0.211, 1.725] },
    { "id": 6,  "bone": 112, "pos": [-0.051,  0.211, 1.725] },
    { "id": 11, "bone": ???, "pos": [???, ???, ???] }
  ]
}
```

**What to change in `scripts/convert-model.ts`:**
- After the existing header parse, read the attachment M2Array at header offset 252
- Parse 48-byte structs: `id(u32) + bone(u16) + unk(u16) + pos(f32×3) + animTrack(28B)`
- Filter to IDs: 1 (HandRight), 2 (HandLeft), 5 (ShoulderRight), 6 (ShoulderLeft), 11 (Head)
- Validate: skip entries where bone index ≥ boneCount or any |pos| component > 10
- Write into manifest alongside `bones` and `groups`
- Re-run `bun run convert-model` → regenerates all 20 model.json files

**Attachment IDs needed:**
| ID | Slot | Used for |
|----|------|---------|
| 1 | HandRight | Main hand weapon |
| 2 | HandLeft | Off-hand / shield |
| 5 | ShoulderRight | Right shoulder pad |
| 6 | ShoulderLeft | Left shoulder pad |
| 11 | Head | Helmet |

---

### Phase 3 — Item M2 Converter

**Goal:** Convert item M2 files (weapons, helms, shoulders, shields) to the same `model.bin` + `model.json` format as character models, served from `public/items/{category}/{slug}/`.

**Key difference from character models:** Item M2s are single-bone (all verts weight 255 on bone 0). No geoset system. Same vertex format.

**Conversion output structure:**
```
public/items/weapon/{slug}/model.bin
public/items/weapon/{slug}/model.json   ← no attachments, no groups needed
public/items/weapon/{slug}/textures/{name}.tex
public/items/head/{slug}/model.bin      ← one per race/gender variant
public/items/shoulder/{slug}/model.bin
```

**Script to write:** `scripts/convert-items.ts`
- Input: a list of (displayId, category, m2BaseName, modelTextureName) tuples
- Locate M2: search `data/patch/` directories in reverse priority order (patch-9 → patch-8 → ... → patch/), then fall back to the just-extracted `data/patch/patch/`
- Parse M2 with same parseM2v256() logic (relax version check to 256–264)
- Write bin + json
- Convert BLP texture alongside M2 to `.tex`

**Lookup priority for files (patch override order):**
```
patch-9 > patch-8 > patch-7 > patch-6 > patch-5 > patch-4 > patch-3 > patch-2 > patch > base MPQ
```
The base MPQ extraction in Phase 1 goes into `data/patch/patch/`, so the same directory scan works for everything.

**For helmets specifically:** the M2 filename in ItemDisplayInfo includes the base name only (e.g. `Helm_Plate_Judgement_A_01`). The actual file is `Helm_Plate_Judgement_A_01_HuM.m2`. Generate one converted output per race/gender suffix.

---

### Phase 4 — Body Texture Pipeline

**Goal:** Convert item body-region BLPs to `.tex` files, organized for fast runtime lookup.

**Output structure:**
```
public/item-textures/ArmUpper/{name}.tex
public/item-textures/TorsoUpper/{name}.tex
public/item-textures/LegUpper/{name}.tex
... (8 region directories)
```

**Script to write:** `scripts/convert-item-textures.ts`
- Glob all BLPs from all `data/patch/*/Item/TextureComponents/{Region}/` directories
- Deduplicate by filename (higher-numbered patch wins)
- Convert BLP → raw RGBA `.tex` using existing `@wowserhq/format` Blp parser
- Output to `public/item-textures/`

**Estimated output:** ~10,100 `.tex` files, roughly 200–400MB (RGBA 4×).

---

### Phase 5 — ItemDisplayInfo Lookup

**Goal:** Make it fast to go from a display ID to all visual data needed.

**What to build:** `src/itemData.ts` — loads `ItemDisplayInfo.json` (already at `data/dbc/`) and provides:

```typescript
interface ItemDisplay {
  id: number;
  modelName: string;       // bare filename, no ext
  modelTexture: string;    // bare texture name
  geosetGroup: [number, number, number];
  bodyTextures: {          // index matches CharRegion enum
    armUpper: string; armLower: string; hand: string;
    torsoUpper: string; torsoLower: string;
    legUpper: string; legLower: string; foot: string;
  };
  helmetGeosetVisId: [number, number]; // [male, female]
}

function getItemDisplay(displayId: number): ItemDisplay | null
```

**Note on the `Texture[]` array ordering** (from `09-equipment-rendering-plan.md`):
- Index 0 = ArmUpper, 1 = ArmLower, 2 = Hand
- Index 3 = TorsoUpper, 4 = TorsoLower
- Index 5 = LegUpper, 6 = LegLower, 7 = Foot

**Note on `ModelName`:** Has `.mdx` extension in the data. Strip it and use `.m2` when looking for the file.

---

### Phase 6 — Geoset Switching for Equipped Items

**Goal:** Extend `resolveDefaultGeosets()` in `src/loadModel.ts` to accept equipment overrides.

**Equipment slot → geoset group mapping:**
| Item slot | Geoset group | Default (naked) meshId | Formula |
|----------|-------------|----------------------|---------|
| Gloves | 4 | 401 | 400 + GeosetGroup[0] + 1 |
| Boots | 5 | 501 | 500 + GeosetGroup[0] + 1 |
| Chest sleeves | 8 | 801 | 800 + GeosetGroup[0] + 1 |
| Robe/kilt | 13 | disabled | 1300 + GeosetGroup[0] + 1 |
| Cape | 15 | 1501 | 1500 + GeosetGroup[0] + 1 |
| Belt buckle | 18 | disabled | 1800 + GeosetGroup[0] + 1 |

**Special case — robes:** If GeosetGroup[1] indicates a robe (group 13 enabled), disable group 11 (trousers) and group 13's default.

**API change:**
```typescript
export async function loadModel(
  modelDir: string,
  options?: {
    enabledGeosets?: Set<number>;
    equipment?: EquipmentGeosetOverride[];  // new
  }
): Promise<THREE.Group>
```

---

### Phase 7 — Weapon Attachment (Runtime)

**Goal:** Load a weapon M2 and attach it to the character's hand bone in Three.js.

**In `src/loadModel.ts`:**
```typescript
// After building skeleton, find attachment point
const att = manifest.attachments?.find(a => a.id === 1); // HandRight
if (att && weaponDisplayId) {
  const bone = skeleton.bones[att.bone];
  const attGroup = new THREE.Group();
  // pos is WoW Z-up; our character pivot rotates X by -π/2 already
  attGroup.position.set(att.pos[0], att.pos[1], att.pos[2]);
  bone.add(attGroup);
  const weaponModel = await loadItemModel(`/items/weapon/${weaponSlug}`);
  attGroup.add(weaponModel);
}
```

**loadItemModel():** Same as `loadModel()` but simpler — single material, no geoset filtering, no skeleton needed (single bone, attach as static THREE.Group).

**Left/right:** HandLeft (ID 2) is Y-positive side. HandRight (ID 1) is Y-negative. Shoulder mirroring: `leftShoulderGroup.scale.x = -1`.

---

### Phase 8 — Helmet Attachment (Runtime)

**Goal:** Load the correct race/gender helmet variant and attach to head bone.

**Slug → suffix map:**
```typescript
const HELM_SUFFIX: Record<string, string> = {
  'human-male': 'HuM',      'human-female': 'HuF',
  'dwarf-male': 'DwM',      'dwarf-female': 'DwF',
  'gnome-male': 'GnM',      'gnome-female': 'GnF',
  'night-elf-male': 'NiM',  'night-elf-female': 'NiF',
  'orc-male': 'OrM',         'orc-female': 'OrF',
  'scourge-male': 'ScM',    'scourge-female': 'ScF',
  'tauren-male': 'TaM',     'tauren-female': 'TaF',
  'troll-male': 'TrM',      'troll-female': 'TrF',
  'blood-elf-male': 'BeM',  'blood-elf-female': 'BeF',
  'goblin-male': 'GoM',     'goblin-female': 'GoF',
};
```

**Helmet path for serving:**
```
/items/head/{baseName}_{suffix}/model.bin
```
Where `baseName` = `ItemDisplayInfo.ModelName[0]` without extension.

**Helmet geoset hiding:** Look up `HelmetGeosetVisID[genderIdx]` in `HelmetGeosetVisData.json`. If hide flags are set, remove those geoset groups from the active set:
- HideHair → remove group 0 meshes
- HideFacialHair1 → remove group 1
- HideEars → remove group 7

---

### Phase 9 — Body Texture Compositing with Equipment

**Goal:** Extend existing `src/charTexture.ts` to composite armor textures over the skin atlas.

**`charTexture.ts` already has:** `composeCharTexture(baseImageData, layers[])` with correct 256×256 region rects.

**New layer type needed:**
```typescript
interface EquipmentLayer {
  texUrl: string;     // e.g. "/item-textures/TorsoUpper/Chest_Plate_RaidWarrior_A_01.tex"
  region: CharRegion;
  compositeOrder: number; // determines draw order (shirt < chest < tabard < legs < boots < gloves)
}
```

**Layer order by slot** (lower number = drawn first = underneath):
| Slot | Order | Regions affected |
|------|-------|-----------------|
| Shirt | 10 | ArmUpper, TorsoUpper, ArmLower |
| Chest | 20 | ArmUpper, TorsoUpper, TorsoLower, ArmLower |
| Tabard | 30 | TorsoUpper, TorsoLower |
| Legs | 40 | LegUpper, LegLower |
| Boots | 50 | LegLower, Foot |
| Bracers | 60 | ArmLower |
| Gloves | 70 | Hand, ArmLower |

---

### Phase 10 — UI: Equipment Picker

**Goal:** Add equipment slot inputs to `src/main.ts`.

**Minimal UI (by display ID):**
```
Race: [Human ▼]  Gender: [Male ▼]

Equipment:
  Weapon (displayId): [_____]  [Load]
  Chest  (displayId): [_____]  [Load]
  Legs   (displayId): [_____]  [Load]
  Helm   (displayId): [_____]  [Load]
```

User enters a displayId, clicks Load. No itemId lookup needed at this stage.

**Future:** Add item name search using an item database JSON (e.g. from `thatsmybis/classic-wow-item-db`).

---

## Sequencing and Dependencies

```
Phase 1 (Extract MPQ)
  └─► Phase 3 (Convert item M2s)
  └─► Phase 4 (Convert item textures)

Phase 2 (Export attachments)
  └─► Phase 7 (Weapon attachment)
  └─► Phase 8 (Helmet attachment)

Phase 5 (ItemDisplayInfo lookup)
  └─► Phase 6 (Geoset switching)   ← no new assets needed
  └─► Phase 9 (Body texture comp)  ← needs Phase 4
  └─► Phase 7 (Weapon)             ← needs Phase 3
  └─► Phase 8 (Helmet)             ← needs Phase 3

Phase 10 (UI) ← needs Phases 5, 6, 7, 8, 9
```

**Recommended order to get something visible fast:**
1. Phase 1 — unlock the data
2. Phase 2 — add attachment points (small script change)
3. Phase 5 — item data lookup (in-memory, fast)
4. Phase 6 — geoset switching (no new files, immediate visual fix)
5. Phase 7 — weapon attachment (most dramatic visual payoff)
6. Phase 3 — item M2 conversion (needed before Phase 7 can serve real weapons)
7. Phase 4 — texture conversion (unlocks all armor appearance)
8. Phase 9 — body texture compositing
9. Phase 8 — helmet (most complex)
10. Phase 10 — UI

---

## Full Coverage Checklist

### Classic WoW Items ✅ achievable with current files
- [x] `model.MPQ` present (368 weapon M2, 980 head M2, 145 shoulder M2)
- [x] `texture.MPQ` present (983 weapon BLP, 8,570 body texture BLP)
- [ ] **Phase 1:** Extract from MPQs into `data/patch/patch/`

### Turtle WoW Custom Items ✅ mostly covered
- [x] patch-3 through patch-9 extracted (3,544+ item files)
- [x] Custom race helms (BeM/BeF: 200+, GoM/GoF: 150+)
- [ ] Verify patch-y is truly empty (or ask user for higher patches if TW updated)

### All 10 Races × 2 Genders ✅ helmet variants present
- [x] 8 classic races: HuM/F, DwM/F, GnM/F, NiM/F, OrM/F, ScM/F, TaM/F, TrM/F
- [x] 2 TW races: BeM/F, GoM/F
- [ ] Case-insensitive path lookup needed (files exist as _HuM.m2, _HuM.M2, _hum.m2 mixed)

### Known Gaps (require live TW client for full coverage)
| Gap | Impact | Fix |
|-----|--------|-----|
| patch-y is empty | Any items added in the latest TW patches won't show | Extract from live TW Data/ directory |
| No itemId→displayId map | Can't look up by item name/ID | Download `thatsmybis/classic-wow-item-db` SQL dump |
| TW-only items with no displayId mapping | ~10% of TW custom items | Scrape database.turtle-wow.org |
| Character skin color variants (races 3-8) | Currently only 1 skin per race/gender | Extract full CharSections BLP set from texture.MPQ |
