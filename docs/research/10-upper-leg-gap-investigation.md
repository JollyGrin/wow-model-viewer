# 10 — Upper Leg Gap Investigation

## The Problem

When rendering the Human Male character model, the upper thigh area (between the waist loincloth and the knees) renders as empty black space. The torso, waist band, lower legs, and feet all render correctly, but there's a visible gap roughly at the Z 0.61-0.72 region.

Screenshot observation:
- Torso and waist loincloth render correctly (golden-colored band)
- Empty black space where upper thighs should be
- Knees and lower legs render correctly
- Feet render correctly

## Current State

### Enabled Geosets (from `src/loadModel.ts`)

```
0     — body mesh (torso, waist, head, feet)  →  624 tris
5     — hairstyle 4 (long hair with braids)
101   — facial 1 default (jaw geometry)
201   — facial 2 default
301   — facial 3 default
401   — bare hands
502   — legs (Z 0.13–0.61)                   →  142 tris
701   — ears visible
903   — upper legs (Z 0.49–0.73)             →   64 tris
1002  — undershirt (upper back/chest)         →   32 tris
```

### Expected Coverage Chain (if everything renders)

| Geometry | Z Range | Triangles |
|----------|---------|-----------|
| 502 (legs) | 0.125 → 0.614 | 142 |
| 903 (upper legs) | 0.492 → 0.728 | 64 |
| Body mesh (0) | 0.720 → 1.964 | 624 |

With overlap at Z 0.49-0.61 (502↔903) and Z 0.72-0.73 (903↔body), there should be **continuous coverage from feet to head**. The fact that a gap is visible means something is preventing 903 from rendering or displaying correctly.

### Available Geosets in model.json (leg-related)

| ID | indexStart | indexCount | Tris | Purpose |
|----|-----------|-----------|------|---------|
| 501 | 14124 | 258 | 86 | Bare feet |
| 502 | 15516 | 426 | 142 | Wider legs/boots |
| 503 | 14898 | 618 | 206 | Tall boots |
| 504 | 15942 | 462 | 154 | Full greaves |
| 902 | 14382 | 324 | 108 | Kneepads variant 2 (Z 0.34-0.61) |
| 903 | 14706 | 192 | 64 | Kneepads variant 3 (Z 0.49-0.73) |
| 1102 | 13440 | 144 | 48 | Pants doublet |
| 1301 | 12990 | 354 | 118 | Trousers (legs visible) |
| 1302 | 13728 | 396 | 132 | Dress/robe |

---

## Hypotheses

### Hypothesis 1: Geoset 903 UV Coordinates Map to a Transparent Texture Region

**Likelihood: HIGH**

The skin texture (`skin.tex`, 262KB = 256x256 RGBA) is a composited atlas. The 903 geoset's UV coordinates likely map to the `CR_LEG_UPPER` region of the atlas (128, 96, 128, 64). If this region has transparent (alpha=0) pixels — or if the compositing failed to paint skin color there — the geometry would exist but be **invisible**.

The compositing pipeline (`src/charTexture.ts`) overlays underwear textures onto `CR_LEG_UPPER`. If the base skin texture already has correct pixels in that region, this wouldn't be an issue. But if we're using the Turtle WoW `HumanMale_Magic.blp` or another custom skin that may not have full thigh coverage, the 903 region could be partially or fully transparent.

**Investigation steps:**
1. Dump the UV coordinates of geoset 903 vertices to see exactly where they map on the 256x256 atlas
2. Inspect the `skin.tex` file to check if pixels in the CR_LEG_UPPER region (128, 96, 128, 64) have alpha > 0
3. Compare with a properly composited base vanilla skin texture from `texture.MPQ`

### Hypothesis 2: The `isGeosetVisible` Function Has a Subtle Group-Matching Bug

**Likelihood: MEDIUM**

The current visibility function:
```typescript
function isGeosetVisible(id: number, enabled: Set<number>): boolean {
  const group = Math.floor(id / 100);
  for (const eqId of enabled) {
    if (Math.floor(eqId / 100) === group && eqId === id) return true;
  }
  return false;
}
```

