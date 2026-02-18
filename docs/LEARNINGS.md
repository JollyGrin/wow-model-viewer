# Learnings Journal

## [2026-02-18] M2 Version 256 Header Differences from WotLK

**Context:** Attempting to parse HumanMale.m2 (vanilla 1.12.x, version 256) using `@wowserhq/format`
**Finding:** The `@wowserhq/format` M2 parser targets WotLK (version 264+) and fails on vanilla M2 v256 with "Out of memory" due to two header layout differences:

1. **Extra `playableAnimLookup` M2Array** after `sequenceIdxHashById` — adds 8 bytes to header
2. **`views` is an M2Array (8 bytes)** not `uint32 numSkinProfiles` (4 bytes) — adds 4 bytes

These 12 extra bytes shift all subsequent fields, causing the parser to read garbage offsets.

**Impact:** Cannot use `@wowserhq/format` for M2 parsing. Wrote custom v256 header parser in `scripts/convert-model.ts`.
**Reference:** `scripts/parse-m2-v256.ts`, `node_modules/@wowserhq/format/dist/cjs/model/io/m2.js:158-194`

## [2026-02-18] No External .skin Files in Vanilla M2

**Context:** Plan called for extracting `HumanMale00.skin` from `model.MPQ`
**Finding:** No `.skin` files exist in `model.MPQ`. For vanilla M2 version 256, the view/skin data (indices, submeshes, batches) is **embedded in the M2 file** at offsets pointed to by the `views` M2Array in the header. External `.skin` files with `SKIN` magic were introduced in WotLK/Cata.

**Impact:** No `.skin` extraction step needed. Conversion reads everything from the single `.m2` file.
**Reference:** `model.MPQ` listfile search returned 0 `.skin` entries; `scripts/inspect-mpq.ts`

## [2026-02-18] Vanilla Skin Struct Sizes Differ from Later Versions

**Context:** Parsing embedded view data from M2 v256
**Finding:** The struct sizes for embedded skin data differ from WotLK:

| Struct | Vanilla (v256) | WotLK (v264+) | Missing Fields |
|--------|---------------|---------------|----------------|
| M2SkinSection (submesh) | 32 bytes | 48 bytes | `sortCenterPosition[3]`, `sortRadius` |
| M2Batch | 24 bytes | 26 bytes | Likely 1 uint16 field |

Confirmed by checking offset gaps between submeshes array and batches array: `0x1c40e9 - 0x1c39e9 = 1792 = 56 × 32`.

**Impact:** Must use custom struct sizes when parsing embedded view data.
**Reference:** `scripts/parse-m2-v256.ts` verification

## [2026-02-18] M2 Vertex Normal Offset

**Context:** Extracting vertex normals for rendering
**Finding:** M2 vertex layout (48 bytes): `position(12) + boneWeights(4) + boneIndices(4) + normal(12) + texCoords1(8) + texCoords2(8)`. Normal starts at byte offset **20** (not 28 as some docs suggest). Verified by checking that extracted normals are unit vectors.

**Impact:** Browser vertex buffer uses compact 24-byte stride: `position(12) + normal(12)`.
**Reference:** `scripts/convert-model.ts`

## [2026-02-18] HumanMale Model Statistics

**Context:** Successfully converted HumanMale.m2 to web format
**Finding:**
- **3159 vertices**, **3773 triangles** (highest LOD, View 0)
- **56 geoset groups** (19 of which are empty placeholders with id=65535)
- **4 LOD levels** (views)
- Geoset IDs present: 0 (body), 1-13 (hair/facial variants), 101-102, 201-202, 301-302, 401-404, 501-504, 701-702, 802-803, 902-903, 1002, 1102, 1202, 1301-1302, 1501-1506
- First vertex position: (0.019, -0.175, 1.307) — model centered near origin, Z-up, ~2 units tall
- Binary output: 98,454 bytes (76KB vertices + 22KB indices)

**Impact:** Model is the right size/shape for a character. Z-up to Y-up rotation confirmed necessary.
**Reference:** `scripts/convert-model.ts` output, `public/models/human-male.json`

## [2026-02-18] Geoset System — Body Mesh Has Intentional Holes

**Context:** Rendering HumanMale.m2 untextured with geoset filtering. Multiple iterations showed missing body parts.
**Finding:** The body mesh (geoset 0) has **intentional holes** designed to be filled by equipment geosets. Z-binned triangle analysis reveals:

