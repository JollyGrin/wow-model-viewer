# 03 - Character Rendering Pipeline

## Overview

Rendering a fully equipped WoW character involves three interacting systems:
1. **Geoset visibility** -- showing/hiding submeshes on the character model
2. **Texture compositing** -- layering equipment textures onto the character body
3. **Model attachment** -- mounting separate M2 models (weapons, helms, shoulders) to bone attachment points

---

## Equipment Rendering Categories

### Category 1: Texture-Only Items (No Separate 3D Model)

These items render by applying textures to the character body and optionally toggling geosets:

| Slot | How Rendered |
|------|-------------|
| Chest (non-robe) | Body region textures (TorsoUpper, ArmUpper) + geoset for sleeves |
| Legs | Body region textures (LegUpper, LegLower) |
| Bracers | Body region textures (ArmLower) |
| Shirt | Body region textures (TorsoUpper, ArmUpper, ArmLower) -- lowest layer |
| Gloves | Body region textures (Hand) + geoset for glove geometry |
| Boots | Body region textures (Foot, LegLower) + geoset for boot geometry |
| Belt/Waist | Body region textures (TorsoLower) + optional belt buckle geoset |
| Tabard | Tabard geoset enabled + tabard textures |

### Category 2: Geoset-Switching Items

These toggle submeshes on the character model:

| Item Type | Geoset Group | Effect |
|-----------|-------------|--------|
| Robe-style chest | 13xx | Shows robe mesh, hides normal legs |
| Cape/Cloak | 15xx | Shows cape mesh attached to back |
| Long gloves | 4xx | Shows armored glove mesh |
| Tall boots | 5xx | Shows knee-high boot mesh |
| Belt buckle | 18xx | Shows 3D belt buckle |
| Tabard | 12xx | Shows tabard mesh |

### Category 3: Separate M2 Model Items

These load an entirely separate M2 model and attach it to the character skeleton:

| Slot | Model Location | Attachment Point |
|------|---------------|-----------------|
| Helmet | `Item\ObjectComponents\Head\<Model><RaceGender>.m2` | Bone #11 (Head) |
| Shoulder (R) | `Item\ObjectComponents\Shoulder\<Model>.m2` | Bone #5 (ShoulderRight) |
| Shoulder (L) | Same model, mirrored | Bone #6 (ShoulderLeft) |
| Main Hand Weapon | `Item\ObjectComponents\Weapon\<Model>.m2` | Bone #1 (HandRight) |
| Off Hand/Shield | `Item\ObjectComponents\Weapon\<Model>.m2` | Bone #2 (HandLeft) |
| Shield | `Item\ObjectComponents\Shield\<Model>.m2` | Bone #2 (HandLeft) |

---

## Geoset System

### How It Works

Character models contain ALL possible geometry -- every hair style, facial hair, glove/boot variant, robes, capes, etc. These are organized as submeshes, each with a `meshId` that encodes what body part category and variant it represents.

### meshId Convention

The hundreds digit = group (body part category), ones/tens = variant within group:

| meshId Range | Group | Controls | Default (nothing equipped) |
|-------------|-------|----------|--------------------------|
| 0xx | 0 - Hair | Hair geometry (each style = different geoset) | From character customization |
| 1xx | 1 - Facial hair 1 | Beards, tusks, jaw features | From character customization |
| 2xx | 2 - Facial hair 2 | Additional facial features | From character customization |
| 3xx | 3 - Facial hair 3 | More facial features (race-specific) | From character customization |
| 4xx | 4 - Gloves | 401=bare hands, 402=short gloves, 403=long gloves | 401 (bare hands) |
| 5xx | 5 - Boots | 501=bare feet, 502=short boots, 503=tall boots | 501 (bare feet) |
| 7xx | 7 - Ears | 701=show ears | 701 (ears visible) |
| 8xx | 8 - Sleeves | 801=bare arms, 802=short sleeves | 801 (bare arms) |
| 9xx | 9 - Legs lower | 901=bare legs, 902=armored lower legs | 901 (bare legs) |
| 10xx | 10 - Undershirt | Chest undershirt layer | 1001 |
| 11xx | 11 - Pants upper | Trouser geometry | 1101 |
| 12xx | 12 - Tabard | Tabard overlay mesh | Disabled (no tabard) |
| 13xx | 13 - Robe/Kilt | Full-length robe, replaces leg geometry | Disabled (show legs) |
| 15xx | 15 - Cape | Cloak geometry (various lengths) | Disabled (no cape) |
| 18xx | 18 - Belt buckle | Belt buckle 3D geometry | Disabled |