This iterates through ALL enabled IDs for each geoset check, which is correct but unnecessarily complex. The simpler `enabled.has(id)` would be equivalent. The potential bug: if the manifest contains a geoset with a slightly different ID than expected (e.g., the M2 had geoset 903 but the conversion rounded or shifted it), the exact match would fail.

The function also has an edge case with geoset 0: both `0` and `5` are in group 0 (since `floor(0/100) = 0` and `floor(5/100) = 0`). The body mesh (id=0) and hairstyle (id=5) are BOTH in group 0. The function correctly handles this because it checks exact ID match, but this means group 0 has TWO enabled geosets — violating the "one per group" rule that WoW enforces. This doesn't cause the thigh gap directly, but indicates the visibility logic doesn't match the WoW client exactly.

**Investigation steps:**
1. Add console.log to `isGeosetVisible` to verify 903 returns true
2. Add console.log in the index-building loop to confirm 903's 192 indices are added to `skinIndices`
3. Simplify the function to `enabled.has(id)` and test

### Hypothesis 3: The Model Conversion Produced Invalid Index Data for Geoset 903

**Likelihood: MEDIUM**

The `scripts/convert-model.ts` parser reads vanilla M2 v256 submesh data. If the submesh parsing has an off-by-one error or if the vanilla M2 struct packing differs for certain submeshes, the `indexStart` and `indexCount` for geoset 903 could point to wrong indices. The resulting triangles would either:
- Reference vertices outside the thigh region (displaced geometry)
- Create degenerate triangles (zero-area, invisible)
- Overlap with other geometry and lose to depth testing

The manifest shows 903 at indexStart=14706, indexCount=192. If these indices point to the correct vertex positions in the shared buffer, the triangles should render.

**Investigation steps:**
1. Write a diagnostic script to read model.bin and extract the actual vertex positions referenced by geoset 903 indices
2. Verify they fall within the expected Z range (0.49-0.73)
3. Check that no indices are out of bounds (> vertexCount)
4. Visualize 903 in isolation to confirm it produces thigh-shaped geometry

### Hypothesis 4: The Skin Texture Material's Alpha Is Hiding 903 Geometry

**Likelihood: HIGH**

The renderer uses `MeshLambertMaterial` with the skin texture:
```typescript
const skinMaterial = new THREE.MeshLambertMaterial({
  map: skinTexture,
  side: THREE.DoubleSide,
});
```

Three.js `MeshLambertMaterial` respects the texture's alpha channel by default. If the skin texture has transparent pixels in the UV region that geoset 903 maps to, those triangles would be transparent/invisible.

Key detail: `MeshLambertMaterial` doesn't have `transparent: true` set explicitly, BUT Three.js may still respect alpha=0 pixels depending on the texture format. With `DataTexture` using `THREE.RGBAFormat`, the alpha channel IS present.

Also: the `.tex` format uses a 4-byte header (width + height) followed by raw RGBA. If the compositing pipeline didn't fill the thigh region, those pixels would be whatever was in the base texture (possibly zeros = transparent black).

**Investigation steps:**
1. Check if the material has `alphaTest` or `transparent` set
2. Try adding `alphaTest: 0` or `transparent: false` to the material to force opaque rendering
3. Inspect the skin.tex file's alpha channel in the CR_LEG_UPPER region
4. Try rendering 903 with a solid color material to confirm the geometry exists

### Hypothesis 5: Geoset 1301 (Trousers) Is Required for Complete Leg Coverage

**Likelihood: LOW-MEDIUM**

From WoWModelViewer source (`WoWModel.cpp`), the default initialization sets ALL geoset groups to value 1. For group 13 (trousers), value 1 = geoset 1301 ("legs visible" mode). This geoset has 118 triangles and provides trouser-like geometry covering the upper legs.

Currently, 1301 is NOT in `DEFAULT_GEOSETS`. In the WoW client, 1301 may provide additional thigh coverage that works in conjunction with geosets 502 and 903.

However, the name "trousers" and the fact that WoWModelViewer treats it as "legs visible" (as opposed to 1302 = "dress") suggests this geoset shows the legs **as-is** rather than adding geometry. It may be that 1301 represents the "pant legs" look that covers from waist to knees, providing the thigh coverage that the body mesh lacks.