| Z Range (height) | Body (id=0) | What Fills It |
|-------------------|-------------|---------------|
| 0.00–0.20 | 102 tris (feet) | — |
| 0.20–0.60 | **0 tris** (HOLE) | Boots geoset (501=bare feet, covers Z 0.13–0.61) |
| 0.60–0.70 | **0 tris** (HOLE) | **Nothing bare** — only equipment: kneepads 903, robe 1301, high boots 503/504 |
| 0.70–0.90 | 114 tris (waist/hips) | — |
| 0.90–1.10 | 54 tris (lower torso) | Undershirt 1002 (Z 0.93–1.11), Pants 1102 (Z 0.81–1.11) |
| 1.10–1.30 | 34 tris (sparse upper back) | Sleeves 802/803 cover arms, NOT the back |
| 1.30–1.70 | 178 tris (torso/shoulders) | — |
| 1.70–2.00 | 142 tris (head/face) | Hairstyles (1–13), Facial (101/201/301), Ears (701) |

Key gaps in "naked" configuration:
1. **Knee gap (Z 0.60–0.70)**: No bare geoset exists. Boots 501 stops at Z 0.61, body starts at Z 0.70. The game hides this with shared boundary vertices + skin texture continuity.
2. **Scalp**: Body has only 20 tris at Z 1.90–2.00. Hairstyle geoset 1 (44 tris, Z 1.90–2.02) provides the bald scalp cap. Geoset 0 is the body, NOT "bald hairstyle."
3. **Upper back (Z 1.10–1.30)**: Only 34 sparse body tris. No bare geoset fills it. Hidden by textures in-game.
4. **"Skirt" appearance**: Body waist ring (Z 0.70–0.90) + pants 1102 hip band (Z 0.81–1.11) appear as a floating skirt when rendered without textures, because the thigh area has no connecting geometry.

**Impact:** For untextured rendering, the "naked" character will always have visible seams at knees and sparse back. Bridging the knee gap requires adding kneepads (903, Z 0.49–0.73, 32 tris). The bald scalp requires hairstyle 1 (id=1), NOT relying on body (id=0) alone.

Default geosets for minimal naked character:
```
0     — body mesh (torso, waist, head, feet)
1     — bald scalp cap
101   — facial 1 (jaw/beard default)
201   — facial 2 (sideburns default)
301   — facial 3 (moustache default)
401   — bare hands
501   — bare feet / lower legs
701   — ears
903   — kneepads var 3 (bridges knee gap, Z 0.49–0.73)
1002  — undershirt (fills upper back/chest gap, Z 0.93–1.11)
1102  — underwear (fills hip band, Z 0.81–1.11)
```

**Reference:** `scripts/diagnose-geosets.ts`, `scripts/analyze-geosets.ts`

## [2026-02-18] UV Coordinates in M2 Vertex Format

**Context:** Adding texture mapping to the human male model
**Finding:** M2 vertex format (48 bytes) includes UV coordinates at offset 32:
- Position: 3 floats (12B) at offset 0
- BoneWeights: 4 uint8 (4B) at offset 12
- BoneIndices: 4 uint8 (4B) at offset 16
- Normal: 3 floats (12B) at offset 20
- UV1: 2 floats (8B) at offset 32
- UV2: 2 floats (8B) at offset 40

UV values are in [0,1] range and map correctly to a 256×256 texture atlas. Updated browser vertex stride from 24→32 bytes (pos3 + normal3 + uv2 = 8 floats).

**Impact:** UVs enable texture mapping on the model.
**Reference:** `scripts/convert-model.ts`, M2 vertex format spec

## [2026-02-18] BLP ABGR8888 Format Byte Order

**Context:** Converting BLP textures using @wowserhq/format
**Finding:** `BLP_IMAGE_FORMAT.IMAGE_ABGR8888` describes the 32-bit integer layout (A=MSB bits 31-24, B=23-16, G=15-8, R=LSB bits 7-0). In memory on little-endian systems (JS typed arrays), the byte order is **R, G, B, A** — already RGBA. No swizzle needed.

Initial attempt swizzled bytes as A,B,G,R → R,G,B,A which reversed channels and made the model appear too red/pink. Removing the swizzle produced correct colors.

**Impact:** BLP conversion is a simple memcpy — no per-pixel processing required.
**Reference:** `scripts/convert-textures.ts`

## [2026-02-18] Character Model Faces +X Direction

**Context:** Setting up camera for front/back views
**Finding:** The HumanMale model faces +X in WoW coordinates (not +Y as commonly assumed). After the Z-up to Y-up rotation (`mesh.rotation.x = -Math.PI / 2`), the model faces +X in Three.js space.

- Front view camera: position (3, 1, 0) looking at (0, 0.9, 0)
- Back view camera: position (-3, 1, 0) looking at (0, 0.9, 0)

