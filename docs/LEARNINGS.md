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
