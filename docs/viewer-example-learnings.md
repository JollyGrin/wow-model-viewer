# Learnings from viewer-example.py (Python VTK M2 Viewer)

Compared our web pipeline (`convert-model.ts` + `loadModel.ts`) against a working
Python M2 viewer to identify gaps. Focus: the "skin flap" at the waist.

---

## 1. M2Batch Texture Chain — COMPLETELY MISSING from Web Pipeline

The Python viewer implements the full M2 texture assignment chain that WoW uses
to decide which texture goes on which submesh:

```
batch.texComboIndex → textureLookup[i] → textureTable[j].type → resolved BLP file
```

**What the Python viewer does** (viewer-example.py lines 636-660):
- Parses the **batches array** from the skin (M2Batch, 24 bytes each)
- Each batch has a `skinSectionIndex` (which submesh) and `texComboIndex` (which texture)
- Builds a mapping: submesh index → texture table key
- Groups faces by `(group, variant, tex_key)` — a **render key**
- Same geoset can have faces with DIFFERENT textures

**What our web converter does** (convert-model.ts line 113):
- Parses submeshes from the skin ✓
- **Skips the batches array entirely** ✗
- No texture-per-submesh mapping at all

**What our web renderer does** (loadModel.ts lines 216-224):
- Categorizes geosets into 3 buckets by ID: body (id=0), hair (ids 2-13), everything else (overlay)
- All body faces → skin texture
- All overlay faces → skin texture
- All hair faces → hair texture

This means we can never assign different textures to different submeshes within the same
category. Multi-pass rendering (e.g. loincloth fabric over body skin on the same geoset)
is impossible with our current approach.

### What we'd need to parse

The skin header (44 bytes) has 5 M2Arrays. We parse 3, skip 2:

```
Offset  M2Array           Status
+0      vertexIndices      ✓ parsed (remap)
+8      triangleIndices    ✓ parsed
+16     properties         ✗ skipped (bone lookup)
+24     submeshes          ✓ parsed
+32     batches            ✗ SKIPPED — this is where texture assignment lives
+40     nBones (uint32)    ✗ skipped
```

M2Batch struct (24 bytes for v256, key fields):
```
+0   uint8   flags
+1   uint8   priority
+2   uint16  skinSectionIndex     → which submesh
+4   ...
+10  uint16  colorIndex
+12  uint16  materialIndex        → render flags / blend mode
+14  ...
+16  uint16  texComboIndex        → index into textureLookup table
+18  ...
+22  uint16  transparencyIndex
```

The chain: `batch.texComboIndex` → `textureLookup[i]` → `textureTable[j]`.
`textureLookup` is another M2Array in the main header (not the skin).
`textureTable` entries have a `type` field (0=hardcoded, 1=body, 6=hair, 8=fur, etc.).

---

## 2. Geoset 1002 (Undershirt) — Possible Skin Flap Culprit

**Critical difference in default geosets:**

| Geoset | Python Viewer | Web Viewer | Notes |
|--------|--------------|------------|-------|
| Group 0 (Body) | All variants | 0 only | Python shows all body variants |
| Group 1 (Hair) | Not enabled | 5 | Both show one hairstyle |
| Group 2 (Facial1) | All variants | 101 | |
| Group 3 (Facial2) | All variants | 201 | |
| Group 4 (Bracers) | variant 1 | 401 | Match |
| Group 5 (Boots) | variant 1 | 501 | Match |
| Group 7 (Ears) | All variants | 701 | |
| **Group 10 (Chest)** | **NOT ENABLED** | **1002** | **Web has it, Python doesn't** |
| Group 13 (Legs) | variant 1 | 1301 | Match |
| Group 15 (Cape) | variant 1 | Not enabled | Python has it, web doesn't |

**Group 10 (Chest) / geoset 1002** is the "undershirt" geoset. It was added to
our DEFAULT_GEOSETS to "fill the upper back/chest gap." But the Python viewer
does NOT enable any group 10 variants by default.

If geoset 1002's mesh extends below the chest into the waist area, its lower
boundary would create a visible "flap" of skin-textured geometry sitting on top
of the loincloth zone. The polygonOffset hack pushes body (geoset 0) behind
overlays, but geoset 1002 is categorized as "overlay" — it renders at the SAME
depth as geoset 1301 (legs), creating overlap at the waist.

**Action to test:** Temporarily remove 1002 from DEFAULT_GEOSETS and see if the
skin flap disappears.

---

## 3. Multi-Texture Submeshes — How WoW Layers Body + Cloth

The Python viewer's render key system `(group, variant, tex_key)` reveals something
important: a single geoset can have triangles rendered with multiple different textures
via multiple M2Batch entries pointing to the same submesh.

Example of how the loincloth region works in WoW:
```
Batch 0: skinSectionIndex=0, texComboIndex → body skin texture
  → draws body faces (torso, limbs, head)

Batch N: skinSectionIndex=K, texComboIndex → body skin texture
  → draws the skin-colored waist wrap portion of the loincloth geoset

Batch N+1: skinSectionIndex=K, texComboIndex → loincloth fabric texture
  → draws the cloth portion of the loincloth geoset
```