### How Equipment Changes Geosets

`ItemDisplayInfo.dbc` has `geosetGroup[0,1,2]` fields. When an item is equipped, these values determine which geoset variant to enable.

Formula:
```
enabled_meshId = (groupBase) + geosetGroupValue + 1
```

Example: Gloves with `geosetGroup[0] = 2` enables meshId `403` (group 4 = 400, +2, +1 = 403 = long gloves).

The **equipment slot type** determines which geoset group is affected:
- Glove slot -> modifies group 4 (gloves)
- Boot slot -> modifies group 5 (boots)
- Chest slot -> modifies group 8 (sleeves) and potentially group 13 (robe)

**The same `geosetGroup[0]` value means different things depending on the equipment slot.**

### HelmetGeosetVisData.dbc

Controls what geosets to **hide** when a helmet is equipped:

| Field | Effect |
|-------|--------|
| HideHair | 0=show, 1=hide (group 0) |
| HideFacialHair1 | 0=show, 1=hide (group 1) |
| HideFacialHair2 | 0=show, 1=hide (group 2) |
| HideFacialHair3 | 0=show, 1=hide (group 3) |
| HideEars | 0=show, 1=hide (group 7 -- important for Night Elves, High Elves) |

`ItemDisplayInfo.dbc` has `HelmetGeosetVis_1` (male) and `HelmetGeosetVis_2` (female) referencing this table.

---

## Texture Compositing

### Body Texture Layout

The character body uses a single composited texture, divided into regions:

```
+---------------------------+
| Face/Head region          |  <- CharSections face texture
+---------------------------+
| TorsoUpper | ArmUpper     |  <- Chest armor, shoulders
+---------------------------+
| TorsoLower | ArmLower     |  <- Belt, bracers
+---------------------------+
| LegUpper   | Hand         |  <- Legs, gloves
+---------------------------+
| LegLower   | Foot         |  <- Boots, shin guards
+---------------------------+
```

Base texture is typically **256x256** or **512x512** in vanilla.

### Body Region to ItemDisplayInfo Mapping

| Region Index | Body Part | ItemDisplayInfo Field |
|-------------|-----------|---------------------|
| 0 | ArmUpper | Texture1 |
| 1 | ArmLower | Texture2 |
| 2 | Hand | Texture3 |
| 3 | TorsoUpper | Texture4 |
| 4 | TorsoLower | Texture5 |
| 5 | LegUpper | Texture6 |
| 6 | LegLower | Texture7 |
| 7 | Foot | Texture8 |

### Compositing Process

1. **Start** with base character skin texture (from `CharSections.dbc`, based on race/gender/skin color)
2. **Layer** face texture (from `CharSections.dbc`)
3. **Layer** underwear texture (from `CharSections.dbc`)
4. **For each equipped item** with texture overlays:
   a. Look up `displayId` in `ItemDisplayInfo.dbc`
   b. Read `Texture1`-`Texture8` fields to get body region texture names
   c. Load BLP texture files from `Item\TextureComponents\{Region}\{name}.blp`
   d. **Alpha-blend** each onto the corresponding body region

### Compositing Layer Order (bottom to top)

```
1. Base skin (CharSections.dbc, type=0)
2. Face texture (CharSections.dbc, type=1)
3. Underwear (CharSections.dbc, type=4)
4. Shirt textures (ArmUpper, TorsoUpper, ArmLower)
5. Chest textures (ArmUpper, TorsoUpper, TorsoLower, ArmLower)
6. Tabard textures (TorsoUpper, TorsoLower)
7. Leg textures (LegUpper, LegLower)
8. Boot textures (LegLower, Foot)
9. Bracer textures (ArmLower)
10. Glove textures (Hand, ArmLower)
```

Later items overwrite earlier ones (with alpha blending). For a web implementation, this can be done with Canvas 2D:

```typescript
function compositeBodyTexture(
  baseSkin: HTMLCanvasElement,
  equippedItems: EquipmentTexture[]
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.drawImage(baseSkin, 0, 0);

  for (const item of equippedItems) {
    for (const [region, texture] of Object.entries(item.bodyTextures)) {
      if (texture) {
        const rect = BODY_REGION_RECTS[region];
        ctx.drawImage(texture, rect.x, rect.y, rect.w, rect.h);
      }
    }
  }

  return canvas;
}
```

