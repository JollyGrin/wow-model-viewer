# 11 — How Other Repos Solve Character Geoset Rendering

## The Universal Default Geoset Rule

Every major WoW model viewer converges on the same formula for default (naked) geoset visibility:

```
visible = (id == 0) || (id > 100 && id % 100 == 1)
```

This means: **geoset 0 (body mesh) plus every XX01 geoset is visible by default.**

### Evidence Across 5 Independent Codebases

| Project | Language | Rule | Source File |
|---------|----------|------|-------------|
| **WMVx** (Frostshake) | C++ | `geoset_id == 0 \|\| (geoset_id > 100 && geoset_id % 100 == 1)` | `CharacterCustomization.cpp:931` |
| **wow.export** (Kruithne) | JS | `submeshID === 0 \|\| submeshID.toString().endsWith('01')` | `M2RendererGL.js:566` |
| **wow-mdx-viewer** (barncastle) | TS | `DefaultGeosets = [0, 101, 201, 301, 401, 501, 702, 801, 901, ...]` | `characterRenderer.ts:17` |
| **WoWModelViewer** (classic) | C++ | `cd.geosets[i] = 1` → `targetMeshId = group*100 + 1` | `WoWModel.cpp:2294` |
| **WebWowViewerCpp** (Deamon87) | C++ | `meshIds[group]` defaults to empty (render all) | `m2Object.cpp:1282` |
| **wowserhq/scene** | TS | No filtering — renders ALL submeshes | `ModelLoaderWorker.ts` |

### The WMVx Implementation (Clearest)

From `Frostshake/WMVx` — `src/core/modeling/CharacterCustomization.cpp`:

```cpp
void ModelDefaultsGeosetModifier::operator()(GeosetState& state)
{
    state.each([](auto& el) {
        const auto geoset_id = el.first;
        el.second = geoset_id == 0 || (geoset_id > 100 && geoset_id % 100 == 1);
    });
}
```

Equipment then OVERRIDES specific groups via `setVisibility(group, value)`.

---

## What This Means for Vanilla Human Male

Running the XX01 rule against our actual model.json geoset IDs:

| Group | Default (XX01) | Exists in M2? | Meaning |
|-------|---------------|---------------|---------|
| 0 | 0 (body) | **YES** | Body mesh — always visible |
| 0 | 1 (bald scalp) | **YES** | Default hairstyle |
| 1 | 101 | **YES** | Jaw/beard default |
| 2 | 201 | **YES** | Sideburns default |
| 3 | 301 | **YES** | Moustache default |
| 4 | 401 | **YES** | Bare hands |
| 5 | 501 | **YES** | Bare feet/lower legs |
| 7 | 701 | **YES** | Ears (note: some viewers use 702) |
| 8 | 801 | **NO (DNE)** | No sleeves for naked character |
| **9** | **901** | **NO (DNE)** | **No kneepads for naked character** |
| 10 | 1001 | **NO (DNE)** | No undershirt for naked character |
| 11 | 1101 | **NO (DNE)** | No pants for naked character |
| 12 | 1201 | **NO (DNE)** | No tabard |
| **13** | **1301** | **YES** | **Trousers — "legs visible" mode** |
| 15 | 1501 | **YES** | Cape (first style) |

**Critical insight**: Geoset 901 DOES NOT EXIST in vanilla Human Male. When the WoW client sets group 9 to value 1 (= geoset 901), nothing renders because there's no mesh with that ID. This is intentional — **a naked character has NO upper-leg geoset geometry**. The thigh area is filled purely by texture compositing.

**Our current approach uses 903** (which DOES exist, 64 tris, Z 0.49-0.73). This diverges from what every other viewer does. Either:
1. 903 is rendering but invisible due to texture issues, OR
2. We should follow the standard rule (901 = DNE = nothing) and rely on texture compositing

---

## Geoset 1301 — The Overlooked Piece

Geoset 1301 (group 13, "trousers — legs visible") **DOES exist** in our M2 with 118 triangles. The XX01 rule enables it by default. Our DEFAULT_GEOSETS does NOT include it.

1301 may provide additional leg/thigh coverage. The name "trousers" is misleading — in the WoW client, `CG_TROUSERS` group 13 with value 1 means "show legs" (as opposed to value 2 = "show dress/robe"). This geometry may represent the basic leg shape that's visible when wearing pants or when naked.

**All four codebase implementations include 1301 in their defaults.**

---

## The wowserhq/scene Approach — Just Render Everything

`@wowserhq/scene` takes the simplest approach: render ALL batches from the skin profile with no filtering. This works because overlapping geosets are resolved by depth testing. The downside is all hairstyle/facial variants render simultaneously, but for a quick test this would confirm whether geometry exists.

```typescript
// wowserhq/scene — NO geoset filtering at all
for (let i = 0; i < skinProfile.batches.length; i++) {
    const batch = skinProfile.batches[i];
    groups.push({
        start: batch.skinSection.indexStart,
        count: batch.skinSection.indexCount,
        materialIndex: i,
    });
}
```

---

## Recommended Changes to DEFAULT_GEOSETS

### Option A: Follow the XX01 Standard Rule
```typescript
const DEFAULT_GEOSETS = new Set([
  0,     // body mesh
  1,     // bald scalp (default hair, override with CharHairGeosets)
  101,   // facial 1 default
  201,   // facial 2 default
  301,   // facial 3 default
  401,   // bare hands
  501,   // bare feet
  701,   // ears (or 702 per WMV)
  // 801  — DNE (no sleeves)
  // 901  — DNE (no kneepads)
  // 1001 — DNE (no undershirt)
  // 1101 — DNE (no pants)
  // 1201 — DNE (no tabard)
  1301,  // trousers: legs visible
  // 1501 — cape: probably should be disabled for naked character
]);
```

This matches what WoWModelViewer, WMVx, wow.export, and barncastle all do. The thigh area would have NO geometry and would rely on texture compositing for visual continuity.

### Option B: Keep 903 But Fix the Texture
Keep using 903 for geometric coverage of the thigh area, but ensure the skin texture has opaque pixels in the UV region 903 maps to. This deviates from other viewers but provides geometric coverage that texture compositing alone can't.

### Option C: Hybrid — XX01 Standard + Debug 903
Use Option A as the baseline, then separately test whether adding 903 improves the appearance. Debug with a solid-color material first to confirm 903 geometry renders.

---

## Source URLs

- WMVx default geosets: https://github.com/Frostshake/WMVx (`src/core/modeling/CharacterCustomization.cpp`)
- wow.export geoset logic: https://github.com/Kruithne/wow.export (`src/js/3D/renderers/M2RendererGL.js`)
- barncastle DefaultGeosets: https://github.com/barncastle/wow-mdx-viewer (`src/renderer/character/characterRenderer.ts`)
- WoWModelViewer refresh(): https://github.com/wowmodelviewer/wowmodelviewer (`src/games/wow/WoWModel.cpp`)
- WebWowViewerCpp meshIds: https://github.com/Deamon87/WebWowViewerCpp (`wowViewerLib/src/engine/objects/m2/m2Object.cpp`)
- wowserhq/scene (no filtering): https://github.com/wowserhq/scene (`src/lib/model/loader/ModelLoaderWorker.ts`)
- wowdev.wiki GeosRenderPrep: https://wowdev.wiki/DB/ItemDisplayInfo/GeosRenderPrep
- wowdev.wiki Character Customization: https://wowdev.wiki/Character_Customization