Model bounding box (WoW coords): X [-0.49, 0.49], Y [-0.62, 0.62], Z [0, 2.03]

**Impact:** Camera setup for viewer and e2e tests.
**Reference:** `src/main.ts`, e2e screenshots

## [2026-02-18] M2 Texture Types — Character Skin is Runtime-Composited

**Context:** Parsing M2 texture entries for the human male model
**Finding:** The M2 file has 3 texture slots, all runtime-resolved (no hardcoded filenames):
- Texture 0: type=1 (Character Skin) — body base from CharSections.dbc
- Texture 1: type=6 (Character Hair) — hair from CharSections.dbc
- Texture 2: type=2 (Cape) — from equipment data

The standard WoW character skin is a COMPOSITE of multiple layers:
- BaseSection 0: Body skin base (e.g., `HumanMaleSkin00_00.blp`)
- BaseSection 1: Face (lower + upper textures overlaid on face region)
- BaseSection 4: Underwear (overlaid on pelvis region)

These are composited into a single 256×256 atlas at runtime. Our patch data only has custom Turtle WoW skins (101, 102, etc.), not the standard vanilla base skins (00-09) which are in unextracted base MPQs.

**Impact:** Cannot render standard vanilla skin without base MPQ extraction. Custom Turtle WoW skins work as standalone body textures. "HumanMale_Magic.blp" has the closest golden/warm tone to standard human skin.
**Reference:** `data/dbc/CharSections.json`, M2 texture entries at header offset 92

## [2026-02-18] Geoset "Skirt" Effect — Geometry vs Texture Problem

**Context:** Rendering the naked human male with geosets 1002 (undershirt) and 1102 (pants) active
**Finding:** The underwear/undershirt geosets are floating geometry bands that visually stick out from the body mesh, creating a "skirt" appearance. This is NOT a rendering bug — it's the actual geometry.

In the WoW client, this is invisible because:
1. The composite skin texture paints matching skin color across body→geoset boundaries
2. The underwear region has specific painted underwear detail that blends with the surrounding geoset geometry
3. Without these geosets, the body has large holes at hips (Z 0.70-1.10) and knees (Z 0.49-0.73)

Removing 1002/1102/903 eliminates the skirt but creates massive hip/thigh holes. The geosets are required.

**Impact:** The skirt effect cannot be fixed by geoset selection or render settings. It requires proper skin texture compositing from base MPQ textures. This is acceptable for now.
**Reference:** e2e test screenshots, geoset spatial analysis

## [2026-02-18] M2 Triangle Winding — Already CCW Compatible with Three.js

**Context:** Tried reversing M2 triangle winding (clockwise → counter-clockwise) for proper FrontSide culling
**Finding:** Despite M2 docs stating clockwise winding, the actual triangle data from HumanMale.m2 is already counter-clockwise when viewed from the model exterior. Reversing winding caused FrontSide rendering to show the INSIDE of the model instead of the outside.

However, the model has inconsistent winding — some upper back triangles appear backfacing from certain angles. This is why DoubleSide is required; FrontSide creates holes in the upper back.

**Impact:** Must use DoubleSide rendering. Do NOT reverse triangle winding.
**Reference:** FrontSide vs DoubleSide comparison screenshots

## [2026-02-18] Material Choice — MeshLambertMaterial Best for WoW Models

**Context:** Comparing MeshBasicMaterial, MeshLambertMaterial, and MeshStandardMaterial
**Finding:**
- **MeshBasicMaterial**: Unlit, no muscle definition visible. Hides geometry issues but looks flat.
- **MeshStandardMaterial**: PBR rendering creates harsh shadows that emphasize geometry seams and the skirt effect.
- **MeshLambertMaterial**: Simple diffuse shading closest to WoW's own rendering. Shows muscle definition through normals without harsh PBR artifacts.

Best lighting setup: High ambient (0.8) + front directional (0.5 from character face direction) + fill light (0.3 from behind).

**Impact:** Use MeshLambertMaterial + DoubleSide for all character rendering.
**Reference:** `src/loadModel.ts`, `src/main.ts` lighting setup

## [2026-02-18] Clothing Geoset "Skirt" Fix — Centroid Shrink with Radius Clamping

**Context:** Geosets 1002 (undershirt) and 1102 (pants) create floating band geometry that looks like a skirt. Tried multiple vertex manipulation approaches to make them hug the body.

