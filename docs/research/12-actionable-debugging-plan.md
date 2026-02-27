# 12 — Actionable Debugging Plan for Upper Leg Gap

## Quick Summary of the Situation

Geoset 903 (64 triangles, Z 0.49-0.73) is in `DEFAULT_GEOSETS` and in `model.json`, yet the upper thigh renders as empty black space. Either the geometry isn't reaching the GPU, or it's rendering but invisible.

Meanwhile, every other WoW model viewer uses geoset **901** as the default for group 9 — which DOES NOT EXIST in vanilla Human Male. They rely on **texture compositing** to fill the thigh area, not geometry. Our approach of using 903 is non-standard.

---

## Debugging Steps (in order of bang-for-buck)

### Step 1: Solid Color Test (2 minutes)

Replace the skin material temporarily with a flat red material to confirm geometry exists:

```typescript
const debugMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide });
```

If the thigh area turns red → geometry is there, texture is the problem.
If still black → geometry is not rendering.

### Step 2: Console.log in the Index Loop (2 minutes)

Add a log to confirm 903's indices are being collected:

```typescript
for (const g of manifest.groups) {
  if (!isGeosetVisible(g.id, enabledGeosets)) {
    if (g.id === 903) console.warn('903 FILTERED OUT');
    continue;
  }
  if (g.id === 903) console.log('903 INCLUDED:', g.indexCount, 'indices');
  // ...
}
```

### Step 3: Inspect Skin Texture Alpha (5 minutes)

The skin.tex file is 256x256 RGBA. Geoset 903's UV coords likely map to the CR_LEG_UPPER region (pixels 128-255, y 96-159). Check if those pixels have alpha > 0:

```bash
# Quick check: read the .tex file header + dump pixel data
node -e "
const fs = require('fs');
const buf = fs.readFileSync('public/models/human-male/textures/skin.tex');
const w = buf.readUInt16LE(0), h = buf.readUInt16LE(2);
console.log('Texture size:', w, 'x', h);
// Check CR_LEG_UPPER region (128, 96, 128, 64)
let transparent = 0, opaque = 0;
for (let y = 96; y < 160; y++) {
  for (let x = 128; x < 256; x++) {
    const off = 4 + (y * w + x) * 4;
    const a = buf[off + 3];
    if (a === 0) transparent++; else opaque++;
  }
}
console.log('CR_LEG_UPPER region: opaque=' + opaque + ' transparent=' + transparent);
"
```

If `transparent` is high → the compositing pipeline isn't painting the thigh region.

### Step 4: Try the XX01 Standard + geoset 1301 (2 minutes)

Switch to what every other viewer uses:

```typescript
const DEFAULT_GEOSETS = new Set([
  0, 1, 101, 201, 301, 401, 501, 701, 1301
]);
```

This adds 1301 (118 tris, "trousers - legs visible") and removes 502→501, 903, 1002. If the thigh area fills in with 1301, that was the missing piece.

### Step 5: Render ALL Geosets (2 minutes)

Disable the visibility filter entirely to see what the full model looks like:

```typescript
// Skip the filter — include everything
for (const g of manifest.groups) {
  const target = HAIR_GEOSETS.has(g.id) ? hairIndices : skinIndices;
  for (let i = 0; i < g.indexCount; i++) {
    target.push(fullIndexData[g.indexStart + i]);
  }
}
```

If the thigh area fills → one of the excluded geosets was needed.

### Step 6: Dump 903 Vertex Positions (5 minutes)

Read model.bin and extract actual Z positions for 903's referenced vertices:

```bash
node -e "
const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync('public/models/human-male/model.json'));
const bin = fs.readFileSync('public/models/human-male/model.bin');
const verts = new Float32Array(bin.buffer, 0, manifest.vertexBufferSize / 4);
const indices = new Uint16Array(bin.buffer, manifest.vertexBufferSize, manifest.indexCount);

const g903 = manifest.groups.find(g => g.id === 903);
console.log('Geoset 903:', g903);

const zValues = new Set();
for (let i = 0; i < g903.indexCount; i++) {
  const vi = indices[g903.indexStart + i];
  const z = verts[vi * 8 + 2];  // stride=8, z is at offset 2
  zValues.add(z.toFixed(3));
}
const sorted = [...zValues].map(Number).sort((a,b) => a-b);
console.log('Z range:', sorted[0], 'to', sorted[sorted.length-1]);
console.log('Unique Z values:', sorted.length);
"
```

---

## Files From the WoW Download That Can Help

### Already Extracted (Ready to Use)

You already have the base vanilla textures extracted at `data/extracted/Character/Human/Male/`:

