# Equipment MVP Plan

> Reference: [`docs/EQUIPMENT-PLAN.md`](./EQUIPMENT-PLAN.md) for full-phase detail
> Reference: [`docs/research/09-equipment-rendering-plan.md`](./research/09-equipment-rendering-plan.md) for technical findings

---

## Should We Do One Item First, or Everything at Once?

**Single item first. Definitively.**

The pipeline code is identical for one item vs. ten thousand. The conversion loop is just a loop — removing the filter to go from one to all is trivial. But the bugs you'll hit (wrong attachment offsets, incorrect coordinate transforms, texture regions misaligned on specific races, BLP decode errors) are all caught and fixed on item 1. Debugging attachment position on Thunderfury with 14,600 other items loaded is far worse than debugging it with one sword.

There is no extra work. There is only finding the right sequence.

### The staged payoff

Each milestone has a clear visual pass/fail. Every step builds directly on the last.

```
Milestone 1: Sword on Human Male   ← prove the attachment pipeline works at all
Milestone 2: Sword on all 20 races ← prove attachment data is correct per-race
Milestone 3: Chest on Human Male   ← prove texture compositing works
Milestone 4: Chest on all 20 races ← prove compositing is race-neutral
Milestone 5: Bulk everything       ← same code, remove the item filter
```

Bugs found in milestone 1–2 are easy to diagnose (one model, one item, clear before/after). The same bug found in milestone 5 with hundreds of items is much harder.

---

## Target Items for MVP

These are confirmed to exist in `data/model/model.MPQ` and `data/model/texture.MPQ`.

### Weapon — displayId 1956
- M2: `Item/ObjectComponents/Weapon/Sword_2H_Claymore_B_02.m2`
- Texture: `Item/ObjectComponents/Weapon/Sword_2H_Claymore_B_02Green.blp`
- No body textures, no geoset changes — pure attachment test
- Shows as a large two-handed sword held in right hand

### Chest — displayId 3413
- No M2 (texture-only armor)
- `Texture[0]` ArmUpper: `Plate_A_01Silver_Sleeve_AU`
- `Texture[3]` TorsoUpper: `Plate_A_01Silver_Chest_TU`
- `Texture[4]` TorsoLower: `Plate_A_01Silver_Chest_TL`
- `GeosetGroup[0]`: 1 → enables geoset 802 (short sleeves)
- Tests texture compositing across 3 body regions + geoset switching

---

## Milestone 1 — Sword on Human Male

**What gets built:**
- Extraction script pulls 2 files from `model.MPQ` + `texture.MPQ` → `data/extracted/`
- `convert-model.ts` updated to parse and export attachment points
- Item M2 converter (new script) converts the sword to `public/items/weapon/sword-2h-claymore-b-02/`
- `loadModel.ts` loads the weapon and attaches it to the HandRight bone

**Steps:**

1. **Extend `extract-from-mpq.ts`**: add targeted extraction of the two sword files
   ```
   Item\ObjectComponents\Weapon\Sword_2H_Claymore_B_02.m2     → model.MPQ
   Item\ObjectComponents\Weapon\Sword_2H_Claymore_B_02Green.blp → texture.MPQ
   ```
   Output: `data/extracted/Item/ObjectComponents/Weapon/`

2. **Fix `convert-model.ts`**: parse M2 attachment M2Array at header offset 252 (48-byte structs), add to manifest:
   ```json
   "attachments": [
     { "id": 1, "bone": 125, "pos": [-0.059, -0.476, 0.904] },
     { "id": 2, "bone": 126, "pos": [-0.059,  0.471, 0.904] },
     ...
   ]
   ```
   Re-run `bun run convert-model` → regenerates all 20 `model.json` files.

3. **Write `scripts/convert-item.ts`** (new): takes a single M2 path + texture path, outputs to `public/items/`:
   - Same vertex extraction logic as `convert-model.ts`
   - No geoset filtering (include all submeshes)
   - Relax version check to `256–264` (item M2s may vary slightly)
   - Convert the BLP texture to `.tex`
   - Write `model.bin` + `model.json` + `textures/main.tex`

