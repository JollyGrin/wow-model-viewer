# Ralph Progress Log

## [2026-02-18] Eval improvement: Added 3/4 rear and top-down camera views
- Status: done
- Files changed: e2e/human-male.spec.ts
- Notes: Front and back views were insufficient — they hide side-profile issues (waist flaring) and upper-back holes. Added rear-quarter view (camera at -2, 1.3, 2) and top-down back view (camera at -1.5, 2.8, 0) to catch these issues. All four views must be checked for regressions on every change.

## [2026-02-18] Task: Fix upper back hole — Attempt 1 (REVERTED)
- Status: reverted
- Files changed: src/loadModel.ts (reverted)
- Decisions: Tried moving 1002 from CLOTHING_GEOSETS to BODY_LAYER_GEOSETS.
- Notes: FAILED. Removing the shrink caused the undershirt to flare out at the waist like a skirt — a clear regression visible in side profile. The back hole also was not actually fixed (visible from top-down view). The straight-on back view hid both problems. Reverted to baseline.

## [2026-02-18] Task: Fix upper back hole — Attempt 2 (SUCCESS)
- Status: done
- Files changed: src/loadModel.ts
- Decisions: Used geometry analysis to discover the root cause and generated a patch mesh.
- Notes: Investigated approaches A (DoubleSide on 1002) and B (selective unshrink) — both failed because the hole is NOT caused by culling or shrinking. Analysis revealed:
  1. Geoset 1002 only covers Z=[0.927, 1.105] — too low for the neck hole
  2. Body mesh (geoset 0) has 12-vertex boundary loop forming a hole at Z=[1.58, 1.81] — the entire back of the neck
  3. This hole is intentional in the WoW model, normally covered by hair/armor
  4. Solution: generated a 12-triangle fan patch from the centroid to fill the boundary loop, using UVs sampled from nearest body vertices for proper skin texturing
  5. Also split geoset 1002 into its own UNDERSHIRT_GEOSETS set with DoubleSide rendering (belt-and-suspenders approach)
  6. Small dark area remains where head meets hair (separate boundary loop at Z=1.81-1.92, covered by hairstyle geoset)

## [2026-02-19] Task: Fix upper leg dark patches
- Status: done
- Files changed: src/loadModel.ts
- Decisions: Used Approach B (normal copying) + switched clothing to DoubleSide.
- Notes: For each clothing vertex, found the nearest body vertex and copied its normal (nx, ny, nz) to the clothing vertex data. This makes the clothing shading match the body surface, eliminating the dark rectangular bands caused by different normals. Also switched clothing material from FrontSide to DoubleSide so back-facing triangles in body holes are visible, reducing see-through gaps. Result: front view upper thighs have much more continuous skin tone, dark bands largely eliminated. Some seam lines remain from geometry gaps between body edge and shrunk clothing, but the overall appearance is significantly improved. No regressions in other views — neck patch intact, waist band acceptable.

## [2026-02-19] Task: Add close-up legs camera view
- Status: done
- Files changed: e2e/human-male.spec.ts
- Notes: Added 5th camera view at (1.5, 0.55, 0) targeting (0, 0.55, 0) — close-up front legs capturing waist-to-feet area. Clearly shows all three leg problems: waist skirt, black gaps between body and shrunk clothing, and knee seams. This view is the primary eval target for the upper leg fix task.

## [2026-02-19] Task: Fix upper leg gaps and skirt
- Status: done
- Files changed: src/loadModel.ts, docs/LEARNINGS.md
- Decisions: Replaced 55% radial shrink with normal-based vertex snapping.
- Notes: The 55% shrink was the root cause of massive black see-through gaps. Removing shrink fixed gaps but revealed waist skirt (clothing extending beyond body silhouette). Tried 5 approaches:
  1. Uniform 10% shrink — skirt barely affected
  2. Boundary clamp (maxR per height) — clothing within body maxR, no effect
  3. Face culling (scalar maxR) — damaged kneepads, skirt untouched
  4. Face culling (directional maxR, 12 sectors) — more kneepad damage, skirt still there
  5. **Normal-based vertex snapping (SUCCESS)** — for each clothing vertex, find nearest body vertex. If dot(displacement, body_normal) > 0 (vertex outside body surface), snap to body position. Leaves hole-filling vertices untouched.

  Result: waist skirt eliminated, black gaps gone, continuous skin tone at upper thighs. Minor triangle artifacts remain at hip sides and knees. No regressions in other views — neck patch and upper back intact.