| File | Purpose | Status |
|------|---------|--------|
| `HumanMaleSkin00_00.blp` through `_09` | 10 skin color variants (full body base) | Extracted |
| `HumanMaleFaceLower00_00.blp`, `_01` | Face lower overlay | Extracted |
| `HumanMaleFaceUpper00_00.blp`, `_01` | Face upper overlay | Extracted |
| `HumanMaleNakedPelvisSkin00_00.blp`, `_01` | **Underwear pelvis overlay** | Extracted |

The **pelvis texture** (`HumanMaleNakedPelvisSkin00_00.blp`) is the key file — it gets composited into the CR_LEG_UPPER region (128, 96, 128, 64) of the atlas. This is what creates visual continuity across the body-to-leg boundary in the WoW client.

**Question:** Is the current `skin.tex` using these extracted textures in the compositing pipeline? Or is it still using the Turtle WoW `HumanMale_Magic.blp` as a raw skin? If the latter, the CR_LEG_UPPER region may not have proper pixel coverage.

### DBC Files in Patch Directories (Need Conversion to JSON)

These exist as raw `.dbc` binary files in the patch directories:

| DBC | Location | Purpose | Priority |
|-----|----------|---------|----------|
| `CharHairGeosets.dbc` | `data/patch/patch-3/DBFilesClient/` | Maps hairstyle → geoset ID | Medium |
| `CharacterFacialHairStyles.dbc` | `data/patch/patch-3/DBFilesClient/` | Maps facial hair → geoset IDs | Medium |
| `CharStartOutfit.dbc` | `data/patch/patch-3/DBFilesClient/` | Starting equipment per race/class | Low |

These would help with proper character customization but are NOT directly related to the thigh gap.

### MPQ Archives (Potentially Useful)

| Archive | Size | What's Inside |
|---------|------|--------------|
| `model.MPQ` | 182MB | M2 models, DBC files, .skin files |
| `texture.MPQ` | 634MB | All BLP textures including base character skins |

The base M2 model (not patch override) might have different geoset data. Comparing the base `model.MPQ` version of `HumanMale.m2` against the patch-6 version we're using could reveal differences.

### What You Could Share for Debugging

**Most useful (small, targeted):**
1. The current `public/models/human-male/textures/skin.tex` file — so we can inspect its pixel data and alpha channel
2. A screenshot of the browser console after adding the console.log from Step 2
3. A screenshot after using the solid red debug material from Step 1

**Moderately useful:**
4. The output of the Step 6 vertex dump script
5. The `HumanMaleNakedPelvisSkin00_00.blp` file — to verify the underwear texture is being composited correctly

**Less urgent:**
6. The raw `HumanMale.m2` from `model.MPQ` (base, not patch) for comparison

---

## The Key Insight From Other Repos

**No WoW model viewer renders geoset 903 for a naked character.** They all use 901 (which DNE = nothing renders). The thigh area is filled by:
1. **Texture compositing** — underwear pelvis texture painted onto the skin atlas creates visual skin continuity
2. **When equipment is worn** — pants set geoset group 9 to 902 or 903 (actual kneepads geometry)

Our renderer is the only one using 903 for a naked character. The fact that it shows as empty space suggests either:
- The texture alpha in 903's UV region is 0 (invisible), OR
- The geometry is correct but the texture mapping makes it blend with the background, OR
- The 903 indices are somehow not being included

**The standard approach is: no geometry in the thigh area for naked characters, rely on texture compositing.**

---

## DBC Files That Do NOT Exist in Vanilla

These are sometimes referenced in guides but are post-vanilla only:

| DBC | First Appeared | Purpose |
|-----|---------------|---------|
| `CharComponentTextureSections.dbc` | WoD (6.0+) | Texture atlas region definitions |
| `CharComponentTextureLayouts.dbc` | WoD (6.0+) | Atlas layout (256x256 vs 512x512) |
| `ChrCustomizationGeoset.dbc` | Shadowlands | Modern geoset customization |
| `ChrModel.dbc` | Post-vanilla | Model references |

In vanilla 1.12, the texture compositing regions are **hardcoded in the client**. Our `src/charTexture.ts` already has these hardcoded correctly.

---

## Next Steps Decision Tree

```
Does Step 1 (red material) show thigh geometry?
├── YES → Texture problem
│   ├── Check skin.tex alpha in CR_LEG_UPPER (Step 3)
│   ├── Verify compositing includes pelvis underwear texture
│   └── Fix: ensure opaque pixels in 903's UV region
│
└── NO → Geometry not rendering
    ├── Check console.log (Step 2)
    ├── Try rendering ALL geosets (Step 5)
    ├── Try adding 1301 (Step 4)
    └── Dump 903 vertex positions (Step 6)
```