**Investigation steps:**
1. Add 1301 to `DEFAULT_GEOSETS` and test
2. Analyze geoset 1301's vertex positions to determine its Z-height coverage
3. Check if 1301 overlaps with 502 and 903 or fills a different region
4. Compare the visual result with 1301 enabled vs disabled

### Hypothesis 6: Geoset 902 Provides Better Coverage Than 903

**Likelihood: LOW**

Geoset 902 has 108 triangles (vs 903's 64) and covers Z 0.34-0.61. It's a BIGGER geoset with more geometry. However, its Z-max is 0.61, which still leaves a gap to the body mesh at Z 0.72. Geoset 903 reaches Z 0.73, which is why it was chosen.

The one-per-group rule (both are in group 9xx) means only one can be active. If 903's geometry is somehow corrupt or its UV mapping is wrong, 902 might be worth trying even with the gap.

**Investigation steps:**
1. Try switching from 903 to 902 to see if it renders visible geometry
2. If 902 renders but 903 doesn't, the issue is specific to geoset 903's data

### Hypothesis 7: wowserhq/scene's "Render Everything" Approach Is Correct for Vanilla

**Likelihood: MEDIUM**

The `@wowserhq/scene` library renders ALL submeshes unconditionally — no geoset filtering at all. This "show everything" approach works because:
1. Equipment-level geosets (boots, gloves) overlap with body mesh, and depth testing resolves which surface is in front
2. All body parts are covered by at least one geoset
3. The composited skin texture provides uniform appearance across overlapping regions

Maybe the correct approach for our viewer is to render ALL geosets (or at least all non-equipment geosets) rather than carefully selecting which ones to show. The overlapping geometry would sort itself out via depth testing.

The downside: rendering all 53 geosets simultaneously would show all hairstyle variants, all glove types, all boot types, etc., on top of each other. This only works if you have the full compositing + filtering pipeline.

**Investigation steps:**
1. Temporarily enable ALL geosets (remove the `isGeosetVisible` filter) and render
2. See if the thigh area fills in
3. If yes, systematically narrow down which additional geosets are needed
4. Compare with wowserhq/scene's rendering approach

---

## Recommended Investigation Order

1. **Quick diagnostic** (5 min): Add `console.log` in the index-building loop to confirm geoset 903's indices are being added. Render with a solid red material (no texture) to confirm geometry exists.

2. **Texture inspection** (10 min): Inspect the alpha channel of `skin.tex` in the CR_LEG_UPPER region (pixel coords 128-255, 96-159). If alpha is 0, the compositing pipeline needs fixing.

3. **Try adding geoset 1301** (2 min): Add 1301 to DEFAULT_GEOSETS and see if the thigh area fills in.

4. **Force opaque material** (2 min): Set `transparent: false` and `alphaTest: 0` on the skin material to force all geometry to render regardless of texture alpha.

5. **Render all geosets** (2 min): Remove the geoset filter entirely to see what the model looks like with everything enabled.

---

## References

- `src/loadModel.ts` — geoset visibility logic, DEFAULT_GEOSETS, material setup
- `src/charTexture.ts` — texture compositing regions (CR_LEG_UPPER = 128, 96, 128, 64)
- `public/models/human-male/model.json` — manifest with all 53 geoset groups
- `scripts/convert-model.ts` — M2 v256 parser, submesh extraction
- `docs/LEARNINGS.md` — 17 previous thigh gap fix attempts documented
- `docs/research/09-character-compositing-research.md` — compositing pipeline analysis
- [wowdev.wiki — Character Customization](https://wowdev.wiki/Character_Customization) — geoset group table
- [wowdev.wiki — M2/.skin](https://wowdev.wiki/M2/.skin) — submesh ID encoding
- [wowdev.wiki — DB/ItemDisplayInfo/GeosRenderPrep](https://wowdev.wiki/DB/ItemDisplayInfo/GeosRenderPrep) — default geoset formula
- [WoWModelViewer source](https://github.com/wowmodelviewer/wowmodelviewer) — `WoWModel.cpp`, `CharDetails.cpp`, `wow_enums.h`
- [wowserhq/scene](https://github.com/wowserhq/scene) — renders all submeshes unconditionally