## [2026-02-19] Task: Fix hip wing protrusions — Attempt (BLOCKED)
- Status: blocked
- Files changed: src/loadModel.ts (reverted to best state)
- Decisions: Tried 3 variations, all worse than baseline hard snap with dot > 0.001.
- Notes: Attempted:
  1. **Smooth lerp + distance guard (dist < 0.15)** — waist skirt returned because distance guard prevented skirt vertices from snapping. Major regression.
  2. **Higher dot threshold (0.02)** — no visible change vs dot > 0.001, hip wings identical.
  3. **Normal projection (subtract dot*normal)** — severe distortion because body normals at hole boundaries point in inconsistent directions. Much worse than hard snap.

  Root cause analysis: the hip wings are caused by triangle distortion at the clothing/body boundary where some vertices snap and neighbors don't. All vertex-level approaches (threshold tuning, lerp, projection) trade off between skirt elimination and wing artifacts. A fundamentally different approach is needed — either triangle-connectivity-aware snapping, or a post-snap mesh smoothing pass. Reverted to hard snap baseline which remains the best overall result.

## [2026-02-19] Task: Fix hip wing protrusions — Triangle-level culling (IMPROVEMENT)
- Status: done
- Files changed: src/loadModel.ts
- Decisions: Used edge stretch ratio culling — compare post-snap vs pre-snap edge lengths for each clothing triangle. If any edge grew >3x, skip that triangle from the index buffer.
- Notes: Tried 3 approaches:
  1. **Absolute edge length threshold (0.12)** — way too aggressive. Removed ALL upper thigh triangles, leaving legs disconnected from torso. Clothing triangles naturally have edges > 0.12.
  2. **Stretch ratio 3x (SUCCESS)** — compare post-snap/pre-snap edge length squared. If ratio > 9, cull triangle. Hip wings significantly reduced from massive flaps to small remnants. Good balance — catches stretched triangles without removing natural geometry.
  3. **Stretch ratio 2x** — slightly more wing removal but also removed useful thigh coverage triangles. Net worse than 3x.

  Result: 3x stretch ratio is the best balance. Hip wings dramatically reduced. Small remnants remain at hip sides but no longer dominate the silhouette. Dark crotch gap is now the biggest visual issue (separate task). No regressions in upper body views.

## [2026-02-19] Task: Fix legs — Strip vertex manipulation, use correct WoW defaults (SUCCESS)
- Status: done
- Files changed: src/loadModel.ts
- Decisions: Removed ALL vertex manipulation (snapping, clamping, stretch culling). Used correct WoW geoset defaults per formula. Removed geoset 1102 entirely.
- Notes: Research into WoW rendering revealed the engine does NO vertex manipulation — it just toggles geoset visibility and lets depth testing handle overlaps. Our vertex snapping was CAUSING the hip wings and crotch gap, not fixing them.

  Key discoveries:
  1. **WoW geoset default formula**: `enabled_meshId = groupBase + geosetGroupValue + 1`, with default `geosetGroupValue=1`
  2. **502 (not 501) is the correct default boot**: 500+1+1=502, provides 142 tris vs 501's 86 — nearly double the leg geometry
  3. **902 (not 903) is the correct default kneepad**: 900+1+1=902, extends down to Z 0.344 vs 903's Z 0.492
  4. **Using 902+903 together** bridges the gap between 902's top (Z 0.61) and body mesh (Z 0.70)
  5. **Geoset 1102 is ALL outward flare** — 24 tris, all forming a skirt shape. No amount of vertex manipulation fixes it because it has no fill geometry, only flare.

  Approaches tried during this session:
  - Angular-aware vertex projection (atan2-based) — WORSE, created wide horizontal shelf
  - X-direction clamping — slightly better but still visible skirt + gap
  - Remove 1102 + use 502+902+903 — **BEST result**: no skirt, no wings, clean waist edge

  Final DEFAULT_GEOSETS: 0, 5, 101, 201, 301, 401, 502, 701, 902, 903, 1002
  Code reduced from ~300+ lines (with snapping infrastructure) to ~210 lines (clean rendering).

  Remaining: upper thigh gap between waist and kneepads, visible from front. This is a model design limitation — WoW fills this with underwear texture compositing. Acceptable until texture compositing is implemented.