**Finding:** Four approaches tested:
1. **Nearest-body-vertex lerp (LERP=0.85)** — Original approach. Clothing vertices lerped toward nearest body vertex. V-shaped skirt flaps remained because lerp doesn't account for directionality.
2. **Centroid shrink (SHRINK=0.92)** — Shrink XY toward body centroid at each height. Eliminated skirt but inner-thigh vertices collapsed past each other, creating dark gaps between legs.
3. **Selective nearest-vertex lerp (only protruding vertices)** — Only moved vertices beyond 95% of body max radius. Partially reduced skirt but left rectangular band protruding at sides.
4. **Centroid shrink with radius clamping (SHRINK=0.55, minR=bodyMinR*0.85)** — Best result. Moderate shrink toward centroid with a minimum radius floor prevents inner geometry collapse. Band is tight-fitting like shorts instead of floating skirt.

None of these approaches fully eliminate the band — the remaining visibility is because:
- The clothing geometry is designed to be painted with matching skin texture via runtime compositing
- Without proper underwear texture compositing, the shading difference at geoset boundaries creates visible edges
- The body mesh has intentional holes that REQUIRE these geosets, so they can't be removed

**Impact:** Approach #4 (centroid shrink + radius clamp) is the best achievable result without texture compositing. The "skirt" is reduced to a tight band that reads as shorts/underwear.
**Reference:** `src/loadModel.ts` lines 125-190, comparison screenshots

## [2026-02-18] Skin Texture Comparison — All Available BLPs

**Context:** Comparing all available HumanMale BLP skins to find best match for the reference screenshots (warm peach/tan with golden shorts).

**Finding:** Tested 4 candidate skins:

| BLP File | Tone | Underwear | Pixel Sample (RGBA) | Match Quality |
|----------|------|-----------|---------------------|---------------|
| `HumanMale_Magic.blp` (patch-3) | Warm golden/peach | Dark (matches skin) | R=137 G=116 B=93 | **Best** — closest warm tone |
| `HumanMale_Pirate.blp` (patch-3) | Warm tan/brown + tattoos | Very dark/black | R=127 G=98 B=75 | Too brown, has forearm tattoos |
| `HumanMaleSkin00_101.blp` (patch-8) | Pale/cool gray-pink | Purple | R=57 G=47 B=70 | Too pale, purple underwear |
| `HumanMaleSkin00_102.blp` (patch-3) | Gray/marble/stone | Dark | R=128 G=130 B=131 | Way too gray |

Skipped `103NecroBlue`, `104WizardFel`, `105WizardArcane` — names indicate fantasy colors (blue/green/arcane) incompatible with reference's natural skin tone.

The reference's golden shorts are composited from base CharSections skin + underwear overlay in the WoW client. None of our available BLPs include painted underwear that matches the reference — they're either custom Turtle WoW skins (Magic/Pirate) or numbered skin variants with their own underwear colors.

**Impact:** Keep HumanMale_Magic.blp as the skin texture. Matching the reference's golden shorts would require base MPQ extraction + runtime skin compositing, which is out of scope.
**Reference:** `scripts/convert-textures.ts`, e2e comparison screenshots

## [2026-02-18] Sleeve Geosets 802/803 Are Not Suitable for Filling Back Gaps

**Context:** Investigating whether geosets 802 (24 tris) and 803 (72 tris) from group 8 (sleeves) could fill the sparse upper back area at Z 1.00-1.25.

**Finding:** Both geosets add visible sleeve flap geometry that extends beyond the body silhouette:

| Geoset | Tris | Max |Y| (lateral) | Body Max |Y| at same Z | Visual Result |
|--------|------|-------------------|------------------------|---------------|
| 802 | 24 | 0.619 | 0.535 | Small flared sleeves at elbows |
| 803 | 72 | 0.569 | 0.535 | Larger sleeve tubes on forearms |

Both geosets are mostly back-facing (802: 24/28 verts on back, 803: 44/56), which explains why they were candidates — they DO cover the back shoulder region. However, they also extend outward past the arm boundary, creating visible sleeve flaps in both front and back views.

The body mesh (geoset 0) has sparse but present coverage in the upper back:
- Z [1.00, 1.30]: 2-3 back-facing triangles per 0.05 Z-bin
- No actual see-through holes — just low-poly flat shading
- The "gap" appearance is a shading artifact from sparse geometry, not missing faces

The reference screenshot looks smooth because the WoW client has full composited skin texture that visually fills the sparse polygon area with painted muscle detail.

**Impact:** Do not add geosets 802 or 803 to the naked character. The upper back sparseness is acceptable and cannot be fixed with geoset selection — it requires higher-quality texture compositing.
**Reference:** `src/loadModel.ts`, geoset spatial analysis, comparison screenshots

## [2026-02-18] Hair Geoset and Texture Mapping