4. **Update `loadModel.ts`**: after building the character skeleton, check for weapon attachment:
   ```typescript
   const att = manifest.attachments?.find(a => a.id === 1);
   if (att && options?.weapon) {
     const bone = skeleton.bones[att.bone];
     const socket = new THREE.Group();
     socket.position.set(att.pos[0], att.pos[1], att.pos[2]);
     bone.add(socket);
     const weapon = await loadItemModel(options.weapon);
     socket.add(weapon);
   }
   ```

**Pass criteria:** Sword appears in the human male's right hand at roughly the correct position. It can be slightly off in angle/position at this point — that's expected and fixable.

---

## Milestone 2 — Sword on All 20 Races

**What gets built:** Nothing new. Just run the existing viewer, switch race/gender dropdown, observe.

**This is the critical cross-race test.** Common failure modes caught here:

| Symptom | Likely cause |
|---------|-------------|
| Sword at wrong position on specific race | Attachment bone index differs across races |
| Sword floating or buried on some races | Pivot/position offset incorrect |
| Sword missing on some races | Attachment ID not found in that model's attachment table |
| Sword correct on 8 classic races, wrong on Blood Elf/Goblin | Attachment parsing bug with v256-extra header |

**Attachment bone indices will differ per race** — Human Male bone 125 is HandRight, but Tauren Male's HandRight is a different bone index. The converter extracts the correct bone index per model since it reads directly from each M2's attachment table.