## [2026-02-27] Task: Re-add 903 Y-stretch + crotch patch (approach #33)
- Status: done
- Hypothesis: Re-adding 903 Y-stretch (1.75× smoothstep) + body pull-down + crotch patch from approach #33 would fill the thigh gap on baked vertices, because the bone-baking LEARNINGS entry confirmed baking didn't affect thigh geometry.
- Result: confirmed — massive black void (~80px) reduced to thin seam (~15-20px)
- Prior art checked: LEARNINGS entries for approaches 30-33, bone baking experiment (2026-02-26), all 17 bridge approaches
- Files changed: src/loadModel.ts
- Screenshots: screenshots/runs/2026-02-27T14-23-16_fix-thigh-gap-before → screenshots/runs/2026-02-27T14-27-30_fix-thigh-gap-after
- Decisions: Used same parameters as original #33 (1.75× smoothstep Z 0.458-0.733, body pull Z-=0.05 Y*=0.94, 6-vertex crotch trapezoid). Adjusted body pull threshold to |Y|>0.30 and Z 0.60-0.80 to match post-baked positions.
- Notes: Vertex positions post-baking are nearly identical to pre-baked for geosets 903 and body mesh thigh zone. 903 Z range 0.458-0.733 (same as documented). Remaining seam at body/903 boundary is the documented limitation — requires vertex stitching or texture compositing to eliminate.
- Next: N/A — thigh gap is at the geometric limit. Further improvement requires texture compositing (painting underwear texture over the seam zone).

## [2026-02-27] Task: Discover geoset 1301 + remove all vertex hacking (BREAKTHROUGH)
- Status: done
- Hypothesis: Geoset 1301 (CG_TROUSERS, group 13 value=1) is the WoW default thigh geometry that bridges legs to torso, because WoWModelViewer initializes all geoset groups to value=1 and group 13 value=1 = mesh 1301.
- Result: confirmed — 118 triangles, Z 0.549–1.105, completely fills the thigh gap
- Prior art checked: All 33 prior approaches in LEARNINGS.md + thigh-gap.md memory
- Files changed: src/loadModel.ts
- Screenshots: screenshots/runs/2026-02-27T* (before/after)
- Decisions: Removed ALL vertex hacking (903 Y-stretch, body pull-down, crotch patch). Set DEFAULT_GEOSETS to [0, 5, 101, 201, 301, 401, 501, 701, 1002, 1301]. Reverted to 501 from 502.
- Notes: This was THE solution after 33 failed approaches. The thigh gap was never a rendering bug — it was a missing geoset. WoW's geoset system provides native thigh geometry that bridges the body mesh to the leg geosets.
- Next: Fix waist "skirt" where body mesh lip extends beyond geoset 1301.

## [2026-02-27] Task: Polygon offset layering for waist skirt fix
- Status: done
- Hypothesis: Splitting body mesh (geoset 0) and overlay geosets (1301, 1002) into separate SkinnedMesh objects with polygon offset on the body mesh will make overlays win the depth test in overlap zones, hiding the body mesh lip.
- Result: partial — polygon offset prevents Z-fighting and makes overlays render on top in overlap zones. The body mesh lip is still visible at the sides where it extends beyond geoset 1301 laterally.
- Prior art checked: LEARNINGS entries for polygon offset approaches
- Files changed: src/loadModel.ts
- Screenshots: See human-male-legs-test.png, human-male-front-test.png
- Decisions: Three separate SkinnedMesh objects (body, overlay, hair). Body has polygonOffset factor=1 units=1. Overlays render at true depth.
- Notes: The remaining visible seam at the waist is from the body mesh being geometrically wider than geoset 1301 at the sides. Polygon offset only helps where surfaces overlap in screen space — it can't hide body mesh triangles that extend beyond the overlay's silhouette. A pipeline-level fix may be needed (e.g., trimming body mesh triangles in convert-model.ts).
- Next: Evaluate whether body mesh lip needs pipeline-level trimming or if current state is acceptable.
