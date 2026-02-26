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

## [2026-02-19] WoW Does NO Vertex Manipulation — Correct Geoset Defaults Fix Legs

**Context:** After multiple iterations of vertex snapping, clamping, angular projection, and stretch culling — all creating hip wings, crotch gaps, or shelf artifacts — researched how the actual WoW client and open-source viewers (WoWModelViewer, wowserhq/scene, zamimg/Wowhead) handle character geosets.

**Finding:** WoW's rendering engine does ZERO vertex manipulation at runtime. No snapping, no shrinking, no clamping. The system works purely through:
1. Geoset visibility toggling (show/hide submeshes)
2. Standard depth testing (resolves overlaps naturally)
3. Shared boundary vertices (stitched mesh — geosets share exact vertex positions at boundaries)
4. Texture compositing (skin-colored paint across boundaries hides seams)

Our vertex snapping was **causing** the problems, not fixing them. The snapping distorted triangles at boundaries, creating wings and gaps.

The critical formula for default geosets: `enabled_meshId = groupBase + geosetGroupValue + 1`, with `geosetGroupValue=1` for all groups by default (from GeosRenderPrep).

| Group | Wrong Default | Correct Default | Difference |
|-------|---------------|-----------------|------------|
| 5 (boots) | 501 (86 tris) | 502 (142 tris) | Nearly double the leg geometry |
| 9 (kneepads) | 903 (Z 0.49-0.73) | 902 (Z 0.34-0.61) | Much more thigh coverage |

Using 902+903 together bridges the full gap from Z 0.34 to Z 0.73.

Geoset 1102 (default pants) was analyzed in detail: ALL 24 triangles are outward-facing flare geometry. It has 8 boundary vertices shared with body at Z~1.09, and 16 extra vertices flaring outward at Z~0.83. No amount of vertex manipulation can make it hug the body because it has no fill geometry — only flare. Removing it entirely and relying on 502+902+903 for leg coverage produces the cleanest result.

**Impact:** Stripped ALL vertex manipulation code (~100 lines). Final geoset selection: 0, 5, 101, 201, 301, 401, 502, 701, 902, 903, 1002. No 1102. Code reduced to ~210 lines. Clean rendering with no wings, no skirt, no crotch gap. Upper thigh gap remains but is a model design limitation (filled by texture compositing in WoW).
**Reference:** `src/loadModel.ts`, WoW GeosRenderPrep formula, `screenshots/human-male-legs-test.png`

## [2026-02-21] Thigh Bridge Geometry — Filling the Body Mesh's Thigh Gap

**Context:** Geosets 502 (boots), 902/903 (kneepads) made the naked character look like it was wearing armor. Switching to 501 (bare feet) and removing equipment geosets left a massive thigh gap between body waist (Z 0.72) and bare feet top (Z 0.61).

**Finding:** The body mesh has ZERO vertices from Z 0.20 to Z 0.70 — the entire thigh region is empty by design. WoW fills this with equipment geosets + texture compositing. For a naked character, only geoset 501 (bare feet, Z 0.13–0.61) provides lower leg geometry. The gap is 0.11 units vertically but also requires massive lateral expansion: legs are at |Y| ~0.17 while the body waist is at |Y| ~0.49.

**Solution:** Generated thigh bridge geometry (same approach as neck patch):
- 6 vertices per ring, 5 rings per leg (ease-out interpolation for natural taper)
- Bottom ring: exact 501 top boundary positions (6 unique vertices per leg)
- Top ring: outer vertices at Z=0.80, |Y|~0.48 (inside body mesh hip ring); inner vertices at Z=0.84 (fills pelvis shadow zone)
- Crotch bridge: 4 triangles connecting left and right inner thigh top vertices
- Total: 60 vertices, 52 triangles per leg pair
- Uses computeVertexNormals() for smooth shading

**Key dimensions from boundary analysis:**
- 501 top boundary: 14 vertices (7 per leg), Z 0.549–0.614, centered at Y ≈ ±0.172
- Body waist boundary: 94 vertices at Z 0.70–0.85, all at |Y| ≈ 0.48–0.55
- No shared vertices between body(0) and 501 — separate meshes

**Impact:** Final geoset selection: 0, 5, 101, 201, 301, 401, 501, 701, 1002. No boots (502), no kneepads (902/903). Character looks like a naked human with natural bare legs. Thin dark line remains at outer hips where body mesh bottom edge creates a shadow — requires texture compositing to fully eliminate.
**Reference:** `src/loadModel.ts` thigh bridge section, `scripts/analyze-thigh-gap.ts` (boundary analysis)