**Pass criteria:** Sword positioned consistently in the right hand across all 20 models. Minor orientation differences are acceptable (some races hold weapons at slightly different angles — that's authentic WoW behavior).

---

## Milestone 3 — Chest Armor on Human Male

**What gets built:**
- Extraction of 3 BLPs from `texture.MPQ` → `data/extracted/`
- Item texture conversion script converts BLPs to `.tex`
- `charTexture.ts` extended to accept equipment layers
- Geoset switching: enable geoset 802 (short sleeves) instead of 801 (bare arms)

**Steps:**

1. **Extend `extract-from-mpq.ts`**: add the 3 chest BLPs:
   ```
   Item\TextureComponents\ArmUpperTexture\Plate_A_01Silver_Sleeve_AU.blp
   Item\TextureComponents\TorsoUpperTexture\Plate_A_01Silver_Chest_TU.blp
   Item\TextureComponents\TorsoLowerTexture\Plate_A_01Silver_Chest_TL.blp
   ```
   Output: `data/extracted/Item/TextureComponents/{Region}/`

2. **Write `scripts/convert-item-textures.ts`** (new): converts BLPs to `.tex`, output to `public/item-textures/{Region}/`

3. **Update `charTexture.ts`**: add equipment overlay support to `composeCharTexture()`:
   ```typescript
   interface EquipmentLayer {
     texUrl: string;
     region: CharRegion;
     order: number;  // compositing order (shirt < chest < legs < gloves)
   }
   ```
   Layer order from `09-equipment-rendering-plan.md`: shirt(10) < chest(20) < tabard(30) < legs(40) < boots(50) < bracers(60) < gloves(70)

4. **Update geoset selection in `loadModel.ts`**: add per-group override:
   ```typescript
   // GeosetGroup[0]=1 on a chest → group 8 → meshId 802
   const overrides = new Map([[8, 802]]); // group → meshId
   ```
   Pass into `resolveDefaultGeosets()`.

5. **Wire it up in `main.ts`**: hardcode displayId 3413 for now, load item display info, call `loadModel` with equipment options.

**Pass criteria:** Human male shows silver plate chest texture on torso/arms instead of bare skin. Short sleeve geometry (geoset 802) visible instead of bare arms (801). No visible seams at region boundaries.

**Common failures at this stage:**
- Region UV mapping off → texture appears stretched or misplaced
- Wrong region rect coordinates → texture bleeds into adjacent body parts
- BLP decode producing wrong color space → tinted or washed out armor

---

## Milestone 4 — Chest on All 20 Races

**What gets built:** Texture lookup needs to handle race/gender variants.

Many armor body textures exist in multiple variants:
```
Plate_A_01Silver_Chest_TU_M.blp  ← male version
Plate_A_01Silver_Chest_TU_F.blp  ← female version
Plate_A_01Silver_Chest_TU_U.blp  ← unisex (used when no gender variant)
```

ItemDisplayInfo stores only the base name (`Plate_A_01Silver_Chest_TU`). The fallback lookup order is:
```
1. {name}_{Gender}.blp   e.g. _M or _F
2. {name}_U.blp          universal
3. {name}.blp            no suffix
```

**Steps:**

1. Add gender-aware texture resolution to the item texture lookup:
   ```typescript
   function resolveItemTexturePath(baseName: string, gender: 'M' | 'F'): string {
     for (const suffix of [gender, 'U', '']) {
       const name = suffix ? `${baseName}_${suffix}.tex` : `${baseName}.tex`;
       if (exists(`/item-textures/{Region}/${name}`)) return name;
     }
   }
   ```

2. Switch race/gender dropdown and observe. No BLP re-extraction needed — the files are already in place.

**Pass criteria:** All 20 races show armor correctly. Female characters use `_F` textures, male use `_M`, with `_U` as fallback. Gnome and Tauren may look slightly odd at extreme proportions — that's expected and authentic.

---

## Milestone 5 — Bulk Extraction and Conversion

Once milestones 1–4 pass, scale up by removing the item filter from each script.

**Bulk extraction:** Change `extract-from-mpq.ts` from targeted file lists to pattern-based:
```typescript
// Instead of listing specific files:
const WEAPON_PATTERNS = ['Item\\ObjectComponents\\Weapon\\*.m2'];
const TEXTURE_PATTERNS = ['Item\\TextureComponents\\*\\*.blp', ...];
// Extract all matches from both MPQs
```
~14,600 files total. Estimated time: 5–10 minutes on first run.

**Bulk item conversion:** Loop `convert-item.ts` over all M2s found in:
- `data/extracted/Item/ObjectComponents/Weapon/`
- `data/patch/patch-*/Item/ObjectComponents/Weapon/` (patch overrides, highest patch wins)

**Bulk texture conversion:** Loop `convert-item-textures.ts` over all BLPs in all `TextureComponents` directories.

**ItemDisplayInfo lookup:** Enable the full JSON lookup in `src/itemData.ts` — no change to logic, just stop hardcoding displayId 3413.

**Pass criteria:** Can type any displayId into the UI and have it load. Spot-check 5–10 known items from different slots and categories.

---

## What is NOT in the MVP

Deliberately deferred. These are not needed to prove the pipeline:

| Feature | Why deferred |
|---------|-------------|
| Helmets | Most complex (race-specific M2 variants, HelmetGeosetVisID hide logic) — add after weapons + armor work |
| Shoulders | Same attachment mechanism as weapons, trivial to add after Milestone 2 |
| Left-hand weapon / shield | Same attachment mechanism, add after right hand works |
| Capes | Geoset 15xx already handled in current code, just need cape texture |
| Item name search | Needs itemId→displayId SQL mapping, add later |
| Skin color variety | Currently 1 skin per race, full CharSections BLP extraction adds the rest |
| Animations | T-pose is fine for equipment testing |

---

## File Changes per Milestone

| Milestone | New scripts | Modified files | New public assets |
|-----------|------------|---------------|------------------|
| 1 (sword) | `convert-item.ts` | `extract-from-mpq.ts`, `convert-model.ts`, `loadModel.ts` | `public/items/weapon/sword-2h-claymore-b-02/` |
| 2 (cross-race) | — | — | — |
| 3 (chest) | `convert-item-textures.ts` | `extract-from-mpq.ts`, `charTexture.ts`, `loadModel.ts`, `main.ts` | `public/item-textures/*/Plate_A_01Silver_*.tex` |
| 4 (cross-race) | — | `loadModel.ts` (gender lookup) | — |
| 5 (bulk) | — | `extract-from-mpq.ts`, `convert-item.ts`, `convert-item-textures.ts` (loop) | Everything |

---

## Quick Reference: Test Displayids

| DisplayId | Item type | What it tests |
|-----------|----------|--------------|
| **1956** | 2H sword (Claymore) | Weapon attachment, HandRight bone |
| **3413** | Plate chest | Body texture (3 regions), geoset 802 |
| **222** | Boots | Body texture (Foot region only), geoset 502 |
| **453** | 1H axe | Weapon attachment, different M2 |
| **563** | 2H claymore A | Different weapon model, same category |
