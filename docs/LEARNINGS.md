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