## [2026-02-21] WoW Thigh Gap: How Other Solutions Handle It

**Context:** Investigating why our thigh bridge still looks "wonky" — visible hip shelf line and flat/angular thigh geometry.
**Finding:** Research across WoWModelViewer source, wowserhq/scene, and wowdev.wiki reveals:

1. **WoWModelViewer** defaults ALL geoset groups to value 1. For group 5 (boots), value 1 = geoset 501 (bare feet). For group 11 (pants), value 1 = geoset 1101 — which **does not exist** in vanilla models. So: no pants geometry is shown for naked characters.

2. **Underwear is PURELY textural**, not geometric. WoWModelViewer composites CharSections.dbc type=4 textures (PelvisTexture, TorsoTexture) onto the body texture atlas. No underwear geoset exists.

3. **wowserhq/scene** renders ALL submeshes unconditionally — no geoset selection logic at all. It doesn't even preserve geoset IDs.

4. **Geoset 1101 does NOT exist** in vanilla Human Male model, matching the same pattern as 801, 901, 1001. Only the x02+ variants exist (armor pieces). The wowdev.wiki description of group 11 value 1 as "regular" is for post-WoD HD models.

5. **Body mesh waist boundary analysis**: The bottom edge forms TWO concentric rings:
   - **Inner ring**: |Y| ~0.48-0.51, Z ~0.72-0.78 (the actual bottom edge)
   - **Outer ring**: |Y| ~0.54-0.55, Z ~0.80-0.84 (hip flare/lip)
   - Triangles between these rings form a visible downward-facing "skirt lip"
   - Our bridge top ring at |Y| ~0.46-0.48 is NARROWER than the body hip, creating a visible narrowing step

**Impact:** The hip shelf is caused by two problems: (1) bridge too narrow vs body hip width, (2) body mesh has downward-facing "lip" triangles. Fix: widen bridge top to match body hip width (~|Y| 0.55) and cull body mesh's downward-facing hip triangles.
**Reference:** WoWModelViewer `WoWModel.cpp` setGeosetGroupDisplay(), `WoWItem.cpp` CS_PANTS, `CharTexture.cpp`; wowdev.wiki Character_Customization; `scripts/waist-boundary.ts`

## [2026-02-21] Thigh Bridge: Widening Approaches All Create Visible Artifacts

**Context:** After generating the initial thigh bridge (5-ring tubes + crotch bridge), the body mesh lip at Z 0.72-0.84 (extending to |Y|=0.54) creates a visible trapezoidal "skirt" shape. Six approaches were tried to hide it by widening the bridge's top to fill under the lip.

**Finding:** Every widening approach creates visible artifacts because of a fundamental geometric trade-off:

| # | Approach | Result | Why It Failed |
|---|----------|--------|---------------|
| 1 | Y-clamping body mesh + wide bridge (|Y|=0.48) + bridge in front (polygonOffset -1) | Massive hexagonal band | Y-clamping narrowed body to |Y|=0.39, bridge extended 0.09 beyond |
| 2 | Swap polygonOffset: body in front (-1), bridge behind (+1) | Same hexagonal band | Bridge sticks out above lip zone (Z > 0.84) where body is narrower than bridge |
| 3 | Narrow bridge (|Y|=0.38), no clamping | Wide black gap under lip | Bridge too narrow — gap from |Y|=0.38 to lip at |Y|=0.54 |
| 4 | 3-keyframe: narrow mid (|Y|=0.30), wide top (|Y|=0.50) | Horizontal bar at mid ring | Mid ring 0.03 wider than legs = 11px visible edge |
| 5 | Step easing (zero widening until t=0.8), top at |Y|=0.44 | Thin line from panel disc | Front/back panel fan triangles form disc at Z=0.76, visible edge-on |
| 6 | **Constant-width tubes to Z=0.85, no widening, no panels** | **Best result** | No artifacts from bridge. Lip still visible (inherent to mesh) |

**Key insights:**

1. **polygonOffset only works at OVERLAPS** — it controls which surface wins where two meshes occupy the same screen pixel. Where the bridge extends BEYOND the body mesh silhouette, no body mesh triangle exists to occlude it, so the bridge edge is always visible.