---

## Equipment Model Attachment

### Finding Model Files

From `ItemDisplayInfo.dbc`:
- `ModelName1` / `ModelName2`: M2 filename (without full path)
- Full path constructed as: `Item\ObjectComponents\{category}\{modelName}`

Categories: `Weapon`, `Shield`, `Head`, `Shoulder`, `Cape`

### Attaching to Character

1. Find the attachment point on character model by ID
2. The attachment's `bone` index determines which skeleton bone drives its transform
3. Apply the attachment's `position` offset relative to that bone
4. Render the equipment model with the bone's current animated world-space transform

Equipment models inherit character bone animation passively -- when the character raises an arm, the weapon moves with it. No special handling needed.

### Shoulder Mirroring

The same shoulder model is loaded twice. The right shoulder uses the model as-is. The left shoulder is **mirrored** by negating the X scale:
```javascript
leftShoulder.scale.x = -rightShoulder.scale.x;
```

### Equipment Model Animations

Equipment can have their own **global sequences** for effects:
- Weapon enchant glows (pulsing light)
- Shoulder pad particle effects (e.g., Tier 2 Judgement shoulders)
- These loop independently of character animation

---

## Full Rendering Order

```
1. EVALUATE SKELETON
   - Sample bone animation tracks at current time
   - Build bone world-space transform matrices (walk hierarchy root->leaf)

2. BUILD COMPOSITED BODY TEXTURE
   a. Base skin (CharSections.dbc)
   b. Face texture overlay
   c. Underwear texture
   d. Equipment textures in layer order (shirt -> chest -> tabard -> legs -> boots -> bracers -> gloves)

3. DETERMINE VISIBLE GEOSETS
   a. Set defaults (bare hands 401, bare feet 501, bare arms 801, bare legs 901)
   b. Apply hair style geoset (from character customization)
   c. Apply facial hair geosets (from character customization)
   d. For each equipped item: read GeosetGroup values from ItemDisplayInfo, enable corresponding variant
   e. If robe: enable robe geoset (13xx), disable normal leg geosets
   f. If cape: enable cape geoset (15xx)
   g. If helmet: apply HelmetGeosetVisData to hide hair/facial hair/ears

4. RENDER CHARACTER BODY
   a. For each visible geoset (submesh):
      - Apply composited body texture (or hair/cape texture for those geosets)
      - Set render flags (blending mode, backface culling)
      - Perform vertex skinning with bone matrices
      - Draw triangles
   b. Order: opaque first, then alpha-tested, then alpha-blended

5. RENDER ATTACHED EQUIPMENT
   a. Helmet: race/gender-specific M2 -> Head attachment point
   b. Shoulders: M2 x2 -> ShoulderRight + ShoulderLeft (mirror left)
   c. Main hand weapon: M2 -> HandRight
   d. Off-hand/shield: M2 -> HandLeft
   e. Each attached model may have its own global sequence animations

6. RENDER EFFECTS (optional, can skip in v1)
   a. Enchant glows (particle emitters)
   b. Weapon trails (ribbon emitters during attack animations)
```

---

## Hardest Parts to Implement

1. **Texture compositing** -- Getting body texture regions to align correctly, handling alpha blending order, different texture sizes per race. The single most complex and error-prone part.

2. **Bone animation interpolation** -- Compressed quaternion format (int16 -> float) has multiple interpretations. Small errors cause visibly broken animations.

3. **Geoset logic** -- Interactions between equipment slots, geoset groups, and ItemDisplayInfo fields are complex. Edge cases: robe + normal legs, tabard layering, etc.

4. **Race-specific helmets** -- Building correct file path with race/gender suffix, handling missing variants.

5. **Render order** -- Body before equipment. Within body: opaque before transparent (hair, capes). Equipment with alpha last.

---

## Race-Specific Gotchas

- **Tauren**: Hooves instead of feet; boot geosets show as leg wraps. Largest model with different proportions. Has tail bones.
- **Troll**: Two-toed feet. Tusks are facial hair geosets. Hunched posture affects shoulder positioning.
- **Undead**: Exposed bones in some skin variants (alpha transparency on body mesh -- need alpha testing). Jaw bones are facial feature geosets.
- **Night Elf / High Elf**: Separate ear geosets that helmets may hide.
- **Gnome**: Smallest race. All equipment scales down significantly.
- **Tauren + Troll**: Ears are separate geosets affected by helmet hiding.