**Context:** Adding hair to the human male model. Needed to determine which geoset ID corresponds to which hairstyle, and which texture to use.

**Finding:** M2 batch data reveals texture-to-submesh mappings via `texLookup`:
- texLookup=0 → skin texture (M2 texture type 1, CharacterSkin)
- texLookup=1 → hair texture (M2 texture type 6, CharacterHair)
- texLookup=2 → cape texture (M2 texture type 2, Cape)

All hairstyle geosets (IDs 2-13) use texLookup=1 (hair texture). Geoset 1 (bald cap) uses texLookup=0 (skin texture), which makes sense — the bald cap shows scalp skin.

Hair texture naming: `Hair04_NN.blp` where `04` is the hairstyle index and `NN` (00-09) is the color variant. Hairstyle index 4 maps to geoset ID 5 (geoset = hairstyleIndex + 1, since geoset 1 = bald). The only hair textures available in our patch data are `Hair04_00` through `Hair04_09` (style 4 = long hair with braids). Color 07 gives a dark brown that matches the reference.

Geoset 5 (hairstyle 4) has 148 triangles across 2 submeshes (348 + 96 indices). The geometry shows long braids flowing from the head — matching the reference's hairstyle.

**Impact:** Hair rendering requires a separate material with the hair texture, applied only to hair geosets (2-13). The model loader now creates three mesh layers: clothing (shrunk, FrontSide), body (polygonOffset, DoubleSide), and hair (DoubleSide with hair texture).
**Reference:** `src/loadModel.ts`, `scripts/convert-textures.ts`, M2 batch parsing

## [2026-02-18] Lighting Tuning — Lower Ambient for Muscle Definition

**Context:** Comparing rendered output to reference screenshots. The reference shows clear muscle shadow contrast (abs, pecs, biceps) while our render looked washed out/flat.

**Finding:** The original lighting (ambient 0.8 + directional 0.5 + fill 0.3) had too much ambient light, which floods shadow areas and reduces contrast. Lowering ambient to 0.55 and increasing the front directional to 0.75 produced significantly better muscle definition. Adding warm tints (0xfff5e6 ambient, 0xfff0dd front, 0xffe8d0 fill) better matches the reference's golden skin tone.

| Light | Before | After |
|-------|--------|-------|
| Ambient | 0xffffff @ 0.8 | 0xfff5e6 @ 0.55 |
| Front directional | 0xffffff @ 0.5 | 0xfff0dd @ 0.75 |
| Fill directional | 0xffffff @ 0.3 | 0xffe8d0 @ 0.35 |

The key insight: for low-poly models where muscle definition comes from vertex normals, directional light creates the shadows that reveal surface detail. Ambient light fills those shadows and flattens the appearance.

**Impact:** Muscle grooves (abs, pecs, biceps, shoulder blades) are now clearly visible. Warm tint brings skin closer to reference tone.
**Reference:** `src/main.ts` lines 22-32, comparison screenshots

## [2026-02-19] Upper leg fix: Normal-based vertex snapping eliminates waist skirt

**Context:** Fixing the upper leg area — 55% radial shrink created massive black gaps, removing shrink created a visible waist "skirt" where clothing geosets (1102, 1002) extended beyond the body silhouette.
**Finding:** Multiple approaches failed:
1. Uniform shrink (0.10) — skirt still visible, barely affected
2. Boundary clamp (snap vertices beyond body maxR) — skirt unaffected because at waist height, body maxR (torso width) is larger than clothing radius
3. Face-level culling with scalar maxR — damaged kneepads (903) without fixing waist
4. Face-level culling with directional maxR (12 angular sectors) — more kneepad damage, skirt still unaffected
5. **Normal-based vertex snapping (SUCCESS):** For each clothing vertex, find nearest body vertex. Compute dot product of displacement (body→clothing) with body vertex normal. If positive (clothing is outside body surface), snap clothing vertex to the body position. If zero/negative (clothing is inside body volume, i.e., filling a hole), leave it alone.

The key insight: the skirt isn't about radial distance from centroid or even directional radius. It's about clothing vertices being on the OUTSIDE of the body surface at boundary edges. Body normals point outward, so the dot product test correctly distinguishes "outside body surface" (skirt flap → snap) from "inside body hole" (gap filler → keep).

**Impact:** Waist skirt eliminated. Black gaps from 0.55 shrink already eliminated by removing shrink. Some minor triangle artifacts remain at hip sides and knees where snapping distorts individual triangles, but overall appearance is dramatically improved.
**Reference:** `src/loadModel.ts` vertex snapping loop, `screenshots/human-male-legs-test.png`