2. **The body mesh lip narrows at higher Z** — at Z=0.76 the lip's outer edge is at |Y|≈0.45, at Z=0.80 it's |Y|≈0.50, at Z=0.84 it reaches max |Y|≈0.54. A bridge that's wide enough at one Z level pokes out at the Z levels above/below.

3. **Front/back panel fans create visible disc shapes** — flat triangles connecting the two leg tubes (crotch bridge, front panel, back panel) form a disc at the top ring's Z level. From the front view camera, this disc's edge is visible as a horizontal line, even when covered by the body mesh at the overlap zones.

4. **Easing can't solve it** — whether t⁴, step, or cubic, the bridge must transition from leg-width (|Y|=0.27) to lip-width (|Y|=0.50). At some Z between 0.60 and 0.76, the bridge is wider than the legs but not yet covered by the body mesh lip (which starts at Z=0.72). This creates a visible widening.

5. **Constant-width is optimal** — a simple tube at constant leg-width (|Y|=0.27) extending into the body mesh (Z=0.85) creates NO visible artifacts from the bridge itself. The body mesh lip remains visible, but that's an inherent mesh limitation, not a bridge problem.

**The geometric limit:** The body mesh bottom boundary has a "lip" — triangles extending from inner ring (Z=0.72, |Y|=0.41) outward/upward to outer ring (Z=0.84, |Y|=0.54). This lip is designed to be hidden by texture compositing (underwear painted on the skin atlas). No geometric approach can hide it without creating worse artifacts. The constant-width bridge fills the gap between legs and body while adding zero new visual problems.

**Impact:** Final bridge design is two constant-width tubes (matching 501 top cross-section) from Z=0.58 to Z=0.85 with a 4-quad crotch bridge connecting inner vertices at the top ring. No front/back panels. No widening. Body mesh renders in front (polygonOffset -1), bridge behind (+1). Next step for improvement: texture compositing.
**Reference:** `src/loadModel.ts` thigh bridge section, comparison screenshots in `screenshots/`

## [2026-02-21] Texture Compositing — The Correct Solution for Thigh Gap

**Context:** After 17 geometric approaches to hide the body mesh thigh gap (vertex snapping, centroid shrink, thigh bridge tubes, widening, panel fans), researched how WoWModelViewer and other implementations actually solve this.

**Finding:** The body mesh thigh gap and hip "lip" are designed to be hidden by **texture compositing**, not geometry. The WoW client composites multiple CharSections textures into a single 256×256 body atlas:

1. Base skin (CharSections type=0) → full canvas
2. Face lower/upper (type=1) → CR_FACE_LOWER/UPPER regions
3. Underwear pelvis/torso (type=4) → CR_LEG_UPPER / CR_TORSO_LOWER regions

The underwear pelvis texture paints skin-colored underwear across the CR_LEG_UPPER region (128, 96, 128, 64) — exactly where the body-to-leg boundary sits. This creates visual continuity across the geometric seam.

No correct WoW model viewer implementation uses bridge geometry. The thigh bridge is a workaround that should be replaced by proper texture compositing.

**Impact:** Implemented: (1) extracted base vanilla textures from texture.MPQ, (2) built CharTexture compositor, (3) wired composited texture into renderer. Bridge geometry remains — the thigh gap is a geometric void (zero vertices Z 0.20-0.70) that texture compositing alone cannot fill. However, the composited underwear texture provides correct color continuity across the body-bridge-leg boundary, significantly improving appearance over the old wizard skin.
**Reference:** `docs/research/09-character-compositing-research.md`, `src/charTexture.ts`, WoWModelViewer `CharTexture.cpp`

---

## Approaches Summary

Scannable tables per problem area. Add a new table once a problem accumulates 2+ attempts.

### Leg Geometry

| # | Approach | Outcome | Key Insight |
|---|----------|---------|-------------|
| 1 | 55% centroid shrink | FAILED | Inner vertices collapsed past each other, black gaps between legs |
| 2 | Nearest-body-vertex lerp (0.85) | FAILED | V-shaped skirt flaps remained, lerp doesn't account for directionality |
| 3 | Selective nearest-vertex lerp (protruding only) | PARTIAL | Reduced skirt but left rectangular band at sides |
| 4 | Centroid shrink + radius clamp (0.55, minR=0.85*bodyMinR) | PARTIAL | Best vertex manipulation result, but still visible band |
| 5 | Normal-based vertex snapping (dot > 0) | PARTIAL | Eliminated skirt but created hip wings from triangle distortion |
| 6 | Stretch ratio triangle culling (3x) on top of snapping | PARTIAL | Reduced wings but crotch gap remained |
| 7 | Angular-aware vertex projection (atan2) | FAILED | Created wide horizontal shelf — body wider than geoset at waist |
| 8 | X-direction clamping | FAILED | Still visible skirt + gap |
| 9 | Remove ALL vertex manipulation + correct geoset defaults | SUCCESS | WoW does NO vertex manipulation at runtime |