Our web renderer lumps ALL non-hair, non-body submeshes into one "overlay" bucket
with a single skin texture. This can't reproduce multi-texture rendering within a
single geoset.

---

## 4. Geoset Group Names from Python Viewer

The Python viewer's `GEOSET_NAMES` provides the complete mapping (not all in our LEARNINGS):

```
Group  Name          Web DEFAULT  Python DEFAULT
0      Body          0            All variants
1      Hair          5            Not enabled
2      Facial 1      101          All variants
3      Facial 2      201          All variants
4      Bracers       401          {1}
5      Boots         501          {1}
7      Ears          701          All variants
8      Sleeves       —            —
9      Kneepads      —            —
10     Chest         1002         —          ← MISMATCH
11     Pants         —            —
12     Tabard        —            —
13     Legs          1301         {1}
14     Cloak         —            —
15     Cape          —            {1}        ← MISMATCH
16     Loincloth     —            —
17     Eyeglow       —            —
18     Belt          —            —
```

Notable:
- **Group 16 = Loincloth** — We have no loincloth geoset enabled. If the model has one,
  it could provide proper waist-to-hip transition geometry.
- **Group 15 = Cape** — Python enables 1501 by default, we don't. Low priority.
- **Group 17 = Eyeglow** — Blood Elves have glowing eyes. Currently not rendered.

---

## 5. UV Handling Comparison

| Aspect | Python Viewer | Web Viewer |
|--------|--------------|------------|
| UV source | `v.uv1` (primary tex coords) | `rawF32[f+6], rawF32[f+7]` from M2 offset 32 |
| V flip | `1.0 - v.uv1[1]` explicitly | `texture.flipY = false` (no flip) |

M2 stores UVs in DirectX convention (V=0 at top). OpenGL expects V=0 at bottom.
The Python viewer flips V in the UV data. The web viewer doesn't flip UVs but also
doesn't flip the texture — both are in DirectX convention, so they're consistent.
Should be equivalent, but if textures ever look vertically mirrored, this is where to look.

---

## 6. Texture Resolution — Python vs Web Approach

**Python viewer** resolves textures at runtime from BLP files adjacent to the M2:
1. **Replaceable textures** (type 1=Body, 8=Fur): Naming convention search
   `{ModelName}Skin00_XX.blp` / `_Extra.blp`, prefers highest XX variant
2. **Hardcoded textures** (type 0): Embedded path in M2, searched locally then up parents

**Web pipeline** uses build-time compositing:
1. Hardcoded BLP paths per model in `convert-textures.ts`
2. Composites face/pelvis/torso overlays into a single atlas
3. Outputs one `skin.tex` + optionally one `hair.tex`

The web approach works for character models (which use composited skin atlases) but
won't generalize to creature models or items. Those use the batch texture chain with
multiple independent textures per model.

---

## 7. Bone Transform — Subtle Difference

**Python viewer** (line 383):
```python
local = t_pivot @ t_trans @ r_mat @ s_mat @ t_neg_pivot
```
Transform order: `T(pivot) * T(translation) * R(rotation) * S(scale) * T(-pivot)`

**Web viewer** (loadModel.ts line 100):
```typescript
local.copy(posPivot).multiply(rot).multiply(negPivot);
// posPivot = T(pivot + translation)
```
Transform order: `T(pivot + translation) * R(rotation) * T(-pivot)`

The web viewer **folds translation into the pivot offset** and **omits scale**.
This is equivalent for the rest pose (first keyframe only), but:
- If scale != (1,1,1) on any bone's first keyframe, web viewer ignores it
- The folding is mathematically equivalent only when scale = identity

For animation support later, the web viewer will need the full transform chain.

---

## 8. Likely Root Cause of the Skin Flap

Based on comparison, the most likely causes (in order of probability):

1. **Geoset 1002 extending into the waist zone** — This "undershirt" geoset isn't
   enabled by the Python viewer at all. Its lower boundary may overlap the loincloth
   area, creating the flap. Quick test: remove 1002.

2. **Missing M2Batch texture chain** — Without per-submesh texture mapping, faces at
   the body/loincloth boundary all get the same skin texture. WoW draws these with
   different blend modes (opaque body behind, alpha-blended cloth on top) via the
   batch system. Our single-material approach can't replicate this layering.

3. **Body mesh (geoset 0) bottom lip** — Already partially addressed with polygonOffset,
   but the body mesh has ~94 vertices at Z 0.70-0.85 forming two concentric rings.
   If polygonOffset isn't pushing far enough, these poke through.

4. **Missing geoset 1601 (Loincloth)** — If the model has a dedicated loincloth geoset
   in group 16, it might provide proper waist-transition geometry that covers the body
   mesh boundary. Currently not in our DEFAULT_GEOSETS.