| 10 | Correct geosets (502+902+903) but no vertex manipulation | PARTIAL | No wings/gaps, but 502=boots, 902/903=kneepads look like armor |
| 11 | Switch to 501 (bare feet) + thigh bridge geometry | SUCCESS | Generate fill geometry like neck patch; 5-ring tube per leg with crotch bridge |
| 12 | Y-clamp body lip + wide bridge in front (polygonOffset -1) | FAILED | Clamped body narrower than bridge → massive hexagonal band |
| 13 | Swap polygonOffset: body in front, bridge behind | FAILED | Bridge extends beyond body above lip zone (Z > 0.84) |
| 14 | Narrow bridge (|Y|=0.38) under lip, body untouched | FAILED | Wide black gap between lip outer (|Y|=0.54) and bridge (|Y|=0.38) |
| 15 | 3-keyframe: narrow mid + wide top under lip | FAILED | Mid ring 0.03 wider than legs = visible horizontal bar |
| 16 | Step easing + top at |Y|=0.44 + front/back panels | FAILED | Panel fan triangles form disc seen edge-on as horizontal line |
| 17 | **Constant-width tubes to Z=0.85, no widening, no panels** | **BEST** | No bridge artifacts. Body lip remains (inherent mesh limitation) |

**Conclusion:** Never manipulate existing model vertices. Never try to widen the bridge to cover the body mesh lip — every widening approach creates visible artifacts (shelves, bars, discs). The optimal geometric bridge is constant-width (matching leg cross-section) extending into the body mesh, with body rendering in front via polygonOffset. The body mesh lip at Z 0.72-0.84 requires texture compositing (CharSections underwear textures baked onto the skin atlas) to fully eliminate.

## [2026-02-22] Thigh Gap Is By Design — Geoset 903 Fills It, No Bridge Needed

**Context:** After 17 iterations building and tweaking a synthetic thigh bridge (hand-crafted tube geometry connecting legs to body), investigated whether any M2 patch version has body mesh thigh geometry.

**Finding:** No vanilla WoW M2 has body mesh thigh geometry. Verified across ALL 4 patches:

| Patch | Body mesh (geoset 0) verts in thigh zone Z 0.20–0.72 | Total verts |
|-------|-------------------------------------------------------|-------------|
| patch-3 | **0** | 3,159 |
| patch-6 | **0** | 4,675 |
| patch-7 | **0** | 4,675 |
| patch/  | **0** | 3,159 |

The extra 1,516 vertices in patch-6/7 are Turtle WoW custom hairstyles (geosets 14–18, all Z > 1.35 = head area) and doubled equipment geosets — NOT thigh geometry.

Geoset 903 already reaches Z 0.7275, overlapping the body mesh (Z 0.72) by 0.0075 units. Combined with 502 (Z 0.125–0.614), this gives continuous M2 geometry coverage from feet to waist:

| Geometry | Z range | Overlap |
|----------|---------|---------|
| 502 (legs) | 0.125 → 0.614 | — |
| 903 (upper legs) | 0.492 → 0.728 | overlaps 502 at 0.49–0.61 |
| Body mesh | 0.720 → 1.964 | overlaps 903 at 0.72–0.73 |

Switched to patch-6 M2 for smoother 903 (64 tris vs 32 in patch-3) and more hairstyle options (geosets 14–18). Removed ~90 lines of synthetic thigh bridge code.

**Process failures identified:**
1. Never established ground truth (what a naked character SHOULD look like)
2. Assumed patch-3 was incomplete without comparing — all patches have the same gap
3. Built bridge before understanding WHY the gap exists
4. Dismissed 903 as "kneepads armor" without testing with composited skin texture
5. 17 bridge iterations were unnecessary — the M2 already had the solution

**Impact:** Removed synthetic bridge geometry entirely. Enabled geoset 903 in DEFAULT_GEOSETS. Continuous skin coverage from Z 0.125 to 1.964 using only native M2 geometry. Code reduced by ~90 lines. Always check existing geoset coverage before engineering geometric solutions.
**Reference:** `src/loadModel.ts` DEFAULT_GEOSETS, `scripts/convert-model.ts` (switched to patch-6)

### Upper Back Hole

| # | Approach | Outcome | Key Insight |
|---|----------|---------|-------------|
| 1 | Move 1002 from clothing to body layer | REVERTED | Undershirt flared out at waist without shrink, hole not fixed |
| 2 | DoubleSide on 1002 + selective unshrink | FAILED | Hole is NOT caused by culling or shrinking |
| 3 | Patch mesh (12-triangle fan from boundary loop centroid) | SUCCESS | Hole is intentional in the M2, designed for hair/armor coverage |

**Conclusion:** Intentional holes in the body mesh should be filled with generated patch geometry, not by repurposing equipment geosets.

## [2026-02-26] Tapered Thigh Bridge — Filling the Lateral Gap

**Context:** Geoset 903 was supposed to bridge legs to body, but analysis revealed the gap is LATERAL, not vertical. At Z ~0.72: 903 top is at |Y| 0.11-0.28 (leg-width) while body bottom is at |Y| 0.48-0.50 (hip-width). Zero geometry connects them.

**Finding:** Built a tapered thigh bridge with 6 approaches tested:

| # | Approach | Result | Key Insight |
|---|----------|--------|-------------|
| 18 | Tapered bridge, ease-out, topCenterY=-0.45, crotch at top ring | Golden color, visible bar | UVs mapped to underwear region; crotch bridge at wide top ring visible |
| 19 | Fix UVs (v=0.63-0.69), reduce shift to -0.38, crotch at ring 1 | Skin-colored, bar still visible | Crotch bridge at ring 1 creates horizontal bar; top ring too conservative |
| 20 | Remove crotch bridge entirely | Clean thighs, inner gap acceptable | No horizontal bars; inner thigh gap (|Y| ±0.10) less objectionable than bars |
| 21 | Add crotch panel (rings 0-2 inner vertices connected) | Multiple horizontal bars | Vertical connection triangles appear edge-on as 3 horizontal lines — WORSE |
| 22 | Ease-in (t^2) interpolation | Horn/tusk shapes | Concentrated widening at top creates dramatic outer-hip curves |
| **23** | **Ease-out (1-(1-t)^2), topCenterY=-0.40, no crotch bridge** | **BEST** | Natural taper; most widening hidden inside body mesh; skin UVs match |

**Final bridge design:**
- Bottom ring: matches 502 top boundary (Z ~0.55-0.61, centered |Y| ~0.18)
- Top ring: center shifted to |Y| ~0.40, Z=0.85 (inside body mesh)
- 5 rings, 6 verts each, ease-out lateral shift, linear Z
- No crotch bridge (horizontal bars from any crotch connection are worse than the gap)
- Body mesh: polygonOffset -1 (renders in front); Bridge: polygonOffset +1 (behind)
- UVs map to v=0.63-0.69 (skin-colored thigh region, NOT underwear at v=0.38-0.50)

**Remaining artifacts:**
1. Body mesh lip/shelf at Z 0.72-0.84 — downward-facing triangles wider than bridge top
2. Inner thigh gap — no crotch geometry (every approach creates visible horizontal bars)
3. These are geometric limits requiring texture compositing to fully eliminate

**Impact:** Removed geoset 903. Added tapered thigh bridge (~80 lines). Character now has continuous legs from feet to waist. The thigh gap that was previously a massive black hole is now filled with skin-colored tapered geometry.
**Reference:** `src/loadModel.ts` thigh bridge section, comparison screenshots

### Thigh Bridge Approaches (Updated)

| # | Approach | Outcome | Key Insight |
|---|----------|---------|-------------|
| 17 | Constant-width tubes to Z=0.85 | BEST (old) | No bridge artifacts, body lip remains |
| 18 | Tapered, ease-out, crotch at top | FAILED | UVs wrong + crotch bar visible + extends past body |
| 19 | Tapered, ease-out, crotch at ring 1, fixed UVs | PARTIAL | Still visible crotch bar |
| 20 | Tapered, ease-out, no crotch | GOOD | Clean but inner thigh gap |
| 21 | Tapered + crotch panel (rings 0-2) | FAILED | Multiple horizontal bars from edge-on triangles |
| 22 | Tapered, ease-in (t^2) | FAILED | Horn shapes from concentrated lateral shift |
| **23** | **Tapered, ease-out, no crotch, shift=0.40** | **BEST** | Natural taper, skin UVs, no bars |
